import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { Workspace } from "./workspace.ts";
import { exportSite, renderPage, renderLayer, renderComponent } from "./html.ts";

test("HTML imports keep editable styles, image references and source context, and undo as one edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-import-"));
  try {
    const file = join(dir, "test.buni");
    const doc = emptyDoc();
    doc.attachments.photo = { id: "photo", path: "assets/photo.png", mime: "image/png" };
    await writeFile(file, serializeDoc(doc));
    const ws = await Workspace.open(file);
    const sources = [{ file: "src/Hero.tsx", symbol: "Hero", url: "https://example.com", selector: "#hero" }];
    const html = `<section style="display:flex;gap:24px;background-image:url(asset:photo)" data-buni-sources='${JSON.stringify(sources)}'><h1 style="color:rgb(30, 40, 50)">Hello</h1><img src="asset:photo" alt="Photo"></section>`;
    expect((await ws.call("you", "import_html", { html, page: { name: "Imported", width: 1280, route: "/" } })).ok).toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    expect(page.sources).toEqual(sources);
    expect(Object.values(ws.view().nodes).filter((n) => n.kind === "text").map((n) => n.text)).toEqual(["Hello"]);
    const section = Object.values(ws.view().nodes).find((n) => n.style.display === "flex")!;
    expect(section.style.gap).toBe("24px");
    expect(renderPage(ws.view(), page.id).css).toContain('url("assets/photo.png")');
    expect(renderLayer(ws.view(), page.id, section.id).css).toContain('url("assets/photo.png")');
    expect(exportSite(ws.view(), () => "font.woff2").get("styles/pages.css")).toContain('url("../assets/photo.png")');
    expect((await ws.undo()).ok).toBe(true);
    expect(Object.keys(ws.view().pages)).toHaveLength(0);
    expect(Object.keys(ws.view().nodes)).toHaveLength(0);
    expect((await ws.redo()).ok).toBe(true);
    const reopened = await Workspace.open(file);
    expect(reopened.view().pages[page.id]?.sources).toEqual(sources);
    expect((await ws.call("you", "make_component", { node: section.id, name: "Hero" })).ok).toBe(true);
    const shared = Object.values(ws.view().shared)[0]!;
    expect(renderComponent(ws.view(), shared.id).css).toContain('url("assets/photo.png")');
    expect(exportSite(ws.view(), () => "font.woff2").get("styles/shared.css")).toContain('url("../assets/photo.png")');
    const before = serializeDoc(ws.view());
    expect((await ws.call("you", "import_html", { html: '<div style="background-image:url(asset:missing)">Broken</div>', page: { name: "Bad" } })).ok).toBe(false);
    expect(serializeDoc(ws.view())).toBe(before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
