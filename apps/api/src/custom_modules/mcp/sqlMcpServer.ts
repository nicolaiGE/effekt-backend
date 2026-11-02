import type { ReadOnlyDb } from "../analysisDbPool";

/**
 * A small, dependency-free implementation of the Model Context Protocol (MCP)
 * over Streamable HTTP, exposing READ-ONLY SQL access to one or more MySQL
 * schemas through a dedicated SELECT-only DB user. Used by the analysis
 * connector (analysisMcpServer.ts, /mcp) and the Claude Tag connector
 * (claudeTagMcpServer.ts, /mcp-tag).
 *
 * We hand-roll the protocol rather than using @modelcontextprotocol/sdk because
 * the current SDK requires zod v4, whose type definitions cannot be parsed by
 * this repo's pinned TypeScript 4.9. The JSON-RPC surface for a stateless,
 * tools-only server is small and implemented here in full.
 *
 * Spec: https://modelcontextprotocol.io/specification (Streamable HTTP transport)
 */

export interface SqlMcpServerOptions {
  serverInfo: { name: string; version: string };
  instructions: string;
  db: ReadOnlyDb;
  /** Schemas the tools list and describe. The first is the default (the pool's database). */
  schemas: string[];
  /** How tool descriptions refer to the data, e.g. "the analysis database". */
  label: string;
  /** Words (schema names) that make a query fail, with the message to return. */
  forbiddenWords: { word: string; message: string }[];
  /** Tables/views that are fully off-limits (lower-case). */
  blockedTables: string[];
  /** Columns rejected if referenced and stripped from results (lower-case). */
  blockedColumns: string[];
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// Newest first. We echo the client's version if we support it, else the newest.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const MAX_RESULT_ROWS = 1000;
const MAX_RESULT_CHARS = 100_000;

class QueryRejected extends Error {}

const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

/** Strip -- line comments and /* *\/ block comments so keyword checks are reliable. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ");
}

function containsWord(haystackLower: string, word: string): boolean {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- word comes from fixed keyword/table/column lists in this file and the server options
  return new RegExp(`\\b${word}\\b`, "i").test(haystackLower);
}

const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "truncate",
  "replace",
  "merge",
  "grant",
  "revoke",
  "rename",
  "call",
  "handler",
  "load",
  "load_file", // \bload\b does not match load_file (underscore is a word char)
  "outfile",
  "dumpfile",
  "lock",
  "unlock",
  "into", // blocks SELECT ... INTO OUTFILE/DUMPFILE/@var
];

function jsonStringifySafe(value: any): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Date) return v.toISOString();
      return v;
    },
    2,
  );
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function ok(id: any, result: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function err(id: any, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function createSqlMcpServer(opts: SqlMcpServerOptions) {
  const { db, schemas, label, blockedTables, blockedColumns } = opts;
  const defaultSchema = schemas[0];
  const multiSchema = schemas.length > 1;

  const tools = [
    {
      name: "list_tables",
      description: multiSchema
        ? `List all tables and views available in ${label}, with their schema and type (BASE TABLE or VIEW).`
        : `List all tables and views available in ${label}, with their type (BASE TABLE or VIEW).`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "describe_table",
      description: multiSchema
        ? `Return the columns (name, data type, nullability, comment) of a given table or view in ${label}. Defaults to ${defaultSchema}.`
        : `Return the columns (name, data type, nullability, comment) of a given table or view in ${label}.`,
      inputSchema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table or view name, e.g. 'Donations'." },
          ...(multiSchema
            ? {
                database: {
                  type: "string",
                  enum: schemas,
                  description: `Schema to look in (default ${defaultSchema}).`,
                },
              }
            : {}),
        },
        required: ["table"],
        additionalProperties: false,
      },
    },
    {
      name: "run_sql",
      description: multiSchema
        ? `Execute a single read-only SQL SELECT (or WITH ... SELECT) against ${label} and return the rows as JSON. Unqualified tables refer to ${defaultSchema}; qualify the others (e.g. ${schemas[1]}.Donations). Only SELECT queries are permitted.`
        : `Execute a single read-only SQL SELECT (or WITH ... SELECT) against ${label} and return the rows as JSON. Only SELECT queries are permitted.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "A single read-only SELECT statement." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ];

  /**
   * Validate and normalize a user-supplied query. Returns the query to execute
   * (with a LIMIT appended if absent). Throws QueryRejected with a helpful message
   * on any violation.
   */
  function validateSelectQuery(rawQuery: string): string {
    if (typeof rawQuery !== "string" || rawQuery.trim().length === 0) {
      throw new QueryRejected("Query must be a non-empty string.");
    }

    let query = rawQuery.trim();
    // Allow a single trailing semicolon; reject any other semicolons (no stacking).
    query = query.replace(/;\s*$/, "");
    if (/\/\*|--+|#/.test(query)) {
      throw new QueryRejected("SQL comments are not allowed.");
    }
    const stripped = stripComments(query);

    if (stripped.includes(";")) {
      throw new QueryRejected("Only a single statement is allowed (no ';').");
    }

    const lower = stripped.toLowerCase();

    if (!/^\s*(select|with)\b/.test(lower)) {
      throw new QueryRejected("Only read-only SELECT (or WITH ... SELECT) queries are allowed.");
    }

    for (const kw of FORBIDDEN_KEYWORDS) {
      if (containsWord(lower, kw)) {
        throw new QueryRejected(`Query contains a disallowed keyword: '${kw}'.`);
      }
    }

    for (const { word, message } of opts.forbiddenWords) {
      if (containsWord(lower, word)) throw new QueryRejected(message);
    }

    for (const t of blockedTables) {
      if (containsWord(lower, t)) {
        throw new QueryRejected(`Table '${t}' is not accessible.`);
      }
    }
    for (const c of blockedColumns) {
      if (containsWord(lower, c)) {
        throw new QueryRejected(`Column '${c}' contains restricted data and cannot be queried.`);
      }
    }

    if (!/\blimit\b/i.test(lower)) {
      query = `${query}\nLIMIT ${MAX_RESULT_ROWS}`;
    }

    return query;
  }

  /** Remove any blocklisted columns from result rows (covers SELECT *). */
  function stripBlockedColumns(rows: any[]): any[] {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    return rows.map((row) => {
      if (row && typeof row === "object") {
        for (const key of Object.keys(row)) {
          if (blockedColumns.includes(key.toLowerCase())) {
            delete row[key];
          }
        }
      }
      return row;
    });
  }

  async function toolListTables() {
    const { rows } = multiSchema
      ? await db.runReadOnlyQuery<{ TABLE_SCHEMA: string; TABLE_NAME: string; TABLE_TYPE: string }>(
          `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
             FROM information_schema.TABLES
            WHERE TABLE_SCHEMA IN (?)
            ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME`,
          [schemas],
        )
      : await db.runReadOnlyQuery<{ TABLE_NAME: string; TABLE_TYPE: string }>(
          `SELECT TABLE_NAME, TABLE_TYPE
             FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ?
            ORDER BY TABLE_TYPE, TABLE_NAME`,
          [defaultSchema],
        );
    const visible = rows.filter((r) => !blockedTables.includes(r.TABLE_NAME.toLowerCase()));
    return textResult(jsonStringifySafe(visible));
  }

  async function toolDescribeTable(args: any) {
    let table = args?.table;
    let database: string | undefined = defaultSchema;
    if (multiSchema) {
      database = args?.database ?? defaultSchema;
      // Accept "Schema.Table" too.
      if (typeof table === "string" && table.includes(".") && args?.database === undefined) {
        [database, table] = table.split(".", 2);
      }
      database = schemas.find((s) => s.toLowerCase() === String(database).toLowerCase());
      if (!database) {
        return textResult(
          `Invalid 'database' argument: must be one of ${schemas.join(", ")}.`,
          true,
        );
      }
    }
    if (typeof table !== "string" || !IDENTIFIER_RE.test(table)) {
      return textResult("Invalid 'table' argument: must be a plain identifier.", true);
    }
    if (blockedTables.includes(table.toLowerCase())) {
      return textResult(`Table '${table}' is not accessible.`, true);
    }
    const { rows } = await db.runReadOnlyQuery(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [database, table],
    );
    if (rows.length === 0) {
      return textResult(`No table or view named '${table}' found in ${database}.`, true);
    }
    const visible = rows.filter(
      (r: any) => !blockedColumns.includes(String(r.COLUMN_NAME).toLowerCase()),
    );
    return textResult(jsonStringifySafe(visible));
  }

  async function toolRunSql(args: any) {
    let query: string;
    try {
      query = validateSelectQuery(args?.query);
    } catch (ex) {
      if (ex instanceof QueryRejected) return textResult(`Query rejected: ${ex.message}`, true);
      throw ex;
    }

    let rows: any[];
    try {
      ({ rows } = await db.runReadOnlyQuery(query));
    } catch (ex: any) {
      return textResult(`SQL error: ${ex?.sqlMessage || ex?.message || String(ex)}`, true);
    }

    const truncated = rows.length > MAX_RESULT_ROWS;
    const limited = stripBlockedColumns(rows.slice(0, MAX_RESULT_ROWS));

    let body = jsonStringifySafe({ rowCount: limited.length, truncated, rows: limited });
    if (body.length > MAX_RESULT_CHARS) {
      body = jsonStringifySafe({
        rowCount: limited.length,
        truncated: true,
        note: "Result too large to return in full; add aggregation or a smaller LIMIT.",
        rows: limited.slice(0, 50),
      });
    }
    return textResult(body);
  }

  async function callTool(name: string, args: any) {
    switch (name) {
      case "list_tables":
        return toolListTables();
      case "describe_table":
        return toolDescribeTable(args);
      case "run_sql":
        return toolRunSql(args);
      default:
        return null; // unknown tool
    }
  }

  /**
   * Handle one JSON-RPC message. Returns a response object for requests, or null
   * for notifications (which get no response body).
   */
  async function handleJsonRpcMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return err(message?.id ?? null, -32600, "Invalid Request");
    }

    const isNotification = message.id === undefined || message.id === null;
    const { method, params, id } = message;

    try {
      switch (method) {
        case "initialize": {
          const requested = params?.protocolVersion;
          const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0];
          return ok(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: opts.serverInfo,
            instructions: opts.instructions,
          });
        }
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools });
        case "tools/call": {
          const result = await callTool(params?.name, params?.arguments);
          if (result === null) return err(id, -32602, `Unknown tool: ${params?.name}`);
          return ok(id, result);
        }
        // Notifications we simply acknowledge with no response body.
        case "notifications/initialized":
        case "notifications/cancelled":
          return null;
        // Advertised capability is tools-only; be explicit for probes.
        case "resources/list":
        case "prompts/list":
          return err(id, -32601, `Method not found: ${method}`);
        default:
          if (isNotification) return null;
          return err(id, -32601, `Method not found: ${method}`);
      }
    } catch (ex: any) {
      console.error("MCP handler error:", ex);
      if (isNotification) return null;
      return err(id, -32603, "Internal error");
    }
  }

  return { handleJsonRpcMessage, tools };
}
