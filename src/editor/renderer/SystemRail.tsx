// The rail in System and Plan modes: the things of that mode (parts and where they run; requirements,
// questions and roles), each a click from its form, each section a + from adding one by hand.
import { Fragment, type ReactNode } from "react";
import { AlertTriangle, CircleHelp, Cloud, KeyRound, ListChecks, Milestone, Plus, type LucideIcon } from "lucide-react";
import type { Doc, Id, PartKind } from "buni/format/doc.ts";
import { planNotes, systemNotes } from "buni/tools/notes.ts";
import { KIND_ICON } from "./System.tsx";
import { PLAN_VIEWS, type SystemSelection, type SystemView } from "./system.ts";

type Select = (s: SystemSelection | undefined) => void;
type Toast = (m: string) => void;

const byIndex = <T extends { index: string }>(xs: T[]): T[] => xs.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));

function Label({ children, onAdd, title }: { children: ReactNode; onAdd?: () => void; title?: string }) {
  return (
    <div className="section-label with-action">
      {children}
      {onAdd && <button type="button" className="icon-btn small" title={title} aria-label={title} onClick={onAdd}><Plus size={14} /></button>}
    </div>
  );
}

function Row({ icon: Icon, name, meta, on, warn, faint, onClick }: { icon: LucideIcon; name: string; meta?: string; on: boolean; warn?: boolean; faint?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`row${on ? " active" : ""}${faint ? " faint" : ""}`} onClick={onClick}>
      <Icon size={16} strokeWidth={1.75} />
      <span className="name">{name}</span>
      {warn && <span className="warn-dot" title="Something to look at" />}
      {meta && <span className="meta">{meta}</span>}
    </button>
  );
}


const GROUPS: { label: string; kinds: PartKind[]; add: PartKind }[] = [
  { label: "Clients", kinds: ["client"], add: "client" },
  { label: "Services", kinds: ["service"], add: "service" },
  { label: "Data", kinds: ["store", "cache", "queue"], add: "store" },
  { label: "Outside", kinds: ["external"], add: "external" },
];

export { PLAN_VIEWS };

export function SystemRail({ doc, mode, view, selection, onSelect, onView, onToast }: {
  doc: Doc; mode: "system" | "plan"; view: SystemView; selection: SystemSelection | undefined;
  onSelect: Select; onView: (v: SystemView) => void; onToast: Toast;
}) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const notes = mode === "plan" ? planNotes(doc) : systemNotes(doc);
  // Selecting from the rail keeps the lens you're on, unless it can't show that kind of thing.
  const show = (s: SystemSelection, lens: SystemView) => { onSelect(s); if (!(mode === "plan" ? PLAN_VIEWS : ["map", "api", "data", "shapes", "cache", "traces", "topology", "brief"]).includes(view)) onView(lens); };
  // Only something to look at earns the rail's footer; an all-clear says so where the checks are.
  const foot = notes.length === 0 ? null : (
    <button type="button" className="rail-note" onClick={() => onSelect(undefined)}>
      {notes.length ? <AlertTriangle size={14} className="amber" /> : null}
      <span>{notes.length ? `${notes.length} thing${notes.length === 1 ? "" : "s"} to look at` : "Nothing to fix"}</span>
    </button>
  );

  if (mode === "system") {
    const parts = byIndex(Object.values(doc.parts));
    return (
      <>
        <nav className="tree">
          {GROUPS.map((g) => {
            const own = parts.filter((p) => g.kinds.includes(p.kind));
            return (
              <Fragment key={g.label}>
                {/* Parts are added on the map, where they're placed; the rail lists them. */}
                <Label>{g.label}</Label>
                {own.length === 0 && <p className="rail-empty">{g.label === "Clients" ? "Where the pages live: a web or mobile app." : g.label === "Services" ? "APIs and workers." : g.label === "Data" ? "Databases, caches and queues." : "Stripe, email, anything you don't run."}</p>}
                {own.map((p) => (
                  <Row key={p.id} icon={KIND_ICON[p.kind]} name={p.name} on={selected === p.id}
                    meta={p.kind === "service" ? { rest: "REST", graphql: "GQL", none: "worker" }[p.api ?? "rest"] : p.kind === "store" ? `${Object.values(doc.tables).filter((t) => t.store === p.id).length}` : undefined}
                    warn={notes.some((n) => n.startsWith(`${p.name} `) || n.includes(`when ${p.name} is down`))}
                    onClick={() => show({ kind: "part", id: p.id }, "map")} />
                ))}
              </Fragment>
            );
          })}
          <Label title="Add an environment" onAdd={() => { onView("topology"); onSelect({ kind: "new", what: "environment" }); }}>Runs in</Label>
          {byIndex(Object.values(doc.environments)).map((e) => (
            <Row key={e.id} icon={Cloud} name={e.name} meta={e.provider} on={selected === e.id} onClick={() => { onView("topology"); onSelect({ kind: "environment", id: e.id }); }} />
          ))}
        </nav>
        {foot}
      </>
    );
  }

  const reqs = byIndex(Object.values(doc.requirements));
  const phases = byIndex(Object.values(doc.phases));
  const open = byIndex(Object.values(doc.questions)).filter((q) => q.status === "open" && q.kind === "question");
  const groups: { id: Id; name: string }[] = [...phases.map((p) => ({ id: p.id, name: p.name })), ...(reqs.some((q) => !q.phase) || !phases.length ? [{ id: "", name: phases.length ? "No phase yet" : "Requirements" }] : [])];
  return (
    <>
      <nav className="tree">
        {groups.map((g) => (
          <Fragment key={g.id || "none"}>
            <Label title="Add a requirement" onAdd={() => { onView("requirements"); onSelect({ kind: "new", what: "requirement", ...(g.id ? { parent: g.id } : {}) }); }}>{g.name}</Label>
            {reqs.filter((q) => (q.phase ?? "") === g.id).map((q) => (
              <Row key={q.id} icon={ListChecks} name={q.title} meta={q.priority} on={selected === q.id} warn={!q.servedBy.length} onClick={() => show({ kind: "requirement", id: q.id }, "requirements")} />
            ))}
            {!reqs.some((q) => (q.phase ?? "") === g.id) && <p className="rail-empty">What the design has to achieve, as outcomes you can check.</p>}
          </Fragment>
        ))}
        <Label title="Add a phase" onAdd={() => { onView("requirements"); onSelect({ kind: "new", what: "phase" }); }}>Phases</Label>
        {phases.map((p) => <Row key={p.id} icon={Milestone} name={p.name} faint on={selected === p.id} onClick={() => show({ kind: "phase", id: p.id }, "requirements")} />)}
        <Label title="Ask a question" onAdd={() => { onView("questions"); onSelect({ kind: "new", what: "question" }); }}>Open questions</Label>
        {open.length === 0 && <p className="rail-empty">Nothing undecided. Write down what isn't, so agents ask instead of guessing.</p>}
        {open.map((q) => <Row key={q.id} icon={CircleHelp} name={q.text} on={selected === q.id} onClick={() => show({ kind: "question", id: q.id }, "questions")} />)}
        <Label title="Add a role" onAdd={() => { onView("access"); onSelect({ kind: "new", what: "role" }); }}>Roles</Label>
        {byIndex(Object.values(doc.roles)).map((r) => <Row key={r.id} icon={KeyRound} name={r.name} on={selected === r.id} onClick={() => show({ kind: "role", id: r.id }, "access")} />)}
      </nav>
      {foot}
    </>
  );
}
