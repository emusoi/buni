import { beforeEach, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { exportSite, liveHead, renderPage } from "./html.ts";
import { embeddedFont } from "./fontdata.ts";
import { Workspace } from "./workspace.ts";

const example = new URL("../../examples/portal.buni", import.meta.url).pathname;
let file: string;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-live-"));
  file = join(dir, "portal.buni");
  await copyFile(example, file);
});

test("a live page loads pinned libraries and its own files; still pages and stray hosts don't", async () => {
  const ws = await Workspace.open(file);
  const page = Object.values(ws.view().pages).find((p) => p.route === "/")!;
  expect(liveHead(ws.view(), page.id)).toBe("");

  const bad = await ws.call("pi", "set_live", { page: page.id, libraries: [{ name: "evil", url: "https://evil.example/x.js" }] });
  expect(bad.ok).toBe(false);
  expect(bad.reply).toContain("pinned");

  const on = await ws.call("pi", "set_live", { page: page.id, libraries: [{ name: "motion", url: "https://cdn.jsdelivr.net/npm/motion@11.15.0/dist/motion.js" }, { name: "Manrope", url: "https://fonts.googleapis.com/css2?family=Manrope&display=swap" }] });
  expect(on.ok).toBe(true);
  const css = await ws.call("pi", "write_file", { page: page.id, kind: "css", text: ".b-home-frame { outline: 1px solid red }" });
  expect(css.ok).toBe(true);
  const js = await ws.call("pi", "write_file", { page: page.id, kind: "js", text: "document.body.dataset.live = 'yes';" });
  expect(js.ok).toBe(true);
  expect(await readFile(join(file, "..", "live", `${page.id}.js`), "utf8")).toBe("document.body.dataset.live = 'yes';");
  expect((await ws.call("pi", "read_file", { page: page.id, kind: "css" })).reply).toBe(".b-home-frame { outline: 1px solid red }");

  const head = liveHead(ws.view(), page.id);
  expect(head).toContain('<script src="https://cdn.jsdelivr.net/npm/motion@11.15.0/dist/motion.js"></script>');
  expect(head).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope&amp;display=swap">');
  expect(head).toContain(`<link rel="stylesheet" href="live/${page.id}.css">`);
  expect(head).toContain(`<script type="module" src="live/${page.id}.js"></script>`);
  expect(liveHead(ws.view(), page.id, { bust: "7" })).toContain(`live/${page.id}.css?v=7`);
  // The export carries it, one folder up where the page's folder is deeper.
  const site = exportSite(ws.view(), embeddedFont);
  expect(site.get("index.html")).toContain(`<script type="module" src="live/${page.id}.js"></script>`);

  // Writing again keeps the one attachment; the file survives a save and a reopen; still again drops the page's part.
  await ws.call("pi", "write_file", { page: page.id, kind: "css", text: "/* again */" });
  expect(Object.values(ws.view().attachments).filter((a) => a.path.startsWith("live/")).length).toBe(2);
  const back = parseDoc(serializeDoc(ws.view()));
  expect(back.ok && back.doc.pages[page.id]?.live?.libraries.length).toBe(2);
  const off = await ws.call("pi", "set_live", { page: page.id, live: false });
  expect(off.ok).toBe(true);
  expect(ws.view().pages[page.id]?.live).toBeUndefined();
  expect(liveHead(ws.view(), page.id)).toBe("");
});

test("a layer keeps the classes it was written with, and the file refuses one that could end the attribute", async () => {
  const ws = await Workspace.open(file);
  const r = await ws.call("pi", "write_html", { parent: "home-frame", html: '<section class="tier bg-ink md:px-4" style="display:flex"><p class="x">Hi</p><svg class="icon" viewBox="0 0 2 2"><rect width="2" height="2"/></svg></section>' });
  expect(r.ok).toBe(true);
  const id = r.reply.match(/Created \d+ nodes: (\w+)/)?.[1] ?? "";
  expect(ws.view().nodes[id]?.classes).toEqual(["tier", "bg-ink", "md:px-4"]);
  expect(renderPage(ws.view(), "home").html).toContain(`class="b-${id} tier bg-ink md:px-4"`);
  const html = (await ws.call("pi", "layer_html", { node: id })).reply;
  expect(html).toContain('class="tier bg-ink md:px-4"');
  // An <svg> keeps its class in its markup, not as layer classes.
  const svg = Object.values(ws.view().nodes).find((n) => n.kind === "svg" && n.parent === id);
  expect(svg?.classes).toBeUndefined();
  const broken = serializeDoc(ws.view()).replace('"md:px-4"', '"md:px-4\\" onload=\\"x"');
  expect(parseDoc(broken).ok).toBe(false);
});
