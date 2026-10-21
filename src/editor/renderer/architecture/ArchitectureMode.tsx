// Architecture mode: how the app behind the screens is built and shipped, read at the level you need. Read-mostly:
// agents edit it through the architecture tools; here you look, select, and copy a brief for one.
import { useEffect, useMemo, useState } from "react";
import { architectureOf, type Doc, type Id } from "buni/format/doc.ts";
import { architectureBrief } from "buni/tools/areas/architecture.ts";
import { canaryAt, environmentOf, environmentsInOrder } from "./model.ts";
import { layoutFor, type Level } from "./layout.ts";
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
  const env = environmentOf(arch, envId);
  const envs = environmentsInOrder(arch);
  // A release's canary split is drawn in its workload's card, which takes the room for it.
  const shownPlay = playId ? arch.plays[playId] : startPlay;
  const canary = view === "flows" && shownPlay?.kind === "release" ? canaryAt(arch, shownPlay, step) : undefined;
  const layout = useMemo(() => layoutFor(arch, level, env, canary ? new Map([[canary.workload, CANARY_HEIGHT]]) : undefined), [arch, level, env, canary?.workload]);
  // A selection the architecture no longer has (an agent deleted it) goes.
  useEffect(() => { if (selected && !Object.values(arch).some((bag) => Object.hasOwn(bag, selected))) setSelected(undefined); }, [arch, selected]);

  if (!Object.keys(arch.parts).length) {
    return (
      <div className="arch arch-empty">
        <div>
          <b>No architecture yet</b>
          <p>How the app behind these screens is built and shipped: its parts, where their code lives, how each is built, how it ships to Kubernetes and what it runs as.</p>
          <p>Ask your coding agent to describe it. It has the architecture tools (<code>set_part</code>, <code>link_parts</code>, <code>set_build</code>, <code>set_environment</code>, <code>set_cluster</code>, <code>set_workload</code>, <code>set_release</code>, <code>set_plan</code>…). From a terminal, <code>buni arch {name}</code> prints what is there.</p>
        </div>
      </div>
    );
  }

  const copyBrief = () => {
    const text = architectureBrief(doc, { level, ...(env ? { environment: env.id } : {}), ...(selected ? { focus: selected } : {}) });
    void navigator.clipboard.writeText(text).then(() => onToast("Copied the brief; paste it to Claude or any agent."), () => onToast("Couldn't copy the brief."));
  };
  const { part } = selected ? selectionOf(arch, selected, env?.id) : {};
  const group = Object.values(arch.groups)[0];
  const crumbs = [name.replace(/\.buni$/, ""), ...(level === "system" ? [] : [env?.name ?? ""]), ...(level === "runtime" && env?.cluster ? [arch.clusters[env.cluster]?.name ?? ""] : []), ...(level === "system" && group ? [group.name] : [])];

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
      </div>
      <div className="arch-body">
        {view === "software" ? <SoftwarePath arch={arch} env={env} onSee={setView} />
        : view === "deploy" ? <DeployPath arch={arch} env={env} />
        : view === "kubernetes" ? <Kubernetes arch={arch} env={env} />
        : view === "proposals" ? <Proposals arch={arch} plan={planId} onPlan={setPlanId} onToast={onToast} />
        : view === "flows" ? (
          <Flows arch={arch} layout={layout} level={level} env={env} play={playId} step={step} onPlay={playOn} onStep={setStep}
            onAsk={(text) => void navigator.clipboard.writeText(text).then(() => onToast("Copied the request; paste it to your coding agent."), () => onToast("Couldn't copy the request."))} />
        ) : <>
        <MapCanvas
          layout={layout}
          fitKey={`${level} ${env?.id}`}
          selected={selected}
          onSelect={setSelected}
          footer={
            <div className="arch-foot">
              <div className="arch-crumbs">
                {[...crumbs, ...(selected ? [part?.name ?? selected] : [])].filter(Boolean).map((c, i, all) => (
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
        <ArchInspector
          arch={arch}
          id={selected}
          env={env}
          empty={group ? (
            <>
              <b className="arch-inspector-name">{group.name}</b>
              <p className="arch-about">{Object.values(arch.parts).filter((p) => p.group === group.id).map((p) => p.name).join(", ")}.</p>
              <p className="arch-about">Click a part to see how it is built, how it ships, what it runs as and what is planned for it. Drag to pan; ⌘-scroll zooms.</p>
            </>
          ) : <p className="arch-about">Click a part to see how it is built, how it ships and what it runs as.</p>}
          actions={<>
            {(() => {
              // The release that ships the selection, played; and the plan that changes it.
              const rel = part && Object.values(arch.plays).find((p) => p.kind === "release" && p.release && arch.releases[p.release]?.parts.includes(part.id));
              const plan = part && plansAbout(arch, part.id)[0];
              return <>
                {rel && <button type="button" className="arch-btn primary" onClick={() => { playOn(rel.id); setView("flows"); }}>Play the release</button>}
                {plan && <button type="button" className="arch-btn" onClick={() => { setPlanId(plan.id); setView("proposals"); }}>Open the plan</button>}
              </>;
            })()}
            <button type="button" className={`arch-btn${part ? "" : " primary"}`} onClick={copyBrief} title="The architecture as text, focused on what's selected">Copy brief for Claude</button>
          </>}
        />
        </>}
      </div>
    </div>
  );
}
