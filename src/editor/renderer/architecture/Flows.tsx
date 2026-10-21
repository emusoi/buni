// Flows: a request, a release or a failure played step by step over the map. The steps are listed on the left; the
// map lights what the step touches and dims the rest; a release shows its canary split and the checks it must pass.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play as PlayIcon } from "lucide-react";
import { PLAY_KINDS, workloadName, type Architecture, type Environment, type Id, type Play } from "buni/format/doc.ts";
import { canaryAt, flowLook, payloadOf, previousVersion } from "./model.ts";
import type { Level, MapBox, MapLayout } from "./layout.ts";
import { MapCanvas, Replicas } from "./MapCanvas.tsx";
import { Segmented } from "./ArchitectureMode.tsx";

type Kind = (typeof PLAY_KINDS)[number];
const KINDS: [Kind, string][] = [["request", "Requests"], ["release", "Releases"], ["failure", "Failures"]];
const HEADING: Record<Kind, string> = { request: "Flow", release: "Release", failure: "Failure" };
/** Each play reads best on one map: a request between parts, a release or a failure on the cluster. */
/** A rollout's card with the canary split and its checks in it. */
export const CANARY_HEIGHT = 222;
export const levelFor = (kind: Kind): Level => (kind === "request" ? "system" : "runtime");

export function Flows({ arch, layout, level, env, play: playId, step, onPlay, onStep, onAsk }: {
  arch: Architecture; layout: MapLayout; level: Level; env: Environment | undefined;
  play: Id | undefined; step: number;
  onPlay: (id: Id) => void; onStep: (i: number) => void;
  /** Copies a request for a coding agent. */
  onAsk: (request: string) => void;
}) {
  const plays = Object.values(arch.plays).sort((a, b) => a.name.localeCompare(b.name));
  const play = (playId ? arch.plays[playId] : undefined) ?? plays[0];
  const [playing, setPlaying] = useState(false);
  const n = play?.steps.length ?? 0;
  const at = Math.min(step, Math.max(0, n - 1));
  // Playing walks the steps and stops at the end.
  useEffect(() => {
    if (!playing) return;
    if (at >= n - 1) { setPlaying(false); return; }
    const t = setTimeout(() => onStep(at + 1), 1600);
    return () => clearTimeout(t);
  }, [playing, at, n]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" && at < n - 1) { e.preventDefault(); onStep(at + 1); }
      if (e.key === "ArrowLeft" && at > 0) { e.preventDefault(); onStep(at - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, n]);
  const look = useMemo(() => (play ? flowLook(arch, play, at, level === "system") : undefined), [arch, play, at, level]);
  const badges = useMemo(() => {
    const out = new Map<string, number>();
    for (const b of layout.boxes) for (const id of b.ids) { const k = look?.badges.get(id); if (k !== undefined && !out.has(b.key)) out.set(b.key, k); }
    return out;
  }, [layout, look]);

  if (!play) return <div className="arch-flows-empty"><p>No flows yet. Ask your coding agent to add one with <code>set_play</code>: a request through the parts, a release through its environments, or what happens when a check fails.</p></div>;

  const kind = play.kind;
  const release = play.release ? arch.releases[play.release] : undefined;
  const plan = release?.plan ? arch.plans[release.plan] : undefined;
  const canary = kind === "release" ? canaryAt(arch, play, at) : undefined;
  const branch = play.fails ? arch.plays[play.fails.then] : undefined;
  const current = play.steps[at];
  const payload = kind === "request" ? payloadOf(current?.about) : undefined;
  const lands = kind === "request" ? [...(current?.touches ?? [])].reverse().find((id) => arch.parts[id]) : undefined;
  const sameKind = plays.filter((p) => p.kind === kind);
  const timeline = kind !== "request";

  const renderCanary = (b: MapBox) => {
    if (!canary || b.key !== canary.workload) return undefined;
    const w = arch.workloads[canary.workload]!;
    const min = w.replicas?.min ?? 1;
    const fresh = canary.percent >= 100 ? min : Math.max(1, Math.round((min * canary.percent) / 100));
    const old = canary.percent >= 100 ? 0 : min;
    return (
      <>
        <span className="arch-lbl">{w.kind} · canary</span>
        <b className="arch-name">{workloadName(arch, w)}</b>
        <div className="arch-split">
          <div className="arch-split-row"><span>{previousVersion(canary.release.name)} stable</span><Replicas min={old} max={old} color="#52525b" /></div>
          <div className="arch-split-row new"><span>{canary.release.name} canary</span><Replicas min={fresh} max={fresh} color="#8aaeff" /></div>
          <div className="arch-traffic"><span style={{ width: `${100 - canary.percent}%` }} /><span className="new" style={{ width: `${canary.percent}%` }} /></div>
          <div className="arch-split-row"><span>{100 - canary.percent}% of traffic</span><span className="new">{canary.percent}%</span></div>
          {canary.release.checks?.length ? (
            <div className="arch-checks">
              <span>{canary.next !== undefined ? `Holds ${canary.release.strategy.hold ?? "a while"}, then ${canary.next}% if:` : "Stays if:"}</span>
              {canary.release.checks.map((c) => <span key={c} className="arch-gold">◆ {c}</span>)}
            </div>
          ) : null}
        </div>
      </>
    );
  };

  return (
    <div className="arch-flows">
      <aside className="arch-steps">
        <div className="arch-steps-head">
          <Segmented label="Kind of flow" options={KINDS} value={kind} onChange={(k) => { const first = plays.find((p) => p.kind === k); if (first) onPlay(first.id); }} />
          {sameKind.length > 1 && (
            <div className="arch-play-pick">
              {sameKind.map((p) => <button key={p.id} type="button" className={p.id === play.id ? "on" : ""} onClick={() => onPlay(p.id)}>{p.name}</button>)}
            </div>
          )}
          <div className="arch-play-title">
            <span className="arch-sub">{HEADING[kind]}</span>
            <b>{release && plan && kind === "release" ? `${release.name} · ${plan.name}` : play.name}</b>
            {release && kind !== "request" && (
              <span className="arch-sub">{[plan?.issue, release.parts.map((p) => arch.parts[p]?.name ?? p).join(" + "), `to ${arch.environments[release.path.at(-1) ?? ""]?.name ?? ""}`].filter(Boolean).join(" · ")}</span>
            )}
          </div>
        </div>
        <ol className="arch-step-list">
          {play.steps.map((s, i) => {
            const state = kind === "request" ? (i === at ? "current" : "todo lit") : i < at ? "done" : i === at ? "current" : "todo";
            return (
              <li key={i}>
                <button type="button" className={`arch-step ${state}`} onClick={() => { setPlaying(false); onStep(i); }} aria-current={i === at ? "step" : undefined}>
                  <span className="arch-step-n">{state === "done" ? "✓" : i + 1}</span>
                  <span className="arch-step-text">
                    <b>{s.name}</b>
                    {s.about && <span>{s.about}</span>}
                    {s.check && i === at && <span className="arch-gold">◆ {s.check}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {branch && kind === "release" && (
          <div className="arch-fails">
            <b>If a check fails</b>
            <span>{release?.rollback ?? branch.steps.map((s) => s.name).join(", ")}</span>
            <button type="button" onClick={() => onPlay(branch.id)}>Play this branch →</button>
          </div>
        )}
        {!timeline && (
          <div className="arch-step-foot">
            <button type="button" aria-label="Previous step" disabled={at === 0} onClick={() => onStep(at - 1)}><ChevronLeft size={14} /></button>
            <span>{at + 1} of {n}</span>
            <button type="button" aria-label="Next step" disabled={at >= n - 1} onClick={() => onStep(at + 1)}><ChevronRight size={14} /></button>
            <span className="grow" />
            <span className="arch-sub">← → steps</span>
          </div>
        )}
      </aside>
      <MapCanvas
        layout={layout}
        fitKey={`${level} ${env?.id} ${play.id}`}
        {...(look ? { look: { lit: look.lit, shown: look.shown, dimRest: true } } : {})}
        badges={badges}
        render={renderCanary}
        bubble={payload && lands ? { key: layout.boxes.find((b) => b.ids.includes(lands))?.key ?? lands, text: payload } : undefined}
        bottomInset={timeline ? 96 : 0}
        footer={timeline && (
          <div className="arch-timeline">
            <button type="button" className="arch-play-btn" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (!playing && at >= n - 1) onStep(0); setPlaying((p) => !p); }}>
              {playing ? <Pause size={13} /> : <PlayIcon size={13} />}
            </button>
            <div className="arch-timeline-where">
              <b>Step {at + 1} of {n}</b>
              <span className="arch-sub">{release ? `${release.name} · ${release.path.map((e) => arch.environments[e]?.name ?? e).join(" → ")}` : play.name}</span>
            </div>
            <div className="arch-timeline-steps">
              {play.steps.map((s, i) => (
                <button key={i} type="button" className={i < at ? "done" : i === at ? "current" : ""} style={{ flex: s.check ? 2.2 : 1 }} onClick={() => { setPlaying(false); onStep(i); }} title={s.name}>
                  <span className="bar" />
                  <span className="name">{s.name}</span>
                </button>
              ))}
            </div>
            {release && (
              <button type="button" className="arch-btn" onClick={() => onAsk(`In the architecture, change how release ${release.name} (id ${release.id}) ships: its path (${release.path.join(" → ")}), strategy (${release.strategy.kind}), checks and rollback. Use set_release.`)}>
                Edit the release path
              </button>
            )}
          </div>
        )}
      />
    </div>
  );
}
