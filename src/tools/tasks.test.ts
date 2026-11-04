import { beforeEach, expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { lineage } from "../editor/renderer/lineage.ts";
import { Workspace } from "./workspace.ts";

const example = new URL("../../examples/portal.buni", import.meta.url).pathname;
let file: string;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-tasks-"));
  file = join(dir, "portal.buni");
  await copyFile(example, file);
});

test("a task is queued in the person's words, taken by one agent, finished with a note, and survives the file", async () => {
  const ws = await Workspace.open(file);
  expect((await ws.call("you", "tasks", {})).reply).toContain("No tasks");
  const added = await ws.call("you", "add_task", { title: "Make the pricing cards scan faster", detail: "Three tiers, the middle one first.", page: "pricing" });
  expect(added.ok).toBe(true);
  const id = added.reply.match(/Task (\w+) is queued/)?.[1] ?? "";
  expect(ws.view().tasks[id]).toMatchObject({ title: "Make the pricing cards scan faster", state: "queued", page: "pricing" });
  expect((await ws.call("you", "add_task", { title: "x", page: "nope" })).ok).toBe(false);

  const listed = (await ws.call("claude", "tasks", {})).reply;
  expect(listed).toContain(`${id} [queued] Make the pricing cards scan faster (on Pricing)`);
  expect((await ws.call("claude", "take_task", { task: id })).ok).toBe(true);
  expect(ws.view().tasks[id]).toMatchObject({ state: "working", by: "claude" });
  // Another agent can't take it from under the first.
  expect((await ws.call("codex", "take_task", { task: id })).reply).toContain("claude is on it");
  expect((await ws.call("claude", "finish_task", { task: id, note: "Middle tier is dark and first in the row." })).ok).toBe(true);
  expect(ws.view().tasks[id]).toMatchObject({ state: "done", by: "claude", note: "Middle tier is dark and first in the row." });
  expect((await ws.call("codex", "take_task", { task: id })).reply).toContain("done");

  const back = parseDoc(serializeDoc(ws.view()));
  expect(back.ok && back.doc.tasks[id]?.state).toBe("done");
  // Undo takes the finish back, and a removed task is gone.
  await ws.undo();
  expect(ws.view().tasks[id]?.state).toBe("working");
  expect((await ws.call("you", "delete_task", { task: id })).ok).toBe(true);
  expect(ws.view().tasks[id]).toBeUndefined();
});

test("picking an option keeps the why on the winner, and the canvas hangs options off their page", async () => {
  const ws = await Workspace.open(file);
  const made = await ws.call("claude", "explore_page", { page: "pricing", options: [{ name: "Proof first", idea: "Lead times before prices" }, { name: "One plan", idea: "A single price, no table" }] });
  expect(made.ok).toBe(true);
  const options = Object.values(ws.view().pages).filter((p) => p.option?.of === "pricing");
  expect(options.length).toBe(2);
  const proof = options.find((p) => p.name.includes("Proof"))!;
  const picked = await ws.call("claude", "pick_option", { option: proof.id, why: "Buyers trust lead times before they ask for a price." });
  expect(picked.ok).toBe(true);
  const winner = ws.view().pages[proof.id]!;
  expect(winner.picked?.why).toBe("Buyers trust lead times before they ask for a price.");
  expect(winner.picked?.over).toContain("pricing");
  expect(winner.route).toBe("/pricing");

  const boxes = new Map(Object.keys(ws.view().pages).map((id, i) => [id, { x: i * 1600, y: 0, width: 1440, height: 900 }]));
  const { branches, whys } = lineage(ws.view(), boxes);
  // The old live page and the other option now hang off the winner.
  expect(branches.map((b) => b.from)).toEqual(expect.arrayContaining([proof.id, proof.id]));
  expect(branches.length).toBe(2);
  expect(whys).toEqual([{ page: proof.id, x: boxes.get(proof.id)!.x, y: 0, why: "Buyers trust lead times before they ask for a price.", over: expect.arrayContaining(["Pricing"]) }]);
  const back = parseDoc(serializeDoc(ws.view()));
  expect(back.ok && back.doc.pages[proof.id]?.picked?.over.length).toBe(2);
});
