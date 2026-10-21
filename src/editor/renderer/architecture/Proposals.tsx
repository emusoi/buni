// Proposals: each plan as a diff on the System map (what it adds green dashed, what it removes red), its changes
// listed, and a person's Merge (merge_plan) or Discard (delete_architecture of the plan and what only it holds).
import { useMemo, useState } from "react";
import { workloadName, type Architecture, type Id } from "buni/format/doc.ts";
import { systemLayout } from "./layout.ts";
import { MapCanvas } from "./MapCanvas.tsx";

export interface Change { added: boolean; text: string }

/** What a plan changes, in words: its new or removed parts, links, workloads and migrations. */
export function planChanges(arch: Architecture, plan: Id): Change[] {
  const name = (id: Id) => arch.parts[id]?.name ?? id;
  const out: Change[] = [];
  const add = (x: { plan?: Id; status?: string }, text: string) => { if (x.plan === plan) out.push({ added: x.status !== "removed", text }); };
  for (const p of Object.values(arch.parts)) add(p, p.status === "removed" ? p.name : `${p.name}, a new ${p.kind}`);
  for (const l of Object.values(arch.links)) add(l, `${name(l.from)} ${l.kind} ${name(l.to)}${l.carries ? ` · ${l.carries}` : ""}`);
  for (const w of Object.values(arch.workloads)) add(w, `${workloadName(arch, w)}, a ${w.kind} in ${arch.environments[w.environment]?.name ?? w.environment}`);
  for (const m of Object.values(arch.migrations)) add(m, `${m.name} on ${name(m.store)} (${m.safe})`);
  return out;
}

export function Proposals({ arch, plan: want, onPlan, onToast }: { arch: Architecture; plan: Id | undefined; onPlan: (id: Id) => void; onToast: (text: string) => void }) {
  const plans = Object.values(arch.plans).sort((a, b) => a.name.localeCompare(b.name));
  const plan = (want ? arch.plans[want] : undefined) ?? plans[0];
  const layout = useMemo(() => systemLayout(arch, plan?.id), [arch, plan?.id]);
  const [busy, setBusy] = useState(false);
  if (!plan) return <div className="arch-flows-empty"><p>No proposals. A plan is a change drawn before it is built: ask your coding agent to propose one with <code>set_plan</code>, marking what it adds as planned.</p></div>;
  const changes = planChanges(arch, plan.id);
  const run = (tool: "merge_plan" | "delete_architecture", args: Record<string, unknown>) => {
    setBusy(true);
    void window.buni.edit(tool, args).then((r) => { setBusy(false); onToast(r.reply); });
  };
  return (
    <div className="arch-proposals">
      <div className="arch-proposal-main">
        <div className="arch-banner">
          <i />
          <b>Proposal: {plan.name}</b>
          <span className="arch-sub">{[plan.issue, plan.releases?.length ? `ships in ${plan.releases.map((r) => arch.releases[r]?.name ?? r).join(", ")}` : undefined, "not merged"].filter(Boolean).join(" · ")}</span>
          <span className="grow" />
          {plans.length > 1 ? (
            <select className="arch-select" value={plan.id} onChange={(e) => onPlan(e.target.value)} aria-label="Proposal">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <span className="arch-sub">Showing the proposal</span>}
        </div>
        <MapCanvas layout={layout} fitKey={`proposal ${plan.id}`} />
      </div>
      <aside className="arch-inspector picked">
        <b className="arch-changes-title">{changes.length} change{changes.length === 1 ? "" : "s"}</b>
        {changes.map((c, i) => (
          <div key={i} className="arch-change"><span className={c.added ? "added" : "removed"}>{c.added ? "Added" : "Removed"}</span><span>{c.text}</span></div>
        ))}
        {plan.about && <p className="arch-about">Why: {plan.about}</p>}
        <div className="arch-actions wide">
          <button type="button" className="arch-btn primary" disabled={busy} onClick={() => run("merge_plan", { plan: plan.id })} title="Everything in the plan becomes live">Merge</button>
          <button type="button" className="arch-btn" disabled={busy} onClick={() => run("delete_architecture", { ids: [plan.id] })} title="Drops the plan and what only it adds; undo brings it back">Discard</button>
        </div>
      </aside>
    </div>
  );
}
