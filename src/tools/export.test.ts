import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "../format/parse.ts";
import { embeddedFont } from "./fontdata.ts";
import { exportSite, pageSvg } from "./html.ts";

const portal = () => {
  const r = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
  if (!r.ok) throw new Error("example does not parse");
  return r.doc;
};

test("a graphic exported as SVG keeps the styles of what's inside it", () => {
  const doc = portal();
  doc.pages.logo = { id: "logo", name: "Logo", frame: "logo-frame", index: "z0" };
  doc.nodes["logo-frame"] = { id: "logo-frame", kind: "frame", name: "Logo", index: "a0", style: { width: "64px", height: "64px" } };
  doc.nodes["logo-mark"] = { id: "logo-mark", kind: "svg", parent: "logo-frame", name: "Mark", index: "a0", style: {}, markup: '<svg viewBox="0 0 64 64"><text style="font-weight:700">b</text></svg>' };
  expect(pageSvg(doc, "logo", embeddedFont)).toContain('<text style="font-weight:700">');
});

test("a link to a state of a screen opens the screen", () => {
  const doc = portal();
  const [conn] = Object.values(doc.connections);
  if (!conn) throw new Error("the example has links");
  const screen = doc.pages[conn.to];
  if (!screen?.route) throw new Error("the link goes to a screen");
  doc.pages.empty = { id: "empty", name: `${screen.name}, empty`, route: screen.route, state: "Empty", frame: "empty-frame", index: "z1" };
  doc.nodes["empty-frame"] = { id: "empty-frame", kind: "frame", name: "Empty", index: "a0", style: {} };
  doc.connections[conn.id] = { ...conn, to: "empty" };
  const html = [...exportSite(doc, embeddedFont).values()].join("\n");
  // The link's own element points at the screen's file, not the site root.
  const link = html.match(new RegExp(`<a[^>]*class="b-${conn.node}"[^>]*href="([^"]*)"|<a[^>]*href="([^"]*)"[^>]*class="b-${conn.node}"`));
  const href = link?.[1] ?? link?.[2] ?? "";
  expect(href.replace(/^(\.\.\/)+/, "")).toBe(screen.route === "/" ? "index.html" : `${screen.route.slice(1)}/index.html`);
});
