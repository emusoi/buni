// Designs kept on a buni server, for the command line: list them, find one by name, read it, or serve it to a local
// MCP client. Tool calls go to the server's MCP endpoint (mcpUrl), so edits land for everyone with the design open.
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { HomeFile } from "../tools/protocol.ts";
import type { Account } from "./account.ts";

/**
 * One of a buni server's RPCs, as a browser tab calls it: `file` is the design it is about, and `token` a Wazo token
 * a hosted buni takes as a bearer (none for one on this machine).
 */
export async function rpc<T>(base: string, token: string | undefined, method: string, file: string | undefined, args: readonly unknown[]): Promise<T> {
  const q = file ? `?file=${encodeURIComponent(file)}` : "";
  const res = await fetch(`${base}/rpc/${method}${q}`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: JSON.stringify(args) });
  // A proxy's error page isn't JSON: the status says more than a parse error would.
  const body: { value?: T; error?: string } | undefined = await res.json().catch(() => undefined);
  if (!res.ok || !body) throw new Error(body?.error ?? `${base}: ${res.status} ${res.statusText}`);
  // Known limitation: the server's answer is trusted to have the shape asked for, as a browser tab trusts it.
  return body.value as T;
}

/** Your designs on the server, newest first. */
export async function designs(account: Account): Promise<HomeFile[]> {
  return rpc<HomeFile[]>(account.server, account.token, "home", undefined, []);
}

/** A design by the name `buni ls` shows: exactly, else ignoring case. Its path on the server. */
export async function findDesign(account: Account, name: string): Promise<string> {
  const all = await designs(account);
  const hit = all.find((d) => d.name === name) ?? all.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.path;
  const known = all.map((d) => d.name).join(", ");
  throw new Error(`No design called "${name}" on ${new URL(account.server).host}${known ? `; you have: ${known}` : "; you have none yet"}.`);
}

/** The design's .buni text, as the server has it now. */
export async function download(account: Account, path: string): Promise<string> {
  return rpc<string>(account.server, account.token, "fileText", path, []);
}

/** Where the server serves one design's tools over MCP, and the header that signs in to it. */
export function mcpUrl(account: Account, path: string): URL {
  const url = new URL("/mcp", account.server);
  url.searchParams.set("file", path);
  return url;
}
export const bearer = (account: Account): Record<string, string> => ({ authorization: `Bearer ${account.token}` });

/**
 * A design's tools served elsewhere over HTTP (your buni server, or a buni on this machine that has it open), served
 * here over stdio: an MCP client (a coding agent) talks to it as to `buni mcp <file>`, and every message is passed
 * through and back.
 */
export async function proxyMcp(url: URL, headers: Record<string, string>): Promise<void> {
  const remote = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  const local = new StdioServerTransport();
  local.onmessage = (m) => void remote.send(m).catch((e: unknown) => process.stderr.write(`buni: ${e instanceof Error ? e.message : String(e)}\n`));
  remote.onmessage = (m) => void local.send(m);
  remote.onerror = (e) => process.stderr.write(`buni: ${e.message}\n`);
  local.onclose = () => void remote.close();
  await remote.start();
  await local.start();
}
