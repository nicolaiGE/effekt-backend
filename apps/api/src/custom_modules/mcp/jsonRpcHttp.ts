import type { Request, Response } from "express";
import type { JsonRpcRequest, JsonRpcResponse } from "./sqlMcpServer";

/**
 * Express handler for MCP Streamable HTTP POSTs: answers requests with a single
 * application/json JSON-RPC response (or a batch); notifications get 202 with no body.
 */
export function jsonRpcPostHandler(
  handle: (message: JsonRpcRequest) => Promise<JsonRpcResponse | null>,
) {
  return async (req: Request, res: Response) => {
    const body = req.body;

    try {
      if (Array.isArray(body)) {
        // JSON-RPC batch: collect responses to requests, drop notifications.
        const responses: JsonRpcResponse[] = [];
        for (const msg of body) {
          const r = await handle(msg);
          if (r !== null) responses.push(r);
        }
        if (responses.length === 0) return res.status(202).end();
        return res.json(responses);
      }

      const response = await handle(body);
      if (response === null) return res.status(202).end();
      return res.json(response);
    } catch (ex) {
      console.error("MCP route error:", ex);
      return res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Internal error" },
      });
    }
  };
}
