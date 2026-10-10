import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import type { Snapshot } from "./api.ts";
import { createEditor } from "./server.ts";
import { DiskStore } from "./store.ts";

test("the local editor saves, undoes and streams CLI edits through its live MCP server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-editor-"));
  await cp(join(import.meta.dir, "../../examples"), join(dir, "design"), { recursive: true });
  const file = join(dir, "design/portal.buni");
  // Build outside bun:test: Bun.build there cannot resolve some browser imports.
  const child = Bun.spawn(["bun", "-e", `
    import { serveEditor } from "./src/editor/server.ts";
    const editor = await serveEditor(process.argv[1]);
    process.on("SIGTERM", () => { editor.stop(); process.exit(0); });
    console.log(editor.url);
  `, file], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "inherit" });
  const output = child.stdout.getReader();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const first = await output.read();
    const url = new URL(new TextDecoder().decode(first.value).trim());
    const call = (name: string, args: (string | { parent: string | undefined; html: string })[] = []) => fetch(`${url.origin}/rpc/${name}${url.search}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args),
    });
    const html = await (await fetch(url)).text();
    expect(html).toContain('<title>buni</title>');
    const script = html.match(/src="(\/assets\/client-[^"]+)"/)?.[1];
    expect(script).toBeDefined();
    const asset = await fetch(`${url.origin}${script}`, { headers: { "accept-encoding": "br" } });
    expect(asset.headers.get("content-encoding")).toBe("br");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${url.origin}/fonts/manrope.woff2`)).headers.get("content-type")).toBe("font/woff2");
    expect((await fetch(`${url.origin}/files/designs/design/assets/steel-rack.jpg`)).status).toBe(200);
    expect((await fetch(`${url.origin}/files/designs/other/x`)).status).toBe(404);
    expect((await fetch(url, { headers: { host: "evil.example" } })).status).toBe(403);
    expect((await fetch(`${url.origin}/rpc/undo${url.search}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "[]" })).status).toBe(403);
    const snapshot: { value: Snapshot } = await (await call("snapshot")).json();
    expect(Object.values(snapshot.value.view.pages).map((page) => page.name)).toEqual(["Home", "Pricing"]);
    const frame = snapshot.value.view.pages.pricing?.frame;
    expect(frame).toBeDefined();
    const edit = await call("edit", ["write_html", { parent: frame, html: "<p>Plans from $49</p>" }]);
    expect(edit.status).toBe(200);
    expect(await readFile(file, "utf8")).toContain("Plans from $49");
    await call("undo");
    expect(await readFile(file, "utf8")).not.toContain("Plans from $49");
    await call("redo");
    expect(await readFile(file, "utf8")).toContain("Plans from $49");
    reader = (await fetch(`${url.origin}/events${url.search}`)).body?.getReader();
    if (!reader) throw new Error("no live stream");
    await reader.read();
    const cli = Bun.spawn(["bun", "src/cli.ts", "call", file, "create_page", '{"name":"CLI page","route":"/cli"}', "--as", "test-agent"], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "inherit" });
    const reply = await new Response(cli.stdout).text();
    expect(await cli.exited).toBe(0);
    expect(reply).toContain("Created page");
    let update = "";
    while (!update.includes("CLI page")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("live stream ended before the edit");
      update += new TextDecoder().decode(chunk.value);
    }
    expect(update).toContain('"kind":"patch"');
    expect(update).toContain("CLI page");
    const again: { value: Snapshot } = await (await call("snapshot")).json();
    expect(Object.values(again.value.view.pages).some((page) => page.name === "CLI page")).toBe(true);
    expect(again.value.edits?.some((edit) => edit.author === "test-agent")).toBe(true);
    expect(parseDoc(await readFile(file, "utf8")).ok).toBe(true);
    const reopen = Bun.spawn(["bun", "src/cli.ts", "open", file, "--no-open"], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "inherit" });
    expect(await new Response(reopen.stdout).text()).toContain("Already open:");
    expect(await reopen.exited).toBe(0);
  } finally {
    await reader?.cancel();
    await output.cancel();
    child.kill();
    await child.exited;
    expect(await Bun.file(`${file}.live`).exists()).toBe(false);
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

test("the hosted editor rejects another account's files and imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-accounts-"));
  await mkdir(join(root, "a/Shop"), { recursive: true });
  await mkdir(join(root, "b/Other"), { recursive: true });
  const store = new DiskStore(root, "/people");
  await store.write("/people/a/Shop/Shop.buni", serializeDoc(emptyDoc()));
  await store.write("/people/b/Other/Other.buni", serializeDoc(emptyDoc()));
  const editor = await createEditor({ store, origin: "https://buni.test", assets: () => ({ files: new Map(), client: "", styles: "", xyflow: "" }) });
  const snapshot = (file: string) => new Request(`https://buni.test/rpc/snapshot?file=${encodeURIComponent(file)}`, {
    method: "POST", headers: { host: "buni.test", "content-type": "application/json" }, body: "[]",
  });
  try {
    expect((await editor.fetch(snapshot("/people/a/Shop/Shop.buni"), "/people/a")).status).toBe(200);
    expect((await editor.fetch(snapshot("/people/a/Shop/Shop.buni"), "/people/b")).status).toBe(404);
    expect((await editor.fetch(new Request("https://buni.test/files/people/b/Other/Other.buni", { headers: { host: "buni.test" } }), "/people/a")).status).toBe(404);
    await store.write("/people/a/Shop/Imported.buni", serializeDoc({ ...emptyDoc(), imports: ["../../b/Other/Other.buni"] }));
    const response = await editor.fetch(snapshot("/people/a/Shop/Imported.buni"), "/people/a");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("can't be read");
  } finally {
    editor.stop();
    await rm(root, { recursive: true, force: true });
  }
});


test("opening a file held by a headless MCP server cannot replace its writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-held-"));
  const file = join(dir, "held.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  const agent = Bun.spawn(["bun", "src/cli.ts", "mcp", file], { cwd: join(import.meta.dir, "../.."), stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  try {
    const deadline = Date.now() + 5000;
    while (!(await Bun.file(`${file}.live`).exists())) {
      if (Date.now() > deadline) throw new Error("MCP writer did not start");
      await Bun.sleep(10);
    }
    const marker = await readFile(`${file}.live`, "utf8");
    const editor = Bun.spawn(["bun", "src/cli.ts", "open", file, "--no-open"], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
    expect(await new Response(editor.stderr).text()).toContain("An MCP server is already editing");
    expect(await editor.exited).toBe(1);
    expect(await readFile(`${file}.live`, "utf8")).toBe(marker);
    expect(await readFile(file, "utf8")).toBe(serializeDoc(emptyDoc()));
  } finally {
    agent.kill();
    await agent.exited;
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);
