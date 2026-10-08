// A design's tools over MCP on this machine, for a host that has it open: `buni call` and coding agents send their
// edits here (found through the <file>.live marker) so the host stays the one writer and sees every change at once.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Workspace } from "../tools/workspace.ts";
import { createMcpServer, type HostTools } from "./server.ts";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

/**
 * MCP over HTTP on 127.0.0.1 only, with DNS-rebinding protection so web pages in a browser can't reach it. Each MCP
 * session gets its own change set. Port 0 picks a free port.
 */
export async function startMcpHttp(ws: Workspace, port: number, host: HostTools): Promise<{ url: string; server: Server }> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  // Known once listening.
  let allowedHosts: string[] = [];

  const server = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = req.method === "POST" ? await readJson(req) : undefined;
      const sid = req.headers["mcp-session-id"];
      let transport = typeof sid === "string" ? transports.get(sid) : undefined;
      if (!transport && req.method === "POST" && isInitializeRequest(body)) {
        const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, t);
          },
          enableDnsRebindingProtection: true,
          allowedHosts,
        });
        t.onclose = () => {
          if (t.sessionId) transports.delete(t.sessionId);
        };
        await createMcpServer(ws, host).connect(t);
        transport = t;
      }
      if (!transport) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "start with an initialize request" }));
        return;
      }
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(e instanceof Error ? e.message : "error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("MCP server has no TCP address");
  allowedHosts = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
  return { url: `http://127.0.0.1:${addr.port}/mcp`, server };
}
