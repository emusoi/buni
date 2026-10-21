// What the architecture views say about each thing: card text, inspector rows, canary splits. Pure, so the layout
// can size cards from the same text the components draw.
import { workloadName, type Architecture, type ArchStatus, type Environment, type Id, type Part, type PartKind, type Play, type Release, type Workload } from "buni/format/doc.ts";

/** How a card is edged: as it is, planned (purple dashed), run at deploy (gold dashed), or a plan's diff. */
export type Tone = "live" | "planned" | "deploy" | "added" | "removed";

export interface Card {
  label: string;
  name: string;
  sub?: string;
  /** Replica squares: min filled, up to max dashed. */
  replicas?: { min: number; max: number };
  note?: string;
  /** Rows of chips, each wrapping in the card. */
  chips?: string[][];
  /** What a plan adds to it: "+ 0042_store_credit". */
  adds?: string[];
  tone: Tone;
}

export const KIND_LABEL: Record<PartKind, string> = {
  client: "Client", service: "Service", worker: "Worker", job: "Job", store: "Store", cache: "Cache", queue: "Queue", external: "External", edge: "Edge",
};

export const toneOf = (status: ArchStatus | undefined): Tone => (status === "planned" ? "planned" : status === "removed" ? "removed" : "live");

/** Environments in the order a release ships through them. */
export const environmentsInOrder = (arch: Architecture): Environment[] => Object.values(arch.environments).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

/** The environment shown: the one asked for, else the last on the way to production. */
export function environmentOf(arch: Architecture, want: Id | undefined): Environment | undefined {
  const all = environmentsInOrder(arch);
  return all.find((e) => e.id === want) ?? all.at(-1);
}

const PREFER: Record<Workload["kind"], number> = { Rollout: 0, Deployment: 1, StatefulSet: 2, DaemonSet: 3, CronJob: 4, Job: 5 };

/** A part's workloads in an environment, the one serving it first (a migration Job last). */
export const workloadsOf = (arch: Architecture, part: Id, env: Id | undefined): Workload[] =>
  Object.values(arch.workloads).filter((w) => w.part === part && w.environment === env).sort((a, b) => PREFER[a.kind] - PREFER[b.kind] || a.id.localeCompare(b.id));

/** Releases that ship a part, in plan order then by name. */
export const releasesOf = (arch: Architecture, part: Id): Release[] =>
  Object.values(arch.releases).filter((r) => r.parts.includes(part)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/** "02:00 UTC" for a daily cron schedule; the schedule as written otherwise. */
export function cronText(schedule: string): string {
  const m = schedule.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  return m ? `${m[2]!.padStart(2, "0")}:${m[1]!.padStart(2, "0")} UTC` : schedule;
}

export const strategyText = (r: Release): string =>
  r.strategy.kind === "canary" && r.strategy.steps?.length ? `canary ${r.strategy.steps.join(" → ")}%` : r.strategy.kind;

export const partCard = (p: Part): Card => ({
  label: KIND_LABEL[p.kind], name: p.name, ...(p.tech ? { sub: p.tech } : {}), tone: toneOf(p.status),
});

/** A managed or outside service beside the cluster: what runs it, then what it holds. */
export function serviceCard(arch: Architecture, p: Part): Card {
  const adds = Object.values(arch.migrations).filter((m) => m.store === p.id && m.status === "planned").map((m) => `+ ${m.name}`);
  return {
    label: p.managed ?? p.tech ?? KIND_LABEL[p.kind], name: p.name, ...(p.about ? { sub: p.about.replace(/\.$/, "") } : {}),
    ...(adds.length ? { adds } : {}), tone: toneOf(p.status),
  };
}

/** An edge part (DNS, CDN, firewall, load balancer): what it is, then what it does. */
export const edgeCard = (p: Part): Card => ({ label: p.tech ?? "Edge", name: p.name, ...(p.about ? { sub: p.about.replace(/\.$/, "") } : {}), tone: toneOf(p.status) });

const planLabel = (arch: Architecture, plan: Id | undefined): string => {
  const p = plan ? arch.plans[plan] : undefined;
  return p ? `Planned · ${p.name}${p.issue ? ` (${p.issue})` : ""}` : "Planned";
};

/** A workload card on the Runtime map: kind and how it ships, then its image, replicas and what it reads. */
export function workloadCard(arch: Architecture, w: Workload): Card {
  const part = arch.parts[w.part];
  const release = releasesOf(arch, w.part).find((r) => r.path.includes(w.environment));
  const pool = Object.values(arch.clusters).flatMap((c) => c.pools ?? []).find((p) => p.name === w.nodes);
  const how = w.kind === "Rollout" && release ? strategyText(release)
    : w.before ? "runs before each sync"
    : w.kind === "CronJob" && w.schedule ? cronText(w.schedule)
    : pool?.spot ? "spot nodes" : undefined;
  const name = workloadName(arch, w);
  if (w.status === "planned") {
    const reads = Object.values(arch.links).filter((l) => l.from === w.part && l.kind === "subscribes" && l.carries).map((l) => `reads ${l.carries}`);
    const ships = releasesOf(arch, w.part).map((r) => r.name);
    return { label: planLabel(arch, w.plan), name, sub: [`new ${w.kind}`, ...reads, ...ships].join(" · "), tone: "planned" };
  }
  const sub = [part?.build?.path, w.kind === "Rollout" || w.kind === "Deployment" ? part?.build?.dockerfile : undefined, w.image ? `image ${w.image}` : undefined].filter(Boolean).join(" · ");
  const r = w.replicas;
  const note = r && r.max !== undefined && r.max > r.min
    ? w.scale?.by === "queue" ? "scales on queue depth (KEDA)" : `${r.min} replicas, scales to ${r.max} on ${w.scale?.by === "memory" ? "memory" : "CPU"}${w.keep ? ` · keeps ${w.keep} during changes` : ""}`
    : w.kind === "CronJob" ? "one at a time" : undefined;
  const reads = [...(w.config ?? []).map((c) => `ConfigMap ${c}`), ...(w.secrets ?? []).map((s) => `Secret ${s}`), ...(w.account?.role ? [w.account.role.startsWith("IAM") ? w.account.role.replace(/ \(.*\)$/, "") : `IAM role ${w.account.name}`] : [])];
  const runs = [...(w.probes?.ready ? [`health ${w.probes.ready}`] : []), ...(w.resources?.cpu || w.resources?.memory ? [[w.resources.cpu, w.resources.memory].filter(Boolean).join(" · ")] : [])];
  const chips = [reads, runs].filter((row) => row.length);
  return {
    label: [w.kind, how].filter(Boolean).join(" · "), name, ...(sub ? { sub } : {}),
    ...(r && w.kind !== "Job" && w.kind !== "CronJob" ? { replicas: { min: r.min, max: Math.max(r.min, r.max ?? r.min) } } : {}),
    ...(note ? { note } : {}), ...(chips.length ? { chips } : {}),
    tone: w.before ? "deploy" : toneOf(w.status),
  };
}

// Card sizes, as drawn (styles.css .arch-card): 9px padding, 3px between rows.
const ROW = { label: 13, name: 15, sub: 14, replicas: 20, note: 14, chips: 18, adds: 24 } as const;
const CHIP_CHAR = 5.6;

/** How many lines a row of chips wraps to in a card `width` wide. */
export function chipLines(chips: readonly string[], width: number): number {
  let lines = 1, at = 0;
  for (const c of chips) {
    const w = c.length * CHIP_CHAR + 15;
    if (at > 0 && at + 6 + w > width - 20) { lines++; at = w; } else at += (at > 0 ? 6 : 0) + w;
  }
  return lines;
}

/** A card's height at `width`, from the rows it has. */
export function cardHeight(c: Card, width: number): number {
  const rows = [ROW.label, ROW.name, ...(c.sub ? [ROW.sub] : []), ...(c.replicas ? [ROW.replicas] : []), ...(c.note ? [ROW.note] : []),
    ...(c.chips ?? []).map((row) => 6 + chipLines(row, width) * (ROW.chips + 6) - 6), ...(c.adds ? [ROW.adds] : [])];
  return Math.ceil(20 + rows.reduce((a, b) => a + b, 0) + 3 * (rows.length - 1));
}

/** The version a release replaces: v41 before v42; "stable" when its name doesn't count. */
export const previousVersion = (name: string): string => {
  const m = name.match(/^v(\d+)$/);
  return m ? `v${Number(m[1]) - 1}` : "stable";
};

/** Where a release play stands on a canary workload at step `at` (0-based): the share of traffic on the new version. */
export function canaryAt(arch: Architecture, play: Play, at: number): { workload: Id; percent: number; next?: number; release: Release } | undefined {
  const release = play.release ? arch.releases[play.release] : undefined;
  const steps = release?.strategy.kind === "canary" ? release.strategy.steps ?? [] : [];
  const step = play.steps[at];
  if (!release || !steps.length || !step) return undefined;
  const workload = step.touches.find((id) => arch.workloads[id]?.kind === "Rollout");
  if (!workload) return undefined;
  // The nth step that touches the rollout is the nth canary step.
  const nth = play.steps.slice(0, at + 1).filter((s) => s.touches.includes(workload)).length - 1;
  const percent = steps[Math.min(nth, steps.length - 1)]!;
  const next = steps[nth + 1];
  return { workload, percent, ...(next !== undefined ? { next } : {}), release };
}
