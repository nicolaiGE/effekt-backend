import { Router, json, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import * as crypto from "crypto";
import config from "../config";
import {
  handleJsonRpcMessage,
  isClaudeTagMcpConfigured,
} from "../custom_modules/mcp/claudeTagMcpServer";
import { jsonRpcPostHandler } from "../custom_modules/mcp/jsonRpcHttp";

/**
 * Remote MCP endpoint for Claude Tag only (docs/pseudo-db.md), separate from the
 * team's analysis connector at /mcp.
 *
 * Auth: Authorization: Bearer <MCP_TAG_TOKEN>. Claude Tag attaches the token at
 * its proxy (a Bearer custom connector for this host), so it never reaches the
 * session sandbox, and the endpoint is not in the claude.ai connector library.
 * No OAuth: nobody can sign in to this connector with their own account.
 *
 * Disabled (404) unless MCP_TAG_TOKEN and the MCP_TAG_DB_* credentials are set.
 */

export const mcpClaudeTagRouter = Router();

mcpClaudeTagRouter.use(json({ limit: "1mb" }));

// Modest rate limit to protect the database, independent of the global limiter.
mcpClaudeTagRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
  }),
);

/** Constant-time comparison that does not leak length. */
function tokenMatches(provided: string | undefined): boolean {
  const expected = config.mcp_tag_token;
  if (!expected || typeof provided !== "string") return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireClaudeTagToken(req: Request, res: Response, next: NextFunction) {
  if (!isClaudeTagMcpConfigured()) return res.status(404).end();
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.match(/^Bearer\s+(\S+)$/i)?.[1] : undefined;
  if (!tokenMatches(token)) {
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    return res.status(401).json({ error: "invalid_token" });
  }
  next();
}

mcpClaudeTagRouter.use(requireClaudeTagToken);

// MCP clients may open a GET stream or DELETE a session; we are stateless.
mcpClaudeTagRouter.get("/", (_req, res) => res.status(405).end());
mcpClaudeTagRouter.delete("/", (_req, res) => res.status(405).end());

mcpClaudeTagRouter.post("/", jsonRpcPostHandler(handleJsonRpcMessage));

export default mcpClaudeTagRouter;
