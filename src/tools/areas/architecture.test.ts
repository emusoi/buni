import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { architectureOf, emptyDoc, type Doc } from "../../format/doc.ts";
import { parseDoc, type FormatError } from "../../format/parse.ts";
import { applyPatch, diffDoc } from "../../format/patch.ts";
import { serializeDoc } from "../../format/serialize.ts";
import { Workspace } from "../workspace.ts";

const parcelPath = new URL("../../../examples/parcel.buni", import.meta.url).pathname;

function parcel(): Doc {
  const r = parseDoc(readFileSync(parcelPath, "utf8"));
  if (!r.ok) throw new Error(`parcel is invalid: ${JSON.stringify(r.errors, null, 2)}`);
  return r.doc;
}

/** Break parcel's architecture in one way and return what the parser says. */
function errorsAfter(change: (doc: Doc) => void): string[] {
  const doc = structuredClone(parcel());
  change(doc);
  const r = parseDoc(serializeDoc(doc));
  if (r.ok) throw new Error("expected the change to be rejected");
  return r.errors.map((e: FormatError) => `${e.path}: ${e.message}`);
}

const arch = (doc: Doc) => {
  if (!doc.architecture) throw new Error("no architecture");
  return doc.architecture;
};

describe("format", () => {
  test("parcel's architecture loads, validates and round-trips byte for byte", () => {
    const doc = parcel();
    const a = arch(doc);
    expect(Object.keys(a.parts)).toContain("returns-api");
    expect(a.workloads["returns-api-prod"]).toMatchObject({ kind: "Rollout", namespace: "eks-prod-returns", replicas: { min: 3, max: 10 } });
    expect(a.releases.v42?.strategy).toEqual({ kind: "canary", steps: [10, 50, 100], hold: "15 min" });
    expect(a.plays["release-v42"]?.steps).toHaveLength(7);
    expect(a.plays["release-v42"]?.fails).toEqual({ at: 5, then: "v42-canary-fails" });
    expect(serializeDoc(doc)).toBe(readFileSync(parcelPath, "utf8"));
  });

  test("a design without architecture has no key for it, and old files with the legacy system keys still open", () => {
    expect(serializeDoc(emptyDoc())).not.toContain("architecture");
    const legacy = { ...JSON.parse(serializeDoc(emptyDoc())), parts: { a: { id: "a" } }, clusters: {}, environments: {} };
    const r = parseDoc(JSON.stringify(legacy));
    expect(r.ok && r.doc.architecture).toBe(undefined);
  });

  test("a collection left out reads as empty", () => {
    const text = JSON.stringify({ ...JSON.parse(serializeDoc(emptyDoc())), architecture: { parts: { api: { id: "api", name: "API", kind: "service" } } } });
    const r = parseDoc(text);
    expect(r.ok && architectureOf(r.doc).clusters).toEqual({});
  });

  test("references must resolve, naming what is missing", () => {
    expect(errorsAfter((d) => { arch(d).workloads["worker-prod"]!.namespace = "nope"; })).toContain('architecture.workloads.worker-prod.namespace: namespace "nope" does not exist');
    expect(errorsAfter((d) => { arch(d).links["worker-calls-shippo"]!.to = "fedex"; })).toContain('architecture.links.worker-calls-shippo.to: part "fedex" does not exist');
    expect(errorsAfter((d) => { arch(d).releases.v42!.path.push("qa"); })).toContain('architecture.releases.v42.path: environment "qa" does not exist');
    expect(errorsAfter((d) => { arch(d).parts.worker!.plan = "nope"; })).toContain('architecture.parts.worker.plan: plan "nope" does not exist');
    expect(errorsAfter((d) => { arch(d).plays["release-v42"]!.steps[0]!.touches.push("ghost"); })).toContain('architecture.plays.release-v42.steps[0].touches: "ghost" is nothing in the architecture');
  });

  test("enums, Kubernetes names and the rules between things are checked", () => {
    const kind = errorsAfter((d) => { Reflect.set(arch(d).parts.worker!, "kind", "lambda"); });
    expect(kind.some((e) => e.startsWith("architecture.parts.worker.kind: expected one of client"))).toBe(true);
    expect(errorsAfter((d) => { arch(d).namespaces["eks-prod-jobs"]!.name = "Jobs_Q"; }).some((e) => e.includes("isn't a Kubernetes name"))).toBe(true);
    expect(errorsAfter((d) => { arch(d).workloads["worker-prod"]!.namespace = "eks-staging-worker"; }))
      .toContain('architecture.workloads.worker-prod.namespace: namespace "worker" is in cluster "eks-staging", but prod runs on "eks-prod"');
    expect(errorsAfter((d) => { delete arch(d).workloads["nightly-labels-prod"]!.schedule; })).toContain('architecture.workloads.nightly-labels-prod.schedule: a CronJob needs a schedule, e.g. "0 2 * * *"');
    expect(errorsAfter((d) => { arch(d).releases.v42!.strategy.steps = [10, 50]; })).toContain("architecture.releases.v42.strategy.steps: steps are percentages of traffic, rising, ending at 100");
    expect(errorsAfter((d) => { arch(d).releases.v42!.before = ["returns-api-prod"]; })).toContain('architecture.releases.v42.before: "returns-api" is a Rollout; what runs before a release is a Job');
    expect(errorsAfter((d) => { arch(d).migrations["0042-store-credit"]!.store = "jobs"; })).toContain('architecture.migrations.0042-store-credit.store: "Jobs" is a queue; migrations change a store');
    expect(errorsAfter((d) => { arch(d).plays["release-v42"]!.fails = { at: 5, then: "buyer-starts-a-return" }; }))
      .toContain('architecture.plays.release-v42.fails: "Buyer starts a return" is a request play; what follows a failed check is a failure play');
    expect(errorsAfter((d) => { arch(d).stages.jobs = { id: "jobs", name: "Jobs", order: 9 }; })).toContain('architecture.stages.jobs: "jobs" is already in parts; ids are unique across the architecture');
    expect(errorsAfter((d) => { Reflect.set(arch(d).parts.worker!, "replicas", 3); })).toContain("architecture.parts.worker.replicas: unknown key");
    expect(errorsAfter((d) => { arch(d).workloads["main-db-prod"] = { id: "main-db-prod", part: "main-database", environment: "prod", namespace: "eks-prod-jobs", kind: "StatefulSet" }; }))
      .toContain('architecture.workloads.main-db-prod.part: "Main database" is managed (RDS Postgres Multi-AZ · db.r6g.large): it runs outside the cluster, not as a workload');
  });

  test("a patch carries architecture changes to an editor, and its removal too", () => {
    const a = parcel();
    const b = { ...a, architecture: { ...arch(a), parts: { ...arch(a).parts, extra: { id: "extra", name: "Extra", kind: "cache" as const } } } };
    const patch = diffDoc(a, b);
    expect(Object.keys(patch.bags)).toEqual(["architecture"]);
    expect(applyPatch(a, patch).architecture?.parts.extra?.name).toBe("Extra");
    const { architecture: _, ...none } = a;
    expect(applyPatch(a, diffDoc(a, none)).architecture).toBeUndefined();
  });
});

describe("tools", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "buni-arch-"));
    file = join(dir, "app.buni");
  });
  const fresh = async () => { await writeFile(file, serializeDoc(emptyDoc())); return Workspace.open(file); };
  const withParcel = async () => { await copyFile(parcelPath, file); return Workspace.open(file); };
  const call = async (ws: Workspace, name: Parameters<Workspace["call"]>[1], args: unknown) => {
    const r = await ws.call("claude", name, args);
    if (!r.ok) throw new Error(r.reply);
    return r.reply;
  };

  test("set_part creates with a readable id, keeps what a change leaves out, and null removes a field", async () => {
    const ws = await fresh();
    expect(await call(ws, "set_part", { name: "Quote API", kind: "service", tech: "Go", owners: "quotes" })).toBe("Created part quote-api.");
    await call(ws, "set_part", { id: "quote-api", about: "Prices jobs", owners: null });
    expect(architectureOf(ws.view()).parts["quote-api"]).toEqual({ id: "quote-api", name: "Quote API", kind: "service", tech: "Go", about: "Prices jobs" });
    const reopened = await Workspace.open(file);
    expect(reopened.view().architecture?.parts["quote-api"]?.about).toBe("Prices jobs");
  });

  test("refusals say which rule broke", async () => {
    const ws = await fresh();
    expect((await ws.call("claude", "set_part", { name: "API" })).reply).toBe("a new part needs a name and a kind");
    expect((await ws.call("claude", "set_part", { id: "nope", name: "API" })).reply).toBe('part "nope" does not exist');
    await call(ws, "set_part", { name: "API", kind: "service" });
    expect((await ws.call("claude", "link_parts", { from: "api", to: "db", kind: "writes" })).reply).toContain('architecture.links.api-writes-db.to: part "db" does not exist');
    await call(ws, "set_cluster", { name: "Prod", provider: "eks" });
    const ns = await ws.call("claude", "set_namespace", { cluster: "prod", name: "Returns API" });
    expect(ns.ok).toBe(false);
    expect(ns.reply).toContain("isn't a Kubernetes name");
    const cron = await ws.call("claude", "set_workload", { part: "api", environment: "x", namespace: "y", kind: "CronJob" });
    expect(cron.reply).toContain('a CronJob needs a schedule, e.g. "0 2 * * *"');
  });

  test("a workload's namespace must be in its environment's cluster", async () => {
    const ws = await fresh();
    await call(ws, "set_part", { name: "API", kind: "service" });
    await call(ws, "set_cluster", { name: "EKS prod", provider: "eks", pools: [{ name: "general", min: 1, max: 3 }] });
    await call(ws, "set_cluster", { name: "EKS staging", provider: "eks" });
    await call(ws, "set_environment", { name: "staging", cluster: "eks-staging" });
    await call(ws, "set_namespace", { cluster: "eks-prod", name: "api" });
    const r = await ws.call("claude", "set_workload", { part: "api", environment: "staging", namespace: "eks-prod-api", kind: "Deployment" });
    expect(r.reply).toContain('namespace "api" is in cluster "eks-prod", but staging runs on "eks-staging"');
    await call(ws, "set_environment", { id: "staging", cluster: "eks-prod" });
    expect(await call(ws, "set_workload", { part: "api", environment: "staging", namespace: "eks-prod-api", kind: "Deployment", nodes: "general" })).toBe("Created workload api-staging.");
    expect(architectureOf(ws.view()).environments.staging?.order).toBe(1);
  });

  test("deleting a part takes its links and workloads, and one undo puts them all back", async () => {
    const ws = await withParcel();
    const before = serializeDoc(ws.view());
    const reply = await call(ws, "delete_architecture", { ids: ["worker"] });
    expect(reply).toContain("worker-prod");
    expect(reply).toContain("worker-subscribes-jobs");
    const a = architectureOf(ws.view());
    expect(a.parts.worker).toBeUndefined();
    expect(a.workloads["nightly-labels-prod"]).toBeUndefined();
    expect(Object.values(a.links).some((l) => l.from === "worker")).toBe(false);
    // Plays that touched it still play, without it.
    expect(a.plays["buyer-starts-a-return"]?.steps[3]?.touches).toEqual(["jobs"]);
    await ws.undo();
    expect(serializeDoc(ws.view())).toBe(before);
  });

  test("deleting a cluster takes its namespaces and their workloads, and its environment runs nowhere", async () => {
    const ws = await withParcel();
    await call(ws, "delete_architecture", { ids: ["eks-staging"] });
    const a = architectureOf(ws.view());
    expect(Object.values(a.namespaces).every((n) => n.cluster === "eks-prod")).toBe(true);
    expect(a.workloads["returns-api-staging"]).toBeUndefined();
    expect(a.environments.staging?.cluster).toBeUndefined();
    expect(a.releases.v42?.before).toEqual(["db-migrate-prod"]);
  });

  test("deleting everything leaves no architecture key", async () => {
    const ws = await fresh();
    await call(ws, "set_part", { name: "API", kind: "service" });
    await call(ws, "delete_architecture", { ids: ["api"] });
    expect(ws.view().architecture).toBeUndefined();
    expect(readFileSync(file, "utf8")).not.toContain("architecture");
  });

  test("merge_plan makes what a plan adds live and removes the plan; discarding deletes what it would add", async () => {
    const ws = await withParcel();
    await call(ws, "link_parts", { id: "worker-calls-shippo", status: "removed", plan: "store-credit" });
    const reply = await call(ws, "merge_plan", { plan: "store-credit" });
    expect(reply).toContain("Merged Store credit");
    let a = architectureOf(ws.view());
    expect(a.plans["store-credit"]).toBeUndefined();
    expect(a.parts["credit-ledger"]?.status).toBeUndefined();
    expect(a.parts["credit-ledger"]?.plan).toBeUndefined();
    expect(a.workloads["credit-ledger-prod"]?.status).toBeUndefined();
    expect(a.migrations["0042-store-credit"]).toMatchObject({ release: "v42" });
    expect(a.migrations["0042-store-credit"]?.status).toBeUndefined();
    expect(a.releases.v43?.plan).toBeUndefined();
    expect(a.links["worker-calls-shippo"]).toBeUndefined();
    expect(a.plays["buyer-starts-a-return"]?.steps[4]?.touches).toEqual(["worker", "shippo"]);
    await ws.undo();
    a = architectureOf(ws.view());
    expect(a.plans["store-credit"]).toBeDefined();
    expect(a.links["worker-calls-shippo"]?.status).toBe("removed");

    await call(ws, "delete_architecture", { ids: ["store-credit"] });
    a = architectureOf(ws.view());
    expect(a.parts["credit-ledger"]).toBeUndefined();
    expect(a.workloads["credit-ledger-prod"]).toBeUndefined();
    expect(a.releases.v43).toBeUndefined();
    expect(a.migrations["0042-store-credit"]).toBeUndefined();
    // What the plan would have removed stays, live.
    expect(a.links["worker-calls-shippo"]).toEqual({ id: "worker-calls-shippo", from: "worker", to: "shippo", kind: "calls", carries: "Label" });
  });

  test("parts, workloads, releases and plans link to source files", async () => {
    const ws = await withParcel();
    const sources = [{ file: "api/src/server.ts", symbol: "app" }];
    await call(ws, "set_sources", { ids: ["returns-api", "returns-api-prod", "v42", "store-credit"], sources });
    await call(ws, "set_part", { id: "returns-api", tech: "Node 22" });
    const a = architectureOf((await Workspace.open(file)).view());
    expect(a.parts["returns-api"]?.sources).toEqual(sources);
    expect(a.workloads["returns-api-prod"]?.sources).toEqual(sources);
    expect(a.releases.v42?.sources).toEqual(sources);
    expect(a.plans["store-credit"]?.sources).toEqual(sources);
  });

  test("read_architecture briefs every level, one environment, or one thing and what is around it", async () => {
    const ws = await withParcel();
    const all = await call(ws, "read_architecture", {});
    for (const heading of ["## System", "## Runtime · prod", "## Edge", "## Managed", "## Outside services", "## Code", "## Software path", "## Releases", "## Plans", "## Plays"]) expect(all).toContain(heading);
    expect(all).toContain("link worker-subscribes-jobs: Worker subscribes Jobs · RefundJob");
    expect(all).toContain("  if step 5's check fails: play v42-canary-fails");
    const prod = await call(ws, "read_architecture", { level: "runtime", environment: "prod" });
    expect(prod).not.toContain("## Runtime · staging");
    expect(prod).toContain("Rollout returns-api (returns-api-prod) runs Returns API: api:4f2c9a1 · replicas 3–10 · scales on cpu 70% · keeps 2");
    expect(prod).toContain("CronJob nightly-labels (nightly-labels-prod) runs Worker");
    expect(prod).not.toContain("## System");
    const system = await call(ws, "read_architecture", { level: "system" });
    expect(system).not.toContain("## Runtime");
    const plan = await call(ws, "read_architecture", { focus: "store-credit" });
    expect(plan).toContain("adds workload credit-ledger-prod (Deployment credit-ledger)");
    expect(plan).not.toContain("part shopify");
    expect((await ws.call("claude", "read_architecture", { environment: "qa" })).reply).toContain('environment "qa" does not exist');
    expect((await ws.call("claude", "read_architecture", { focus: "ghost" })).reply).toBe('"ghost" is nothing in the architecture');
    expect(await call(await fresh(), "read_architecture", {})).toContain("no architecture yet");
  });

  test("set_api and set_operation design an API: ids, validation, resolves, the brief, and removing", async () => {
    const ws = await fresh();
    await call(ws, "set_part", { name: "Returns API", kind: "service" });
    await call(ws, "set_part", { name: "Gateway", kind: "service" });
    await call(ws, "set_part", { name: "Buyer", kind: "person" });
    expect(await call(ws, "set_operation", { part: "returns-api", method: "POST", path: "/returns/{id}/refund", about: "Refunds a return", responses: ["202 Refund queued"] }))
      .toBe("Created operation post-returns-id-refund on Returns API: POST /returns/{id}/refund.");
    expect(architectureOf(ws.view()).parts["returns-api"]?.api).toEqual({ kind: "rest", operations: [{ id: "post-returns-id-refund", method: "POST", path: "/returns/{id}/refund", about: "Refunds a return", responses: ["202 Refund queued"] }] });
    expect((await ws.call("claude", "set_operation", { part: "returns-api", method: "GET", path: "returns" })).reply).toContain('a path starts with "/"');
    expect((await ws.call("claude", "set_operation", { part: "returns-api", method: "GET", path: "/x", field: "x" })).reply).toContain("a REST operation has a method and path");
    await call(ws, "set_api", { part: "gateway", kind: "graphql", spec: "schema.graphql" });
    expect((await ws.call("claude", "set_operation", { part: "gateway", field: "requestRefund(returnId: ID!)", resolves: "ghost" })).reply).toContain('"ghost" is no operation on another part');
    await call(ws, "set_operation", { part: "gateway", type: "mutation", field: "requestRefund(returnId: ID!)", returns: "Refund", resolves: "post-returns-id-refund" });
    const brief = await call(ws, "read_architecture", {});
    expect(brief).toContain('part buyer "Buyer" person');
    expect(brief).toContain("requestrefund: mutation requestRefund(returnId: ID!): Refund · served by post-returns-id-refund");
    // Taking the REST operation out leaves the field it served standing, served by nothing.
    await call(ws, "set_operation", { part: "returns-api", id: "post-returns-id-refund", remove: true });
    expect(architectureOf(ws.view()).parts.gateway?.api?.operations).toEqual([{ id: "requestrefund", type: "mutation", field: "requestRefund(returnId: ID!)", returns: "Refund" }]);
    // So does deleting the part an operation was on.
    await call(ws, "set_operation", { part: "returns-api", method: "POST", path: "/refunds" });
    await call(ws, "set_operation", { part: "gateway", id: "requestrefund", resolves: "post-refunds" });
    await call(ws, "delete_architecture", { ids: ["returns-api"] });
    expect(architectureOf(ws.view()).parts.gateway?.api?.operations[0]?.resolves).toBeUndefined();
    await call(ws, "set_api", { part: "gateway", remove: true });
    expect(architectureOf(ws.view()).parts.gateway?.api).toBeUndefined();
  });
});
