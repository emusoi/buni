// Architecture mode: how the app behind the screens is built and shipped, read at the level you need. Read-mostly:
// agents edit it through the architecture tools; here you look, select, and copy a brief for one.
import { useEffect, useMemo, useState } from "react";
import { architectureOf, type Doc, type Id } from "buni/format/doc.ts";
import { architectureBrief } from "buni/tools/areas/architecture.ts";
import { environmentOf, environmentsInOrder } from "./model.ts";
import { layoutFor, type Level } from "./layout.ts";
import { MapCanvas } from "./MapCanvas.tsx";
import { ArchInspector, selectionOf } from "./Inspector.tsx";

export const ARCH_VIEWS = [["map", "Map"]] as const;
export type ArchView = (typeof ARCH_VIEWS)[number][0];
const LEVELS: [Level, string][] = [["system", "System"], ["runtime", "Runtime"], ["code", "Code"]];

/** Where a link opens architecture mode: ?arch=map&level=runtime&env=prod&select=returns-api. */
export function archParams(search: string): { view: ArchView; level?: Level; env?: Id; select?: Id } | undefined {
  const q = new URLSearchParams(search);
  const view = ARCH_VIEWS.find(([v]) => v === q.get("arch"))?.[0];
  if (!view) return undefined;
  const level = LEVELS.find(([l]) => l === q.get("level"))?.[0];
  return { view, ...(level ? { level } : {}), ...(q.get("env") ? { env: q.get("env")! } : {}), ...(q.get("select") ? { select: q.get("select")! } : {}) };
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
  const [level, setLevel] = useState<Level>(start?.level ?? "runtime");
  const [envId, setEnvId] = useState<Id | undefined>(start?.env);
  const [selected, setSelected] = useState<Id | undefined>(start?.select);
  const env = environmentOf(arch, envId);
  const envs = environmentsInOrder(arch);
  const layout = useMemo(() => layoutFor(arch, level, env), [arch, level, env]);
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
        <Segmented label="Level" options={LEVELS} value={level} onChange={setLevel} />
        {envs.length > 0 && <Segmented label="Environment" options={envs.map((e) => [e.id, e.name] as const)} value={env?.id ?? ""} onChange={setEnvId} />}
      </div>
      <div className="arch-body">
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
          actions={<button type="button" className="arch-btn primary" onClick={copyBrief} title="The architecture as text, focused on what's selected">Copy brief for Claude</button>}
        />
      </div>
    </div>
  );
}
