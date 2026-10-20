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

test.skipIf(!browser)("live URL imports run the page's scripts, sign in with cookies and wait for it to settle; hosted storage refuses them", async () => {
  const { dir, file, ws } = await design();
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    if (new URL(req.url).pathname === "/style.css") return new Response('.card{color:rgb(12,34,56)}', { headers: { "content-type": "text/css" } });
    const signedIn = req.headers.get("cookie")?.includes("session=owner") === true;
    return new Response(`<link rel="stylesheet" href="style.css"><main id="app"></main><script>setTimeout(() => {
      document.getElementById("app").innerHTML = ${JSON.stringify(signedIn ? '<section id="card" class="card"><h1>Documents</h1></section>' : '<h1>Sign in</h1>')};
    }, 300)</script>`, { headers: { "content-type": "text/html" } });
  } });
  const url = `http://localhost:${server.port}/`;
  try {
    const result = await ws.call("agent", "import_html_page", { url, live: true, cookies: "session=owner; theme=dark", wait_for: "#card", selector: "#card", page: { name: "Live" } });
    expect(result.ok).toBe(true);
    expect(Object.values(ws.view().nodes).find((n) => n.name === "card")?.style.color).toBe("rgb(12, 34, 56)");
    expect(Object.values(ws.view().nodes).filter((n) => n.kind === "text").map((n) => n.text)).toEqual(["Documents"]);
    expect(Object.values(ws.view().pages)[0]!.sources).toEqual([{ url, selector: "#card" }]);
    const before = serializeDoc(ws.view());
    expect((await ws.call("agent", "import_html_page", { url, live: true, wait_for: "#card", page: { name: "Signed out" } })).reply).toContain("never showed #card");
    expect((await ws.call("agent", "import_html_page", { url, cookies: "session=owner", page: { name: "Bad" } })).ok).toBe(false);
    const hosted = await Workspace.open(file, within(diskStore, dir, false));
    expect((await hosted.call("agent", "import_html_page", { url, live: true, page: { name: "Blocked" } })).reply).toContain("local Buni");
    expect(serializeDoc(ws.view())).toBe(before);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 90_000);

test.skipIf(!browser)("a native button with a border on one side imports without the browser's outset border on the others", async () => {
  const { dir, ws } = await design();
  try {
    const result = await ws.call("agent", "import_html_page", {
      html: '<style>.tab{border:0;border-bottom:2px solid rgb(10, 20, 30);background:none;padding:8px}</style><nav id="tabs"><button class="tab">Requests</button></nav>',
      selector: "#tabs", page: { name: "Tabs" },
    });
    expect(result.ok).toBe(true);
    const tab = Object.values(ws.view().nodes).find((n) => n.kind === "text" && n.text === "Requests")!;
    expect(tab.style.border).toBe("0px none");
    expect(tab.style.borderBottom).toBe("2px solid rgb(10, 20, 30)");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("a flex item holding only text sizes to its text; a box with children, or text drawn in a box, keeps its measured size", async () => {
  const { dir, ws } = await design();
  try {
    const html = '<div style="display:flex;gap:8px"><b id="label" style="overflow:hidden;white-space:nowrap">98 questions from Lido</b><div id="box" style="width:120px"><span>Box</span></div><span id="avatar" style="width:24px;height:24px;background:green;display:flex;align-items:center;justify-content:center">R</span></div>';
    expect((await ws.call("agent", "import_html_page", { html, page: { name: "Row" } })).ok).toBe(true);
    const nodes = Object.values(ws.view().nodes);
    expect(nodes.find((n) => n.name === "label")!.style.width).toBeUndefined();
    expect(nodes.find((n) => n.name === "box")!.style.width).toBe("120px");
    expect(nodes.find((n) => n.name === "avatar")!.style).toMatchObject({ width: "24px", height: "24px" });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("live imports keep a PDF reader's pictures: canvas pages, images by URL and frames become images, pdf.js text layers are left out, scrolling panes keep their height", async () => {
  const { dir, ws } = await design();
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    if (new URL(req.url).pathname === "/pixel.png") return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    return new Response(`<body style="margin:0"><div id="app" style="height:100dvh;display:flex;overflow:hidden">
      <aside style="flex:0 0 300px;overflow:auto"><div style="height:4070px"><img src="/pixel.png" alt="Thumb" style="width:40px;height:40px"></div></aside>
      <main style="flex:1;overflow:auto"><div style="height:36192px;position:relative">
        <canvas id="page" width="200" height="100" style="width:200px;height:100px"></canvas>
        <div class="textLayer" style="position:absolute;inset:0;color:transparent"><span>Invoice 4471</span></div>
        <iframe srcdoc="<p>Framed</p>" style="width:300px;height:150px;border:0"></iframe>
      </div></main></div>
      <script>const c = document.getElementById("page").getContext("2d"); c.fillStyle = "red"; c.fillRect(0, 0, 200, 100);</script></body>`, { headers: { "content-type": "text/html" } });
  } });
  try {
    const result = await ws.call("agent", "import_html_page", { url: `http://localhost:${server.port}/`, live: true, wait_for: "#page", page: { name: "Reader" } });
    expect(result.ok).toBe(true);
    const nodes = Object.values(ws.view().nodes);
    expect(nodes.filter((n) => n.kind === "text").map((n) => n.text)).not.toContain("Invoice 4471");
    const pictures = nodes.filter((n) => n.kind === "image");
    expect(pictures).toHaveLength(3);
    expect(Object.keys(ws.view().attachments)).toHaveLength(3);
    expect(pictures.find((n) => n.style.width === "300px")?.style.height).toBe("150px");
    const panes = nodes.filter((n) => n.style.overflowY === "auto");
    expect(panes.map((n) => n.style.height)).toEqual(["900px", "900px"]);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 90_000);

test.skipIf(!browser)("a live layout that fills the window is captured in a desktop window, not grown to what it first seemed to need", async () => {
  const { dir, ws } = await design();
  // Its pane overflows in a desktop window but fits any window grown to show it: the height follows the window.
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(`<body style="margin:0"><div style="height:100dvh;display:grid;grid-template-rows:56px 1fr">
    <header>Files</header><main style="overflow:auto"><div id="reader" style="height:calc(9000px - 100dvh)">Page 1</div></main></div></body>`, { headers: { "content-type": "text/html" } }) });
  try {
    expect((await ws.call("agent", "import_html_page", { url: `http://localhost:${server.port}/`, live: true, page: { name: "Reader" } })).ok).toBe(true);
    expect(Object.values(ws.view().nodes).find((n) => n.name === "main")?.style.height).toBe("844px");
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 90_000);

test.skipIf(!browser)("a live canvas drawn after the DOM settles, as a PDF page is, is captured once it is drawn", async () => {
  const { dir, ws } = await design();
  // The canvas is in place at once and drawn a second later, with no DOM change in between.
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(`<body style="margin:0"><canvas id="page" width="200" height="100"></canvas>
    <script>setTimeout(() => { const c = document.getElementById("page").getContext("2d"); c.fillStyle = "red"; c.fillRect(0, 0, 200, 100); }, 1200)</script></body>`, { headers: { "content-type": "text/html" } }) });
  try {
    expect((await ws.call("agent", "import_html_page", { url: `http://localhost:${server.port}/`, live: true, wait_for: "#page", page: { name: "Drawn" } })).ok).toBe(true);
    expect((await ws.call("agent", "import_html_page", { html: '<canvas width="200" height="100"></canvas>', page: { name: "Blank" } })).ok).toBe(true);
    const files = Object.values(ws.view().attachments).map((a) => a.path);
    expect(new Set(files).size).toBe(2);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 90_000);

test.skipIf(!browser)("a grid keeps how it places its items, and a controlled field keeps its placeholder", async () => {
  const { dir, ws } = await design();
  try {
    const html = '<div id="grid" style="display:grid;grid-template-columns:300px;justify-items:start"><span id="pill" style="display:inline-flex;padding:3px 8px;background:green">Accepted</span></div><input id="search" value="" placeholder="Search 15 documents">';
    expect((await ws.call("agent", "import_html_page", { html, page: { name: "Request" } })).ok).toBe(true);
    const nodes = Object.values(ws.view().nodes);
    expect(nodes.find((n) => n.name === "grid")!.style.justifyItems).toBe("start");
    const search = nodes.find((n) => n.name === "search")!;
    expect(search.kind === "text" && search.text).toBe("Search 15 documents");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("a flex item as wide as its mixed content sizes to it, so a wider font in Buni doesn't wrap it", async () => {
  const { dir, ws } = await design();
  try {
    const li = (n: string, words: string) => `<li style="display:flex;align-items:center;gap:6px"><i style="width:8px;height:8px;background:green"></i><b>${n}</b> ${words}</li>`;
    const html = `<ul id="legend" style="display:flex;gap:6px 18px;margin:0;padding:0;list-style:none">${li("12", "accepted")}${li("3", "waiting on Sam")}</ul>`;
    expect((await ws.call("agent", "import_html_page", { html, page: { name: "Legend" } })).ok).toBe(true);
    const nodes = Object.values(ws.view().nodes);
    expect(nodes.filter((n) => n.name === "li").map((n) => n.style.width)).toEqual([undefined, undefined]);
    expect(nodes.filter((n) => n.name === "i").map((n) => n.style.width)).toEqual(["8px", "8px"]);
    expect(nodes.find((n) => n.name === "legend")!.style.padding).toBe("0px");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("a PDF page box holding only its overlaid canvas keeps its height, and an empty canvas is left out", async () => {
  const { dir, ws } = await design();
  try {
    const html = `<div id="page" style="position:relative;overflow:hidden;width:200px;height:260px;background:white"><div style="position:absolute;inset:0"><canvas width="200" height="260" style="width:200px;height:260px"></canvas></div></div><canvas id="unused" width="0" height="0"></canvas>`;
    const result = await ws.call("agent", "import_html_page", { html, page: { name: "PDF page" } });
    expect(result.ok).toBe(true);
    expect(result.reply).not.toContain("unreadable");
    const nodes = Object.values(ws.view().nodes);
    expect(nodes.find((n) => n.name === "page")!.style.height).toBe("260px");
    expect(nodes.find((n) => n.name === "unused")).toBeUndefined();
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("a tag reset to look like its parent keeps the reset: italic, heading size and field font aren't the browser's; an icon keeps its size", async () => {
  const { dir, ws } = await design();
  try {
    const html = `<style>textarea { font: inherit }</style><div id="card" style="font:13px Arial"><i id="label" style="font-style:normal">Choose files</i><h2 id="heading" style="font:inherit">A quick question</h2><textarea id="composer" placeholder="Ask Lido"></textarea><label style="display:flex;gap:8px"><svg id="search" width="14" height="14" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/></svg><input placeholder="Search conversations"></label></div>`;
    expect((await ws.call("agent", "import_html_page", { html, page: { name: "Portal" } })).ok).toBe(true);
    const nodes = Object.values(ws.view().nodes);
    expect(nodes.find((n) => n.name === "label")!.style.fontStyle).toBe("normal");
    expect(nodes.find((n) => n.name === "heading")!.style).toMatchObject({ fontSize: "13px", fontWeight: "400" });
    expect(nodes.find((n) => n.name === "composer")!.style.fontFamily).toBe("Arial");
    expect(nodes.find((n) => n.kind === "svg")!.style).toMatchObject({ width: "14px", height: "14px", flexShrink: "0" });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);
