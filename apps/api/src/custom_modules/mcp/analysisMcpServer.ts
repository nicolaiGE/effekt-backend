import config from "../../config";
import { isAnalysisDbConfigured, runReadOnlyQuery } from "../analysisDbPool";
import { createSqlMcpServer, MAX_RESULT_ROWS } from "./sqlMcpServer";

/**
 * The analysis connector (/mcp): READ-ONLY SQL access to the anonymized analysis
 * database (EffektAnalysisDB) for team members' Claude custom connectors.
 * Auth is an Auth0 JWT with analysis_mcp (routes/mcp.ts). The MCP/SQL handling
 * lives in sqlMcpServer.ts, shared with the Claude Tag connector.
 */

const SCHEMA = config.mcp_db_name || "EffektAnalysisDB";

export const SERVER_INFO = { name: "effekt-analysis-mcp", version: "1.0.0" };

/**
 * Residual-PII guardrails inside the (mostly anonymized) analysis DB.
 * Comparisons are done lower-cased with word boundaries.
 *
 * - Blocked TABLES/VIEWS are fully off-limits (queries referencing them fail).
 * - Blocked COLUMNS are rejected if referenced explicitly AND stripped from any
 *   result set (so `SELECT *` cannot leak them either).
 */
const BLOCKED_TABLES = [
  "mailersend_survey_responses",
  "v_mailersend_survey_responses_raw_enriched",
];
const BLOCKED_COLUMNS = ["paymentexternal_id", "other_comment", "answer"];

const INSTRUCTIONS = `This server gives read-only SQL access to Stiftelsen Effekt's anonymized analytics database "${SCHEMA}" (MySQL).

Effekt is a Norwegian effective-altruism nonprofit that routes donations to evidence-based charities. All monetary amounts are in Norwegian Kroner (NOK).

How to use:
1. Call list_tables to see available tables and views.
2. Call describe_table to inspect columns before writing SQL.
3. Call run_sql with a single read-only SELECT (or WITH ... SELECT). Prefer the pre-built v_* views for reporting.

Useful objects:
- Tables: Donors, Donations, Tax_unit, Referral_types, Referral_records, Recurring_donor_periods, Donor_LTV, Donor_LTV_predictions, Only_GE_Donations, Only_rec_orgs_Donations.
- Views (v_*): v_Daily_donations, v_Monthly_donations_per_org, v_Yearly_donations_per_org, v_Recurring_donations, plus referral-channel, fundraiser and sporadic->recurring conversion views.

Rules & privacy:
- Read-only. INSERT/UPDATE/DELETE/DDL and multiple statements are rejected.
- The data is pseudonymized: Donor_ID is a stable pseudonym, not a real identity. Do not attempt to re-identify individuals.
- Some residual-PII fields are blocked and cannot be queried; free-text survey responses are not accessible.
- Results are capped at ${MAX_RESULT_ROWS} rows. Add GROUP BY / aggregation for large questions.`;

const server = createSqlMcpServer({
  serverInfo: SERVER_INFO,
  instructions: INSTRUCTIONS,
  db: { isConfigured: isAnalysisDbConfigured, runReadOnlyQuery },
  schemas: [SCHEMA],
  label: "the analysis database",
  // No cross-database access; only the analysis schema is reachable.
  forbiddenWords: [
    { word: "effektdonasjondb", message: "Access to the operational database is not permitted." },
  ],
  blockedTables: BLOCKED_TABLES,
  blockedColumns: BLOCKED_COLUMNS,
});

export const handleJsonRpcMessage = server.handleJsonRpcMessage;
