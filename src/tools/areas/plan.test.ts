import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../workspace.ts";

test("a new record never replaces an existing one of any kind", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-ids-")), "d.buni");
  await copyFile(new URL("../../../examples/portal.buni", import.meta.url), file);
  const ws = await Workspace.open(file);
  const before = Object.keys(ws.view().requirements).length;
  expect((await ws.call("t", "set_requirement", { title: "A buyer sends a quote in under a minute" })).ok).toBe(true);
  expect((await ws.call("t", "set_requirement", { title: "A buyer sends a quote by email" })).ok).toBe(true);
  expect(Object.keys(ws.view().requirements).length).toBe(before + 2);
  await ws.call("t", "set_agent", { name: "Support", instructions: "first" });
  await ws.call("t", "set_agent", { name: "Support", instructions: "second" });
  expect(Object.values(ws.view().agents).map((a) => a.instructions).sort()).toEqual(["first", "second"]);
});


test("clearing a case's mocked answers returns it to the normal mock", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-eval-")), "d.buni");
  await copyFile(new URL("../../../examples/portal.buni", import.meta.url), file);
  const ws = await Workspace.open(file);
  const args = { agent: "buni", ask: "Show my orders", must: ["Do not invent an order"] };
  expect((await ws.call("you", "set_eval", { ...args, given: { api_get_orders: [] } })).ok).toBe(true);
  const id = Object.values(ws.view().evals).find((e) => e.ask === args.ask)!.id;
  expect((await ws.call("you", "set_eval", { ...args, eval: id, given: {} })).ok).toBe(true);
  expect(ws.view().evals[id]?.given).toBeUndefined();
  expect((await ws.undo()).ok).toBe(true);
  expect(ws.view().evals[id]?.given).toEqual({ api_get_orders: [] });
});
