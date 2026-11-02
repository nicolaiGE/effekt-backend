import { afterEach, beforeEach, describe, it } from "vitest";
import { expect } from "chai";
import express from "express";
import request from "supertest";
import sinon from "sinon";
import config from "../config";
import { createSqlMcpServer } from "../custom_modules/mcp/sqlMcpServer";
import { claudeTagDb } from "../custom_modules/analysisDbPool";

function fakeDb(rows: any[] = []) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    db: {
      isConfigured: () => true,
      runReadOnlyQuery: async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        return { rows, fields: [] as any };
      },
    },
  };
}

const call = (name: string, args: any) => ({
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("SQL MCP server factory", function () {
  it("keeps the analysis connector's single-schema tools unchanged", async function () {
    const { db } = fakeDb();
    const server = createSqlMcpServer({
      serverInfo: { name: "x", version: "1" },
      instructions: "",
      db,
      schemas: ["EffektAnalysisDB"],
      label: "the analysis database",
      forbiddenWords: [],
      blockedTables: [],
      blockedColumns: [],
    });
    const res = await server.handleJsonRpcMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = res!.result.tools;
    expect(tools.map((t: any) => t.description)).to.deep.equal([
      "List all tables and views available in the analysis database, with their type (BASE TABLE or VIEW).",
      "Return the columns (name, data type, nullability, comment) of a given table or view in the analysis database.",
      "Execute a single read-only SQL SELECT (or WITH ... SELECT) against the analysis database and return the rows as JSON. Only SELECT queries are permitted.",
    ]);
    expect(Object.keys(tools[1].inputSchema.properties)).to.deep.equal(["table"]);
  });

  it("rejects forbidden schemas, blocked columns and writes", async function () {
    const { db, calls } = fakeDb();
    const server = createSqlMcpServer({
      serverInfo: { name: "x", version: "1" },
      instructions: "",
      db,
      schemas: ["EffektPseudoDB", "EffektAnalysisDB"],
      label: "x",
      forbiddenWords: [{ word: "effektdonasjondb", message: "nope" }],
      blockedTables: [],
      blockedColumns: ["answer"],
    });
    for (const query of [
      "SELECT * FROM EffektDonasjonDB.Donors",
      "SELECT answer FROM Mailersend_survey_responses",
      "DELETE FROM Donors",
      "SELECT 1; SELECT 2",
    ]) {
      const res = await server.handleJsonRpcMessage(call("run_sql", { query }));
      expect(res!.result.isError, query).to.equal(true);
    }
    expect(calls).to.have.length(0);
  });

  it("describes tables in either schema of a multi-schema server", async function () {
    const { db, calls } = fakeDb([{ COLUMN_NAME: "ID" }]);
    const server = createSqlMcpServer({
      serverInfo: { name: "x", version: "1" },
      instructions: "",
      db,
      schemas: ["EffektPseudoDB", "EffektAnalysisDB"],
      label: "x",
      forbiddenWords: [],
      blockedTables: [],
      blockedColumns: [],
    });
    await server.handleJsonRpcMessage(call("describe_table", { table: "Donors" }));
    await server.handleJsonRpcMessage(call("describe_table", { table: "EffektAnalysisDB.Donors" }));
    const bad = await server.handleJsonRpcMessage(
      call("describe_table", { table: "Donors", database: "EffektDonasjonDB" }),
    );
    expect(calls.map((c) => c.params)).to.deep.equal([
      ["EffektPseudoDB", "Donors"],
      ["EffektAnalysisDB", "Donors"],
    ]);
    expect(bad!.result.isError).to.equal(true);
  });
});

describe("Claude Tag MCP route (/mcp-tag)", function () {
  const saved = { ...config } as any;
  let app: express.Express;

  beforeEach(async function () {
    Object.assign(config, {
      mcp_tag_token: "tag-token-for-tests",
      mcp_tag_db_username: "u",
      mcp_tag_db_password: "p",
      mcp_tag_db_name: "EffektPseudoDB",
    });
    sinon.stub(claudeTagDb, "runReadOnlyQuery").resolves({ rows: [], fields: [] as any });
    const { mcpClaudeTagRouter } = await import("../routes/mcpClaudeTag");
    app = express();
    app.use("/mcp-tag", mcpClaudeTagRouter);
  });

  afterEach(function () {
    sinon.restore();
    for (const k of [
      "mcp_tag_token",
      "mcp_tag_db_username",
      "mcp_tag_db_password",
      "mcp_tag_db_name",
    ]) {
      (config as any)[k] = saved[k];
    }
  });

  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };

  it("rejects requests without the token", async function () {
    await request(app).post("/mcp-tag").send(init).expect(401);
    await request(app).post("/mcp-tag").set("Authorization", "Bearer wrong").send(init).expect(401);
  });

  it("answers with the token", async function () {
    const res = await request(app)
      .post("/mcp-tag")
      .set("Authorization", "Bearer tag-token-for-tests")
      .send(init)
      .expect(200);
    expect(res.body.result.serverInfo.name).to.equal("effekt-claude-tag-mcp");
  });

  it("is disabled when no token is configured", async function () {
    (config as any).mcp_tag_token = undefined;
    await request(app)
      .post("/mcp-tag")
      .set("Authorization", "Bearer tag-token-for-tests")
      .send(init)
      .expect(404);
  });
});
