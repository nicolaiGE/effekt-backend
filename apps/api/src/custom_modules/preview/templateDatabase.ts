/**
 * Template databases for previews (docs/preview-environments.md#database-templates).
 *
 * A push to main seeds a template database, preview_tpl_<seed key>_<commit>, once. A PR's
 * seed job then clones the newest suitable template inside the instance and only applies its
 * own new migrations and tops the data up to today, instead of running every migration and
 * generating all the data from scratch. Anything unexpected makes the caller fall back to the
 * full seed.
 *
 * A template is suitable when it was seeded by code with the same seed key (dist-seed/SEED_KEY,
 * a fingerprint of the seed sources) and every migration it has applied also exists in the PR,
 * so `prisma migrate deploy` only has to add the PR's newer ones.
 */
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import type * as mysql from "mysql2/promise";

export const TEMPLATE_PREFIX = "preview_tpl_";
/** preview_tpl_<seed key>_<id>; interpolated into DDL, so strict. */
export const SAFE_TEMPLATE_NAME = /^preview_tpl_[a-f0-9]{12}_[a-z0-9]{1,16}$/;
export const SEED_KEY = /^[a-f0-9]{12}$/;
/** Written last by `markTemplate`; a template without it is incomplete and never cloned. */
export const MARKER_TABLE = "_preview_template";
/**
 * prisma/devdata keeps what it generated (seed, scale, generated-through date) in this schema,
 * keyed by database name; the top-up needs the clone's own entry (prisma/devdata/store.ts).
 */
const SEED_META = { schema: "dev_seed_meta", table: "state" };

const hasSeedMeta = async (conn: mysql.Connection) => {
  const [rows] = await conn.query<Row[]>(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    [SEED_META.schema, SEED_META.table],
  );
  return rows.length > 0;
};

type Row = mysql.RowDataPacket;

/** Names of the migrations in a Prisma migrations folder. */
export const localMigrations = (dir: string): Set<string> =>
  new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
      .map((d) => d.name),
  );

/** Whether a template with these applied migrations can be brought up to the local ones. */
export const migrationsFit = (applied: string[], local: Set<string>, exact = false) =>
  applied.every((m) => local.has(m)) && (!exact || applied.length === local.size);

/**
 * A definition from SHOW CREATE … made portable to another database: no DEFINER (the object is
 * owned by whoever creates it) and references to the source schema pointed at the target.
 */
export const retarget = (sql: string, from: string, to: string) =>
  sql
    .replace(/\s*DEFINER\s*=\s*`[^`]*`@`[^`]*`/i, "")
    .split(`\`${from}\`.`)
    .join(`\`${to}\`.`);

const completedAt = async (conn: mysql.Connection, db: string): Promise<Date | null> => {
  try {
    const [rows] = await conn.query<Row[]>("SELECT MAX(created_at) AS at FROM ??.??", [
      db,
      MARKER_TABLE,
    ]);
    return rows[0]?.at ? new Date(rows[0].at) : null;
  } catch {
    return null; // no marker table: incomplete
  }
};

const appliedMigrations = async (conn: mysql.Connection, db: string) => {
  const [rows] = await conn.query<Row[]>(
    "SELECT migration_name AS name FROM ??._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    [db],
  );
  return rows.map((r) => String(r.name));
};

const templateSchemas = async (conn: mysql.Connection, like: string) => {
  const [rows] = await conn.query<Row[]>(
    "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
    [like],
  );
  return rows.map((r) => String(r.name)).filter((n) => SAFE_TEMPLATE_NAME.test(n));
};

/** The newest complete template for this seed key whose migrations fit, or null. */
export const findTemplate = async (
  conn: mysql.Connection,
  seedKey: string,
  local: Set<string>,
  { exact = false } = {},
): Promise<string | null> => {
  if (!SEED_KEY.test(seedKey)) throw new Error(`Invalid seed key "${seedKey}"`);
  let best: { name: string; at: Date } | null = null;
  for (const name of await templateSchemas(conn, `preview\\_tpl\\_${seedKey}\\_%`)) {
    const at = await completedAt(conn, name);
    if (!at) continue;
    if (!migrationsFit(await appliedMigrations(conn, name), local, exact)) continue;
    if (!best || at > best.at) best = { name, at };
  }
  return best?.name ?? null;
};

/** Marks a freshly seeded template complete. */
export const markTemplate = async (conn: mysql.Connection, db: string) => {
  if (!SAFE_TEMPLATE_NAME.test(db)) throw new Error(`Not a template database: ${db}`);
  await conn.query("CREATE TABLE IF NOT EXISTS ??.?? (created_at DATETIME NOT NULL)", [
    db,
    MARKER_TABLE,
  ]);
  await conn.query("INSERT INTO ??.?? (created_at) VALUES (UTC_TIMESTAMP())", [db, MARKER_TABLE]);
};

/** Keeps the newest `keep` complete templates (and `current`); drops the rest. */
export const pruneTemplates = async (conn: mysql.Connection, keep: number, current?: string) => {
  const all = await templateSchemas(conn, "preview\\_tpl\\_%");
  const dated = await Promise.all(
    all.map(async (name) => ({ name, at: await completedAt(conn, name) })),
  );
  const complete = dated.filter((t) => t.at).sort((a, b) => b.at!.getTime() - a.at!.getTime());
  const keepNames = new Set(complete.slice(0, keep).map((t) => t.name));
  if (current) keepNames.add(current);
  const dropped: string[] = [];
  for (const { name } of dated) {
    if (keepNames.has(name)) continue;
    await conn.query("DROP DATABASE IF EXISTS ??", [name]);
    if (await hasSeedMeta(conn)) {
      await conn.query("DELETE FROM ??.?? WHERE db_name = ?", [
        SEED_META.schema,
        SEED_META.table,
        name,
      ]);
    }
    dropped.push(name);
  }
  return dropped;
};

/**
 * Copies database `from` into `to` (dropped and recreated): tables with their data, then
 * routines, views and finally triggers, so copying the data doesn't fire them. Each object is
 * created with the sql_mode it was defined with.
 */
export const cloneDatabase = async (conn: mysql.Connection, from: string, to: string) => {
  if (!SAFE_TEMPLATE_NAME.test(from)) throw new Error(`Not a template database: ${from}`);
  const started = Date.now();
  await conn.query("SET SESSION foreign_key_checks = 0");
  await conn.query("SET SESSION unique_checks = 0");
  await conn.query("DROP DATABASE IF EXISTS ??", [to]);
  const [[charset]] = await conn.query<Row[]>(
    "SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [from],
  );
  const ident = /^[a-z0-9_]+$/;
  if (!ident.test(String(charset?.cs)) || !ident.test(String(charset?.co))) {
    throw new Error(`Unexpected character set of ${from}`);
  }
  await conn.query(`CREATE DATABASE ?? CHARACTER SET ${charset.cs} COLLATE ${charset.co}`, [to]);
  await conn.query("USE ??", [to]);
  const originalMode = (await conn.query<Row[]>("SELECT @@SESSION.sql_mode AS m"))[0][0].m;

  const [tables] = await conn.query<Row[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> ?",
    [from, MARKER_TABLE],
  );
  let rowsCopied = 0;
  for (const { name } of tables) {
    const [[def]] = await conn.query<Row[]>("SHOW CREATE TABLE ??.??", [from, name]);
    await conn.query(retarget(String(def["Create Table"]), from, to));
  }
  // Every column except generated ones (VIRTUAL/STORED), which MySQL computes itself. Not
  // EXTRA LIKE '%GENERATED%': that also matches DEFAULT_GENERATED, i.e. any column with an
  // expression default such as CURRENT_TIMESTAMP, whose values must be copied.
  for (const { name } of tables) {
    const [cols] = await conn.query<Row[]>(
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND (GENERATION_EXPRESSION IS NULL OR GENERATION_EXPRESSION = '') ORDER BY ORDINAL_POSITION",
      [from, name],
    );
    const columns = cols.map((r) => String(r.c));
    const [result] = await conn.query<mysql.ResultSetHeader>(
      "INSERT INTO ??.?? (??) SELECT ?? FROM ??.??",
      [to, name, columns, columns, from, name],
    );
    rowsCopied += result.affectedRows;
  }

  const create = async (sql: string, mode: string) => {
    await conn.query("SET SESSION sql_mode = ?", [mode]);
    await conn.query(retarget(sql, from, to));
  };

  const [routines] = await conn.query<Row[]>(
    "SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?",
    [from],
  );
  for (const { name, type } of routines) {
    const kind = type === "FUNCTION" ? "FUNCTION" : "PROCEDURE";
    const [[def]] = await conn.query<Row[]>(`SHOW CREATE ${kind} ??.??`, [from, name]);
    const sql = def[kind === "FUNCTION" ? "Create Function" : "Create Procedure"];
    if (!sql) throw new Error(`Can't read the definition of ${kind} ${name}`);
    await create(String(sql), String(def.sql_mode));
  }

  // Views may depend on each other: create in passes until none are left.
  const [viewRows] = await conn.query<Row[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?",
    [from],
  );
  let pending = viewRows.map((r) => String(r.name));
  const skippedViews: string[] = [];
  while (pending.length > 0) {
    const failed: string[] = [];
    let lastError: unknown;
    for (const name of pending) {
      const [[def]] = await conn.query<Row[]>("SHOW CREATE VIEW ??.??", [from, name]);
      try {
        await create(String(def["Create View"]), originalMode);
      } catch (err) {
        failed.push(name);
        lastError = err;
      }
    }
    if (failed.length === pending.length) {
      // What's left may be views that are already broken in the template (they reference a
      // table a later migration dropped; MySQL keeps such views but can't create them). Those
      // can't have been used, so they're skipped; anything else is a real error.
      for (const name of failed) {
        try {
          await conn.query("SELECT 1 FROM ??.?? LIMIT 0", [from, name]);
        } catch {
          skippedViews.push(name);
          continue;
        }
        throw lastError;
      }
      break;
    }
    pending = failed;
  }

  const [triggers] = await conn.query<Row[]>(
    "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY ACTION_ORDER",
    [from],
  );
  for (const { name } of triggers) {
    const [[def]] = await conn.query<Row[]>("SHOW CREATE TRIGGER ??.??", [from, name]);
    await create(String(def["SQL Original Statement"]), String(def.sql_mode));
  }

  // The generated data's metadata, under the clone's name, so the top-up can continue from it.
  let seedMeta = false;
  if (await hasSeedMeta(conn)) {
    const [result] = await conn.query<mysql.ResultSetHeader>(
      "REPLACE INTO ??.?? (db_name, data, updated) SELECT ?, data, NOW() FROM ??.?? WHERE db_name = ?",
      [SEED_META.schema, SEED_META.table, to, SEED_META.schema, SEED_META.table, from],
    );
    seedMeta = result.affectedRows > 0;
  }

  await conn.query("SET SESSION sql_mode = ?", [originalMode]);
  await conn.query("SET SESSION foreign_key_checks = 1");
  await conn.query("SET SESSION unique_checks = 1");
  return {
    tables: tables.length,
    rows: rowsCopied,
    routines: routines.length,
    views: viewRows.length - skippedViews.length,
    skippedViews,
    triggers: triggers.length,
    seedMeta,
    ms: Date.now() - started,
  };
};
