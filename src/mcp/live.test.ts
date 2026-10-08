import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = join(import.meta.dir, "../cli.ts");
const exists = (f: string) => Bun.file(f).exists();
const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await ok()); i++) await Bun.sleep(50);
};

test("one buni mcp holds a design; buni call and other MCP clients edit through it, and it lets go when it ends", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-live-")), "tk.buni");
  await copyFile(join(import.meta.dir, "../../examples/tk.buni"), file);

  // The first takes the design: it serves it on localhost and says so in tk.buni.live.
  const first = Bun.spawn(["bun", CLI, "mcp", file], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  await until(() => exists(`${file}.live`));
  expect(JSON.parse(await readFile(`${file}.live`, "utf8"))).toMatchObject({ pid: first.pid });

  // buni call goes through it, not to the file underneath.
  const call = Bun.spawnSync(["bun", CLI, "call", file, "create_page", '{"name":"Help","route":"/help"}']);
  expect(call.exitCode).toBe(0);

  // A second buni mcp passes its client through to the first, screenshots included, and sees that edit.
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: "bun", args: [CLI, "mcp", file] }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toContain("screenshot");
  expect(tools).toContain("read_screen");
  const tree = await client.callTool({ name: "read_tree", arguments: {} });
  expect(JSON.stringify(tree.content)).toContain("Help");
  await client.close();

  // Its client gone, the first lets go of the design; the edit is in the file.
  first.stdin.end();
  await first.exited;
  expect(await exists(`${file}.live`)).toBe(false);
  expect(await readFile(file, "utf8")).toContain('"Help"');
}, 30_000);
