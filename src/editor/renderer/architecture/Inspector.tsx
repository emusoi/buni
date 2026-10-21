// The architecture inspector: what the selected thing is built from, how it ships, what it runs as, what is planned.
import type { ReactNode } from "react";
import { archCollectionOf, workloadName, type Architecture, type Environment, type Id, type Part, type Plan, type Workload } from "buni/format/doc.ts";
import { KIND_LABEL, releasesOf, strategyText, workloadsOf } from "./model.ts";

function Section({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  if (!rows.length) return null;
  return (
    <section className="arch-section">
      <span className="arch-section-title">{title}</span>
      {rows.map(([k, v]) => (
        <div key={k} className="arch-row"><span className="arch-row-key">{k}</span><span className="arch-row-value">{v}</span></div>
      ))}
    </section>
  );
}

/** "github.com/acme/parcel · api/", the path in blue as the design draws a place you can go. */
const pathText = (lead: string, path: string | undefined) => <><span>{lead}{path ? " · " : ""}</span>{path && <span className="arch-link-text">{path}</span>}</>;

/** The plans that say something about a part: its own, and those planning a link, workload or migration on it. */
export function plansAbout(arch: Architecture, part: Id): Plan[] {
  const ids = new Set<Id>();
  const add = (plan: Id | undefined) => { if (plan) ids.add(plan); };
  add(arch.parts[part]?.plan);
  for (const l of Object.values(arch.links)) if (l.from === part || l.to === part) add(l.plan);
  for (const w of Object.values(arch.workloads)) if (w.part === part) add(w.plan);
  for (const m of Object.values(arch.migrations)) if (m.store === part) add(m.plan);
  for (const r of releasesOf(arch, part)) add(r.plan);
  return [...ids].flatMap((id) => (arch.plans[id] ? [arch.plans[id]] : []));
}

/** The part and workload a selected id stands for in an environment. */
export function selectionOf(arch: Architecture, id: Id, env: Id | undefined): { part?: Part; workload?: Workload } {
  const c = archCollectionOf(arch, id);
  if (c === "workloads") {
    const w = arch.workloads[id]!;
    return { workload: w, ...(arch.parts[w.part] ? { part: arch.parts[w.part] } : {}) };
  }
  if (c === "parts") {
    const w = workloadsOf(arch, id, env).find((x) => !x.before);
    return { part: arch.parts[id]!, ...(w ? { workload: w } : {}) };
  }
  return {};
}

export function ArchInspector({ arch, id, env, actions, empty }: {
  arch: Architecture; id: Id | undefined; env: Environment | undefined;
  /** Buttons at the foot: Play the release, Open the plan, Copy brief. */
  actions: ReactNode; empty: ReactNode;
}) {
  const { part, workload: w } = id ? selectionOf(arch, id, env?.id) : {};
  const other = id && !part ? archCollectionOf(arch, id) : undefined;
  if (!part) {
    return (
      <aside className={`arch-inspector${other ? " picked" : ""}`}>
        {other && id ? <OtherThing arch={arch} id={id} /> : empty}
        <div className="arch-actions">{actions}</div>
      </aside>
    );
  }
  const b = part.build;
  const name = (pid: Id) => arch.parts[pid]?.name ?? pid;
  const releases = releasesOf(arch, part.id);
  const r = releases.find((x) => env && x.path.includes(env.id)) ?? releases[0];
  const ns = w ? arch.namespaces[w.namespace] : undefined;
  const reps = w?.replicas;
  const plans = plansAbout(arch, part.id);
  // What runs first in the environment shown: its migration Jobs.
  const before = r?.before?.flatMap((x) => { const j = arch.workloads[x]; return j && (!env || j.environment === env.id) ? [`${workloadName(arch, j)} ${j.kind}`] : []; });
  const talks = w?.egress?.map(name);
  return (
    <aside className="arch-inspector picked">
      <span className="arch-lbl">{w ? `${w.kind}${ns ? ` · namespace ${ns.name}` : ""}` : `${KIND_LABEL[part.kind]}${part.tech ? ` · ${part.tech}` : ""}`}</span>
      <b className="arch-inspector-name">{w ? workloadName(arch, w) : part.name}</b>
      {part.about && <p className="arch-about">{part.about}</p>}
      <Section title="Built from" rows={[
        ...(b ? [["Code", pathText(b.repo.replace(/^https?:\/\//, ""), b.path)] as [string, ReactNode]] : []),
        ...(b && (b.dockerfile || b.artifact) ? [["Image", [b.dockerfile, b.registry ? `${b.registry} ${b.artifact ?? ""}`.trim() : b.artifact].filter(Boolean).join(" → ")] as [string, ReactNode]] : []),
        ...(b?.steps?.length ? [["Pipeline", b.steps.join(" · ")] as [string, ReactNode]] : []),
        ...(part.managed ? [["Managed", part.managed] as [string, ReactNode]] : []),
        ...(part.owners ? [["Owners", part.owners] as [string, ReactNode]] : []),
      ]} />
      <Section title="Ships by" rows={r ? [
        ...(r.manifests ? [["Manifests", (() => { const [repo, ...rest] = r.manifests.split("/"); return <><span>{repo}/</span><span className="arch-link-text">{rest.join("/")}</span></>; })()] as [string, ReactNode]] : []),
        ["Path", r.path.map((e) => arch.environments[e]?.name ?? e).join(" → ")],
        ["Strategy", strategyText(r)],
        ...(r.checks?.length ? [["Gate", <span className="arch-gold">{r.checks.join(", ")}</span>] as [string, ReactNode]] : []),
        ...(before?.length ? [["Before", before.join(", ")] as [string, ReactNode]] : []),
        ...(releases.length > 1 ? [["Releases", releases.map((x) => x.name).join(", ")] as [string, ReactNode]] : []),
      ] : []} />
      <Section title="Runs as" rows={w ? [
        ...(reps ? [["Replicas", `${reps.min}${reps.max && reps.max > reps.min ? `, up to ${reps.max}` : ""}${w.scale ? ` on ${w.scale.by === "cpu" ? "CPU" : w.scale.by} ${w.scale.target}` : ""}`] as [string, ReactNode]] : []),
        ...(w.keep ? [["Keeps", `${w.keep} during changes`] as [string, ReactNode]] : []),
        ...(w.schedule ? [["Schedule", w.schedule] as [string, ReactNode]] : []),
        ...(w.probes?.ready || w.probes?.live ? [["Probes", [w.probes.ready, w.probes.live].filter(Boolean).join(", ")] as [string, ReactNode]] : []),
        ...(w.resources ? [["Resources", [w.resources.cpu, w.resources.memory].filter(Boolean).join(" · ") + (w.resources.limitCpu || w.resources.limitMemory ? ` · lim ${[w.resources.limitCpu, w.resources.limitMemory].filter(Boolean).join("/")}` : "")] as [string, ReactNode]] : []),
        ...([...(w.config ?? []), ...(w.secrets ?? [])].length ? [["Reads", [...(w.config ?? []), ...(w.secrets ?? [])].join(", ")] as [string, ReactNode]] : []),
        ...(talks?.length ? [["Talks to", talks.join(", ")] as [string, ReactNode]] : []),
        ...(w.nodes ? [["Nodes", w.nodes] as [string, ReactNode]] : []),
      ] : part.managed ? [["Runs", `managed: ${part.managed}`]] : []} />
      {plans.length > 0 && (
        <section className="arch-section">
          <span className="arch-section-title">Planned</span>
          {plans.map((p) => (
            <div key={p.id} className="arch-planned">
              <b>{p.name}{p.issue ? ` · ${p.issue}` : ""}</b>
              {p.about && <span>{p.about}</span>}
            </div>
          ))}
        </section>
      )}
      <div className="arch-actions">{actions}</div>
    </aside>
  );
}

/** A selected thing that isn't a part: a group, a namespace, a cluster, a link. */
function OtherThing({ arch, id }: { arch: Architecture; id: Id }) {
  const c = archCollectionOf(arch, id);
  const thing = c ? arch[c][id] : undefined;
  if (!c || !thing) return null;
  const title = "name" in thing ? thing.name : id;
  const parts = c === "groups" ? Object.values(arch.parts).filter((p) => p.group === id) : [];
  const workloads = c === "namespaces" ? Object.values(arch.workloads).filter((w) => w.namespace === id) : [];
  return (
    <>
      <span className="arch-lbl">{c.replace(/s$/, "")}</span>
      <b className="arch-inspector-name">{title}</b>
      {parts.length > 0 && <p className="arch-about">{parts.map((p) => p.name).join(", ")}</p>}
      {workloads.length > 0 && <p className="arch-about">{workloads.map((w) => `${workloadName(arch, w)} (${w.kind})`).join(", ")}</p>}
    </>
  );
}
