import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import type { Presence, Snapshot } from "./api.ts";
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
    const call = (name: string, args: unknown[] = []) => fetch(`${url.origin}/rpc/${name}${url.search}`, {
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
    const head = await fetch(`${url.origin}/files/designs/design/assets/steel-rack.jpg`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(1000);
    expect((await fetch(`${url.origin}/files/designs/other/x`)).status).toBe(404);
    // A new design from Home joins the chosen project and builds on the design named as its core.
    const made: { value: string } = await (await call("create", ["Checkout", { beside: "/designs/design/portal.buni", core: "/designs/design/portal.buni" }])).json();
    expect(made.value).toBe("/designs/design/Checkout.buni");
    const madeDoc = parseDoc(await readFile(join(dir, "design/Checkout.buni"), "utf8"), { refs: false });
    expect(madeDoc.ok && madeDoc.doc.imports).toEqual(["portal.buni"]);
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
    // The tab's feed is a WebSocket here (an event stream per tab runs out Chrome's six connections a host); another
    // site may not open one, since a socket isn't held back by CORS.
    const wsUrl = `ws://${url.host}/events${url.search}`;
    const upgrade = (origin: string) => fetch(`${url.origin}/events${url.search}`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", origin } });
    expect((await upgrade("https://evil.example")).status).toBe(403);
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((done, fail) => { socket.onopen = () => done(); socket.onerror = fail; });
    const heard = new Promise<string>((done) => { socket.onmessage = (e) => { if (String(e.data).includes("Socket page")) done(String(e.data)); }; });
    expect((await call("edit", ["create_page", { name: "Socket page", route: "/socket" }])).status).toBe(200);
    expect(await heard).toContain('"kind":"patch"');
    socket.close();
    const reopen = Bun.spawn(["bun", "src/cli.ts", "open", file, "--no-open"], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "inherit" });
    // The live stream above is a tab showing it: buni open points at it rather than opening another.
    expect(await new Response(reopen.stdout).text()).toContain("Already open in a tab:");
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
  const editor = await createEditor({ store, origin: "https://buni.test", assets: () => ({ files: new Map(), client: "", styles: "" }) });
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


test("sync mirrors a design by name: added the first time, then taken as one change with its attachments, which tabs hear", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-sync-"));
  const store = new DiskStore(root);
  const editor = await createEditor({ store, origin: "https://buni.test", assets: () => ({ files: new Map(), client: "", styles: "" }) });
  const rpc = (name: string, args: unknown[], file?: string) => editor.fetch(new Request(`https://buni.test/rpc/${name}${file ? `?file=${encodeURIComponent(file)}` : ""}`, {
    method: "POST", headers: { host: "buni.test", "content-type": "application/json" }, body: JSON.stringify(args),
  }), "/designs");
  const value = async <T>(r: Response): Promise<T> => { const j = (await r.json()) as { value?: T; error?: string }; if (!r.ok || j.value === undefined) throw new Error(j.error ?? "no value"); return j.value; };
  try {
    const first = { ...emptyDoc(), tokens: { "--bg": "#fff" } };
    const path = await value<string>(await rpc("sync", ["Shop", serializeDoc(first), []]));
    expect(path).toBe("/designs/Shop/Shop.buni");
    expect(await value<string>(await rpc("sync", ["Shop", serializeDoc(first), []]))).toBe(path);
    const heard: string[] = [];
    const stop = await editor.onChange(path, () => heard.push("changed"));
    const second = { ...first, tokens: { "--bg": "#000" }, attachments: { pic: { id: "pic", path: "assets/pic.png", mime: "image/png" } } };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(await value<string>(await rpc("sync", ["Shop", serializeDoc(second), [{ name: "pic.png", base64: Buffer.from(png).toString("base64") }]]))).toBe(path);
    // Listeners hear it on the next turn, as a tab's feed does.
    await new Promise((r) => setTimeout(r, 20));
    expect(heard.length).toBeGreaterThan(0);
    expect(await editor.text(path)).toBe(serializeDoc(second));
    expect(await store.readBytes("/designs/Shop/assets/pic.png")).toEqual(png);
    const snap = await value<Snapshot>(await rpc("snapshot", [], path));
    expect(snap.edits?.at(-1)?.author).toBe("sync");
    stop();
    await expect(rpc("sync", ["Shop", "not a design", []]).then(value)).rejects.toThrow("not a valid .buni file");
  } finally {
    editor.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("tabs on a file hear where each other is, and a tab that closes its feed leaves the list", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-presence-"));
  await mkdir(join(root, "a/Shop"), { recursive: true });
  const store = new DiskStore(root, "/people");
  const file = "/people/a/Shop/Shop.buni";
  await store.write(file, serializeDoc(emptyDoc()));
  const editor = await createEditor({ store, origin: "https://buni.test", assets: () => ({ files: new Map(), client: "", styles: "" }) });
  const rpc = (name: string, args: unknown[]) => editor.fetch(new Request(`https://buni.test/rpc/${name}?file=${encodeURIComponent(file)}`, {
    method: "POST", headers: { host: "buni.test", "content-type": "application/json" }, body: JSON.stringify(args),
  }), "/people/a");
  const feed = async (tab: string) => {
    const r = (await editor.fetch(new Request(`https://buni.test/events?file=${encodeURIComponent(file)}&tab=${tab}`, { headers: { host: "buni.test" } }), "/people/a")).body?.getReader();
    if (!r) throw new Error("no feed");
    await r.read();
    return r;
  };
  // In process the stream hands over its strings as they were enqueued, one event each.
  const next = async (r: ReadableStreamDefaultReader<Uint8Array | string>): Promise<{ present?: Presence[] }> => {
    const chunk = await r.read();
    if (chunk.done) throw new Error("feed ended");
    const text = typeof chunk.value === "string" ? chunk.value : new TextDecoder().decode(chunk.value);
    return JSON.parse(text.replace(/^data: /, ""));
  };
  try {
    const a = await feed("tab-a");
    const b = await feed("tab-b");
    const page = await (await rpc("edit", ["create_page", { name: "Home", route: "/" }])).json() as { value: { reply: string } };
    const frame = page.value.reply.match(/root frame (\S+)\./)?.[1] ?? "";
    await next(a); await next(b);
    expect((await rpc("presence", ["tab-b", "Ada", "p1", frame])).status).toBe(200);
    const heard = await next(a);
    expect(heard.present).toEqual([{ tab: "tab-b", who: "Ada", page: "p1", node: frame }]);
    // Its own presence reaches the tab too; it leaves itself out when drawing.
    expect((await next(b)).present?.map((p) => p.tab)).toEqual(["tab-b"]);
    await b.cancel();
    expect((await next(a)).present).toEqual([]);
    // No name given: the machine's user, as on buni open.
    expect((await rpc("presence", ["bad tab!", "", "p1"])).status).toBe(400);
    await rpc("presence", ["tab-a", "", "p1"]);
    expect((await next(a)).present?.[0]?.who).toBeTruthy();
    await a.cancel();
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

test("a design is served as its website: a take plays in its page's place, and each page follows the design", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-site-"));
  await mkdir(join(root, "a/Shop"), { recursive: true });
  const store = new DiskStore(root, "/people");
  const file = "/people/a/Shop/Shop.buni";
  await store.write(file, serializeDoc(emptyDoc()));
  const editor = await createEditor({ store, origin: "https://buni.test", assets: () => ({ files: new Map(), client: "", styles: "" }) });
  const get = (path: string) => editor.fetch(new Request(`https://buni.test${path}`, { headers: { host: "buni.test" } }), "/people/a");
  const edit = async (tool: string, args: unknown) => ((await (await editor.fetch(new Request(`https://buni.test/rpc/edit?file=${encodeURIComponent(file)}`, {
    method: "POST", headers: { host: "buni.test", "content-type": "application/json" }, body: JSON.stringify([tool, args]),
  }), "/people/a")).json()) as { value: { reply: string } }).value.reply;
  const frameOf = (reply: string) => reply.match(/root frame (\S+)\./)?.[1] ?? "";
  try {
    const home = await edit("create_page", { name: "Home", route: "/" });
    await edit("write_html", { parent: frameOf(home), html: "<p>As live</p>" });
    const take = await edit("create_page", { name: "Home bolder", take_of: home.match(/Created page (\S+?)[ .]/)?.[1] });
    await edit("write_html", { parent: frameOf(take), html: "<p>Bolder</p>" });
    const site = "/site/people/a/Shop/Shop.buni";
    const live = await (await get(`${site}/`)).text();
    expect(live).toContain("As live");
    // The page listens for edits, to the design it was drawn from.
    expect(live).toContain(`new EventSource("/events?file=" + encodeURIComponent("${file}"))`);
    const takeId = take.match(/Created page (\S+?)[ .]/)?.[1] ?? "";
    const to = (await get(`${site}/?page=${takeId}`)).headers.get("location");
    expect(to).toBe(`${site}/~${takeId}/`);
    const played = await (await get(to ?? "")).text();
    expect(played).toContain("Bolder");
    expect(played).not.toContain("As live");
    expect((await get(`${site}/~${takeId}/styles/pages.css`)).status).toBe(200);
    expect((await get(`${site}/~nope/`)).status).toBe(404);
  } finally {
    editor.stop();
    await rm(root, { recursive: true, force: true });
  }
});
