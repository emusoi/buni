// The architecture checked the way a careful platform reviewer reads it: what would break, page someone or leak at
// deploy time, worst first, each naming the thing it is on and the tool call that fixes it. Read-only.
import { architectureOf, workloadName, type ArchLink, type Architecture, type Doc, type Id, type Part, type Workload } from "../format/doc.ts";

export type Severity = "p1" | "p2" | "p3";

export interface Finding {
  rule: string;
  severity: Severity;
  /** The architecture id it is on. */
  id: Id;
  message: string;
  fix: string;
  /** The one tool call that repairs it, when `fix` already names every argument. Absent when a person still has to fill a blank in. */
  apply?: { tool: string; args: Record<string, unknown> };
}

const RANK: Record<Severity, number> = { p1: 0, p2: 1, p3: 2 };
/** Kinds that keep pods running, so they need probes, more than one replica in production, and can be canaried. */
const LONG_RUNNING = new Set<Workload["kind"]>(["Deployment", "Rollout", "StatefulSet", "DaemonSet"]);
/** Link kinds where the part starts the traffic, so its NetworkPolicy has to let it out. */
const OUTBOUND = new Set<ArchLink["kind"]>(["calls", "reads", "writes", "publishes", "subscribes"]);

const call = (tool: string, args: Record<string, unknown>) => `${tool} ${JSON.stringify(args)}`;
/** Whole values the check still wants a person to choose. A real name that merely contains one of these stays applicable. */
const BLANK = new Set(["CLUSTER_ID", "EDGE_PART", "REPO", "NAME", "WORKLOAD_ID", "MIGRATION_JOB_WORKLOAD", "PART_ID", "ISSUE", "RELEASE_ID", "PATH/", "DEPLOY_REPO/apps/NAME"]);
const concrete = (value: unknown): boolean => {
  if (typeof value === "string") return !BLANK.has(value) && !value.includes("DEPLOY_REPO");
  if (Array.isArray(value)) return value.every(concrete);
  if (value !== null && typeof value === "object") return Object.values(value).every(concrete);
  return true;
};
// ponytail: apply is parsed back out of the `tool {json}` sentence an agent reads. The upgrade is to build the call once and render the sentence from it.
function applyOf(fix: string): Finding["apply"] {
  const space = fix.indexOf(" ");
  if (space < 1 || !fix.endsWith("}")) return undefined;
  const tool = fix.slice(0, space);
  const json = fix.slice(space + 1);
  if (!/^[a-z_]+$/.test(tool) || !json.startsWith("{")) return undefined;
  let args: unknown;
  try { args = JSON.parse(json); } catch { return undefined; }
  if (!args || typeof args !== "object" || Array.isArray(args) || !concrete(args)) return undefined;
  return { tool, args: args as Record<string, unknown> };
}
const hasAddon = (addons: readonly string[] | undefined, re: RegExp) => (addons ?? []).some((a) => re.test(a));
/** A part that holds secrets for the cluster to read: Secrets Manager, Vault, Key Vault… */
const holdsSecrets = (p: Part) => /secret|vault/i.test(`${p.managed ?? ""} ${p.tech ?? ""} ${p.name}`);

/** Every finding on the document's architecture, worst first. */
export function checkArchitecture(doc: Doc): Finding[] {
  const arch = architectureOf(doc);
  const out: Finding[] = [];
  const add = (severity: Severity, rule: string, id: Id, message: string, fix: string) => {
    const apply = applyOf(fix);
    out.push({ rule, severity, id, message, fix, ...(apply ? { apply } : {}) });
  };
  const parts = Object.values(arch.parts);
  const links = Object.values(arch.links);
  const workloads = Object.values(arch.workloads);
  const releases = Object.values(arch.releases);
  const envs = Object.values(arch.environments).sort((a, b) => a.order - b.order);
  const last = envs.at(-1);
  const partName = (id: Id) => arch.parts[id]?.name ?? id;
  const envName = (id: Id) => arch.environments[id]?.name ?? id;
  const where = (w: Workload) => `${w.kind} ${workloadName(arch, w)} in ${envName(w.environment)}`;
  const linked = (a: Id, b: Id) => links.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  const clusterOf = (w: Workload) => {
    const c = arch.environments[w.environment]?.cluster;
    return c === undefined ? undefined : arch.clusters[c];
  };

  for (const w of workloads) {
    const env = arch.environments[w.environment];
    if (env && env.cluster === undefined) add("p1", "no-cluster", w.id, `${where(w)} has nowhere to run: ${env.name} names no cluster.`, call("set_environment", { id: env.id, cluster: "CLUSTER_ID" }));
    if (w.ingress && !w.service) add("p1", "ingress-no-service", w.id, `${where(w)} has an Ingress for ${w.ingress.host} but no Service for it to send to.`, call("set_workload", { id: w.id, service: { port: 8080 } }));
    const long = LONG_RUNNING.has(w.kind);
    if (long) {
      // Without a Service nothing sends it traffic, so only liveness matters.
      const missing = [w.probes?.ready || !w.service ? "" : "ready", w.probes?.live ? "" : "live"].filter(Boolean);
      const why = [missing.includes("ready") ? "traffic reaches pods before they can serve" : "", missing.includes("live") ? "a hung pod is never restarted" : ""].filter(Boolean).join(", and ");
      if (missing.length) add("p2", "no-probes", w.id, `${where(w)} has no ${missing.join(" or ")} probe: ${why}.`, call("set_workload", { id: w.id, probes: { ...w.probes, ...(missing.includes("ready") ? { ready: "/health" } : {}), ...(missing.includes("live") ? { live: "/live" } : {}) } }));
    }
    const res = w.resources;
    const limits = [res?.limitCpu ? "" : "limitCpu", res?.limitMemory ? "" : "limitMemory"].filter(Boolean);
    if (limits.length) add("p2", "no-limits", w.id, `${where(w)} has no ${limits.join(" or ")}: one runaway pod can starve its node.`, call("set_workload", { id: w.id, resources: { ...res, limitCpu: res?.limitCpu ?? res?.cpu ?? "500m", limitMemory: res?.limitMemory ?? res?.memory ?? "512Mi" } }));
    const requests = [res?.cpu ? "" : "cpu", res?.memory ? "" : "memory"].filter(Boolean);
    if (requests.length) add("p3", "no-requests", w.id, `${where(w)} requests no ${requests.join(" or ")}, so the scheduler places it blind.`, call("set_workload", { id: w.id, resources: { ...res, cpu: res?.cpu ?? "100m", memory: res?.memory ?? "256Mi" } }));
    const min = w.replicas?.min ?? 1;
    if (w.scale && (w.replicas?.max === undefined || w.replicas.max <= min)) add("p2", "scale-no-max", w.id, `${where(w)} scales on ${w.scale.by} but has no room to: replicas.max is ${w.replicas?.max ?? "unset"}.`, call("set_workload", { id: w.id, replicas: { min, max: min * 3 } }));
    if (w.keep !== undefined && long && w.kind !== "DaemonSet" && w.keep >= min) add("p2", "keep-blocks-drain", w.id, `${where(w)} keeps ${w.keep} of ${min} pods: its disruption budget never lets a node drain.`, call("set_workload", { id: w.id, keep: Math.max(0, min - 1) }));
    if (long && w.kind !== "DaemonSet" && last && w.environment === last.id && min < 2) add("p3", "single-replica", w.id, `${where(w)} runs one replica: a node going away takes it down.`, call("set_workload", { id: w.id, replicas: { ...w.replicas, min: 2 } }));
    if (w.ingress && !links.some((l) => l.to === w.part && l.kind === "routes" && arch.parts[l.from]?.kind === "edge")) {
      add("p2", "ingress-no-edge", w.id, `${where(w)} takes traffic for ${w.ingress.host}, but no edge part (DNS, CDN, load balancer) routes to ${partName(w.part)}.`, call("link_parts", { from: "EDGE_PART", to: w.part, kind: "routes" }));
    }
    if (w.egress?.length) {
      // A part's links are what its long-running workloads do; a Job of it (a migration) does one thing.
      const egress = w.egress;
      const blocked = long ? links.filter((l) => l.from === w.part && OUTBOUND.has(l.kind) && !egress.includes(l.to) && (l.status !== "planned" || w.status === "planned")) : [];
      if (blocked.length) add("p2", "egress-blocked", w.id, `${partName(w.part)} ${blocked.map((l) => `${l.kind} ${partName(l.to)}`).join(", ")}, but the NetworkPolicy of ${where(w)} doesn't let it out there.`, call("set_workload", { id: w.id, egress: [...egress, ...new Set(blocked.map((l) => l.to))] }));
      for (const to of w.egress) {
        if (!linked(w.part, to)) add("p3", "egress-unlinked", w.id, `${where(w)} may reach ${partName(to)}, but nothing links ${partName(w.part)} to it: link them or drop the egress.`, call("link_parts", { from: w.part, to, kind: "calls" }));
      }
    }
    const cluster = clusterOf(w);
    if (cluster) {
      const need = (re: RegExp, addon: string, why: string) => {
        if (!hasAddon(cluster.addons, re)) add("p2", "missing-addon", w.id, `${where(w)} ${why}, but cluster ${cluster.name} has no ${addon}.`, call("set_cluster", { id: cluster.id, addons: [...(cluster.addons ?? []), addon] }));
      };
      if (w.kind === "Rollout") need(/rollouts/i, "Argo Rollouts", "is a Rollout");
      if (w.scale?.by === "queue") need(/keda/i, "KEDA", "scales on a queue");
      if (w.secrets?.length) need(/external.?secrets/i, "External Secrets", "reads secrets");
    }
  }

  // Secrets: something has to hold them, and a secret for an outside service belongs to the part that calls it.
  const readers = workloads.filter((w) => w.secrets?.length);
  const stores = parts.filter(holdsSecrets);
  const first = readers[0];
  if (first && stores.length === 0) add("p2", "secret-no-store", first.id, `${readers.length} workload${readers.length === 1 ? " reads" : "s read"} secrets (${[...new Set(readers.flatMap((w) => w.secrets ?? []))].join(", ")}), but no part holds them.`, call("set_part", { name: "Secrets Manager", kind: "store", managed: "Secrets Manager" }));
  for (const s of stores) if (readers.length === 0) add("p3", "secret-unread", s.id, `${s.name} holds secrets nothing reads: no workload lists a secret.`, call("set_workload", { id: "WORKLOAD_ID", secrets: ["NAME"] }));
  for (const w of readers) {
    for (const secret of w.secrets ?? []) {
      const owner = parts.find((p) => p.kind === "external" && secret.toLowerCase().startsWith(`${p.id}-`));
      if (owner && !linked(w.part, owner.id)) {
        const user = links.find((l) => l.to === owner.id && l.from !== w.part)?.from;
        add("p3", "secret-unused", w.id, `${where(w)} holds ${secret}, but ${partName(w.part)} never talks to ${owner.name}${user ? `; ${partName(user)} does` : ""}.`, `${call("set_workload", { id: w.id, secrets: (w.secrets ?? []).filter((x) => x !== secret) })}${user ? `, and give ${secret} to ${partName(user)}'s workloads` : ""}`);
      }
    }
  }

  for (const r of releases) {
    if (!r.checks?.length) add("p2", "no-checks", r.id, `Release ${r.name} has no checks: nothing decides whether a step is healthy.`, call("set_release", { id: r.id, checks: ["error rate < 1%", "every new pod ready"] }));
    if (!r.rollback) add("p2", "no-rollback", r.id, `Release ${r.name} says nothing about rolling back.`, call("set_release", { id: r.id, rollback: "Argo CD syncs the previous tag." }));
    if (r.strategy.kind === "canary" && !r.strategy.steps?.length) add("p2", "canary-no-steps", r.id, `Release ${r.name} is a canary with no traffic steps.`, call("set_release", { id: r.id, strategy: { kind: "canary", steps: [10, 50, 100], hold: "15 min" } }));
    const orders = r.path.map((e) => arch.environments[e]?.order ?? 0);
    if (orders.some((o, i) => i > 0 && o < (orders[i - 1] ?? 0))) add("p2", "path-order", r.id, `Release ${r.name} goes ${r.path.map(envName).join(" → ")}, against the environments' order.`, call("set_release", { id: r.id, path: [...r.path].sort((a, b) => (arch.environments[a]?.order ?? 0) - (arch.environments[b]?.order ?? 0)) }));
    // A canary or blue-green release shifts traffic between versions: in its last environment that takes a Rollout.
    const end = r.path.at(-1);
    if (r.strategy.kind !== "rolling" && end !== undefined) {
      for (const w of workloads) {
        if (w.environment === end && r.parts.includes(w.part) && (w.kind === "Deployment" || w.kind === "StatefulSet")) {
          add("p2", "canary-no-rollout", w.id, `Release ${r.name} is ${r.strategy.kind}, but ${where(w)} is a ${w.kind}, which can't shift traffic.`, call("set_workload", { id: w.id, kind: "Rollout" }));
        }
      }
    }
    const gitops = r.path.some((e) => { const c = arch.environments[e]?.cluster; return c !== undefined && arch.clusters[c]?.gitops !== undefined; });
    if (gitops && !r.manifests) add("p3", "no-manifests", r.id, `Release ${r.name} goes through GitOps clusters, but says nowhere where its manifests live.`, call("set_release", { id: r.id, manifests: "DEPLOY_REPO/apps/NAME" }));
  }
  for (const w of workloads) {
    if (w.kind === "Rollout" && !releases.some((r) => r.parts.includes(w.part) && r.path.includes(w.environment) && r.strategy.kind !== "rolling")) {
      add("p3", "rollout-no-canary", w.id, `${where(w)} is a Rollout, but no canary or blue-green release ships ${partName(w.part)} there, so it has no steps.`, call("set_release", { name: "NAME", parts: [w.part], path: [w.environment], strategy: { kind: "canary", steps: [10, 50, 100], hold: "15 min" } }));
    }
  }
  for (const p of parts) {
    const runs = workloads.filter((w) => w.part === p.id);
    if (runs.length && !p.build) add("p2", "no-build", p.id, `${p.name} runs as ${runs.map((w) => workloadName(arch, w)).join(", ")}, but nothing says how it is built.`, call("set_build", { part: p.id, repo: "REPO", path: "PATH/", steps: ["lint", "test", "build"] }));
    if (runs.length && !releases.some((r) => r.parts.includes(p.id))) add("p3", "ships-nowhere", p.id, `${p.name} runs as ${runs.length} workload${runs.length === 1 ? "" : "s"}, but no release ships it.`, call("set_release", { name: `${p.name} path`, parts: [p.id], path: envs.filter((e) => runs.some((w) => w.environment === e.id)).map((e) => e.id), strategy: { kind: "rolling" }, checks: ["every new pod ready"], rollback: "Argo CD syncs the previous tag." }));
  }

  // Migrations run first, from a Job; a breaking one with nothing to run it first takes the running code down.
  for (const m of Object.values(arch.migrations)) {
    const r = m.release === undefined ? undefined : arch.releases[m.release];
    if (r?.before?.length) continue;
    const fix = r ? call("set_release", { id: r.id, before: ["MIGRATION_JOB_WORKLOAD"] }) : call("set_migration", { id: m.id, release: "RELEASE_ID" });
    if (m.safe === "breaking") add("p1", "breaking-migration", m.id, `Migration ${m.name} breaks the running code, and ${r ? `release ${r.name} runs no Job before it` : "no release runs it"}.`, `${fix}, naming a Job with before: true; or ship an additive step first`);
    else add("p2", "migration-not-run", m.id, `Migration ${m.name} has nothing to run it: ${r ? `release ${r.name} runs no Job first` : "it is in no release"}.`, fix);
  }

  // Plans: what is planned belongs to one, and a planned part has to connect to something.
  const plannedThings: { id: Id; status?: string; plan?: Id; what: string }[] = [
    ...parts.map((x) => ({ ...x, what: `part ${x.name}` })),
    ...links.map((x) => ({ ...x, what: `link ${partName(x.from)} ${x.kind} ${partName(x.to)}` })),
    ...workloads.map((x) => ({ ...x, what: where(x) })),
    ...Object.values(arch.migrations).map((x) => ({ ...x, what: `migration ${x.name}` })),
  ];
  for (const x of plannedThings) {
    if ((x.status === "planned" || x.status === "removed") && x.plan === undefined) add("p2", "planned-no-plan", x.id, `The ${x.what} is ${x.status} but in no plan, so nothing merges it.`, call("set_plan", { name: "NAME", issue: "ISSUE" }) + ", then give it plan");
  }
  for (const p of parts) {
    if (p.status === "planned" && !links.some((l) => l.from === p.id || l.to === p.id)) add("p2", "planned-unlinked", p.id, `${p.name} is planned, but nothing links to it: what calls it, and what does it use?`, call("link_parts", { from: p.id, to: "PART_ID", kind: "calls", status: "planned", ...(p.plan ? { plan: p.plan } : {}) }));
  }
  for (const plan of Object.values(arch.plans)) {
    if (!plan.releases?.length && !plannedThings.some((x) => x.plan === plan.id)) add("p3", "plan-empty", plan.id, `Plan ${plan.name} changes nothing yet: nothing is marked with it and it ships in no release.`, call("set_part", { id: "PART_ID", status: "planned", plan: plan.id }));
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id));
}

/** The findings as check_architecture replies: how many, then each, worst first, with its fix. */
export function checkText(arch: Architecture, findings: readonly Finding[]): string {
  const items = Object.values(arch).reduce((n, bag) => n + Object.keys(bag).length, 0);
  if (!findings.length) return `Architecture: no findings across ${items} things. The checks catch the mechanical part; read it yourself with read_architecture.`;
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const head = `Architecture: ${findings.length} finding${findings.length === 1 ? "" : "s"} (${(["p1", "p2", "p3"] as const).map((s) => `${count(s)} ${s.toUpperCase()}`).join(", ")}), worst first.`;
  return [head, ...findings.map((f) => `${f.severity.toUpperCase()} ${f.rule} · ${f.id}: ${f.message}\n   Fix: ${f.fix}`)].join("\n");
}
