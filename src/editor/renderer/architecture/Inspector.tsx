// The architecture inspector: the selected thing's fields, written in place, with how it ships, what it runs as and
// what is planned for it; and its delete, which says first what goes with it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { archCollectionOf, workloadName, type Architecture, type Environment, type Id, type Part, type Plan, type Workload } from "buni/format/doc.ts";
import { KIND_LABEL, releasesOf, strategyText, workloadsOf } from "./model.ts";
import { NOUN, cascadeText, labelOf } from "./edit.ts";
import { ThingForm } from "./Fields.tsx";
import { CheckNotes } from "./Checks.tsx";
import type { Finding } from "buni/tools/arch-check.ts";

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

export interface InspectorProps {
  arch: Architecture; id: Id | undefined; env: Environment | undefined;
  /** Selected along with `id`: the inspector lists them all and deletes them together. */
  more?: readonly Id[];
  /** Buttons at the foot: Play the release, Open the plan, Copy brief. */
  actions: ReactNode; empty: ReactNode;
  /** Just made: its name field takes the focus. */
  fresh?: Id | undefined;
  onSelect: (id: Id | undefined) => void;
  /** The delete is asked for (the key or the button): its one line shows. */
  deleting: boolean;
  onDeleting: (on: boolean) => void;
  onClose?: () => void;
  /** What the check says about this selection, worst first. */
  findings: readonly Finding[];
  onFix: (f: Finding) => Promise<void>;
}

export function ArchInspector({ arch, id, env, more = [], actions, empty, fresh, onSelect, deleting, onDeleting, onClose, findings, onFix }: InspectorProps) {
  const c = id ? archCollectionOf(arch, id) : undefined;
  const all = [...more, ...(id ? [id] : [])].filter((x) => archCollectionOf(arch, x) !== undefined);
  if (all.length > 1) {
    return (
      <aside className="arch-inspector picked">
        {onClose && <button type="button" className="arch-icon-btn arch-close" aria-label="Close the inspector" onClick={onClose}><X size={13} /></button>}
        <span className="arch-lbl">Selected</span>
        <b className="arch-inspector-name">{all.length} things</b>
        <ul className="arch-picked-list">
          {all.map((x) => (
            <li key={x}><button type="button" className="arch-inline-link" onClick={() => onSelect(x)}>{labelOf(arch, x)}</button><span className="arch-sub">{NOUN[archCollectionOf(arch, x) ?? "parts"]}</span></li>
          ))}
        </ul>
        <DeleteRow arch={arch} ids={all} armed={deleting} onArm={onDeleting} onDone={() => onSelect(undefined)} />
      </aside>
    );
  }
  if (!id || !c) {
    return (
      <aside className="arch-inspector">
        {empty}
        <div className="arch-actions">{actions}</div>
      </aside>
    );
  }
  const focus = fresh === id;
  const close = onClose && <button type="button" className="arch-icon-btn arch-close" aria-label="Close the inspector" onClick={onClose}><X size={13} /></button>;
  const foot = (
    <>
      <DeleteRow arch={arch} ids={[id]} armed={deleting} onArm={onDeleting} onDone={() => onSelect(undefined)} />
      <div className="arch-actions">{actions}</div>
    </>
  );
  if (c === "parts") {
    return (
      <aside className="arch-inspector picked" key={id}>
        {close}
        <span className="arch-lbl">{KIND_LABEL[arch.parts[id]!.kind]}</span>
        <CheckNotes findings={findings} onFix={onFix} />
        <ThingForm arch={arch} c="parts" id={id} focus={focus} />
        <PartRuns arch={arch} part={arch.parts[id]!} env={env} onSelect={onSelect} />
        {foot}
      </aside>
    );
  }
  const w = c === "workloads" ? arch.workloads[id] : undefined;
  return (
    <aside className="arch-inspector picked" key={id}>
      {close}
      <span className="arch-lbl">
        {w ? <>{w.kind} of <button type="button" className="arch-inline-link" onClick={() => onSelect(w.part)}>{arch.parts[w.part]?.name ?? w.part}</button></> : NOUN[c]}
      </span>
      {c === "links" && <b className="arch-inspector-name">{labelOf(arch, id)}</b>}
      {w && <b className="arch-inspector-name">{workloadName(arch, w)}</b>}
      <CheckNotes findings={findings} onFix={onFix} />
      <ThingForm arch={arch} c={c} id={id} focus={focus} heading={!w} />
      {foot}
    </aside>
  );
}

/** One line asking before a delete, naming what goes with it; Enter deletes, Escape keeps. */
function DeleteRow({ arch, ids, armed, onArm, onDone }: { arch: Architecture; ids: readonly Id[]; armed: boolean; onArm: (on: boolean) => void; onDone: () => void }) {
  const [error, setError] = useState<string>();
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (armed) yes.current?.focus(); }, [armed]);
  useEffect(() => setError(undefined), [ids.join(" ")]);
  const [one] = ids;
  const what = ids.length === 1 && one ? NOUN[archCollectionOf(arch, one) ?? "parts"] : `${ids.length} things`;
  if (!armed) {
    return (
      <div className="arch-delete">
        <button type="button" className="arch-text-btn danger" onClick={() => onArm(true)} title="Delete (⌫)">Delete {what}</button>
        {error && <span className="arch-field-error" role="alert">{error}</span>}
      </div>
    );
  }
  return (
    <div className="arch-delete armed" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onArm(false); } }}>
      <span><b>Delete {ids.length === 1 && one ? labelOf(arch, one) : what}?</b> {cascadeText(arch, ids)}</span>
      <div className="arch-delete-buttons">
        <button ref={yes} type="button" className="arch-btn danger" onClick={() => {
          void window.buni.edit("delete_architecture", { ids: [...ids] }).then((r) => {
            onArm(false);
            if (r.ok) onDone();
            else setError(r.reply);
          });
        }}>Delete</button>
        <button type="button" className="arch-btn" onClick={() => onArm(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** How a part ships and what it runs as in the environment shown, read; each thing named goes to its own form. */
function PartRuns({ arch, part, env, onSelect }: { arch: Architecture; part: Part; env: Environment | undefined; onSelect: (id: Id) => void }) {
  const { workload: w } = selectionOf(arch, part.id, env?.id);
  const go = (id: Id, text: ReactNode) => <button type="button" className="arch-inline-link" onClick={() => onSelect(id)}>{text}</button>;
  const name = (pid: Id) => arch.parts[pid]?.name ?? pid;
  const releases = releasesOf(arch, part.id);
  const r = releases.find((x) => env && x.path.includes(env.id)) ?? releases[0];
  const reps = w?.replicas;
  const plans = plansAbout(arch, part.id);
  const before = r?.before?.flatMap((x) => { const j = arch.workloads[x]; return j && (!env || j.environment === env.id) ? [`${workloadName(arch, j)} ${j.kind}`] : []; });
  const talks = w?.egress?.map(name);
  const migrations = Object.values(arch.migrations).filter((m) => m.store === part.id);
  return (
    <>
      <Section title="Ships by" rows={r ? [
        ["Release", <>{releases.map((x, i) => <span key={x.id}>{i > 0 && ", "}{go(x.id, x.name)}</span>)}</>],
        ...(r.manifests ? [["Manifests", (() => { const [repo, ...rest] = r.manifests.split("/"); return <><span>{repo}/</span><span className="arch-link-text">{rest.join("/")}</span></>; })()] as [string, ReactNode]] : []),
        ["Path", r.path.map((e) => arch.environments[e]?.name ?? e).join(" → ")],
        ["Strategy", strategyText(r)],
        ...(r.checks?.length ? [["Gate", <span className="arch-gold">{r.checks.join(", ")}</span>] as [string, ReactNode]] : []),
        ...(before?.length ? [["Before", before.join(", ")] as [string, ReactNode]] : []),
      ] : []} />
      <Section title={`Runs as${env ? ` · ${env.name}` : ""}`} rows={w ? [
        ["Workload", go(w.id, `${w.kind} ${workloadName(arch, w)}`)],
        ...(reps ? [["Replicas", `${reps.min}${reps.max && reps.max > reps.min ? `, up to ${reps.max}` : ""}${w.scale ? ` on ${w.scale.by === "cpu" ? "CPU" : w.scale.by} ${w.scale.target}` : ""}`] as [string, ReactNode]] : []),
        ...(w.probes?.ready || w.probes?.live ? [["Probes", [w.probes.ready, w.probes.live].filter(Boolean).join(", ")] as [string, ReactNode]] : []),
        ...([...(w.config ?? []), ...(w.secrets ?? [])].length ? [["Reads", [...(w.config ?? []), ...(w.secrets ?? [])].join(", ")] as [string, ReactNode]] : []),
        ...(talks?.length ? [["Talks to", talks.join(", ")] as [string, ReactNode]] : []),
      ] : part.managed ? [["Runs", `managed: ${part.managed}`]] : []} />
      <Section title="Migrations" rows={migrations.map((m) => [m.safe, go(m.id, m.name)] as [string, ReactNode])} />
      {plans.length > 0 && (
        <section className="arch-section">
          <span className="arch-section-title">Planned</span>
          {plans.map((p) => (
            <button key={p.id} type="button" className="arch-planned" onClick={() => onSelect(p.id)}>
              <b>{p.name}{p.issue ? ` · ${p.issue}` : ""}</b>
              {p.about && <span>{p.about}</span>}
            </button>
          ))}
        </section>
      )}
    </>
  );
}
