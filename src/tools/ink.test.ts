import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import type { Stroke } from "../format/doc.ts";
import { inkSvg, markKind, marksOn, strokePath } from "./ink.ts";
import { Workspace } from "./workspace.ts";

async function portal(): Promise<Workspace> {
  const file = join(await mkdtemp(join(tmpdir(), "buni-ink-")), "d.buni");
  await copyFile(new URL("../../examples/portal.buni", import.meta.url), file);
  return Workspace.open(file);
}
const pen = (points: number[]): Stroke => ({ tool: "pen", color: "#c8331f", width: 3, points });

test("a pen mark is kept as a comment on the layer under it, read by agents, and erased", async () => {
  const ws = await portal();
  const page = Object.values(ws.view().pages)[0];
  if (!page) throw new Error("no page");
  const r = await ws.call("iPad", "mark", { page: page.id, node: "home-nav", from: "iPad", strokes: [pen([10, 20, 120, 22])] });
  expect(r.ok).toBe(true);
  const thread = r.reply.match(/thread (\S+)\)/)?.[1] ?? "";
  const mark = ws.view().comments[thread];
  expect(mark?.node).toBe("home-nav");
  expect(mark?.ink?.page).toBe(page.id);
  // A layer on another page isn't where this mark points: it falls back to the page's frame.
  const elsewhere = Object.values(ws.view().pages)[1];
  const other = await ws.call("iPad", "mark", { page: elsewhere?.id, node: "home-nav", strokes: [pen([0, 0, 5, 5])] });
  expect(ws.view().comments[other.reply.match(/thread (\S+)\)/)?.[1] ?? ""]?.node).toBe(elsewhere?.frame);

  // It survives the file: written, read back, validated.
  const back = parseDoc(await readFile(ws.path, "utf8"));
  expect(back.ok && back.doc.comments[thread]?.ink?.strokes[0]?.points).toEqual([10, 20, 120, 22]);

  const read = await ws.call("claude", "read_marks", { page: page.id });
  expect(read.reply).toContain(`1. Strike on "`);
  expect(read.reply).toContain(`thread ${thread}`);
  expect(read.reply).toContain("--marks");

  expect((await ws.call("iPad", "mark", { remove: thread })).ok).toBe(true);
  expect(ws.view().comments[thread]).toBeUndefined();
  expect((await ws.call("iPad", "mark", { remove: "nope" })).ok).toBe(false);
});

test("a mark's ink is checked like the rest of the file", () => {
  const ws = { buni: 1, tokens: {}, pages: { p: { id: "p", name: "P", frame: "f", index: "a0" } }, nodes: { f: { id: "f", kind: "frame", name: "P", index: "a0", style: {} } }, shared: {}, connections: {}, flows: {}, journeys: {}, sections: {}, rules: {}, attachments: {} };
  const withInk = (ink: unknown) => JSON.stringify({ ...ws, comments: { c: { id: "c", node: "f", state: "open", posts: [{ author: "a", body: "b", at: "t" }], ink } } });
  expect(parseDoc(withInk({ page: "p", strokes: [pen([1, 2, 3, 4])] })).ok).toBe(true);
  expect(parseDoc(withInk({ page: "p", strokes: [pen([1, 2, 3])] })).ok).toBe(false);
  expect(parseDoc(withInk({ page: "gone", strokes: [pen([1, 2, 3, 4])] })).ok).toBe(false);
  expect(parseDoc(withInk({ page: "p", strokes: [{ ...pen([1, 2, 3, 4]), tool: "spray" }] })).ok).toBe(false);
  // And what parses serializes the same way back.
  const parsed = parseDoc(withInk({ page: "p", strokes: [pen([1, 2, 3, 4])], from: "iPad" }));
  if (!parsed.ok) throw new Error("did not parse");
  const again = parseDoc(serializeDoc(parsed.doc));
  expect(again.ok && again.doc.comments.c?.ink).toEqual({ page: "p", strokes: [pen([1, 2, 3, 4])], from: "iPad" });
});

test("marks read as what they look like, and draw the same everywhere", () => {
  expect(markKind([{ ...pen([0, 0, 100, 0]), tool: "highlighter" }])).toBe("Highlight");
  expect(markKind([pen([0, 50, 80, 48, 160, 52])])).toBe("Strike");
  const ring = Array.from({ length: 25 }, (_, i) => [100 + 60 * Math.cos((i / 24) * 2 * Math.PI), 100 + 30 * Math.sin((i / 24) * 2 * Math.PI)]).flat();
  expect(markKind([pen(ring)])).toBe("Circle");
  expect(markKind([pen([0, 0, 50, 80]), pen([60, 0, 10, 80])])).toBe("Drawing");
  expect(strokePath([0, 0, 10, 10, 20, 0])).toBe("M0 0 Q10 10 15 5 L20 0");
});

test("a screenshot with marks draws every open one, numbered", async () => {
  const ws = await portal();
  const page = Object.values(ws.view().pages)[0];
  if (!page) throw new Error("no page");
  await ws.call("iPad", "mark", { page: page.id, strokes: [pen([10, 20, 120, 22])] });
  await ws.call("iPad", "mark", { page: page.id, strokes: [pen([5, 30, 60, 30]), { ...pen([5, 5, 60, 5]), tool: "highlighter" }] });
  expect(marksOn(ws.view(), page.id)).toHaveLength(2);
  const svg = inkSvg(ws.view(), page.id, 1440, 1);
  expect(svg.match(/<path /g)).toHaveLength(3);
  expect(svg).toContain(">2</text>");
  // Within a mark, highlighters go under pens.
  expect(svg.indexOf('stroke-opacity="0.4"')).toBeLessThan(svg.indexOf('d="M5 30'));
});

test("a mark on a flow sits on the screen under it, reads as the flow's, and goes with the flow", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-ink-")), "d.buni");
  await copyFile(new URL("../../examples/parcel.buni", import.meta.url), file);
  const ws = await Workspace.open(file);
  const flow = Object.values(ws.view().flows).find((f) => f.name === "Return an item");
  if (!flow) throw new Error("no flow");
  const r = await ws.call("Tab", "mark", { flow: flow.id, node: "50094e02", from: "Tab", strokes: [pen([10, 20, 120, 22])] });
  expect(r.ok).toBe(true);
  const thread = r.reply.match(/thread (\S+)\)/)?.[1] ?? "";
  expect(ws.view().comments[thread]?.node).toBe(ws.view().pages["50094e02"]?.frame);
  expect(ws.view().comments[thread]?.ink?.flow).toBe(flow.id);
  const back = parseDoc(await readFile(ws.path, "utf8"));
  expect(back.ok).toBe(true);
  const read = await ws.call("claude", "read_marks", {});
  expect(read.reply).toContain(`The flow Return an item (flow ${flow.id}):`);
  expect(read.reply).toContain("on the screen Choose items");
  // Removing the flow takes its marks too, so none is left pointing at nothing.
  expect((await ws.call("claude", "set_flow", { flow: flow.id, remove: true })).ok).toBe(true);
  expect(ws.view().comments[thread]).toBeUndefined();
});

test("a sketch of a new screen sits on the Screens canvas, and reads as a screen to build where it was drawn", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-ink-")), "d.buni");
  await copyFile(new URL("../../examples/parcel.buni", import.meta.url), file);
  const ws = await Workspace.open(file);
  const r = await ws.call("Tab", "mark", { sketch: true, from: "Tab", strokes: [pen([2000, 300, 2150, 300, 2150, 600, 2000, 600, 2000, 300])], body: "Track my refund" });
  expect(r.ok).toBe(true);
  const thread = r.reply.match(/thread (\S+)\)/)?.[1] ?? "";
  expect(ws.view().comments[thread]?.ink?.sketch).toBe(true);
  const back = parseDoc(await readFile(ws.path, "utf8"));
  expect(back.ok).toBe(true);
  const read = await ws.call("claude", "read_marks", {});
  expect(read.reply).toContain(`Sketch (thread ${thread}) at 2000,300 150×300`);
  expect(read.reply).toContain("move_page");
  expect((await ws.call("Tab", "mark", { sketch: true, page: "2e00677a", strokes: [pen([0, 0, 1, 1])] })).ok).toBe(false);
  // A line drawn out of a page is pointed out as a likely arrow, with where to see it.
  await ws.call("Tab", "mark", { page: "bf6a55ad", strokes: [pen([300, 600, 1700, 400])] });
  expect((await ws.call("claude", "read_marks", {})).reply).toContain("a line from 300,600 on the page to 1700,400, 1310px past its right edge");
});
