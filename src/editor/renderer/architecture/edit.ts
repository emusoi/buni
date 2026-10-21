// Writing the architecture by hand: which fields each kind of thing has, the tool call one field's change makes, what
// "+ Add" makes where you are, and what a delete takes with it. Pure, so the forms and the tests read the same table.
import {
  ARCH_STATUSES, CLUSTER_PROVIDERS, GITOPS_TOOLS, GROUP_KINDS, LINK_KINDS, MIGRATION_SAFETY, PART_KINDS, PLAY_KINDS, SCALE_BY, STRATEGIES, WORKLOAD_KINDS,
  archCollectionOf, workloadName, type ArchCollection, type Architecture, type Id, type Part, type Workload,
} from "buni/format/doc.ts";
import type { EditTool } from "../../api.ts";
import { environmentsInOrder, workloadsOf } from "./model.ts";

export type FieldKind = "text" | "long" | "number" | "numbers" | "select" | "ref" | "list" | "refs" | "bool" | "plan" | "pool";

export interface Field {
  /** Where the value sits on the thing: "name", "replicas.min", "build.repo". */
  key: string;
  label: string;
  kind: FieldKind;
  /** A select's choices. */
  options?: readonly string[];
  /** What a ref or refs field picks from. */
  ref?: ArchCollection;
  /** It can't be left empty. */
  required?: boolean;
  placeholder?: string;
}
export interface FormSection { title?: string; fields: Field[] }

/** The value a field shows or sends: text, a number, a yes/no, a list; undefined is empty. */
export type FieldValue = string | number | boolean | string[] | number[] | undefined;
export type Call = { tool: EditTool; args: Record<string, unknown> };

export const TOOL: Record<ArchCollection, EditTool> = {
  parts: "set_part", links: "link_parts", groups: "set_group", environments: "set_environment", clusters: "set_cluster", namespaces: "set_namespace",
  workloads: "set_workload", releases: "set_release", migrations: "set_migration", plans: "set_plan", stages: "set_stage", plays: "set_play",
};

export const NOUN: Record<ArchCollection, string> = {
  parts: "part", links: "link", groups: "group", environments: "environment", clusters: "cluster", namespaces: "namespace",
  workloads: "workload", releases: "release", migrations: "migration", plans: "plan", stages: "stage", plays: "play",
};

const text = (key: string, label: string, more: Partial<Field> = {}): Field => ({ key, label, kind: "text", ...more });
const name = (placeholder?: string): Field => ({ key: "name", label: "Name", kind: "text", required: true, ...(placeholder ? { placeholder } : {}) });
const select = (key: string, label: string, options: readonly string[], required = true): Field => ({ key, label, kind: "select", options, required });
const ref = (key: string, label: string, to: ArchCollection, required = false): Field => ({ key, label, kind: "ref", ref: to, required });
const STATUS = select("status", "Status", ARCH_STATUSES, false);
const PLAN: Field = { key: "plan", label: "Planned in", kind: "plan" };

/** Each kind's fields, in sections; the first section's first field is the one a new thing focuses. */
export const FORMS: Record<ArchCollection, FormSection[]> = {
  parts: [
    { fields: [name(), select("kind", "Kind", PART_KINDS), text("tech", "Tech", { placeholder: "Next.js, Postgres 16" }), { key: "about", label: "About", kind: "long" },
      ref("group", "Group", "groups"), text("owners", "Owners"), text("managed", "Managed", { placeholder: "RDS Postgres Multi-AZ" }), PLAN, STATUS] },
    { title: "Built from", fields: [text("build.repo", "Repo", { placeholder: "github.com/acme/app", required: true }), text("build.path", "Path", { placeholder: "api/" }),
      text("build.dockerfile", "Dockerfile"), { key: "build.steps", label: "Pipeline", kind: "list", placeholder: "lint, test, build" },
      text("build.artifact", "Makes", { placeholder: "api image" }), text("build.registry", "Registry", { placeholder: "ECR" })] },
  ],
  links: [{ fields: [ref("from", "From", "parts", true), select("kind", "Kind", LINK_KINDS), ref("to", "To", "parts", true), text("carries", "Carries", { placeholder: "RefundJob" }), PLAN, STATUS] }],
  groups: [{ fields: [name(), select("kind", "Kind", GROUP_KINDS), ref("parent", "Inside", "groups")] }],
  environments: [{ fields: [name(), { key: "order", label: "Order", kind: "number", required: true }, ref("cluster", "Cluster", "clusters"), text("provider", "Provider", { placeholder: "AWS" }),
    text("region", "Region"), { key: "preview", label: "Per PR", kind: "bool" }] }],
  clusters: [
    { fields: [name(), select("provider", "Provider", CLUSTER_PROVIDERS), text("version", "Version", { placeholder: "1.30" }), { key: "zones", label: "Zones", kind: "number" },
      { key: "addons", label: "Add-ons", kind: "list", placeholder: "Karpenter, KEDA" }] },
    { title: "GitOps", fields: [select("gitops.tool", "Tool", GITOPS_TOOLS, false), text("gitops.repo", "Repo"), text("gitops.path", "Path")] },
  ],
  namespaces: [{ fields: [name("returns"), ref("cluster", "Cluster", "clusters", true), text("owners", "Owners")] }],
  workloads: [
    { fields: [text("name", "Name", { placeholder: "the part's name" }), select("kind", "Kind", WORKLOAD_KINDS), ref("part", "Part", "parts", true), ref("environment", "Environment", "environments", true),
      ref("namespace", "Namespace", "namespaces", true), text("image", "Image", { placeholder: "api:4f2c9a1" }), PLAN, STATUS] },
    { title: "Scale", fields: [{ key: "replicas.min", label: "Replicas", kind: "number" }, { key: "replicas.max", label: "Up to", kind: "number" },
      select("scale.by", "Scales on", SCALE_BY, false), text("scale.target", "Target", { placeholder: "70%" }), { key: "keep", label: "Keeps", kind: "number" },
      { key: "nodes", label: "Node pool", kind: "pool" }, text("schedule", "Schedule", { placeholder: "0 2 * * *" }), { key: "before", label: "Before sync", kind: "bool" }] },
    { title: "Resources", fields: [text("resources.cpu", "CPU", { placeholder: "250m" }), text("resources.memory", "Memory", { placeholder: "512Mi" }),
      text("resources.limitCpu", "CPU limit"), text("resources.limitMemory", "Memory limit"), text("probes.ready", "Ready probe", { placeholder: "/health" }), text("probes.live", "Live probe")] },
    { title: "Network", fields: [{ key: "service.port", label: "Port", kind: "number" }, text("ingress.host", "Ingress host"), text("ingress.path", "Ingress path"),
      { key: "egress", label: "Reaches", kind: "refs", ref: "parts" }] },
    { title: "Reads", fields: [{ key: "config", label: "ConfigMaps", kind: "list" }, { key: "secrets", label: "Secrets", kind: "list" },
      text("account.name", "Account"), text("account.role", "Cloud role")] },
  ],
  releases: [{ fields: [name("v42"), { key: "parts", label: "Parts", kind: "refs", ref: "parts" }, { key: "path", label: "Path", kind: "refs", ref: "environments" },
    select("strategy.kind", "Strategy", STRATEGIES), { key: "strategy.steps", label: "Steps %", kind: "numbers", placeholder: "10, 50, 100" }, text("strategy.hold", "Hold", { placeholder: "15 min" }),
    { key: "checks", label: "Checks", kind: "list", placeholder: "error rate < 1%" }, text("rollback", "Rollback"), text("manifests", "Manifests"),
    { key: "before", label: "Runs first", kind: "refs", ref: "workloads" }, PLAN] }],
  migrations: [{ fields: [name("0042_store_credit"), ref("store", "Store", "parts", true), ref("release", "Release", "releases"), { key: "change", label: "Change", kind: "long", required: true },
    select("safe", "Safe", MIGRATION_SAFETY), PLAN, STATUS] }],
  plans: [{ fields: [name(), text("issue", "Issue", { placeholder: "RET-214" }), { key: "about", label: "Why", kind: "long" }, { key: "releases", label: "Ships in", kind: "refs", ref: "releases" }] }],
  stages: [{ fields: [name(), { key: "order", label: "Order", kind: "number", required: true }, text("tools", "Tools"), { key: "steps", label: "Steps", kind: "list" },
    { key: "makes", label: "Makes", kind: "list" }, text("gate", "Gate"), { key: "about", label: "About", kind: "long" }] }],
  plays: [{ fields: [name(), select("kind", "Kind", PLAY_KINDS), ref("release", "Release", "releases"), { key: "fails.at", label: "Fails at step", kind: "number" },
    ref("fails.then", "Then plays", "plays")] }],
};

/** Collections whose things a plan can add or remove: they take the plan picker. */
export const PLANNABLE: readonly ArchCollection[] = ["parts", "links", "workloads", "migrations", "releases"];

/** A thing's value at a field's key. */
export function valueOf(thing: object, key: string): FieldValue {
  let v: unknown = thing;
  for (const k of key.split(".")) v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[k] : undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return v as number[];
  return undefined;
}

const empty = (v: FieldValue) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a: FieldValue, b: FieldValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What a person typed, read as the field's kind: "10, 50, 100" as numbers, "3" as 3. */
export function readInput(kind: FieldKind, raw: string): FieldValue | { error: string } {
  const t = raw.trim();
  if (kind === "number") {
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : { error: "a number" };
  }
  if (kind === "numbers") {
    if (!t) return undefined;
    const ns = t.split(/[\s,→]+/).filter(Boolean).map(Number);
    return ns.every(Number.isFinite) ? ns : { error: "numbers, comma-separated" };
  }
  if (kind === "list") return t ? t.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return t || undefined;
}

/**
 * The tool call that sets one field of a thing to `value`, or why it can't be. A nested field ("replicas.max") sends
 * its whole object, emptied to null; a part's build goes through set_build. Some fields move together: a CronJob
 * needs a schedule, only a canary has steps. Undefined when nothing changes.
 */
export function changeFor(c: ArchCollection, thing: { id: Id }, field: Field, value: FieldValue): Call | { error: string } | undefined {
  if (same(valueOf(thing, field.key), value)) return undefined;
  if (field.required && empty(value)) return { error: `${field.label} can't be empty` };
  const [head, sub] = field.key.split(".") as [string, string | undefined];
  const v = empty(value) ? null : value;
  if (c === "parts" && head === "build" && sub) {
    const part = thing as Part;
    if (!part.build && sub !== "repo") return { error: "Give the repo first" };
    return { tool: "set_build", args: { part: part.id, [sub]: v } };
  }
  const args: Record<string, unknown> = { id: thing.id };
  if (sub) {
    const obj: Record<string, unknown> = { ...((thing as Record<string, unknown>)[head] as object | undefined) };
    if (v === null) delete obj[sub];
    else obj[sub] = v;
    if (c === "releases" && head === "strategy" && sub === "kind" && v !== "canary") delete obj.steps;
    // An object some of whose fields it can't be without: the one with a usual value takes it, the others are asked for.
    if (Object.keys(obj).length) {
      for (const [k, need] of Object.entries(NEEDS[head] ?? {})) {
        if (obj[k] !== undefined) continue;
        if (need.usual === undefined) return { error: `Give the ${need.label} first` };
        obj[k] = need.usual;
      }
    }
    args[head] = Object.keys(obj).length ? obj : null;
  } else args[head] = v;
  if (c === "workloads" && head === "kind") {
    const w = thing as Workload;
    if (v === "CronJob" && !w.schedule) args.schedule = "0 * * * *";
    if (v !== "CronJob" && w.schedule) args.schedule = null;
    if (v !== "Job" && w.before) args.before = null;
  }
  return { tool: TOOL[c], args };
}

/** The fields a nested object can't be without, and the value one takes when another is set first. */
const NEEDS: Record<string, Record<string, { label: string; usual?: unknown }>> = {
  replicas: { min: { label: "replicas", usual: 1 } },
  scale: { by: { label: "scale metric", usual: "cpu" }, target: { label: "scale target" } },
  ingress: { host: { label: "ingress host" } },
  account: { name: { label: "account name" } },
  service: { port: { label: "port" } },
  gitops: { tool: { label: "GitOps tool", usual: "argocd" }, repo: { label: "GitOps repo" } },
  fails: { at: { label: "failing step", usual: 1 }, then: { label: "play it goes to" } },
};

/** Marks a thing as part of a plan (planned, or removed if it already was), or live again with no plan. */
export function planChange(c: ArchCollection, thing: { id: Id; plan?: Id; status?: string }, plan: Id | undefined): Call {
  if (c === "releases") return { tool: TOOL[c], args: { id: thing.id, plan: plan ?? null } };
  return { tool: TOOL[c], args: plan ? { id: thing.id, plan, status: thing.status === "removed" ? "removed" : "planned" } : { id: thing.id, plan: null, status: null } };
}

/** A ref field's choices: [id, label]; a migration's store is one of the stores. */
export function refOptions(arch: Architecture, c: ArchCollection, field: Field, self: Id | undefined): [Id, string][] {
  if (!field.ref) return [];
  const bag: Record<Id, { id: Id; name?: string }> = arch[field.ref];
  let all = Object.values(bag).filter((x) => x.id !== self);
  if (c === "migrations" && field.key === "store") all = all.filter((x) => arch.parts[x.id]?.kind === "store");
  return all.map((x): [Id, string] => [x.id, labelOf(arch, x.id)]).sort((a, b) => a[1].localeCompare(b[1]));
}

/** The node pools a workload can run on: those of its namespace's cluster. */
export const poolOptions = (arch: Architecture, w: Workload): string[] =>
  (arch.clusters[arch.namespaces[w.namespace]?.cluster ?? ""]?.pools ?? []).map((p) => p.name);

/** What a thing is called where a person reads it. */
export function labelOf(arch: Architecture, id: Id): string {
  const c = archCollectionOf(arch, id);
  if (!c) return id;
  if (c === "workloads") return `${workloadName(arch, arch.workloads[id]!)} (${arch.environments[arch.workloads[id]!.environment]?.name ?? arch.workloads[id]!.environment})`;
  if (c === "links") {
    const l = arch.links[id]!;
    return `${arch.parts[l.from]?.name ?? l.from} ${l.kind} ${arch.parts[l.to]?.name ?? l.to}`;
  }
  const thing = arch[c][id];
  return thing && "name" in thing ? thing.name : id;
}

/** The id a set_ tool's reply names: "Created part returns-api.", "Changed link api-calls-db." */
export const savedId = (reply: string): Id | undefined => reply.match(/^(?:Created|Changed) [a-z]+ (\S+?)\.$/)?.[1];

// ---- + Add ----

export const ADDABLE = ["parts", "links", "environments", "clusters", "namespaces", "workloads", "releases", "migrations", "plans", "stages", "plays"] as const satisfies readonly ArchCollection[];
export type Addable = (typeof ADDABLE)[number];

export interface AddContext {
  /** The environment shown. */
  env?: Id | undefined;
  selected?: Id | undefined;
  /** The play shown in Flows: a new step starts from what it touches. */
  playKind?: (typeof PLAY_KINDS)[number] | undefined;
}

const WORKLOAD_FOR: Partial<Record<Part["kind"], Workload["kind"]>> = { job: "Job", store: "StatefulSet" };
const unique = (taken: Iterable<string>, base: string) => {
  const used = new Set(taken);
  for (let i = 1; ; i++) { const n = i === 1 ? base : `${base}-${i}`; if (!used.has(n)) return n; }
};

/** The part the selection is about: the part itself, a workload's or a link's start. */
export function partOf(arch: Architecture, id: Id | undefined): Part | undefined {
  if (!id) return undefined;
  return arch.parts[id] ?? arch.parts[arch.workloads[id]?.part ?? ""] ?? arch.parts[arch.links[id]?.from ?? ""] ?? arch.parts[arch.migrations[id]?.store ?? ""];
}

/** What "+ Add" makes of `what` where the person is, or why it can't yet. */
export function addFor(arch: Architecture, what: Addable, ctx: AddContext): Call | { error: string } {
  const sel = ctx.selected;
  const part = partOf(arch, sel);
  const env = ctx.env && arch.environments[ctx.env] ? arch.environments[ctx.env] : environmentsInOrder(arch).at(-1);
  const parts = Object.values(arch.parts);
  switch (what) {
    case "parts": {
      const groups = Object.keys(arch.groups);
      const group = sel && arch.groups[sel] ? sel : part?.group ?? (groups.length === 1 ? groups[0] : undefined);
      return { tool: "set_part", args: { name: "New part", kind: "service", ...(group ? { group } : {}) } };
    }
    case "links": {
      const from = part ?? parts[0];
      const to = parts.find((p) => p.id !== from?.id);
      if (!from || !to) return { error: "Needs two parts" };
      return { tool: "link_parts", args: { from: from.id, to: to.id, kind: "calls" } };
    }
    case "environments": return { tool: "set_environment", args: { name: "New environment" } };
    case "clusters": return { tool: "set_cluster", args: { name: "New cluster", provider: "eks" } };
    case "namespaces": {
      const cluster = (sel && arch.clusters[sel] ? sel : undefined) ?? env?.cluster ?? Object.keys(arch.clusters)[0];
      if (!cluster) return { error: "Needs a cluster" };
      return { tool: "set_namespace", args: { cluster, name: unique(Object.values(arch.namespaces).filter((n) => n.cluster === cluster).map((n) => n.name), "new-namespace") } };
    }
    case "workloads": {
      const p = part ?? parts[0];
      if (!p) return { error: "Needs a part" };
      if (!env) return { error: "Needs an environment" };
      const inCluster = Object.values(arch.namespaces).filter((n) => n.cluster === env.cluster);
      const ns = (sel && arch.namespaces[sel]?.cluster === env.cluster ? arch.namespaces[sel] : undefined)
        ?? arch.namespaces[workloadsOf(arch, p.id, env.id)[0]?.namespace ?? ""] ?? inCluster[0];
      if (!ns) return { error: `${env.name} needs a cluster with a namespace` };
      const kind = WORKLOAD_FOR[p.kind] ?? "Deployment";
      const taken = Object.values(arch.workloads).filter((w) => w.namespace === ns.id && w.environment === env.id).map((w) => workloadName(arch, w));
      const base = workloadName(arch, { id: "", part: p.id, environment: env.id, namespace: ns.id, kind });
      return { tool: "set_workload", args: { part: p.id, environment: env.id, namespace: ns.id, kind, ...(taken.includes(base) ? { name: unique(taken, base) } : {}) } };
    }
    case "releases": {
      const p = part ?? parts[0];
      const path = environmentsInOrder(arch).map((e) => e.id);
      if (!p) return { error: "Needs a part" };
      if (!path.length) return { error: "Needs an environment" };
      return { tool: "set_release", args: { name: "New release", parts: [p.id], path, strategy: { kind: "rolling" } } };
    }
    case "migrations": {
      const store = part?.kind === "store" ? part : parts.find((p) => p.kind === "store");
      if (!store) return { error: "Needs a store part" };
      return { tool: "set_migration", args: { name: "new_migration", store: store.id, change: "What changes", safe: "additive" } };
    }
    case "plans": return { tool: "set_plan", args: { name: "New plan" } };
    case "stages": return { tool: "set_stage", args: { name: "New stage" } };
    case "plays": {
      const touches = sel && archCollectionOf(arch, sel) ? [sel] : [];
      return { tool: "set_play", args: { name: "New play", kind: ctx.playKind ?? "request", steps: [{ name: "First step", touches }] } };
    }
  }
}

// ---- Delete ----

/**
 * Everything deleting `ids` takes with it (not `ids` themselves), the way delete_architecture decides: a part's links,
 * workloads and migrations; an environment's or namespace's workloads; a cluster's namespaces; a plan's planned things;
 * a release left with no parts or no environments.
 */
export function cascadeOf(arch: Architecture, ids: readonly Id[]): Id[] {
  const gone = new Set(ids);
  for (let size = -1; size !== gone.size;) {
    size = gone.size;
    const inPlan = (x: { plan?: Id; status?: string }) => x.plan !== undefined && gone.has(x.plan) && x.status !== "removed";
    const add = (x: { id: Id }, when: boolean) => { if (when) gone.add(x.id); };
    for (const x of Object.values(arch.parts)) add(x, inPlan(x));
    for (const x of Object.values(arch.links)) add(x, gone.has(x.from) || gone.has(x.to) || inPlan(x));
    for (const x of Object.values(arch.namespaces)) add(x, gone.has(x.cluster));
    for (const x of Object.values(arch.workloads)) add(x, gone.has(x.part) || gone.has(x.environment) || gone.has(x.namespace) || inPlan(x));
    for (const x of Object.values(arch.migrations)) add(x, gone.has(x.store) || inPlan(x));
    for (const x of Object.values(arch.releases)) add(x, x.parts.every((p) => gone.has(p)) || x.path.every((e) => gone.has(e)) || (x.plan !== undefined && gone.has(x.plan)));
  }
  return [...gone].filter((id) => !ids.includes(id));
}

/** "Also deletes 2 links and 1 workload: api calls db, …": the one line said before a delete. */
export function cascadeText(arch: Architecture, ids: readonly Id[]): string {
  const also = cascadeOf(arch, ids);
  if (!also.length) return "Nothing else goes with it.";
  const counts = new Map<ArchCollection, number>();
  for (const id of also) { const c = archCollectionOf(arch, id); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); }
  const what = [...counts].map(([c, n]) => `${n} ${NOUN[c]}${n === 1 ? "" : "s"}`).join(", ");
  const names = also.slice(0, 4).map((id) => labelOf(arch, id)).join("; ");
  return `Also deletes ${what}: ${names}${also.length > 4 ? "; …" : ""}.`;
}
