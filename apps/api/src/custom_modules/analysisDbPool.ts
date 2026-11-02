import * as mysql from "mysql2/promise";
import config from "../config";

/**
 * Dedicated, read-only connection pools for the MCP connectors: the analysis
 * connector (EffektAnalysisDB) and the Claude Tag connector (EffektPseudoDB). This is intentionally SEPARATE from the main DAO pool in
 * DAO.ts: the DAO pool authenticates as a user that can write to the
 * operational database (EffektDonasjonDB), and must never be reused for the
 * public MCP endpoint.
 *
 * The primary security boundary is each database user itself (MCP_DB_USER should
 * only be granted SELECT on EffektAnalysisDB, MCP_TAG_DB_USER only SELECT on
 * EffektPseudoDB and EffektAnalysisDB). Everything here is defense in
 * depth on top of that.
 */

const MAX_EXECUTION_TIME_MS = 15000;

export interface ReadOnlyDb {
  /** Whether the credentials are configured; if not, the feature is disabled. */
  isConfigured(): boolean;
  /**
   * Run a query inside an explicit READ ONLY transaction with a server-side
   * execution timeout. Any attempt to write (even if the user somehow had the
   * grant) will be rejected by MySQL, and long-running queries are aborted.
   */
  runReadOnlyQuery<T = any>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[]; fields: mysql.FieldPacket[] }>;
}

/**
 * A lazily created, read-only pool for one dedicated DB user. Mirrors the
 * socket-vs-host connection logic in DAO.ts (Cloud Run uses a unix socket to
 * Cloud SQL, detected via K_SERVICE).
 */
export function createReadOnlyDb(
  credentials: () => {
    user?: string;
    password?: string;
    database?: string;
  },
): ReadOnlyDb {
  let pool: mysql.Pool | undefined;

  function getPool(): mysql.Pool {
    if (pool) return pool;
    const { user, password, database } = credentials();
    const args: mysql.PoolOptions = {
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 4,
      enableKeepAlive: true,
      timezone: "+00:00",
      // Extra guard: never allow stacked/multiple statements over this pool.
      multipleStatements: false,
    };

    if (process.env.K_SERVICE != null) {
      (args as any).socketPath = `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`;
    } else {
      (args as any).host = config.db_host;
    }

    pool = mysql.createPool(args);
    return pool;
  }

  return {
    isConfigured() {
      const { user, password, database } = credentials();
      return Boolean(user && password && database);
    },
    async runReadOnlyQuery<T = any>(sql: string, params?: any[]) {
      const conn = await getPool().getConnection();
      try {
        await conn.query(`SET SESSION max_execution_time = ${MAX_EXECUTION_TIME_MS}`);
        await conn.query("START TRANSACTION READ ONLY");
        try {
          // nosemgrep: javascript.lang.security.audit.sqli.node-mysql-sqli.node-mysql-sqli -- runs analyst SQL by design: SELECT-only DB user, READ ONLY transaction, query vetted in sqlMcpServer.ts
          const [rows, fields] = await conn.query(sql, params);
          await conn.query("COMMIT");
          return { rows: rows as T[], fields };
        } catch (ex) {
          try {
            await conn.query("ROLLBACK");
          } catch {
            /* ignore rollback failure */
          }
          throw ex;
        }
      } finally {
        conn.release();
      }
    },
  };
}

/** The analysis connector's pool (/mcp): MCP_DB_USER, SELECT on EffektAnalysisDB only. */
const analysisDb = createReadOnlyDb(() => ({
  user: config.mcp_db_username,
  password: config.mcp_db_password,
  database: config.mcp_db_name,
}));

export const isAnalysisDbConfigured = () => analysisDb.isConfigured();
export const runReadOnlyQuery = analysisDb.runReadOnlyQuery;

/**
 * The Claude Tag connector's pool (/mcp-tag): MCP_TAG_DB_USER, SELECT on the
 * pseudonymised EffektPseudoDB (docs/pseudo-db.md) and EffektAnalysisDB.
 */
export const claudeTagDb = createReadOnlyDb(() => ({
  user: config.mcp_tag_db_username,
  password: config.mcp_tag_db_password,
  database: config.mcp_tag_db_name,
}));
