// Where each part runs, as designed: readable lines for briefs, and warnings worth acting on.
import type { Doc, Environment, Id, Placement, Runtime } from "../format/doc.ts";

const RUNTIME_LABEL: Record<Runtime, string> = {
  deployment: "Deployment", statefulset: "StatefulSet", daemonset: "DaemonSet", cronjob: "CronJob", job: "Job",
  container: "container", function: "function", static: "static hosting", managed: "managed", vm: "VM",
};

export function runtimeLabel(r: Runtime): string {
  return RUNTIME_LABEL[r];
}

const byIndex = <T extends { index: string; id: Id }>(xs: T[]): T[] =>
  xs.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));

export function environmentsInOrder(doc: Doc): Environment[] {
  return byIndex(Object.values(doc.environments));
}

/** "prod: Deployment on prod-use1/quotes in us-east-1, 2–10 pods at 70% CPU, …". */
export function placementLine(doc: Doc, pl: Placement): string {
  const env = doc.environments[pl.environment]?.name ?? pl.environment;
  const cluster = pl.cluster ? doc.clusters[pl.cluster] : undefined;
  const where = cluster ? ` on ${cluster.name}${pl.namespace ? `/${pl.namespace}` : ""}` : "";
  const bits = [
    pl.service,
    pl.scale && (pl.scale.min === pl.scale.max ? `${pl.scale.min} ${pl.runtime === "function" || pl.runtime === "container" ? "instances" : "pods"}` : `${pl.scale.min}–${pl.scale.max} ${pl.runtime === "function" || pl.runtime === "container" ? "instances" : "pods"}${pl.scale.cpuTarget ? ` at ${pl.scale.cpuTarget}% CPU` : ""}`),
    pl.resources && [pl.resources.cpu, pl.resources.memory].filter(Boolean).join("/"),
    pl.replicas !== undefined && `${pl.replicas} standby`,
    pl.schedule && `runs "${pl.schedule}"`,
    pl.ingress && `serves ${pl.ingress.host}${pl.ingress.path === "/" ? "" : pl.ingress.path}`,
    pl.config?.length && `config ${pl.config.join(", ")}`,
    pl.secrets?.length && `secrets ${pl.secrets.join(", ")}`,
  ].filter(Boolean);
  return `- ${env}: ${RUNTIME_LABEL[pl.runtime]}${where} in ${pl.regions.join(", ")}${bits.length ? `, ${bits.join(", ")}` : ""}${pl.note ? ` (${pl.note})` : ""}`;
}

export function placementOf(doc: Doc, part: Id, environment: Id): Placement | undefined {
  return Object.values(doc.placements).find((p) => p.part === part && p.environment === environment);
}

/** Things to look at: parts not placed in an environment, and links that cross regions. */
export function topologyNotes(doc: Doc): string[] {
  const notes: string[] = [];
  const runnable = byIndex(Object.values(doc.parts)).filter((p) => p.kind !== "external");
  for (const env of environmentsInOrder(doc)) {
    const missing = runnable.filter((p) => !placementOf(doc, p.id, env.id));
    if (missing.length) notes.push(`${env.name}: ${missing.map((p) => p.name).join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} placed yet.`);
    for (const l of Object.values(doc.links)) {
      const a = placementOf(doc, l.from, env.id);
      const b = placementOf(doc, l.to, env.id);
      if (!a || !b || a.regions.some((r) => b.regions.includes(r))) continue;
      notes.push(`${env.name}: ${doc.parts[l.from]?.name} ${l.kind} ${doc.parts[l.to]?.name} across regions (${a.regions.join(", ")} → ${b.regions.join(", ")}); every call pays the distance.`);
    }
  }
  return notes;
}

/** The topology as a markdown section for the whole-system brief. */
export function topologyText(doc: Doc): string[] {
  const lines: string[] = [];
  for (const env of environmentsInOrder(doc)) {
    lines.push(`- environment **${env.name}** on ${env.provider} in ${env.regions.join(", ")}`);
    for (const c of Object.values(doc.clusters).filter((x) => x.environment === env.id)) lines.push(`  - cluster ${c.name}: ${c.kind}${c.version ? ` ${c.version}` : ""} in ${c.region}`);
    for (const pl of Object.values(doc.placements).filter((x) => x.environment === env.id)) {
      lines.push(`  ${placementLine(doc, pl).replace(/^- [^:]+: /, `- ${doc.parts[pl.part]?.name ?? pl.part}: `)}`);
    }
  }
  return lines;
}
