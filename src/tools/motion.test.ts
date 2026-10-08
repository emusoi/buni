import { expect, test } from "bun:test";
import { emptyDoc, type Doc, type Node } from "../format/doc.ts";
import { exportSite, motionCss } from "./html.ts";
import { embeddedFont } from "./fontdata.ts";

const frame = (id: string, parent: string | undefined, index: string, extra: Partial<Node> = {}): Node =>
  ({ id, ...(parent ? { parent } : {}), index, name: id, style: {}, kind: "frame", ...extra }) as Node; // Test fixture

test("motion becomes CSS for Play and export, behind reduced motion, and nothing when nothing moves", () => {
  const doc: Doc = { ...emptyDoc(), nodes: {} };
  expect(motionCss(doc)).toBe("");
  doc.pages.p = { id: "p", name: "Home", route: "/", frame: "root" } as Doc["pages"][string];
  doc.nodes.root = frame("root", undefined, "a");
  doc.nodes.hero = frame("hero", "root", "a", { motion: [{ trigger: "load", effect: "rise", durationMs: 600, delayMs: 100, easing: "out" }, { trigger: "hover", effect: "lift", durationMs: 150, easing: "out" }] });
  doc.nodes.list = frame("list", "root", "b", { motion: [{ trigger: "scroll", effect: "fade", durationMs: 400, easing: "out", staggerMs: 100 }] });
  doc.nodes.one = frame("one", "list", "a");
  doc.nodes.two = frame("two", "list", "b");
  const css = motionCss(doc);
  expect(css.startsWith("@media (prefers-reduced-motion: no-preference)")).toBe(true);
  expect(css).toContain("@keyframes buni-rise { from { opacity: 0; transform: translateY(24px); } }");
  expect(css).toContain(".b-hero { animation: buni-rise 600ms cubic-bezier(0.22, 1, 0.36, 1) 100ms backwards; }");
  expect(css).toContain(".b-hero:hover { transform: translateY(-4px); }");
  // A stagger moves the children, each a little later down the scroll; the layer itself stays put.
  expect(css).toContain(".b-one { animation: buni-fade linear backwards;");
  expect(css).toContain("animation-range: entry 10% cover 25%");
  expect(css).not.toContain(".b-list {");
  expect(exportSite(doc, embeddedFont).get("styles/shared.css")).toContain("buni-rise");
});
