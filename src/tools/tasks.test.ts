import { beforeEach, expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
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

test("picking an option keeps the why on the winner; the rest become its takes", async () => {
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

  // The old live page and the other option are now its takes.
  expect(Object.values(ws.view().pages).filter((p) => p.option?.of === proof.id).length).toBe(2);
  const back = parseDoc(serializeDoc(ws.view()));
  expect(back.ok && back.doc.pages[proof.id]?.picked?.over.length).toBe(2);
});

test("a screen the design has is never a second page: create_page and import_html take_of make a take; make_take turns a stray page into one", async () => {
  const ws = await Workspace.open(file);
  const made = await ws.call("claude", "create_page", { name: "Pricing · tighter", route: "/pricing-2", take_of: "pricing" });
  expect(made.ok).toBe(true);
  const take = Object.values(ws.view().pages).find((p) => p.name === "Pricing · tighter")!;
  expect(take.option).toEqual({ of: "pricing", idea: "Pricing · tighter: another take" });
  expect(take.route).toBeUndefined();
  // A take of a take lands under the same page.
  const again = await ws.call("claude", "import_html", { html: "<main><h1>Pricing, as it ships</h1></main>", page: { name: "Pricing · Now", take_of: take.id } });
  expect(again.ok).toBe(true);
  const snap = Object.values(ws.view().pages).find((p) => p.name === "Pricing · Now")!;
  expect(snap.option?.of).toBe("pricing");
  expect(snap.option?.idea).toBe("Pricing · Now, as imported");
  // A page made as a page of its own becomes a take after the fact.
  const stray = await ws.call("claude", "create_page", { name: "Pricing · Next", route: "/pricing-next" });
  const strayId = stray.reply.match(/page (\w+)/)?.[1] ?? "";
  const fixed = await ws.call("you", "make_take", { page: strayId, of: "pricing", idea: "Tighter tiers" });
  expect(fixed.ok).toBe(true);
  expect(ws.view().pages[strayId]).toMatchObject({ option: { of: "pricing", idea: "Tighter tiers" } });
  expect(ws.view().pages[strayId]?.route).toBeUndefined();
  expect((await ws.call("you", "make_take", { page: "pricing", of: "pricing" })).ok).toBe(false);
});
