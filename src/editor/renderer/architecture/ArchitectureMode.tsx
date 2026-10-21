// Architecture mode: how the app behind the screens is built and shipped, read at the level you need and written in
// place: + Add, the inspector's fields, links drawn between cards, delete. Every change is a call to the same tools
// agents use, so undo, live sync and the format's checks apply to a person's edits too.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { LINK_KINDS, archCollectionOf, architectureOf, type Architecture, type Doc, type Id } from "buni/format/doc.ts";
import { architectureBrief } from "buni/tools/areas/architecture.ts";
import { canaryAt, environmentOf, environmentsInOrder } from "./model.ts";
import { layoutFor, type Level, type MapBox } from "./layout.ts";
import { ADDABLE, addFor, savedId, type AddContext, type Addable } from "./edit.ts";
import { useDismiss } from "../useDismiss.ts";
import { MapCanvas } from "./MapCanvas.tsx";
import { ArchInspector, plansAbout, selectionOf } from "./Inspector.tsx";
import { DeployPath, SoftwarePath } from "./Paths.tsx";
import { Kubernetes } from "./Kubernetes.tsx";
import { Proposals } from "./Proposals.tsx";
import { CANARY_HEIGHT, Flows, levelFor } from "./Flows.tsx";

export const ARCH_VIEWS = [["map", "Map"], ["flows", "Flows"], ["software", "Software path"], ["deploy", "Deploy path"], ["kubernetes", "Kubernetes"], ["proposals", "Proposals"]] as const;
export type ArchView = (typeof ARCH_VIEWS)[number][0];
const LEVELS: [Level, string][] = [["system", "System"], ["runtime", "Runtime"], ["code", "Code"]];

/** Where a link opens architecture mode: ?arch=map&level=runtime&env=prod&select=returns-api, ?arch=flows&play=…&step=5. */
export function archParams(search: string): { view: ArchView; level?: Level; env?: Id; select?: Id; play?: Id; step?: number; plan?: Id } | undefined {
  const q = new URLSearchParams(search);
  const view = ARCH_VIEWS.find(([v]) => v === q.get("arch"))?.[0];
  if (!view) return undefined;
  const level = LEVELS.find(([l]) => l === q.get("level"))?.[0];
  return { view, ...(level ? { level } : {}), ...(q.get("env") ? { env: q.get("env")! } : {}), ...(q.get("select") ? { select: q.get("select")! } : {}),
    ...(q.get("play") ? { play: q.get("play")! } : {}), ...(q.get("plan") ? { plan: q.get("plan")! } : {}), ...(Number(q.get("step")) > 0 ? { step: Number(q.get("step")) - 1 } : {}) };
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="arch-seg" role="tablist" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/** The "+ Add" menu: what the view is about first, each item disabled with what it still needs. */
function AddMenu({ arch, view, ctx, onAdd }: { arch: Architecture; view: ArchView; ctx: AddContext; onAdd: (what: Addable) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), ref);
  const first: Addable = view === "flows" ? "plays" : view === "software" ? "stages" : view === "proposals" ? "plans" : view === "kubernetes" ? "workloads" : view === "deploy" ? "environments" : "parts";
  const items = [first, ...ADDABLE.filter((x) => x !== first)];
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
  return (
    <div className="arch-add" ref={ref}>
      <button type="button" className="arch-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Plus size={12} />Add</button>
      {open && (
        <div className="arch-menu" role="menu" ref={menu} onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
          const at = all.indexOf(document.activeElement as HTMLButtonElement);
          all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
        }}>
          {items.map((what) => {
            const call = addFor(arch, what, ctx);
            const why = "error" in call ? call.error : undefined;
            return (
              <button key={what} type="button" role="menuitem" disabled={why !== undefined} title={why} onClick={() => { setOpen(false); onAdd(what); }}>
                <span>{ADD_LABEL[what]}</span>{why && <span className="arch-sub">{why}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ADD_LABEL: Record<Addable, string> = {
  parts: "Part", links: "Link", environments: "Environment", clusters: "Cluster", namespaces: "Namespace", workloads: "Workload",
  releases: "Release", migrations: "Migration", plans: "Plan", stages: "Stage", plays: "Play",
};

export function ArchitectureMode({ doc, name, onToast }: { doc: Doc; name: string; onToast: (text: string) => void }) {
  const arch = useMemo(() => architectureOf(doc), [doc]);
  const start = useMemo(() => archParams(location.search), []);
  const [view, setView] = useState<ArchView>(start?.view ?? "map");
  const [playId, setPlayId] = useState<Id | undefined>(start?.play);
  const [step, setStep] = useState(start?.step ?? 0);
  const [planId, setPlanId] = useState<Id | undefined>(start?.plan);
  const startPlay = playId ? arch.plays[playId] : Object.values(arch.plays).sort((a, b) => a.name.localeCompare(b.name))[0];
  const [level, setLevel] = useState<Level>(start?.level ?? (start?.view === "flows" && startPlay ? levelFor(startPlay.kind) : "runtime"));
  const playOn = (id: Id) => {
    const p = arch.plays[id];
    if (!p) return;
    setPlayId(id);
    setStep(0);
    setLevel(levelFor(p.kind));
  };
  const [envId, setEnvId] = useState<Id | undefined>(start?.env);
  const [selected, setSelected] = useState<Id | undefined>(start?.select);
  // Just made by + Add: selected before the architecture has it, and its name field focused.
  const [fresh, setFresh] = useState<Id>();
  const [deleting, setDeleting] = useState(false);
  const [linking, setLinking] = useState<{ from: Id; to: Id; x: number; y: number }>();
  const select = useCallback((id: Id | undefined) => { setSelected(id); setFresh(undefined); setDeleting(false); }, []);
  const env = environmentOf(arch, envId);
  const envs = environmentsInOrder(arch);
  // A release's canary split is drawn in its workload's card, which takes the room for it.
  const shownPlay = playId ? arch.plays[playId] : startPlay;
  const canary = view === "flows" && shownPlay?.kind === "release" ? canaryAt(arch, shownPlay, step) : undefined;
  const layout = useMemo(() => layoutFor(arch, level, env, canary ? new Map([[canary.workload, CANARY_HEIGHT]]) : undefined), [arch, level, env, canary?.workload]);
  // A selection the architecture no longer has (an agent deleted it, or undo took it back) goes; one just made waits for it.
  useEffect(() => { if (selected && selected !== fresh && !archCollectionOf(arch, selected)) select(undefined); }, [arch, selected, fresh]);
  // ⌫ asks to delete what is selected (the inspector says what goes with it); Escape lets go of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      if ((e.key === "Backspace" || e.key === "Delete") && selected && archCollectionOf(arch, selected)) { e.preventDefault(); setDeleting(true); }
      else if (e.key === "Escape" && !linking) { if (deleting) setDeleting(false); else if (selected) select(undefined); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arch, selected, deleting, linking]);

  const ctx: AddContext = { env: env?.id, selected, playKind: view === "flows" ? shownPlay?.kind : undefined };
  const add = async (what: Addable) => {
    const call = addFor(arch, what, ctx);
    if ("error" in call) return onToast(call.error);
    const r = await window.buni.edit(call.tool, call.args);
    const id = r.ok ? savedId(r.reply) : undefined;
    if (!id) return onToast(r.reply);
    if (what === "plays") { setPlayId(id); setStep(0); }
    if (what === "plans") setPlanId(id);
    setSelected(id);
    setFresh(id);
    setDeleting(false);
  };
  const link = async (kind: (typeof LINK_KINDS)[number]) => {
    if (!linking) return;
    setLinking(undefined);
    const r = await window.buni.edit("link_parts", { from: linking.from, to: linking.to, kind });
    const id = r.ok ? savedId(r.reply) : undefined;
    if (!id) return onToast(r.reply);
    setSelected(id);
    setFresh(undefined);
  };

  if (!Object.keys(arch.parts).length) {
    return (
      <div className="arch arch-empty">
        <div>
          <b>No architecture yet</b>
          <p>How the app behind these screens is built and shipped: its parts, where their code lives, how each is built, how it ships to Kubernetes and what it runs as.</p>
          <p><button type="button" className="arch-btn primary" onClick={() => void add("parts")}>Add your first part</button></p>
          <p>Or ask your coding agent to describe it. It has the architecture tools (<code>set_part</code>, <code>link_parts</code>, <code>set_build</code>, <code>set_environment</code>, <code>set_cluster</code>, <code>set_workload</code>, <code>set_release</code>, <code>set_plan</code>…). From a terminal, <code>buni arch {name}</code> prints what is there.</p>
        </div>
      </div>
    );
  }

  const copyBrief = () => {
    const text = architectureBrief(doc, { level, ...(env ? { environment: env.id } : {}), ...(selected && archCollectionOf(arch, selected) ? { focus: selected } : {}) });
    void navigator.clipboard.writeText(text).then(() => onToast("Copied the brief; paste it to Claude or any agent."), () => onToast("Couldn't copy the brief."));
  };
  const { part } = selected && archCollectionOf(arch, selected) ? selectionOf(arch, selected, env?.id) : {};
  const group = Object.values(arch.groups)[0];
  const crumbs = [name.replace(/\.buni$/, ""), ...(level === "system" ? [] : [env?.name ?? ""]), ...(level === "runtime" && env?.cluster ? [arch.clusters[env.cluster]?.name ?? ""] : []), ...(level === "system" && group ? [group.name] : [])];
  const inspector = (onClose?: () => void) => (
    <ArchInspector
      arch={arch}
      id={selected}
      env={env}
      fresh={fresh}
      onSelect={select}
      deleting={deleting}
      onDeleting={setDeleting}
      {...(onClose ? { onClose } : {})}
      empty={group ? (
        <>
          <b className="arch-inspector-name">{group.name}</b>
          <p className="arch-about">{Object.values(arch.parts).filter((p) => p.group === group.id).map((p) => p.name).join(", ")}.</p>
          <p className="arch-about">Click a part to see and change how it is built, how it ships and what it runs as. Drag from a card's right edge onto another to link them. Drag to pan; ⌘-scroll zooms.</p>
        </>
      ) : <p className="arch-about">Click a part to see and change how it is built, how it ships and what it runs as.</p>}
      actions={<>
        {(() => {
          // The release that ships the selection, played; and the plan that changes it.
          const rel = part && Object.values(arch.plays).find((p) => p.kind === "release" && p.release && arch.releases[p.release]?.parts.includes(part.id));
          const plan = part && plansAbout(arch, part.id)[0];
          return <>
            {rel && <button type="button" className="arch-btn" onClick={() => { playOn(rel.id); setView("flows"); }}>Play the release</button>}
            {plan && <button type="button" className="arch-btn" onClick={() => { setPlanId(plan.id); setView("proposals"); }}>Open the plan</button>}
          </>;
        })()}
        <button type="button" className="arch-btn" onClick={copyBrief} title="The architecture as text, focused on what's selected">Copy brief for Claude</button>
      </>}
    />
  );
  // Beside a view that isn't the map, the inspector shows only while something is selected.
  const aside = selected && archCollectionOf(arch, selected) ? inspector(() => select(undefined)) : undefined;

  return (
    <div className="arch">
      <div className="arch-views">
        <nav className="arch-tabs" aria-label="Architecture views">
          {ARCH_VIEWS.map(([v, label]) => (
            <button key={v} type="button" className={v === view ? "on" : ""} aria-current={v === view ? "page" : undefined} onClick={() => setView(v)}>{label}</button>
          ))}
        </nav>
        <span className="grow" />
        {(view === "map" || view === "flows") && <Segmented label="Level" options={LEVELS} value={level} onChange={setLevel} />}
        {envs.length > 0 && view !== "proposals" && <Segmented label="Environment" options={envs.map((e) => [e.id, e.name] as const)} value={env?.id ?? ""} onChange={setEnvId} />}
        <AddMenu arch={arch} view={view} ctx={ctx} onAdd={(what) => void add(what)} />
      </div>
      <div className="arch-body">
        {view === "software" ? <><SoftwarePath arch={arch} env={env} onSee={setView} onSelect={select} />{aside}</>
        : view === "deploy" ? <><DeployPath arch={arch} env={env} onSelect={select} />{aside}</>
        : view === "kubernetes" ? <><Kubernetes arch={arch} env={env} onSelect={select} />{aside}</>
        : view === "proposals" ? <><Proposals arch={arch} plan={planId} onPlan={setPlanId} onToast={onToast} onSelect={select} />{aside}</>
        : view === "flows" ? (
          <><Flows arch={arch} layout={layout} level={level} env={env} play={playId} step={step} onPlay={playOn} onStep={setStep} onSelect={select} />{aside}</>
        ) : <>
        <MapCanvas
          layout={layout}
          fitKey={`${level} ${env?.id}`}
          selected={selected}
          onSelect={select}
          canLink={(b) => partOfBox(arch, b) !== undefined}
          onLink={(from, to, at) => {
            const [a, b] = [partOfBox(arch, from), partOfBox(arch, to)];
            if (a && b && a !== b) setLinking({ from: a, to: b, ...at });
          }}
          footer={
            <div className="arch-foot">
              <div className="arch-crumbs">
                {[...crumbs, ...(selected && part ? [part.name] : [])].filter(Boolean).map((c, i, all) => (
                  <span key={i}>{i === all.length - 1 && selected ? <b>{c}</b> : c}{i < all.length - 1 && <span className="sep">›</span>}</span>
                ))}
              </div>
              {level === "runtime" && (
                <div className="arch-legend">
                  <span><i className="sq on" />replica</span>
                  <span><i className="sq" />room to scale</span>
                  <span className="planned">- - planned</span>
                  <span className="deploy">- - runs at deploy</span>
                </div>
              )}
            </div>
          }
        />
        {inspector()}
        </>}
      </div>
      {linking && <LinkKind at={linking} from={arch.parts[linking.from]?.name ?? linking.from} to={arch.parts[linking.to]?.name ?? linking.to} onPick={(k) => void link(k)} onCancel={() => setLinking(undefined)} />}
    </div>
  );
}

/** The part a map card stands for: a part card, a workload's part, a build step's part. */
export function partOfBox(arch: Architecture, b: MapBox): Id | undefined {
  for (const id of [...b.ids, ...(b.context ?? [])]) {
    if (arch.parts[id]) return id;
    const w = arch.workloads[id];
    if (w && arch.parts[w.part]) return w.part;
  }
  return undefined;
}

/** After a drop: how the two parts talk, calls first; Escape or a press elsewhere draws nothing. */
function LinkKind({ at, from, to, onPick, onCancel }: { at: { x: number; y: number }; from: string; to: string; onPick: (k: (typeof LINK_KINDS)[number]) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onCancel, ref);
  useEffect(() => { ref.current?.querySelector("button")?.focus(); }, []);
  return (
    <div ref={ref} className="arch-menu arch-link-kind" role="menu" aria-label={`How ${from} talks to ${to}`} style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
      }}>
      <span className="arch-sub">{from} → {to}</span>
      {LINK_KINDS.map((k) => <button key={k} type="button" role="menuitem" onClick={() => onPick(k)}>{k}</button>)}
    </div>
  );
}
