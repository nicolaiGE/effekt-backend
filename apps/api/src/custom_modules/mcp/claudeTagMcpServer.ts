import config from "../../config";
import { claudeTagDb } from "../analysisDbPool";
import { createSqlMcpServer, MAX_RESULT_ROWS } from "./sqlMcpServer";

/**
 * The Claude Tag connector (/mcp-tag, routes/mcpClaudeTag.ts): READ-ONLY SQL access
 * for Claude Tag in Slack, separate from the team's analysis connector (/mcp).
 *
 * - EffektPseudoDB (default): live, pseudonymised views of the production database
 *   (docs/pseudo-db.md).
 * - EffektAnalysisDB: the nightly analysis database and its reporting views.
 *
 * The DB user (MCP_TAG_DB_USER) has SELECT on those two schemas only; that grant is
 * the boundary. Unlike the analysis connector there is no column blocklist: the
 * pseudonymised views already decide what is exposed.
 */

const PSEUDO_SCHEMA = config.mcp_tag_db_name || "EffektPseudoDB";
const ANALYSIS_SCHEMA = "EffektAnalysisDB";

export const SERVER_INFO = { name: "effekt-claude-tag-mcp", version: "1.0.0" };

const INSTRUCTIONS = `This server gives read-only SQL access (MySQL) to Stiftelsen Effekt's data, for Claude Tag in Gi Effektivt's Slack.

Schemas:
- "${PSEUDO_SCHEMA}" (the default schema): live, pseudonymised views of the production database, with the same table and column names as production (Donors, Donations, Distributions, Tax_unit, Vipps_agreements, Avtalegiro_agreements, Referral_records, Regrant_* and so on). Names, e-mails, phone numbers, national ID numbers and donor bank accounts are replaced by stable pseudonyms in *_hash columns: the same person gets the same pseudonym in every table, so they can be joined and counted. Secrets and private greetings are left out. Use it for up-to-date figures and to see how production data looks.
- "${ANALYSIS_SCHEMA}": the nightly analysis database, with ready-made reporting views (v_*), lifetime-value tables and referral statistics. Qualify its tables, e.g. ${ANALYSIS_SCHEMA}.v_Monthly_donations_per_org.

Effekt (Gi Effektivt) is a Norwegian effective-altruism nonprofit that routes donations to evidence-based charities. Amounts are in Norwegian kroner (NOK) unless a column says otherwise.

How to use:
1. Call list_tables to see the tables and views in both schemas.
2. Call describe_table before writing SQL (pass database for ${ANALYSIS_SCHEMA}).
3. Call run_sql with a single read-only SELECT (or WITH ... SELECT).

Rules & privacy:
- Read-only. INSERT/UPDATE/DELETE/DDL and multiple statements are rejected.
- Answers are read in shared Slack channels. Report aggregates and trends. Don't post rows about individual donors, pseudonyms, or free-text comments and survey answers quoted verbatim unless the person asking clearly needs them for their work, and then keep it to what they need.
- Don't try to re-identify people or reverse *_hash values.
- Results are capped at ${MAX_RESULT_ROWS} rows. Use GROUP BY / aggregation for large questions.`;

const server = createSqlMcpServer({
  serverInfo: SERVER_INFO,
  instructions: INSTRUCTIONS,
  db: claudeTagDb,
  schemas: [PSEUDO_SCHEMA, ANALYSIS_SCHEMA],
  label: `${PSEUDO_SCHEMA} and ${ANALYSIS_SCHEMA}`,
  // The DB user can't read these anyway; fail early with a clear message.
  forbiddenWords: [
    {
      word: "effektdonasjondb",
      message: `The production database itself is not accessible; use the pseudonymised views in ${PSEUDO_SCHEMA}.`,
    },
    { word: "effektpseudokey", message: "Not accessible." },
  ],
  blockedTables: [],
  blockedColumns: [],
});

export const isClaudeTagMcpConfigured = () =>
  claudeTagDb.isConfigured() && Boolean(config.mcp_tag_token);
export const handleJsonRpcMessage = server.handleJsonRpcMessage;
