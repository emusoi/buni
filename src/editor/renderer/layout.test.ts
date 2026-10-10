import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { placement, rowTitles, tidy, widthOf } from "./layout.ts";
import { pagesInOrder } from "buni/format/doc.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");
const doc = r.doc;

test("unplaced pages keep their row slot when another page moves", () => {
  expect(placement(doc).get("pricing")).toEqual({ x: 1600, y: 0 });
  const moved = structuredClone(doc);
  moved.pages.home = { ...moved.pages.home!, x: 0, y: 3000 };
  expect(placement(moved).get("pricing")).toEqual({ x: 1600, y: 0 });
  expect(placement(moved).get("home")).toEqual({ x: 0, y: 3000 });
});

test("a page placed by hand is never drawn over by an unplaced one", () => {
  // The first page in order would take the slot at 0,0; another page is pinned there.
  const [first, second] = pagesInOrder(doc);
  if (!first || !second) throw new Error("the example has pages");
  const pinned = structuredClone(doc);
  pinned.pages[second.id] = { ...pinned.pages[second.id]!, x: 0, y: 0 };
  const at = placement(pinned);
  const box = (id: string) => ({ ...at.get(id)!, w: widthOf(pinned, id), h: 900 });
  const a = box(first.id);
  const b = box(second.id);
  expect(b).toMatchObject({ x: 0, y: 0 });
  expect(a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y).toBe(true);
  // Every unplaced page still keeps clear of the pinned one.
  for (const p of pagesInOrder(pinned)) {
    if (p.id === second.id) continue;
    const c = box(p.id);
    expect(c.x >= b.x + b.w || c.x + c.w <= b.x).toBe(true);
  }
});

test("components sit in their own row above the pages unless placed", () => {
  // Each ends the same distance above the pages, whatever its height.
  const root = doc.nodes[doc.shared.nav?.root ?? ""];
  const h = Number.parseInt(root?.style.height ?? root?.style.minHeight ?? "", 10) || 400;
  expect(placement(doc).get("nav")).toEqual({ x: 0, y: -600 - h });
  const moved = structuredClone(doc);
  moved.shared.nav = { ...moved.shared.nav!, x: 100, y: -600 };
  expect(placement(moved).get("nav")).toEqual({ x: 100, y: -600 });
});

test("tidy puts each flow in a row and the rest below, spaced by the tallest page", () => {
  const extra = structuredClone(doc);
  extra.pages.about = { id: "about", name: "About", route: "/about", frame: "about-frame", index: "a2" };
  extra.nodes["about-frame"] = { id: "about-frame", kind: "frame", index: "a0", name: "About", style: { width: "1200px" } };
  const at = tidy(extra, new Map([["home", 2000], ["pricing", 1200]]));
  expect(at.get("home")).toEqual({ x: 0, y: 0 });
  expect(at.get("pricing")).toEqual({ x: 1600, y: 0 });
  expect(at.get("about")).toEqual({ x: 0, y: 2240 });
});

test("a row of pages is titled with the flow most of it is in", () => {
  const at = tidy(doc, new Map());
  const titles = rowTitles(doc, at);
  const flow = Object.values(doc.flows)[0];
  expect(titles[0]).toEqual({ x: 0, y: 0, name: flow?.name ?? "", pages: expect.any(Number) });
  // A lone page, or a row no flow covers, has no title.
  expect(rowTitles(doc, new Map([["home", { x: 0, y: 0 }]]))).toEqual([]);
});

test("tidy sets a screen's states right after it, in its flow's row", () => {
  const parcel = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/parcel.buni")), "utf8"));
  if (!parcel.ok) throw new Error("parcel is invalid");
  const doc = parcel.doc;
  const at = tidy(doc, new Map());
  const byName = (n: string) => Object.values(doc.pages).find((p) => p.name === n)?.id ?? "";
  const row = (n: string) => at.get(byName(n))?.y;
  const x = (n: string) => at.get(byName(n))?.x ?? 0;
  expect(row("Return detail, refund retrying")).toBe(row("Return detail"));
  expect(row("Returns queue, on the way")).toBe(row("Returns queue"));
  expect(x("Returns queue, on the way")).toBeGreaterThan(x("Returns queue"));
  expect(x("Returns queue, on the way")).toBeLessThan(x("Return detail"));
});

test("many unplaced pages wrap into rows, spaced by how tall the pages turn out", () => {
  const many = structuredClone(doc);
  for (let i = 0; i < 10; i++) {
    many.pages[`p${i}`] = { id: `p${i}`, name: `P${i}`, route: `/p${i}`, frame: `f${i}`, index: `b${i}` };
    many.nodes[`f${i}`] = { id: `f${i}`, kind: "frame", index: "a0", name: `P${i}`, style: { width: "1440px" } };
  }
  const tall = new Map([["p0", 3000]]);
  const at = placement(many, tall);
  const ys = [...new Set(Object.keys(many.pages).map((id) => at.get(id)?.y))];
  // Twelve pages, about four to a row: not one endless line.
  expect(ys.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...Object.keys(many.pages).map((id) => at.get(id)?.x ?? 0))).toBeLessThan(4 * 1600);
  // The row after the 3000px page starts below it.
  const p0 = at.get("p0");
  const below = Object.keys(many.pages).map((id) => at.get(id)!).filter((q) => q.y > (p0?.y ?? 0));
  expect(Math.min(...below.map((q) => q.y))).toBeGreaterThan((p0?.y ?? 0) + 3000);
});

test("automatic placement and Tidy keep pages clear of saved component boards", () => {
  const pinned = structuredClone(doc);
  pinned.shared.nav = { ...pinned.shared.nav!, x: 0, y: 100 };
  const heights = new Map([["nav", 2000]]);
  for (const arrange of [placement, tidy]) {
    const at = arrange(pinned, heights);
    for (const p of pagesInOrder(pinned)) expect(at.get(p.id)?.y).toBeGreaterThan(2100);
  }
  expect(placement(pinned, heights).get("nav")).toEqual({ x: 0, y: 100 });
  pinned.pages.home = { ...pinned.pages.home!, x: 8000, y: 42 };
  expect(placement(pinned, heights).get("home")).toEqual({ x: 8000, y: 42 });
  // A library already well above the pages doesn't move the page rows.
  pinned.shared.nav.y = -4000;
  expect(tidy(pinned, heights).get("home")?.y).toBe(0);
});
