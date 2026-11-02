import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Workspace } from "../tools/workspace.ts";
import { createMcpServer, type HostTools } from "./server.ts";

async function connect(host: HostTools) {
  const file = join(await mkdtemp(join(tmpdir(), "buni-mcp-")), "tk.buni");
  await copyFile(join(import.meta.dir, "../../examples/tk.buni"), file);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(await Workspace.open(file), host).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  return client;
}

test("read_screen is offered where the host can read a terminal screen, and passes the page through", async () => {
  const without = await connect({});
  expect((await without.listTools()).tools.map((t) => t.name)).not.toContain("read_screen");

  const asked: string[] = [];
  const client = await connect({ screenAsText: async (page) => (asked.push(page), "┌─┐\n└─┘\n") });
  const r = await client.callTool({ name: "read_screen", arguments: { page: "bee81065" } });
  expect(r.content).toEqual([{ type: "text", text: "┌─┐\n└─┘\n" }]);
  expect(asked).toEqual(["bee81065"]);
  expect((await client.callTool({ name: "read_screen", arguments: { page: "nope" } })).isError).toBe(true);
});

test("ask_person hands the question to the host and the person's answer back; no answer says to carry on", async () => {
  const asked: { author: string; question: string; options: string[] }[] = [];
  const client = await connect({ ask: async (author, q) => (asked.push({ author, ...q }), "Keep one week") });
  const r = await client.callTool({ name: "ask_person", arguments: { question: "Promise a day count?", options: ["Say 5 days", "Keep one week"] } });
  expect(r.content).toEqual([{ type: "text", text: "They answered: Keep one week" }]);
  expect(asked).toEqual([{ author: "test", question: "Promise a day count?", options: ["Say 5 days", "Keep one week"] }]);

  const silent = await connect({ ask: async () => undefined });
  const none = await silent.callTool({ name: "ask_person", arguments: { question: "Anyone?" } });
  expect(JSON.stringify(none.content)).toContain("best judgement");
  expect((await silent.callTool({ name: "ask_person", arguments: { question: "This?", node: "nope" } })).isError).toBe(true);
});

test("connected to a space, a client lists designs, picks one, starts one, and every other tool works on the one picked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-mcp-space-"));
  await copyFile(join(import.meta.dir, "../../examples/tk.buni"), join(dir, "tk.buni"));
  const open = new Map<string, Workspace>();
  const ws = async (path: string) => { let w = open.get(path); if (!w) { w = await Workspace.open(path); open.set(path, w); } return w; };
  const made: string[] = [];
  const host: HostTools = {
    designs: {
      list: async () => [{ space: "Personal", name: "tk", path: join(dir, "tk.buni"), pages: 2 }, ...made.map((p) => ({ space: "Acme", name: "New", path: p, pages: 0 }))],
      use: ws,
      create: async (name, space) => { const p = join(dir, `${name}.buni`); await Bun.write(p, '{"buni":1,"tokens":{},"pages":{},"nodes":{},"shared":{},"connections":{},"flows":{},"journeys":{},"comments":{},"sections":{},"rules":{},"attachments":{}}'); made.push(p); if (space !== "Acme") throw new Error(`No space "${space}"`); return ws(p); },
    },
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(undefined, host).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text?: string }[])[0]?.text ?? "";
  const tree = await client.callTool({ name: "read_tree", arguments: {} });
  expect(tree.isError).toBe(true);
  expect(text(tree)).toContain("use_design");
  expect(text(await client.callTool({ name: "list_designs", arguments: {} }))).toContain("Personal · tk");
  expect(text(await client.callTool({ name: "use_design", arguments: { design: "tk" } }))).toContain("Working on tk");
  expect((await client.callTool({ name: "read_tree", arguments: {} })).isError).toBeFalsy();
  const wrong = await client.callTool({ name: "create_design", arguments: { name: "New", space: "Nowhere" } });
  expect(wrong.isError).toBe(true);
  expect(text(await client.callTool({ name: "create_design", arguments: { name: "New", space: "Acme" } }))).toContain("Created. Working on New");
  const r = await client.callTool({ name: "create_page", arguments: { name: "Home", route: "/" } });
  expect(text(r)).toContain("Created page");
  expect(Object.keys((await ws(join(dir, "New.buni"))).view().pages)).toHaveLength(1);
});
