import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp/server.ts";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { findBrowser } from "../term/chrome.ts";
import { Workspace, diskStore } from "./workspace.ts";
import { within } from "../editor/store.ts";

const browser = findBrowser();
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6L3kAAAAASUVORK5CYII=';
async function design() {
  const dir = await mkdtemp(join(tmpdir(), "buni-import-page-"));
  const file = join(dir, "design.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  return { dir, file, ws: await Workspace.open(file) };
}

test.skipIf(!browser)("MCP imports a responsive HTML section with source context; the editable design persists and undoes as one edit", async () => {
  const { dir, file, ws } = await design();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(ws);
  const client = new Client({ name: "import agent", version: "1" });
  try {
    await server.connect(a); await client.connect(b);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("import_html_page");
    const result = await client.callTool({ name: "import_html_page", arguments: {
      html: '<style>.card{display:flex;gap:24px}@media(max-width:500px){.card{gap:8px}}</style><section id="card" class="card"><h1>Hello</h1></section><footer>Outside</footer>',
      selector: "#card", width: 390, source_file: "src/Card.tsx", symbol: "Card", page: { name: "Card", route: "/card" },
    } });
    expect(result.isError).not.toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    const section = Object.values(ws.view().nodes).find((n) => n.name === "card")!;
    expect(section.style.gap).toBe("8px");
    expect(ws.view().nodes[page.frame]!.style.width).toBe("390px");
    expect(page.sources).toEqual([{ file: "src/Card.tsx", symbol: "Card", selector: "#card" }]);
    expect(Object.values(ws.view().nodes).filter((n) => n.kind === "text").map((n) => n.text)).toEqual(["Hello"]);
    const text = Object.values(ws.view().nodes).find((n) => n.kind === "text")!;
    expect((await ws.call("agent", "set_text", { node: text.id, text: "Edited" })).ok).toBe(true);
    expect((await ws.undo()).ok).toBe(true);
    expect((await ws.undo()).ok).toBe(true);
    expect(Object.keys(ws.view().pages)).toHaveLength(0);
    expect((await ws.redo()).ok).toBe(true);
    expect((await Workspace.open(file)).view().pages[page.id]?.sources).toEqual(page.sources);
  } finally { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("local HTML resolves nested CSS and deduplicated image attachments inside an existing frame", async () => {
  const { dir, file, ws } = await design();
  try {
    await mkdir(join(dir, "css")); await mkdir(join(dir, "images"));
    await writeFile(join(dir, "images/pixel.png"), Buffer.from(png, "base64"));
    await writeFile(join(dir, "css/main.css"), '.card{display:flex;gap:18px;background-image:url(../images/pixel.png)}');
    await writeFile(join(dir, "page.html"), '<link rel="stylesheet" href="css/main.css"><section id="card" class="card"><h1>From file</h1><p>asset:buni-import-image-1-asset</p><img src="images/pixel.png"><img src="images/pixel.png"></section><footer>Outside</footer>');
    expect((await ws.call("agent", "create_page", { name: "Existing" })).ok).toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    expect((await ws.call("agent", "import_html_page", { file: "page.html", selector: "#card", parent: page.frame })).ok).toBe(true);
    const attachment = Object.values(ws.view().attachments)[0]!;
    expect(Object.keys(ws.view().attachments)).toHaveLength(1);
    expect(Object.values(ws.view().nodes).some((n) => n.kind === "text" && n.text === "asset:buni-import-image-1-asset")).toBe(true);
    expect(await readFile(join(dir, attachment.path))).toEqual(Buffer.from(png, "base64"));
    expect(Object.values(ws.view().nodes).find((n) => n.name === "card")?.style.gap).toBe("18px");
    expect(Object.values(ws.view().nodes).find((n) => n.name === "card")?.sources).toEqual([{ file: "page.html", selector: "#card" }]);
    expect(Object.values(ws.view().nodes).filter((n) => n.kind === "image").map((n) => n.asset)).toEqual([attachment.id, attachment.id]);
    expect((await ws.undo()).ok).toBe(true);
    expect(Object.keys(ws.view().nodes)).toEqual([page.frame]);
    expect(Object.keys(ws.view().attachments)).toHaveLength(0);
    expect((await ws.redo()).ok).toBe(true);
    expect((await Workspace.open(file)).view().attachments[attachment.id]).toEqual(attachment);
    const before = serializeDoc(ws.view());
    for (const selector of ["#missing", "img", "["]) {
      const bad = await ws.call("agent", "import_html_page", { file: "page.html", selector, parent: page.frame });
      expect(bad.ok).toBe(false);
      expect(serializeDoc(ws.view())).toBe(before);
    }
    expect((await ws.call("agent", "import_html_page", { file: "../outside.html", parent: page.frame })).ok).toBe(false);
    expect(serializeDoc(ws.view())).toBe(before);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("URL imports use guarded static resources without scripts or credentials, and hosted storage refuses loopback", async () => {
  const { dir, file, ws } = await design();
  const requests: { path: string; cookie: string | null; authorization: string | null }[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const path = new URL(req.url).pathname;
    requests.push({ path, cookie: req.headers.get("cookie"), authorization: req.headers.get("authorization") });
    if (path === "/style.css") return new Response('.card{color:rgb(12,34,56)}', { headers: { "content-type": "text/css" } });
    if (path === "/redirect") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    return new Response('<link rel="stylesheet" href="style.css"><section id="card" class="card"><h1>Static</h1></section><script>document.querySelector("h1").textContent="Executed";fetch("/evil")</script>', { headers: { "content-type": "text/html" } });
  } });
  const url = `http://localhost:${server.port}`;
  try {
    const result = await ws.call("agent", "import_html_page", { url, selector: "#card", page: { name: "URL" } });
    expect(result.ok).toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    expect(page.sources).toEqual([{ url: `${url}/`, selector: "#card" }]);
    expect(Object.values(ws.view().nodes).find((n) => n.name === "card")?.style.color).toBe("rgb(12, 34, 56)");
    expect(Object.values(ws.view().nodes).filter((n) => n.kind === "text").map((n) => n.text)).toEqual(["Static"]);
    expect(requests.map((r) => r.path)).toEqual(["/", "/style.css"]);
    expect(requests.every((r) => r.cookie === null && r.authorization === null)).toBe(true);
    expect((await ws.call("agent", "import_html_page", { url, page: { name: "Whole page" } })).ok).toBe(true);
    const whole = Object.values(ws.view().pages).find((p) => p.name === "Whole page")!;
    expect(whole.sources).toEqual([{ url: `${url}/`, selector: "body" }]);
    expect(Object.values(ws.view().nodes).filter((n) => n.kind === "text").map((n) => n.text)).toEqual(["Static", "Static"]);
    const before = serializeDoc(ws.view());
    const scoped = within(diskStore, dir, false);
    expect(scoped.localImports).toBe(false);
    await expect(scoped.readBytes!(join(dir, "../outside.html"))).rejects.toThrow("outside your designs");
    await expect(scoped.writeBytes!(join(dir, "../outside.png"), new Uint8Array())).rejects.toThrow("outside your designs");
    const hosted = await Workspace.open(file, scoped);
    expect((await hosted.call("agent", "import_html_page", { url, page: { name: "Blocked" } })).reply).toContain("private");
    expect((await ws.call("agent", "import_html_page", { url: `${url}/redirect`, page: { name: "Blocked" } })).reply).toContain("private");
    expect(serializeDoc(ws.view())).toBe(before);
    for (const args of [{ html: '<p>Text</p>', url }, {}, { html: '<p>Text</p>', base_url: 'file:///tmp/' }]) {
      expect((await ws.call("agent", "import_html_page", { ...args, page: { name: "Bad" } })).ok).toBe(false);
    }
    expect(serializeDoc(ws.view())).toBe(before);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 60_000);
