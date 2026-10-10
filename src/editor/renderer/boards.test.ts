import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Doc, Node } from "buni/format/doc.ts";
import { parseDoc } from "buni/format/parse.ts";
import { applyChange, type Op } from "buni/oplog/oplog.ts";
import { pageWindow } from "./sidebar.ts";
import { touchedBoards, previewWidth, boardAt, arrows } from "./Canvas.tsx";

const base = (() => {
  const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
  if (!r.ok) throw new Error("example is invalid");
  return r.doc;
})();

function edited(ops: Op[]): Doc {
  const r = applyChange(base, { id: "c", label: "edit", ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
}
const restyle = (n: Node | undefined): Op => {
  if (!n) throw new Error("no such node");
  return { kind: "put", collection: "nodes", value: { ...n, style: { ...n.style, color: "#000" } } };
};

test("an edit redraws only the boards it touched", () => {
  expect(touchedBoards(base, edited([restyle(base.nodes["home-headline"])]))).toEqual(new Set(["home"]));
  expect(touchedBoards(base, edited([{ kind: "delete", collection: "comments", id: "c1" }, { kind: "delete", collection: "nodes", id: "home-headline" }]))).toEqual(new Set(["home"]));
  expect(touchedBoards(base, edited([{ kind: "delete", collection: "comments", id: "c1" }]))).toEqual(new Set());
  // Tokens and components show on every board.
  expect(touchedBoards(base, edited([{ kind: "token", name: "--color-ink", value: "#111" }]))).toBeUndefined();
  expect(touchedBoards(base, edited([restyle(base.nodes["nav-root"])]))).toBeUndefined();
});


test("overview previews match screen size without reallocating for small zoom changes", () => {
  expect(previewWidth(1280, 0.02, 2)).toBe(64);
  expect(previewWidth(1280, 0.023, 2)).toBe(64);
  expect(previewWidth(1280, 0.04, 2)).toBe(128);
  expect(previewWidth(1440, 0.14, 2)).toBe(200);
  expect(previewWidth(320, 0.005, 3)).toBe(32);
  expect(previewWidth(1280, 0.02, 1)).toBe(32);
  // 1,000 desktop boards now need under 12 MB of bitmap pixels at this overview zoom.
  const width = previewWidth(1280, 0.02, 2);
  expect(1000 * width * Math.ceil(900 * width / 1280) * 4).toBeLessThan(12_000_000);
});


test("headless overview boards remain selectable and connected", () => {
  const boxes = new Map([
    ["home", { x: 10, y: 30, width: 100, height: 80 }],
    ["detail", { x: 80, y: 60, width: 100, height: 80 }],
  ]);
  expect(boardAt(boxes, { x: 20, y: 40 })).toBe("home");
  expect(boardAt(boxes, { x: 90, y: 70 })).toBe("detail");
  expect(boardAt(boxes, { x: 500, y: 70 })).toBeUndefined();
  const doc: Doc = { ...base, connections: { next: { id: "next", page: "home", node: "home-headline", to: "detail", trigger: "click", transition: "none", durationMs: 0 } } };
  const links = arrows(doc, boxes, new Map());
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ from: "home", to: "detail", x: 60, y: 30, sb: 110, tx: 80, ty: 60 });
});


test("a thousand-page sidebar mounts only its visible rows and overscan", () => {
  expect(pageWindow(1000, 0, 560)).toEqual({ start: 0, end: 26 });
  expect(pageWindow(1000, 14000, 560)).toEqual({ start: 494, end: 526 });
  expect(pageWindow(1000, 28000, 560)).toEqual({ start: 994, end: 1000 });
  expect(pageWindow(1000, -100, 560)).toEqual({ start: 0, end: 23 });
  expect(pageWindow(0, 0, 560)).toEqual({ start: 0, end: 0 });
});
