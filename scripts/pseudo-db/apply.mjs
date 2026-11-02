#!/usr/bin/env node
// Creates or refreshes EffektPseudoDB: one pseudonymised, read-only view per table in
// EffektDonasjonDB, following policy.mjs. See docs/pseudo-db.md.
//
//   node scripts/pseudo-db/apply.mjs --dry-run      print the SQL, change nothing
//   node scripts/pseudo-db/apply.mjs                apply (needs an admin login, e.g. root)
//
// Env: DB_HOST (127.0.0.1), DB_PORT (3306), DB_USER, DB_PASS: an admin account for a real run;
// any account that can read information_schema for EffektDonasjonDB is enough for --dry-run.
// PSEUDO_DB_READERS: comma-separated accounts that get SELECT on EffektPseudoDB, e.g.
// "mcp_claude_tag@%,claude@%" (existing accounts only; nothing else is granted to them).
//
// How it's built: the views are owned by a dedicated, LOCKED account (pseudo_view_definer) that
// can read EffektDonasjonDB and the pseudonym key. Readers only get SELECT on the views, so they
// can't read the source tables, the key, or the view definitions (no SHOW VIEW). The script
// unlocks the definer with a throwaway password just long enough to (re)create the views.

import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  KEY_DB,
  NORMALISE,
  PII_HINT,
  SAFE_COLUMNS,
  POLICY,
  SKIP_TABLES,
  SOURCE_DB,
  TARGET_DB,
} from "./policy.mjs";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const mysql = require("mysql2/promise");

const DEFINER = "pseudo_view_definer";
const dryRun = process.argv.includes("--dry-run");
const q = (id) => `\`${String(id).replace(/`/g, "``")}\``;
const lit = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

function hashExpr(kind, column) {
  if (!Object.hasOwn(NORMALISE, kind)) throw new Error(`Unknown hash kind '${kind}'`);
  // nosemgrep: javascript.lang.security.audit.unsafe-dynamic-method.unsafe-dynamic-method -- kind is checked against the fixed NORMALISE table above
  const normalise = NORMALISE[kind];
  const src = `t.${q(column)}`;
  const norm = normalise(src);
  return `IF(NULLIF(${norm}, '') IS NULL, NULL, CONCAT('${kind}_', LEFT(SHA2(CONCAT(pk.k, ':${kind}:', ${norm}), 256), 16)))`;
}

/** Build the SELECT for one table; returns { sql, problems }. */
function buildView(table, columns) {
  const policy = POLICY[table] ?? { columns: {} };
  const rules = policy.columns ?? {};
  const problems = [];
  const select = [];
  let needsKey = false;

  for (const col of Object.keys(rules)) {
    if (!columns.includes(col))
      problems.push(`policy names ${table}.${col}, which no longer exists`);
  }

  for (const col of columns) {
    const rule = rules[col];
    if (rule === undefined) {
      if (PII_HINT.test(col) && !SAFE_COLUMNS.test(col))
        problems.push(`unclassified column ${table}.${col} looks personal or secret`);
      select.push(`t.${q(col)}`);
    } else if (rule === "keep") {
      select.push(`t.${q(col)}`);
    } else if (rule === "drop") {
      // left out
    } else if (rule.hash) {
      needsKey = true;
      select.push(`${hashExpr(rule.hash, col)} AS ${q(`${col}_hash`)}`);
    } else if (rule.sql) {
      select.push(`${rule.sql} AS ${q(rule.as ?? col)}`);
    } else {
      problems.push(`bad rule for ${table}.${col}`);
    }
  }

  for (const [name, def] of Object.entries(policy.extra ?? {})) {
    if (typeof def === "string") {
      select.push(`${def} AS ${q(name)}`);
    } else if (def?.hash && columns.includes(def.of)) {
      needsKey = true;
      select.push(`${hashExpr(def.hash, def.of)} AS ${q(name)}`);
    } else {
      problems.push(`bad extra column ${table}.${name}`);
    }
  }

  const from = `${q(SOURCE_DB)}.${q(table)} t${
    needsKey ? ` CROSS JOIN (SELECT k FROM ${q(KEY_DB)}.hash_key WHERE id = 1) pk` : ""
  }`;
  const sql = `CREATE OR REPLACE SQL SECURITY DEFINER VIEW ${q(TARGET_DB)}.${q(table)} AS\nSELECT ${select.join(",\n       ")}\nFROM ${from}`;
  return { sql, problems };
}

async function main() {
  const base = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: false,
  };
  const admin = await mysql.createConnection({
    ...base,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
  });

  const [cols] = await admin.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [SOURCE_DB],
  );
  const tables = new Map();
  for (const { TABLE_NAME, COLUMN_NAME } of cols) {
    if (!tables.has(TABLE_NAME)) tables.set(TABLE_NAME, []);
    tables.get(TABLE_NAME).push(COLUMN_NAME);
  }

  const views = [];
  const problems = [];
  for (const [table, columns] of tables) {
    if (SKIP_TABLES.some((re) => re.test(table))) continue;
    const v = buildView(table, columns);
    views.push({ table, sql: v.sql });
    problems.push(...v.problems);
  }
  for (const table of Object.keys(POLICY)) {
    if (!tables.has(table)) problems.push(`policy names table ${table}, which no longer exists`);
  }
  if (problems.length) {
    console.error(
      `Policy needs attention (scripts/pseudo-db/policy.mjs):\n  - ${problems.join("\n  - ")}`,
    );
    process.exit(1);
  }

  if (dryRun) {
    for (const v of views) console.log(`${v.sql};\n`);
    console.error(`-- dry run: ${views.length} views, nothing changed`);
    await admin.end();
    return;
  }

  const readers = (process.env.PSEUDO_DB_READERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [user, host = "%"] = s.split("@");
      return `${lit(user)}@${lit(host)}`;
    });

  const definer = `${lit(DEFINER)}@'%'`;
  const tempPassword = randomBytes(24).toString("base64url");
  const run = async (conn, sql) => {
    // nosemgrep: javascript.lang.security.audit.sqli.node-mysql-sqli.node-mysql-sqli -- operator-run DDL built from policy.mjs and the live schema (identifiers quoted with q()), no request input
    await conn.query(sql);
  };

  // Schemas and the pseudonym key (created once, never rotated by this script: rotating it
  // changes every pseudonym).
  await run(admin, `CREATE DATABASE IF NOT EXISTS ${q(TARGET_DB)}`);
  await run(admin, `CREATE DATABASE IF NOT EXISTS ${q(KEY_DB)}`);
  await run(
    admin,
    `CREATE TABLE IF NOT EXISTS ${q(KEY_DB)}.hash_key (id TINYINT PRIMARY KEY, k CHAR(64) NOT NULL)`,
  );
  await run(
    admin,
    `INSERT IGNORE INTO ${q(KEY_DB)}.hash_key (id, k) VALUES (1, HEX(RANDOM_BYTES(32)))`,
  );

  // The definer account: read the source and the key, manage views in the target.
  await run(
    admin,
    `CREATE USER IF NOT EXISTS ${definer} IDENTIFIED BY ${lit(tempPassword)} ACCOUNT LOCK`,
  );
  await run(admin, `ALTER USER ${definer} IDENTIFIED BY ${lit(tempPassword)} ACCOUNT UNLOCK`);
  await run(admin, `GRANT SELECT ON ${q(SOURCE_DB)}.* TO ${definer}`);
  await run(admin, `GRANT SELECT ON ${q(KEY_DB)}.* TO ${definer}`);
  await run(admin, `GRANT SELECT, CREATE VIEW, SHOW VIEW, DROP ON ${q(TARGET_DB)}.* TO ${definer}`);

  try {
    const owner = await mysql.createConnection({ ...base, user: DEFINER, password: tempPassword });
    try {
      const [existing] = await owner.query(
        `SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`,
        [TARGET_DB],
      );
      const wanted = new Set(views.map((v) => v.table));
      for (const { TABLE_NAME } of existing) {
        if (!wanted.has(TABLE_NAME)) {
          await run(owner, `DROP VIEW ${q(TARGET_DB)}.${q(TABLE_NAME)}`);
          console.log(`dropped ${TARGET_DB}.${TABLE_NAME}`);
        }
      }
      for (const v of views) await run(owner, v.sql);
      console.log(`created/updated ${views.length} views in ${TARGET_DB}`);
    } finally {
      await owner.end();
    }
  } finally {
    await run(
      admin,
      `ALTER USER ${definer} IDENTIFIED BY ${lit(randomBytes(24).toString("base64url"))} ACCOUNT LOCK`,
    );
  }

  for (const reader of readers) {
    await run(admin, `GRANT SELECT ON ${q(TARGET_DB)}.* TO ${reader}`);
    console.log(`granted SELECT on ${TARGET_DB} to ${reader}`);
  }
  await admin.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
