import { expect, test } from "bun:test";
import { emptyDoc, type Doc, type Node } from "../format/doc.ts";
import { exportSite, renderComponent, renderLayer, renderPage } from "./html.ts";

function design(): Doc {
  const doc = emptyDoc();
  const frame = (id: string, parent?: string): Node => ({ id, kind: "frame", name: id, index: "a0", style: { color: "red" }, ...(parent ? { parent } : {}) });
  doc.pages.page = { id: "page", name: "Page", route: "/", index: "a0", frame: "page-root" };
  doc.shared.outer = { id: "outer", name: "Outer", root: "outer-root" };
  doc.shared.inner = { id: "inner", name: "Inner", root: "inner-root" };
  doc.shared.unused = { id: "unused", name: "Unused", root: "unused-root" };
  doc.nodes = {
    "page-root": frame("page-root"),
    use: { id: "use", kind: "instance", name: "Use", index: "a0", parent: "page-root", shared: "outer", style: { color: "blue" }, overrides: { "nested/inner-root": { style: { color: "green" } } } },
    "outer-root": frame("outer-root"),
    nested: { id: "nested", kind: "instance", name: "Nested", index: "a0", parent: "outer-root", shared: "inner", style: {}, overrides: {} },
    "inner-root": frame("inner-root"),
    "unused-root": frame("unused-root"),
  };
  return doc;
}

test("boards include their nested component styles and overrides without unrelated components", () => {
  const doc = design();
  const page = renderPage(doc, "page");
  for (const rendered of [page, renderLayer(doc, "page", "use"), renderComponent(doc, "outer")]) {
    expect(rendered.css).toContain(".b-outer-root");
    expect(rendered.css).toContain(".b-inner-root");
    expect(rendered.css).not.toContain(".b-unused-root");
  }
  expect(page.css).toContain(".b-use-nested-inner-root");
  expect(page.css).toContain("color: green");
  expect(page.css.indexOf(".b-outer-root")).toBeLessThan(page.css.indexOf(".b-use {"));
  expect(exportSite(doc, () => "font.woff2").get("styles/shared.css")).toContain(".b-unused-root");
  const hidden: Doc = { ...doc, nodes: { ...doc.nodes, use: { ...doc.nodes.use!, hidden: true } } };
  expect(renderPage(hidden, "page").css).not.toContain(".b-inner-root");
});

test("adding unused components does not grow a board's stylesheet", () => {
  const doc = design();
  const before = renderPage(doc, "page");
  for (let i = 0; i < 100; i++) {
    const id = `unused-${i}`;
    doc.shared[id] = { id, name: id, root: id };
    doc.nodes[id] = { id, kind: "frame", name: id, index: "a0", style: { background: "purple" } };
  }
  expect(renderPage(doc, "page")).toEqual(before);
});
