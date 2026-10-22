// Which findings belong on a card, the worst of them, and which view draws the thing. The check itself lives in arch-check.
import { archCollectionOf, type Architecture, type Id } from "buni/format/doc.ts";
import type { Finding, Severity } from "buni/tools/arch-check.ts";
import type { Level } from "./layout.ts";

export interface FindingPlace {
  view: "map" | "flows" | "software" | "deploy" | "kubernetes" | "proposals";
  level?: Level;
  env?: Id;
  plan?: Id;
  play?: Id;
}

/** The view that draws this thing, so opening a finding lands on it. */
export function placeFor(arch: Architecture, id: Id): FindingPlace | undefined {
  const c = archCollectionOf(arch, id);
  if (!c) return undefined;
  if (c === "workloads") return { view: "map", level: "runtime", env: arch.workloads[id]!.environment };
  if (c === "parts") return { view: "map", level: arch.parts[id]!.kind === "edge" ? "runtime" : "system" };
  if (c === "links") {
    const l = arch.links[id]!;
    return { view: "map", level: arch.parts[l.from]?.kind === "edge" || arch.parts[l.to]?.kind === "edge" ? "runtime" : "system" };
  }
  if (c === "environments") return { view: "deploy", env: id };
  if (c === "clusters" || c === "namespaces") {
    const cluster = c === "clusters" ? id : arch.namespaces[id]!.cluster;
    const env = Object.values(arch.environments).find((e) => e.cluster === cluster);
    return { view: "kubernetes", ...(env ? { env: env.id } : {}) };
  }
  if (c === "releases") {
    const play = Object.values(arch.plays).find((p) => p.release === id);
    return play ? { view: "flows", play: play.id } : { view: "deploy" };
  }
  if (c === "migrations") return { view: "deploy" };
  if (c === "plans") return { view: "proposals", plan: id };
  if (c === "stages") return { view: "software" };
  if (c === "plays") return { view: "flows", play: id };
  return { view: "map", level: "system" };
}

const RANK: Record<Severity, number> = { p1: 0, p2: 1, p3: 2 };

export interface Notice { severity: Severity; title: string }

/** Findings on this thing: a workload also carries its part's, a part carries its workloads in the environment shown. */
export function findingsAbout(arch: Architecture, id: Id, findings: readonly Finding[], env: Id | undefined): Finding[] {
  const ids = new Set<Id>([id]);
  const workload = arch.workloads[id];
  if (workload) ids.add(workload.part);
  if (arch.parts[id]) {
    for (const w of Object.values(arch.workloads)) if (w.part === id && (env === undefined || w.environment === env)) ids.add(w.id);
  }
  return findings.filter((f) => ids.has(f.id));
}

/** The worst finding on a card that is itself something (a part, a workload). A chip drawn beside one is not marked again. */
export function noticeFor(arch: Architecture, box: { ids: readonly Id[] }, findings: readonly Finding[], env: Id | undefined): Notice | undefined {
  const root = box.ids[0];
  if (!root) return undefined;
  const about = findingsAbout(arch, root, findings, env);
  const worst = about[0];
  if (!worst) return undefined;
  return { severity: worst.severity, title: about.length === 1 ? worst.message : `${about.length} issues. ${worst.message}` };
}

export function noticesFor(arch: Architecture, boxes: readonly { key: string; ids: Id[] }[], findings: readonly Finding[], env: Id | undefined): Map<string, Notice> {
  const out = new Map<string, Notice>();
  for (const box of boxes) {
    const notice = noticeFor(arch, box, findings, env);
    if (notice) out.set(box.key, notice);
  }
  return out;
}

export function worst(findings: readonly Finding[]): Severity | undefined {
  return findings.reduce<Severity | undefined>((w, f) => (!w || RANK[f.severity] < RANK[w] ? f.severity : w), undefined);
}
