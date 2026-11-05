import { expect, test } from "bun:test";
import { route, type Arrow } from "./links.ts";

// Pages 800 wide and 600 tall, 120 apart: A at (0,0), B to its right, C in the row below.
const base = { id: "l", from: "a", label: "", x: 0, y: 0, ex: 300, ey: 200, sy: 0, sb: 600, sr: 800 };
const ys = (d: string) => [...d.matchAll(/V (-?[\d.]+)/g)].map((m) => Number(m[1]));

test("a link keeps to the gaps: a lane between rows clears the Picked line and the name row by 24", () => {
  const down: Arrow = { ...base, to: "c", tx: 0, ty: 800 };
  const { d, ly } = route(down, 0, 0, 1);
  // The Picked line ends 26 under the page; the name row starts 40 over the next one.
  expect(ly).toBeGreaterThanOrEqual(600 + 26 + 24);
  expect(ly).toBeLessThanOrEqual(800 - 40 - 24);
  // It leaves from the side of what's tapped and enters the page's left edge, beside its top.
  expect(d.startsWith("M 300 200 H 824 ")).toBe(true);
  expect(ys(d).at(-1)).toBe(824);
});

test("to a page in the same row it runs in the gutter between them, with its label there", () => {
  const right: Arrow = { ...base, to: "b", tx: 920, ty: 0 };
  const { d, lx, ly } = route(right, 0, 0, 1);
  expect(lx).toBe(860);
  expect(ly).toBe(24);
  // Never above the pages, where their names are.
  expect(Math.min(...ys(d))).toBeGreaterThanOrEqual(0);
});

test("to a page above it goes over both rows' names", () => {
  const up: Arrow = { ...base, sy: 800, sb: 1400, ey: 1000, to: "a", tx: 0, ty: 0 };
  expect(route(up, 0, 0, 1).ly).toBe(0 - 40 - 24);
});
