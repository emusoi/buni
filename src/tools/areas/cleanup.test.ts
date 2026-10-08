import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../workspace.ts";

// The portal example's nav component: pricing-nav overrides the nav-cta layer's text.
async function portal(): Promise<Workspace> {
  const file = join(await mkdtemp(join(tmpdir(), "buni-cleanup-")), "d.buni");
  await copyFile(new URL("../../../examples/portal.buni", import.meta.url), file);
  return Workspace.open(file);
}

test("deleting a component layer drops the overrides that pointed at it", async () => {
  const ws = await portal();
  const r = await ws.call("t", "delete_nodes", { nodes: ["nav-cta"] });
  expect(r.reply).toContain("Deleted");
  expect(r.ok).toBe(true);
  const nav = ws.view().nodes["pricing-nav"];
  expect(nav?.kind === "instance" ? Object.keys(nav.overrides) : ["?"]).toEqual([]);
});

test("detaching a component use keeps its comments on the plain layers", async () => {
  const ws = await portal();
  expect((await ws.call("t", "comment", { node: "home-nav", body: "Too tall" })).ok).toBe(true);
  const r = await ws.call("t", "detach_instance", { instance: "home-nav" });
  expect(r.reply).toContain("Detached");
  const comment = Object.values(ws.view().comments).find((c) => c.posts[0]?.body === "Too tall");
  expect(comment && ws.view().nodes[comment.node]?.name).toBe("Public nav");
});

test("deleting an unused component takes the comments on its layers", async () => {
  const ws = await portal();
  const made = await ws.call("t", "make_component", { node: "home-headline", name: "Headline" });
  expect(made.ok).toBe(true);
  const component = Object.values(ws.view().shared).find((c) => c.name === "Headline");
  const use = Object.values(ws.view().nodes).find((n) => n.kind === "instance" && n.shared === component?.id);
  if (!component || !use) throw new Error("make_component made a component and a use");
  expect((await ws.call("t", "comment", { node: component.root, body: "Bigger" })).ok).toBe(true);
  expect((await ws.call("t", "delete_nodes", { nodes: [use.id] })).ok).toBe(true);
  const r = await ws.call("t", "delete_component", { component: component.id });
  expect(r.reply).toContain("Deleted");
  expect(Object.values(ws.view().comments).some((c) => c.posts[0]?.body === "Bigger")).toBe(false);
});
