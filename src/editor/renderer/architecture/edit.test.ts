import { expect, test } from "bun:test";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCH_COLLECTIONS, architectureOf, emptyDoc, type Architecture } from "buni/format/doc.ts";
import { serializeDoc } from "buni/format/serialize.ts";
import { Workspace } from "buni/tools/workspace.ts";
import { ADDABLE, FORMS, addFor, dropOn, insertionAt, moveItem, orderAt, cascadeOf, cascadeText, changeFor, planChange, linkTargets, readInput, shows, valueOf, type Call, type Field } from "./edit.ts";

const parcelPath = new URL(import.meta.resolve("buni/examples/parcel.buni")).pathname;
const withParcel = async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-arch-edit-")), "parcel.buni");
  await copyFile(parcelPath, file);
  return Workspace.open(file);
};
const field = (c: keyof typeof FORMS, key: string): Field => FORMS[c].flatMap((s) => s.fields).find((f) => f.key === key)!;
const isCall = (x: Call | { error: string } | undefined): x is Call => x !== undefined && "tool" in x;
const run = async (ws: Workspace, call: Call | { error: string } | undefined) => {
  if (!isCall(call)) throw new Error(`expected a call, got ${JSON.stringify(call)}`);
  return ws.call("you", call.tool, call.args);
};

test("a nested field sends its whole object, emptied to null; a part's build goes through set_build", async () => {
  const ws = await withParcel();
  const a = architectureOf(ws.view());
  const w = a.workloads["returns-api-prod"]!;
  expect(changeFor("workloads", w, field("workloads", "replicas.max"), 12)).toEqual({ tool: "set_workload", args: { id: w.id, replicas: { min: 3, max: 12 } } });
  expect(changeFor("workloads", w, field("workloads", "probes.ready"), undefined)).toEqual({ tool: "set_workload", args: { id: w.id, probes: { live: w.probes!.live } } });
  expect((await run(ws, changeFor("workloads", w, field("workloads", "replicas.max"), 12))).ok).toBe(true);
  expect(architectureOf(ws.view()).workloads["returns-api-prod"]!.replicas).toEqual({ min: 3, max: 12 });
  const api = a.parts["returns-api"]!;
  expect(changeFor("parts", api, field("parts", "build.dockerfile"), "Dockerfile.prod")).toEqual({ tool: "set_build", args: { part: api.id, dockerfile: "Dockerfile.prod" } });
});

test("nothing changed is no call; a required field can't be emptied; a refusal comes back from the tool", async () => {
  const ws = await withParcel();
  const a = architectureOf(ws.view());
  const p = a.parts["returns-api"]!;
  expect(changeFor("parts", p, field("parts", "name"), p.name)).toBeUndefined();
  expect(changeFor("parts", p, field("parts", "name"), undefined)).toEqual({ error: "Name can't be empty" });
  const ns = a.namespaces[Object.keys(a.namespaces)[0]!]!;
  const r = await run(ws, changeFor("namespaces", ns, field("namespaces", "name"), "Not A K8s Name"));
  expect(r.ok).toBe(false);
  expect(r.reply).toContain("isn't a Kubernetes name");
});

test("the inspector shows a field only where it applies", () => {
  const roll = { id: "w", kind: "Rollout" as const, part: "api", service: { port: 8080 } };
  expect(shows("workloads", roll, field("workloads", "schedule"))).toBe(false);
  expect(shows("workloads", roll, field("workloads", "before"))).toBe(false);
  expect(shows("workloads", roll, field("workloads", "name"))).toBe(false);
  expect(shows("workloads", roll, field("workloads", "replicas.min"))).toBe(true);
  expect(shows("workloads", roll, field("workloads", "ingress.host"))).toBe(true);
  expect(shows("workloads", { id: "w", kind: "CronJob" }, field("workloads", "schedule"))).toBe(true);
  expect(shows("workloads", { id: "w", kind: "Job" }, field("workloads", "before"))).toBe(true);
  expect(shows("workloads", { id: "w", kind: "Job" }, field("workloads", "replicas.min"))).toBe(false);
  expect(shows("workloads", { id: "w", kind: "Job", replicas: { min: 1 } }, field("workloads", "replicas.min"))).toBe(true);
  expect(shows("workloads", { id: "w", kind: "Rollout", name: "api" }, field("workloads", "name"))).toBe(true);
  expect(shows("releases", { id: "v", name: "v", parts: [], path: [], strategy: { kind: "rolling" } }, field("releases", "strategy.steps"))).toBe(false);
  expect(shows("releases", { id: "v", name: "v", parts: [], path: [], strategy: { kind: "canary" } }, field("releases", "strategy.hold"))).toBe(true);
  expect(shows("parts", { id: "db", name: "DB", kind: "store" }, field("parts", "build.repo"))).toBe(false);
  expect(shows("parts", { id: "api", name: "API", kind: "service" }, field("parts", "build.repo"))).toBe(true);
  expect(shows("parts", { id: "db", name: "DB", kind: "store", build: { repo: "acme/db" } }, field("parts", "build.repo"))).toBe(true);
});

test("fields that move together: a CronJob gets a schedule, a canary's steps go when it stops being one", async () => {
  const ws = await withParcel();
  const a = architectureOf(ws.view());
  const w = a.workloads["returns-api-prod"]!;
  const cron = changeFor("workloads", w, field("workloads", "kind"), "CronJob");
  expect(cron).toEqual({ tool: "set_workload", args: { id: w.id, kind: "CronJob", schedule: "0 * * * *" } });
  expect((await run(ws, cron)).ok).toBe(true);
  const back = changeFor("workloads", architectureOf(ws.view()).workloads[w.id]!, field("workloads", "kind"), "Deployment");
  expect(back).toEqual({ tool: "set_workload", args: { id: w.id, kind: "Deployment", schedule: null } });
  expect((await run(ws, back)).ok).toBe(true);
  const v42 = a.releases.v42!;
  const rolling = changeFor("releases", v42, field("releases", "strategy.kind"), "rolling");
  expect(rolling).toEqual({ tool: "set_release", args: { id: "v42", strategy: { kind: "rolling", hold: "15 min" } } });
  expect((await run(ws, rolling)).ok).toBe(true);
});

test("every field of every kind is one the tools take", async () => {
  const ws = await withParcel();
  const a = architectureOf(ws.view());
  const sample: Partial<Record<Field["kind"], unknown>> = { text: "x-1", long: "Changed by hand.", number: 2, list: ["a", "b"], bool: true };
  for (const c of ARCH_COLLECTIONS) {
    const thing = Object.values(a[c])[0];
    if (!thing) continue;
    for (const f of FORMS[c].flatMap((s) => s.fields)) {
      if (!(f.kind in sample)) continue;
      // A field whose value only fits with others (a schedule on a non-CronJob, before on a non-Job) is checked above.
      if (["schedule", "before", "fails.at"].includes(f.key)) continue;
      const fresh = architectureOf(ws.view())[c][thing.id]!;
      const call = changeFor(c, fresh, f, sample[f.kind] as never);
      if (!isCall(call)) continue;
      const r = await ws.call("you", call.tool, call.args);
      expect(`${c}.${f.key}: ${r.ok ? "ok" : r.reply}`).toBe(`${c}.${f.key}: ok`);
    }
  }
});

test("planned in a plan, and back to live", () => {
  const p = { id: "x" };
  expect(planChange("parts", p, "plan-1")).toEqual({ tool: "set_part", args: { id: "x", plan: "plan-1", status: "planned" } });
  expect(planChange("parts", { id: "x", status: "removed" }, "plan-1").args.status).toBe("removed");
  expect(planChange("workloads", { id: "x", plan: "plan-1", status: "planned" }, undefined)).toEqual({ tool: "set_workload", args: { id: "x", plan: null, status: null } });
  expect(planChange("releases", { id: "v42" }, "plan-1")).toEqual({ tool: "set_release", args: { id: "v42", plan: "plan-1" } });
});

test("+ Add makes each thing where the person is, and every default is one the tools accept", async () => {
  const ws = await withParcel();
  const a = architectureOf(ws.view());
  const ns = Object.values(a.namespaces).find((n) => n.cluster === a.environments.prod?.cluster)!;
  const wl = addFor(a, "workloads", { env: "prod", selected: ns.id });
  expect(wl).toMatchObject({ tool: "set_workload", args: { environment: "prod", namespace: ns.id } });
  expect(addFor(a, "plays", { playKind: "failure" })).toMatchObject({ tool: "set_play", args: { kind: "failure" } });
  expect(addFor(a, "workloads", { env: "prod", selected: "returns-api" })).toMatchObject({ args: { part: "returns-api", namespace: a.workloads["returns-api-prod"]!.namespace } });
  for (const what of ADDABLE) {
    const call = addFor(architectureOf(ws.view()), what, { env: "prod", selected: "returns-api" });
    const r = await run(ws, call);
    expect(`${what}: ${r.ok ? "ok" : r.reply}`).toBe(`${what}: ok`);
    expect(r.saved).toBeDefined();
  }
});

test("+ Add says what it still needs on an empty architecture", async () => {
  const empty: Architecture = architectureOf(emptyDoc());
  expect(addFor(empty, "links", {})).toEqual({ error: "Needs two parts" });
  expect(addFor(empty, "workloads", {})).toEqual({ error: "Needs a part" });
  expect(addFor(empty, "migrations", {})).toEqual({ error: "Needs a store part" });
  const file = join(await mkdtemp(join(tmpdir(), "buni-arch-edit-")), "empty.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  const ws = await Workspace.open(file);
  const r = await run(ws, addFor(empty, "parts", {}));
  expect(r.saved).toBe("new-part");
  expect(r.reply).toBe("Created part new-part.");
});

test("what a delete takes with it is what delete_architecture deletes", async () => {
  // One cascade serves both, so one delete checks the wiring: a part takes its links, workloads and migrations.
  const ws = await withParcel();
  const before = architectureOf(ws.view());
  const said = cascadeOf(before, ["returns-api"]).sort();
  expect((await ws.call("you", "delete_architecture", { ids: ["returns-api"] })).ok).toBe(true);
  const after = architectureOf(ws.view());
  expect(said).toEqual(ARCH_COLLECTIONS.flatMap((c) => Object.keys(before[c]).filter((x) => !Object.hasOwn(after[c], x))).filter((x) => x !== "returns-api").sort());
  expect(cascadeText(before, ["returns-api"])).toMatch(/^Also deletes \d+ links?/);
});

test("typed values read as the field's kind", () => {
  expect(readInput("numbers", "10, 50 → 100")).toEqual([10, 50, 100]);
  expect(readInput("number", "")).toBeUndefined();
  expect(readInput("number", "x")).toEqual({ error: "a number" });
  expect(readInput("list", " a, b ,, ")).toEqual(["a", "b"]);
  expect(valueOf({ id: "w", replicas: { min: 2 } }, "replicas.min")).toBe(2);
});

test("Link to… offers the other parts, matched by name, id or kind", async () => {
  const a = architectureOf((await withParcel()).view());
  const all = linkTargets(a, "returns-api", "");
  expect(all.map((p) => p.id)).not.toContain("returns-api");
  expect(all.length).toBe(Object.keys(a.parts).length - 1);
  expect(linkTargets(a, "returns-api", "STORE").every((p) => p.kind === "store" || /store/i.test(p.name + p.id))).toBe(true);
  expect(linkTargets(a, "returns-api", "no such thing")).toEqual([]);
});

test("a card dropped on a frame: into a group, into another namespace of its cluster, or why not; the tools take each", async () => {
  const ws = await withParcel();
  const a = architectureOf(ws.view());
  const at = { x: 300, y: 200 };
  const w = a.workloads["returns-api-prod"]!;
  const other = Object.values(a.namespaces).find((n) => n.cluster === a.namespaces[w.namespace]!.cluster && n.id !== w.namespace && !Object.values(a.workloads).some((x) => x.namespace === n.id && x.environment === "prod" && x.part === w.part))!;
  expect(dropOn(a, "runtime", w.id, w.namespace, at)).toBeUndefined();
  const into = dropOn(a, "runtime", w.id, other.id, at);
  expect(into).toEqual({ tool: "set_workload", args: { id: w.id, namespace: other.id, place: { runtime: at } } });
  expect((await run(ws, into)).ok).toBe(true);
  expect(architectureOf(ws.view()).workloads[w.id]).toMatchObject({ namespace: other.id, place: { runtime: at } });
  const db = Object.values(a.parts).find((p) => p.managed)!;
  expect(dropOn(a, "runtime", db.id, other.id, at)).toEqual({ error: `${db.name} is managed (${db.managed}): it runs outside the cluster` });
  // A part into a group; an edge part has none; a cluster's own frame is no home.
  const g = Object.keys(a.groups)[0]!;
  const loose = Object.values(a.parts).find((p) => p.group === undefined && p.kind !== "edge")!;
  const join_ = dropOn(a, "system", loose.id, g, at);
  expect(join_).toMatchObject({ tool: "set_part", args: { id: loose.id, group: g, place: { system: at } } });
  expect((await run(ws, join_)).ok).toBe(true);
  expect(dropOn(a, "system", Object.values(a.parts).find((p) => p.kind === "edge")!.id, g, at)).toEqual({ error: "Edge parts sit in front of the groups, not in one" });
  expect(dropOn(a, "runtime", w.id, Object.keys(a.clusters)[0], at)).toBeUndefined();
});

test("reordering: where a drop lands, the list after it, and the one order number that says so", () => {
  expect(insertionAt([10, 30, 50], 5)).toBe(0);
  expect(insertionAt([10, 30, 50], 35)).toBe(2);
  expect(insertionAt([10, 30, 50], 99)).toBe(3);
  expect(moveItem(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "a", "d"]);
  expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  expect(moveItem(["a", "b", "c"], 1, 3)).toEqual(["a", "c", "b"]);
  const items = [{ order: 1 }, { order: 2 }, { order: 3 }];
  expect(orderAt(items, 0, 2)).toBe(2.5);
  expect(orderAt(items, 2, 0)).toBe(0);
  expect(orderAt(items, 0, 3)).toBe(4);
  expect(orderAt(items, 1, 1)).toBeUndefined();
  expect(orderAt(items, 1, 2)).toBeUndefined();
});
