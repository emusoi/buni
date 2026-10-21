// Architecture: how the app is built and shipped, code → build → release → Kubernetes → run. One area of buni's
// design tools (agent/areas.ts); tools.ts gathers them. Every set_ tool creates when id is left out and changes the
// thing when it is given: what a change leaves out is kept, and null removes an optional field.
import { z } from "zod";
import {
  ARCH_COLLECTIONS, ARCH_STATUSES, CLUSTER_PROVIDERS, GITOPS_TOOLS, GROUP_KINDS, LINK_KINDS, MIGRATION_SAFETY, PART_KINDS, PLAY_KINDS, SCALE_BY,
  STRATEGIES, WORKLOAD_KINDS, archCollectionOf, architectureOf, workloadName,
  type ArchCollection, type Architecture, type Doc, type Id, type Workload,
} from "../../format/doc.ts";
import { Reader } from "../../format/parse.ts";
import type { SourceOwner } from "../../format/sources.ts";
import { ARCH_PUT, type Op } from "../../oplog/oplog.ts";
import { Ids, type Tool, type ToolContext, ToolError, tool } from "../kit.ts";

const ID = z.string().optional().describe("Id to change; omit to create");
/** An optional field of a change: left out keeps it, null removes it. */
const opt = <T extends z.ZodType>(t: T) => t.nullable().optional();
const TEXT = opt(z.string().min(1));
const LIST = opt(z.array(z.string().min(1)));
const STATUS = opt(z.enum(ARCH_STATUSES)).describe("live (default), planned, deprecated, or removed: planned and removed belong to a plan");
const PLAN = TEXT.describe("Plan id this belongs to: what merge_plan makes live (or, removed, takes out)");

/** `base` with `changes` laid over it: undefined keeps a field, null removes it. Its sources are kept apart. */
function edited(base: object, changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  delete out.sources;
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete out[k];
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/** A thing read by the format's own reader, so a tool builds nothing a file couldn't hold; the reply names the rule. */
function shaped<T>(noun: string, read: (r: Reader) => T): T {
  const r = new Reader();
  const value = read(r);
  if (r.errors.length) throw new ToolError(`That ${noun} breaks the format:\n${r.errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`);
  return value;
}

/** The existing thing a change names, or undefined for a new one. */
function existing<T>(bag: Record<Id, T>, id: Id | undefined, noun: string): T | undefined {
  if (id === undefined) return undefined;
  const v = Object.hasOwn(bag, id) ? bag[id] : undefined;
  if (v === undefined) throw new ToolError(`${noun} "${id}" does not exist`);
  return v;
}

/** The id of the thing a change makes or changes. */
const idFor = (doc: Doc, ctx: ToolContext, old: { id: Id } | undefined, name: string): Id => old?.id ?? new Ids(doc, ctx).slug(name);

const keepSources = <T extends SourceOwner>(old: T | undefined, value: T): T => (old?.sources ? { ...value, sources: old.sources } : value);

const saved = (verb: boolean, noun: string, id: Id) => `${verb ? "Changed" : "Created"} ${noun} ${id}.`;

/** One more than the last, so a new environment or stage comes after the others. */
const nextOrder = (bag: Record<Id, { order: number }>) => Math.max(0, ...Object.values(bag).map((x) => x.order)) + 1;

/** A copy of the architecture whose collections can be changed without touching `arch`. */
function draftOf(arch: Architecture): Architecture {
  return {
    parts: { ...arch.parts }, links: { ...arch.links }, groups: { ...arch.groups }, environments: { ...arch.environments },
    clusters: { ...arch.clusters }, namespaces: { ...arch.namespaces }, workloads: { ...arch.workloads }, releases: { ...arch.releases },
    migrations: { ...arch.migrations }, plans: { ...arch.plans }, stages: { ...arch.stages }, plays: { ...arch.plays },
  };
}

type ArchBags = { [C in ArchCollection]: Record<Id, Architecture[C][Id]> };

function bagOps<C extends ArchCollection>(c: C, before: ArchBags, after: ArchBags, out: Op[]): void {
  for (const id of Object.keys(before[c])) if (!Object.hasOwn(after[c], id)) out.push({ kind: "delete", collection: c, id });
  for (const [id, v] of Object.entries(after[c])) if (JSON.stringify(before[c][id]) !== JSON.stringify(v)) out.push(ARCH_PUT[c](v));
}

/** The ops that turn one architecture into another. */
function opsBetween(before: Architecture, after: Architecture): Op[] {
  const out: Op[] = [];
  for (const c of ARCH_COLLECTIONS) bagOps(c, before, after, out);
  return out;
}

/** `x` without `plan` and `status`: it is simply live now. */
function settled<T extends { plan?: Id; status?: string }>(x: T): Omit<T, "plan" | "status"> {
  const { plan: _p, status: _s, ...rest } = x;
  return rest;
}

/**
 * The architecture without `ids` and what can't be without them: a part's links, workloads and migrations; an
 * environment's or namespace's workloads; a cluster's namespaces; a plan's planned things (what it would remove stays,
 * live); a release left with no parts or no environments. Everything else that named them just stops naming them.
 */
function without(arch: Architecture, ids: Iterable<Id>): { next: Architecture; gone: Set<Id> } {
  const gone = new Set(ids);
  for (let size = -1; size !== gone.size;) {
    size = gone.size;
    const add = (x: { id: Id }, when: boolean) => { if (when) gone.add(x.id); };
    const inPlan = (x: { plan?: Id; status?: string }) => x.plan !== undefined && gone.has(x.plan) && x.status !== "removed";
    for (const x of Object.values(arch.parts)) add(x, inPlan(x));
    for (const x of Object.values(arch.links)) add(x, gone.has(x.from) || gone.has(x.to) || inPlan(x));
    for (const x of Object.values(arch.namespaces)) add(x, gone.has(x.cluster));
    for (const x of Object.values(arch.workloads)) add(x, gone.has(x.part) || gone.has(x.environment) || gone.has(x.namespace) || inPlan(x));
    for (const x of Object.values(arch.migrations)) add(x, gone.has(x.store) || inPlan(x));
    for (const x of Object.values(arch.releases)) add(x, x.parts.every((p) => gone.has(p)) || x.path.every((e) => gone.has(e)) || (x.plan !== undefined && gone.has(x.plan)));
  }
  const next = draftOf(arch);
  for (const id of gone) {
    const c = archCollectionOf(arch, id);
    if (c) delete next[c][id];
  }
  const keep = (list: Id[] | undefined) => list?.filter((id) => !gone.has(id));
  const unplanned = <T extends { plan?: Id; status?: string }>(x: T): T | Omit<T, "plan" | "status"> => (x.plan !== undefined && gone.has(x.plan) ? settled(x) : x);
  for (const x of Object.values(next.parts)) next.parts[x.id] = unplanned(x.group !== undefined && gone.has(x.group) ? (({ group: _, ...rest }) => rest)(x) : x);
  for (const x of Object.values(next.links)) next.links[x.id] = unplanned(x);
  for (const x of Object.values(next.groups)) if (x.parent !== undefined && gone.has(x.parent)) { const { parent: _, ...rest } = x; next.groups[x.id] = rest; }
  for (const x of Object.values(next.environments)) if (x.cluster !== undefined && gone.has(x.cluster)) { const { cluster: _, ...rest } = x; next.environments[x.id] = rest; }
  for (const x of Object.values(next.workloads)) {
    const egress = keep(x.egress);
    const { egress: _, ...rest } = unplanned(x);
    next.workloads[x.id] = { ...rest, ...(egress?.length ? { egress } : {}) };
  }
  for (const x of Object.values(next.releases)) {
    const before = keep(x.before);
    const { before: _, plan, ...rest } = x;
    next.releases[x.id] = { ...rest, parts: keep(x.parts) ?? [], path: keep(x.path) ?? [], ...(before?.length ? { before } : {}), ...(plan !== undefined && !gone.has(plan) ? { plan } : {}) };
  }
  for (const x of Object.values(next.migrations)) {
    const { release, ...rest } = unplanned(x);
    next.migrations[x.id] = { ...rest, ...(release !== undefined && !gone.has(release) ? { release } : {}) };
  }
  for (const x of Object.values(next.plans)) {
    const releases = keep(x.releases);
    const { releases: _, ...rest } = x;
    next.plans[x.id] = { ...rest, ...(releases?.length ? { releases } : {}) };
  }
  for (const x of Object.values(next.plays)) {
    const { release, fails, ...rest } = x;
    next.plays[x.id] = {
      ...rest,
      steps: x.steps.map((s) => ({ ...s, touches: s.touches.filter((id) => !gone.has(id)) })),
      ...(release !== undefined && !gone.has(release) ? { release } : {}),
      ...(fails && !gone.has(fails.then) ? { fails } : {}),
    };
  }
  return { next, gone };
}

/** What is in a plan, as "kind name" lines: what it adds and what it removes (its releases are listed on it). */
function planContents(arch: Architecture, plan: Id): { adds: string[]; removes: string[] } {
  const adds: string[] = [];
  const removes: string[] = [];
  const add = (what: string, x: { plan?: Id; status?: string }) => { if (x.plan === plan) (x.status === "removed" ? removes : adds).push(what); };
  for (const x of Object.values(arch.parts)) add(`part ${x.id} "${x.name}"`, x);
  for (const x of Object.values(arch.links)) add(`link ${x.id}: ${x.from} ${x.kind} ${x.to}`, x);
  for (const x of Object.values(arch.workloads)) add(`workload ${x.id} (${x.kind} ${workloadName(arch, x)})`, x);
  for (const x of Object.values(arch.migrations)) add(`migration ${x.id} "${x.name}"`, x);
  return { adds, removes };
}

// ---- The brief: the architecture as plain text, at the level a reader needs. ----

export type BriefLevel = "system" | "runtime" | "code";

/** Everything one hop from `id`: what it names and what names it; for a plan, everything in it. */
function around(arch: Architecture, id: Id): Set<Id> {
  const near = new Set([id]);
  const link = (a: Id, refs: (Id | undefined)[]) => {
    if (a === id) for (const r of refs) if (r !== undefined) near.add(r);
    if (refs.includes(id)) near.add(a);
  };
  for (const x of Object.values(arch.parts)) link(x.id, [x.group, x.plan]);
  for (const x of Object.values(arch.links)) link(x.id, [x.from, x.to, x.plan]);
  for (const x of Object.values(arch.groups)) link(x.id, [x.parent]);
  for (const x of Object.values(arch.environments)) link(x.id, [x.cluster]);
  for (const x of Object.values(arch.namespaces)) link(x.id, [x.cluster]);
  for (const x of Object.values(arch.workloads)) link(x.id, [x.part, x.environment, x.namespace, x.plan, ...(x.egress ?? [])]);
  for (const x of Object.values(arch.releases)) link(x.id, [...x.parts, ...x.path, ...(x.before ?? []), x.plan]);
  for (const x of Object.values(arch.migrations)) link(x.id, [x.store, x.release, x.plan]);
  for (const x of Object.values(arch.plans)) link(x.id, x.releases ?? []);
  for (const x of Object.values(arch.plays)) link(x.id, [x.release, x.fails?.then, ...x.steps.flatMap((s) => s.touches)]);
  // A part's links and workloads bring the parts at their other ends and where they run.
  for (const x of Object.values(arch.links)) if (near.has(x.id)) { near.add(x.from); near.add(x.to); }
  for (const x of Object.values(arch.workloads)) if (near.has(x.id)) { near.add(x.namespace); near.add(x.environment); }
  return near;
}

/** The architecture as a brief to build or review from: everything, one level, one environment, or one thing and what is around it. */
export function architectureBrief(doc: Doc, opts: { level?: BriefLevel; environment?: Id; focus?: Id } = {}): string {
  const arch = architectureOf(doc);
  if (!ARCH_COLLECTIONS.some((c) => Object.keys(arch[c]).length)) return "(no architecture yet: set_part, link_parts and set_workload start one)";
  const env = opts.environment === undefined ? undefined : Object.values(arch.environments).find((e) => e.id === opts.environment || e.name === opts.environment);
  if (opts.environment !== undefined && !env) throw new ToolError(`environment "${opts.environment}" does not exist; there are ${Object.values(arch.environments).map((e) => e.id).join(", ") || "none"}`);
  if (opts.focus !== undefined && !archCollectionOf(arch, opts.focus)) throw new ToolError(`"${opts.focus}" is nothing in the architecture`);
  const near = opts.focus === undefined ? undefined : around(arch, opts.focus);
  const show = (id: Id) => !near || near.has(id);
  const level = (l: BriefLevel) => opts.level === undefined || opts.level === l;
  const out: string[] = [];
  const section = (title: string, lines: string[]) => { if (lines.length) out.push(`## ${title}`, ...lines, ""); };
  const tags = (x: { status?: string; plan?: Id }) => [x.status && x.status !== "live" ? x.status : "", x.plan ? `plan ${x.plan}` : ""].filter(Boolean);
  const bracket = (t: string[]) => (t.length ? ` [${t.join(" · ")}]` : "");
  const partName = (id: Id) => arch.parts[id]?.name ?? id;
  const envs = Object.values(arch.environments).sort((a, b) => a.order - b.order);

  if (level("system")) {
    const lines: string[] = [];
    for (const g of Object.values(arch.groups)) if (show(g.id)) lines.push(`group ${g.id} "${g.name}" (${g.kind}${g.parent ? ` in ${g.parent}` : ""})`);
    for (const p of Object.values(arch.parts)) {
      if (!show(p.id)) continue;
      const what = [p.kind, p.tech, p.managed ? `managed: ${p.managed}` : "", p.group ? `in ${p.group}` : "", p.owners ? `owners: ${p.owners}` : ""].filter(Boolean).join(" · ");
      lines.push(`part ${p.id} "${p.name}" ${what}${bracket(tags(p))}${p.about ? ` — ${p.about}` : ""}`);
    }
    for (const l of Object.values(arch.links)) if (show(l.id)) lines.push(`link ${l.id}: ${partName(l.from)} ${l.kind} ${partName(l.to)}${l.carries ? ` · ${l.carries}` : ""}${bracket(tags(l))}`);
    section("System", lines);
  }

  if (level("runtime")) {
    for (const e of env ? [env] : envs) {
      const lines: string[] = [];
      const c = e.cluster !== undefined ? arch.clusters[e.cluster] : undefined;
      if (c && show(c.id)) {
        lines.push(`cluster ${c.id} "${c.name}": ${c.provider}${c.version ? ` ${c.version}` : ""}${c.zones ? ` · ${c.zones} zones` : ""}`);
        for (const p of c.pools ?? []) lines.push(`  pool ${p.name}: ${p.machine ? `${p.machine} ` : ""}×${p.min}–${p.max}${p.spot ? " · spot" : ""}${p.taint ? ` · taint ${p.taint}` : ""}`);
        if (c.addons?.length) lines.push(`  add-ons: ${c.addons.join(", ")}`);
        if (c.gitops) lines.push(`  ${c.gitops.tool} syncs ${c.gitops.repo}${c.gitops.path ? `/${c.gitops.path}` : ""}`);
      }
      const here = Object.values(arch.workloads).filter((w) => w.environment === e.id && show(w.id));
      for (const ns of Object.values(arch.namespaces).filter((n) => here.some((w) => w.namespace === n.id) || (show(n.id) && n.cluster === e.cluster))) {
        lines.push(`namespace ${ns.id} "${ns.name}"${ns.owners ? ` (${ns.owners})` : ""}`);
        for (const w of here.filter((x) => x.namespace === ns.id)) lines.push(`  ${workloadLine(arch, w)}`);
      }
      if (lines.length || show(e.id)) {
        const where = [e.provider, e.region, e.preview ? "one per pull request" : ""].filter(Boolean).join(" · ");
        section(`Runtime · ${e.name} (${e.id}${where ? `, ${where}` : ""})`, lines.length ? lines : ["(nothing runs here in the cluster)"]);
      }
    }
    const beside = (pred: (k: string, managed: boolean) => boolean, title: string) => section(title, Object.values(arch.parts)
      .filter((p) => show(p.id) && pred(p.kind, p.managed !== undefined))
      .map((p) => `${p.id} "${p.name}" ${[p.tech, p.managed].filter(Boolean).join(" · ")}${bracket(tags(p))}`));
    beside((k) => k === "edge", "Edge");
    beside((k, managed) => managed && k !== "edge" && k !== "external", "Managed");
    beside((k) => k === "external", "Outside services");
  }

  if (level("code")) {
    section("Code", Object.values(arch.parts).filter((p) => show(p.id) && p.build).map((p) => {
      const b = p.build;
      if (!b) return "";
      const bits = [`${b.repo}${b.path ? ` ${b.path}` : ""}`, b.dockerfile, b.steps?.join(" → "), b.artifact ? `makes ${b.artifact}` : "", b.registry ? `to ${b.registry}` : "", p.owners ? `owners: ${p.owners}` : ""];
      return `${p.id} "${p.name}": ${bits.filter(Boolean).join(" · ")}`;
    }));
    section("Software path", Object.values(arch.stages).sort((a, b) => a.order - b.order).filter((s) => show(s.id)).flatMap((s) => [
      `${s.order}. ${s.name} (${s.id})${s.tools ? ` · ${s.tools}` : ""}${s.about ? ` — ${s.about}` : ""}`,
      ...(s.steps ?? []).map((x) => `   - ${x}`),
      ...(s.makes?.length ? [`   makes: ${s.makes.join(", ")}`] : []),
      ...(s.gate ? [`   gate: ${s.gate}`] : []),
    ]));
  }

  if (level("code") || level("runtime")) {
    const lines: string[] = [];
    for (const r of Object.values(arch.releases)) {
      if (!show(r.id) || (env && !r.path.includes(env.id))) continue;
      const s = r.strategy;
      lines.push(`release ${r.id} "${r.name}": ${r.parts.map(partName).join(", ")} · ${r.path.map((id) => arch.environments[id]?.name ?? id).join(" → ")} · ${s.kind}${s.steps ? ` ${s.steps.join(" → ")}%` : ""}${s.hold ? ` holding ${s.hold}` : ""}${r.plan ? ` [plan ${r.plan}]` : ""}`);
      if (r.manifests) lines.push(`  manifests: ${r.manifests}`);
      if (r.before?.length) lines.push(`  runs first: ${r.before.map((id) => { const w = arch.workloads[id]; return w ? `${workloadName(arch, w)} in ${arch.environments[w.environment]?.name ?? w.environment}` : id; }).join(", ")}`);
      if (r.checks?.length) lines.push(`  checks: ${r.checks.join("; ")}`);
      if (r.rollback) lines.push(`  rollback: ${r.rollback}`);
    }
    for (const m of Object.values(arch.migrations)) if (show(m.id)) lines.push(`migration ${m.id} "${m.name}" on ${partName(m.store)}${m.release ? ` in ${arch.releases[m.release]?.name ?? m.release}` : ""} (${m.safe}): ${m.change}${bracket(tags(m))}`);
    section("Releases", lines);
  }

  section("Plans", Object.values(arch.plans).filter((p) => show(p.id)).flatMap((p) => {
    const { adds, removes } = planContents(arch, p.id);
    return [
      `plan ${p.id} "${p.name}"${p.issue ? ` ${p.issue}` : ""}${p.about ? ` — ${p.about}` : ""}`,
      ...(p.releases?.length ? [`  ships in: ${p.releases.map((id) => arch.releases[id]?.name ?? id).join(", ")}`] : []),
      ...adds.map((x) => `  adds ${x}`),
      ...removes.map((x) => `  removes ${x}`),
    ];
  }));

  if (opts.level === undefined) {
    section("Plays", Object.values(arch.plays).filter((p) => show(p.id)).flatMap((p) => [
      `play ${p.id} "${p.name}" (${p.kind}${p.release ? `, release ${p.release}` : ""})`,
      ...p.steps.map((s, i) => `  ${i + 1}. ${s.name}${s.about ? ` — ${s.about}` : ""}${s.touches.length ? ` [${s.touches.join(", ")}]` : ""}${s.check ? ` check: ${s.check}` : ""}`),
      ...(p.fails ? [`  if step ${p.fails.at}'s check fails: play ${p.fails.then}`] : []),
    ]));
  }
  return out.join("\n").trim() || "(nothing at this level)";
}

function workloadLine(arch: Architecture, w: Workload): string {
  const r = w.replicas;
  const res = w.resources;
  const bits = [
    w.image,
    r ? `replicas ${r.min}${r.max !== undefined ? `–${r.max}` : ""}` : "",
    w.scale ? `scales on ${w.scale.by} ${w.scale.target}` : "",
    w.keep !== undefined ? `keeps ${w.keep}` : "",
    res && (res.cpu || res.memory) ? `requests ${[res.cpu, res.memory].filter(Boolean).join("/")}` : "",
    res && (res.limitCpu || res.limitMemory) ? `limits ${[res.limitCpu, res.limitMemory].filter(Boolean).join("/")}` : "",
    w.probes ? `probes ${[w.probes.ready ? `ready ${w.probes.ready}` : "", w.probes.live ? `live ${w.probes.live}` : ""].filter(Boolean).join(", ")}` : "",
    w.service ? `service :${w.service.port}` : "",
    w.ingress ? `ingress ${w.ingress.host}${w.ingress.path ?? ""}` : "",
    w.config?.length ? `config ${w.config.join(", ")}` : "",
    w.secrets?.length ? `secrets ${w.secrets.join(", ")}` : "",
    w.account ? `account ${w.account.name}${w.account.role ? ` → ${w.account.role}` : ""}` : "",
    w.egress?.length ? `egress ${w.egress.join(", ")}` : "",
    w.schedule ? `schedule ${w.schedule}` : "",
    w.before ? "runs before each sync" : "",
    w.nodes ? `on ${w.nodes}` : "",
  ];
  const tags = [w.status && w.status !== "live" ? w.status : "", w.plan ? `plan ${w.plan}` : ""].filter(Boolean);
  return `${w.kind} ${workloadName(arch, w)} (${w.id}) runs ${arch.parts[w.part]?.name ?? w.part}${tags.length ? ` [${tags.join(" · ")}]` : ""}: ${bits.filter(Boolean).join(" · ")}`;
}

// ---- The tools. ----

const POOL = z.object({ name: z.string(), machine: z.string().optional(), min: z.number().int().min(0), max: z.number().int().min(0), spot: z.boolean().optional(), taint: z.string().optional() });

export const architectureTools = {
  set_part: tool({
    description:
      "Add a part of the app, or change one (pass id). Kinds: client (a web or mobile app), service (an API), worker, job, store (a database, a bucket), " +
      "cache, queue, external (Stripe, Shippo), edge (DNS, CDN, firewall, load balancer). managed says it runs as a cloud service, not a workload " +
      '("RDS Postgres Multi-AZ"). status planned with plan proposes it. How it is built: set_build.',
    input: {
      id: ID,
      name: z.string().min(1).optional(),
      kind: z.enum(PART_KINDS).optional(),
      tech: TEXT.describe('"Next.js", "Postgres 16", "CloudFront"'),
      about: TEXT.describe("What it does, in a sentence"),
      group: TEXT.describe("Group id it sits in"),
      owners: TEXT.describe('"returns team"'),
      managed: TEXT.describe('The managed service it runs as: "RDS Postgres Multi-AZ", "SQS"'),
      status: STATUS,
      plan: PLAN,
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.parts, id, "part");
      if (!old && (a.name === undefined || a.kind === undefined)) throw new ToolError("a new part needs a name and a kind");
      const pid = idFor(doc, ctx, old, a.name ?? "part");
      const value = keepSources(old, shaped("part", (r) => r.part(edited(old ?? { id: pid }, changes), `parts.${pid}`)));
      return { label: `${old ? "Change" : "Add"} ${value.kind} ${value.name}`, ops: [ARCH_PUT.parts(value)], reply: saved(!!old, "part", value.id) };
    },
  }),

  set_build: tool({
    description: "How a part is built: its repo and path, Dockerfile, pipeline steps, what it makes and where that goes. What you leave out is kept; remove drops it.",
    input: {
      part: z.string(),
      repo: z.string().min(1).optional().describe('"github.com/acme/parcel"'),
      path: TEXT.describe('Folder in the repo: "api/"'),
      dockerfile: TEXT,
      steps: LIST.describe('Pipeline steps in order: ["lint", "test", "build", "scan", "sign"]'),
      artifact: TEXT.describe('What it makes: "api image", "web bundle"'),
      registry: TEXT.describe('Where that goes: "ECR"'),
      remove: z.boolean().optional(),
    },
    run: async (doc, a) => {
      const part = existing(architectureOf(doc).parts, a.part, "part");
      if (!part) throw new ToolError("give the part");
      const { part: _, remove, ...changes } = a;
      const { build: _old, ...rest } = part;
      if (remove) return { label: `Remove ${part.name}'s build`, ops: [ARCH_PUT.parts(rest)], reply: `${part.name} has no build now.` };
      if (!part.build && a.repo === undefined) throw new ToolError("a new build needs its repo");
      const build = shaped("build", (r) => r.build(edited(part.build ?? {}, changes), `parts.${part.id}.build`));
      return { label: `Build of ${part.name}`, ops: [ARCH_PUT.parts({ ...rest, build })], reply: `${part.name} builds from ${build.repo}${build.path ? ` ${build.path}` : ""}.` };
    },
  }),

  link_parts: tool({
    description:
      "Say how two parts talk: calls, reads, writes, publishes, subscribes, or routes (edge → what it fronts), and what passes along it (carries). " +
      "Without id, a link with the same from, to and kind is changed rather than added. unlink removes links.",
    input: {
      id: ID,
      from: z.string().optional(),
      to: z.string().optional(),
      kind: z.enum(LINK_KINDS).optional(),
      carries: TEXT.describe('"RefundJob", "Return"'),
      status: STATUS,
      plan: PLAN,
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.links, id, "link") ?? Object.values(arch.links).find((l) => l.from === a.from && l.to === a.to && l.kind === a.kind);
      if (!old && (a.from === undefined || a.to === undefined || a.kind === undefined)) throw new ToolError("a new link needs from, to and kind");
      const lid = idFor(doc, ctx, old, `${a.from}-${a.kind}-${a.to}`);
      const value = shaped("link", (r) => r.archLink(edited(old ?? { id: lid }, changes), `links.${lid}`));
      return { label: `${value.from} ${value.kind} ${value.to}`, ops: [ARCH_PUT.links(value)], reply: saved(!!old, "link", value.id) };
    },
  }),

  unlink: tool({
    description: "Remove links between parts, by id.",
    input: { links: z.array(z.string()).min(1) },
    run: async (doc, a) => {
      const arch = architectureOf(doc);
      for (const id of a.links) existing(arch.links, id, "link");
      return { label: `Remove ${a.links.length} link${a.links.length === 1 ? "" : "s"}`, ops: a.links.map((id): Op => ({ kind: "delete", collection: "links", id })), reply: "Removed." };
    },
  }),

  set_group: tool({
    description: "A boundary parts sit in: a system, a domain or a team; parent nests it in another. Put a part in it with set_part {group}.",
    input: { id: ID, name: z.string().min(1).optional(), kind: z.enum(GROUP_KINDS).optional(), parent: TEXT.describe("Group id it sits in") },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.groups, id, "group");
      if (!old && (a.name === undefined || a.kind === undefined)) throw new ToolError("a new group needs a name and a kind");
      const gid = idFor(doc, ctx, old, a.name ?? "group");
      const value = shaped("group", (r) => r.group(edited(old ?? { id: gid }, changes), `groups.${gid}`));
      return { label: `${old ? "Change" : "Add"} group ${value.name}`, ops: [ARCH_PUT.groups(value)], reply: saved(!!old, "group", value.id) };
    },
  }),

  set_environment: tool({
    description: "An environment a release goes through (preview, staging, prod): its order on the way to production, the cluster it runs on, provider and region.",
    input: {
      id: ID,
      name: z.string().min(1).optional(),
      order: z.number().optional().describe("Lower ships first; a new one goes last when omitted"),
      cluster: TEXT.describe("Cluster id"),
      provider: TEXT.describe('"AWS", "Vercel + Fly"'),
      region: TEXT,
      preview: opt(z.boolean()).describe("One per pull request"),
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, preview, ...changes } = a;
      const old = existing(arch.environments, id, "environment");
      if (!old && a.name === undefined) throw new ToolError("a new environment needs a name");
      const eid = idFor(doc, ctx, old, a.name ?? "environment");
      const base = old ?? { id: eid, order: nextOrder(arch.environments) };
      const value = shaped("environment", (r) => r.environment(edited(base, { ...changes, preview: preview === false ? null : preview }), `environments.${eid}`));
      return { label: `${old ? "Change" : "Add"} environment ${value.name}`, ops: [ARCH_PUT.environments(value)], reply: saved(!!old, "environment", value.id) };
    },
  }),

  set_cluster: tool({
    description:
      "A Kubernetes cluster: provider (eks, gke, aks, k3s, kind, other), version, zones, node pools, add-ons (Karpenter, External Secrets, Argo Rollouts, KEDA…) " +
      "and the GitOps tool and repo that sync it. Pools and add-ons replace the lists when given.",
    input: {
      id: ID,
      name: z.string().min(1).optional(),
      provider: z.enum(CLUSTER_PROVIDERS).optional(),
      version: TEXT.describe('"1.30"'),
      zones: opt(z.number().int().min(1)),
      pools: opt(z.array(POOL)).describe("Node pools; names are Kubernetes names"),
      addons: LIST,
      gitops: opt(z.object({ tool: z.enum(GITOPS_TOOLS), repo: z.string().min(1), path: z.string().optional() })),
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.clusters, id, "cluster");
      if (!old && (a.name === undefined || a.provider === undefined)) throw new ToolError("a new cluster needs a name and a provider");
      const cid = idFor(doc, ctx, old, a.name ?? "cluster");
      const value = shaped("cluster", (r) => r.cluster(edited(old ?? { id: cid }, changes), `clusters.${cid}`));
      return { label: `${old ? "Change" : "Add"} cluster ${value.name}`, ops: [ARCH_PUT.clusters(value)], reply: saved(!!old, "cluster", value.id) };
    },
  }),

  set_namespace: tool({
    description: "A namespace in a cluster, and who owns it. Workloads are placed in one with set_workload.",
    input: { id: ID, cluster: z.string().optional(), name: z.string().optional().describe("A Kubernetes name: returns, jobs"), owners: TEXT },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.namespaces, id, "namespace");
      if (!old && (a.cluster === undefined || a.name === undefined)) throw new ToolError("a new namespace needs a cluster and a name");
      const nid = idFor(doc, ctx, old, `${a.cluster}-${a.name}`);
      const value = shaped("namespace", (r) => r.namespace(edited(old ?? { id: nid }, changes), `namespaces.${nid}`));
      return { label: `${old ? "Change" : "Add"} namespace ${value.name}`, ops: [ARCH_PUT.namespaces(value)], reply: saved(!!old, "namespace", value.id) };
    },
  }),

  set_workload: tool({
    description:
      "What a part runs as in one environment: its Kubernetes kind (Deployment, Rollout, StatefulSet, Job, CronJob, DaemonSet) in a namespace, with replicas, " +
      "scaling (cpu or memory: HPA; queue: KEDA), keep (disruption budget), requests and limits, probes, Service port, Ingress, ConfigMaps, secrets, " +
      "service account and cloud role, egress (parts its NetworkPolicy allows), a CronJob's schedule, before (a Job run before each sync: migrations) " +
      "and the node pool. The namespace's cluster must be the environment's.",
    input: {
      id: ID,
      part: z.string().optional(),
      environment: z.string().optional(),
      namespace: z.string().optional(),
      kind: z.enum(WORKLOAD_KINDS).optional(),
      name: TEXT.describe("Its name in the cluster; the part's name made Kubernetes-safe when absent"),
      image: TEXT.describe('"api:4f2c9a1"'),
      replicas: opt(z.object({ min: z.number().int().min(0), max: z.number().int().min(0).optional() })),
      scale: opt(z.object({ by: z.enum(SCALE_BY), target: z.string().min(1) })).describe('{by:"cpu",target:"70%"} or {by:"queue",target:"depth > 100"}'),
      keep: opt(z.number().int().min(0)).describe("Pods kept during disruptions (PDB minAvailable)"),
      resources: opt(z.object({ cpu: z.string().optional(), memory: z.string().optional(), limitCpu: z.string().optional(), limitMemory: z.string().optional() })),
      probes: opt(z.object({ ready: z.string().optional(), live: z.string().optional() })).describe('{ready:"/health", live:"/live"}'),
      service: opt(z.object({ port: z.number().int().min(1).max(65535) })),
      ingress: opt(z.object({ host: z.string().min(1), path: z.string().optional() })),
      config: LIST.describe("ConfigMap names"),
      secrets: LIST.describe("Secret names"),
      account: opt(z.object({ name: z.string().min(1), role: z.string().optional() })).describe("Service account and the cloud role it assumes"),
      egress: LIST.describe("Part ids its NetworkPolicy lets it reach"),
      schedule: TEXT.describe('A CronJob\'s schedule: "0 2 * * *"'),
      before: opt(z.boolean()).describe("A Job that runs before each sync (migrations)"),
      nodes: TEXT.describe("Node pool name"),
      status: STATUS,
      plan: PLAN,
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, before, ...changes } = a;
      const old = existing(arch.workloads, id, "workload");
      if (!old && (a.part === undefined || a.environment === undefined || a.namespace === undefined || a.kind === undefined)) {
        throw new ToolError("a new workload needs a part, environment, namespace and kind");
      }
      const wid = idFor(doc, ctx, old, `${a.name ?? a.part}-${a.environment}`);
      const value = keepSources(old, shaped("workload", (r) => r.workload(edited(old ?? { id: wid }, { ...changes, before: before === false ? null : before }), `workloads.${wid}`)));
      return { label: `${old ? "Change" : "Add"} workload ${workloadName(arch, value)}`, ops: [ARCH_PUT.workloads(value)], reply: saved(!!old, "workload", value.id) };
    },
  }),

  set_release: tool({
    description:
      "How parts ship: a release (\"v42\") or a release path, its parts, the environments it goes through in order, where its manifests live, the strategy " +
      "(rolling, canary with traffic steps ending at 100 and a hold, blue-green), the checks each step must pass, how it rolls back, and the Jobs that run first.",
    input: {
      id: ID,
      name: z.string().min(1).optional(),
      parts: z.array(z.string()).optional(),
      path: z.array(z.string()).optional().describe("Environment ids in order"),
      manifests: TEXT.describe('"parcel-deploy/apps/returns-api"'),
      strategy: z.object({ kind: z.enum(STRATEGIES), steps: z.array(z.number()).optional(), hold: z.string().optional() }).optional(),
      checks: LIST.describe('"error rate < 1%", "p95 < 400 ms"'),
      rollback: TEXT,
      before: LIST.describe("Workload ids (Jobs) that run first"),
      plan: PLAN,
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.releases, id, "release");
      if (!old && (a.name === undefined || a.parts === undefined || a.path === undefined || a.strategy === undefined)) throw new ToolError("a new release needs a name, parts, path and strategy");
      const rid = idFor(doc, ctx, old, a.name ?? "release");
      const value = keepSources(old, shaped("release", (r) => r.release(edited(old ?? { id: rid }, changes), `releases.${rid}`)));
      return { label: `${old ? "Change" : "Add"} release ${value.name}`, ops: [ARCH_PUT.releases(value)], reply: saved(!!old, "release", value.id) };
    },
  }),

  set_migration: tool({
    description: "A change to a store's data or schema, the release it goes out with, and whether it is additive (running code keeps working) or breaking.",
    input: {
      id: ID,
      name: z.string().min(1).optional().describe('"0042_store_credit"'),
      store: z.string().optional().describe("Store part id"),
      release: TEXT.describe("Release id"),
      change: z.string().min(1).optional(),
      safe: z.enum(MIGRATION_SAFETY).optional(),
      status: STATUS,
      plan: PLAN,
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.migrations, id, "migration");
      if (!old && (a.name === undefined || a.store === undefined || a.change === undefined || a.safe === undefined)) throw new ToolError("a new migration needs a name, store, change and safe");
      const mid = idFor(doc, ctx, old, a.name ?? "migration");
      const value = shaped("migration", (r) => r.migration(edited(old ?? { id: mid }, changes), `migrations.${mid}`));
      return { label: `${old ? "Change" : "Add"} migration ${value.name}`, ops: [ARCH_PUT.migrations(value)], reply: saved(!!old, "migration", value.id) };
    },
  }),

  set_plan: tool({
    description:
      "A planned change: its issue, what it is for, and the releases it ships in, in order. What it adds or removes is marked on those things " +
      "(status planned or removed, with plan); merge_plan makes it so, delete_architecture discards it.",
    input: { id: ID, name: z.string().min(1).optional(), issue: TEXT.describe('"RET-214"'), about: TEXT, releases: LIST.describe("Release ids in order") },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.plans, id, "plan");
      if (!old && a.name === undefined) throw new ToolError("a new plan needs a name");
      const pid = idFor(doc, ctx, old, a.name ?? "plan");
      const value = keepSources(old, shaped("plan", (r) => r.plan(edited(old ?? { id: pid }, changes), `plans.${pid}`)));
      return { label: `${old ? "Change" : "Add"} plan ${value.name}`, ops: [ARCH_PUT.plans(value)], reply: saved(!!old, "plan", value.id) };
    },
  }),

  set_stage: tool({
    description: "A stage of the software path, idea to respond: its order, tools, steps, what it makes, and the gate to the next stage.",
    input: {
      id: ID,
      name: z.string().min(1).optional(),
      order: z.number().optional().describe("Its place on the path; a new one goes last when omitted"),
      tools: TEXT.describe('"GitHub Actions"'),
      steps: LIST,
      makes: LIST,
      gate: TEXT.describe('"signed, no critical CVEs"'),
      about: TEXT,
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.stages, id, "stage");
      if (!old && a.name === undefined) throw new ToolError("a new stage needs a name");
      const sid = idFor(doc, ctx, old, a.name ?? "stage");
      const value = shaped("stage", (r) => r.stage(edited(old ?? { id: sid, order: nextOrder(arch.stages) }, changes), `stages.${sid}`));
      return { label: `${old ? "Change" : "Add"} stage ${value.name}`, ops: [ARCH_PUT.stages(value)], reply: saved(!!old, "stage", value.id) };
    },
  }),

  set_play: tool({
    description:
      "A request, a release or a failure played step by step over the architecture: each step's name, what it touches (any architecture ids) and the check " +
      "it must pass. A release play names its release; fails {at: step number from 1, then: a failure play} is the branch when that step's check fails.",
    input: {
      id: ID,
      name: z.string().min(1).optional(),
      kind: z.enum(PLAY_KINDS).optional(),
      release: TEXT.describe("Release id"),
      steps: z.array(z.object({ name: z.string().min(1), about: z.string().optional(), touches: z.array(z.string()), check: z.string().optional() })).min(1).optional(),
      fails: opt(z.object({ at: z.number().int().min(1), then: z.string() })),
    },
    run: async (doc, a, ctx) => {
      const arch = architectureOf(doc);
      const { id, ...changes } = a;
      const old = existing(arch.plays, id, "play");
      if (!old && (a.name === undefined || a.kind === undefined || a.steps === undefined)) throw new ToolError("a new play needs a name, kind and steps");
      const pid = idFor(doc, ctx, old, a.name ?? "play");
      const value = shaped("play", (r) => r.play(edited(old ?? { id: pid }, changes), `plays.${pid}`));
      return { label: `${old ? "Change" : "Add"} play ${value.name}`, ops: [ARCH_PUT.plays(value)], reply: saved(!!old, "play", value.id) };
    },
  }),

  delete_architecture: tool({
    description:
      "Delete architecture things by id, with what can't be without them: a part's links, workloads and migrations; an environment's or namespace's " +
      "workloads; a cluster's namespaces (and so their workloads); a plan's planned things (discarding it; what it would remove stays); a release left " +
      "with no parts or environments. Anything else that named them stops naming them. The reply lists everything that went.",
    input: { ids: z.array(z.string()).min(1) },
    run: async (doc, a) => {
      const arch = architectureOf(doc);
      for (const id of a.ids) if (!archCollectionOf(arch, id)) throw new ToolError(`"${id}" is nothing in the architecture`);
      const { next, gone } = without(arch, a.ids);
      const also = [...gone].filter((id) => !a.ids.includes(id));
      return {
        label: `Delete ${a.ids.join(", ")}`,
        ops: opsBetween(arch, next),
        reply: `Deleted ${a.ids.join(", ")}${also.length ? `, and with them ${also.join(", ")}` : ""}.`,
      };
    },
  }),

  merge_plan: tool({
    description:
      "Make a plan real: what it adds becomes live (status and plan dropped), what it removes is deleted with what can't be without it, and the plan itself " +
      "goes (its issue is the history). Ask the person first: merging is theirs to decide.",
    input: { plan: z.string() },
    run: async (doc, a) => {
      const arch = architectureOf(doc);
      const plan = existing(arch.plans, a.plan, "plan");
      if (!plan) throw new ToolError("give the plan");
      const draft = draftOf(arch);
      const removed: Id[] = [];
      const mine = (x: { id: Id; plan?: Id; status?: string }) => {
        if (x.plan === plan.id && x.status === "removed") removed.push(x.id);
        return x.plan === plan.id && x.status !== "removed";
      };
      for (const x of Object.values(draft.parts)) if (mine(x)) draft.parts[x.id] = settled(x);
      for (const x of Object.values(draft.links)) if (mine(x)) draft.links[x.id] = settled(x);
      for (const x of Object.values(draft.workloads)) if (mine(x)) draft.workloads[x.id] = settled(x);
      for (const x of Object.values(draft.migrations)) if (mine(x)) draft.migrations[x.id] = settled(x);
      for (const r of Object.values(draft.releases)) if (r.plan === plan.id) { const { plan: _, ...rest } = r; draft.releases[r.id] = rest; }
      const { next, gone } = without(draft, [...removed, plan.id]);
      const { adds } = planContents(arch, plan.id);
      return {
        label: `Merge plan ${plan.name}`,
        ops: opsBetween(arch, next),
        reply: `Merged ${plan.name}: ${adds.length} thing${adds.length === 1 ? "" : "s"} live now${removed.length ? `; removed ${[...gone].filter((id) => id !== plan.id).join(", ")}` : ""}.`,
      };
    },
  }),

  read_architecture: tool({
    description:
      "The architecture as a plain-text brief: parts and links (system), clusters, namespaces and workloads per environment with edge, managed and " +
      "outside services (runtime), builds, the software path and releases (code), plans and plays. level narrows it, environment shows one, focus " +
      "shows one thing and what is around it.",
    input: {
      level: z.enum(["system", "runtime", "code"]).optional(),
      environment: z.string().optional().describe("Environment id or name"),
      focus: z.string().optional().describe("Any architecture id"),
    },
    run: async (doc, a) => ({
      label: "Read architecture",
      ops: [],
      reply: architectureBrief(doc, {
        ...(a.level ? { level: a.level } : {}),
        ...(a.environment !== undefined ? { environment: a.environment } : {}),
        ...(a.focus !== undefined ? { focus: a.focus } : {}),
      }),
    }),
  }),
} satisfies Record<string, Tool>;
