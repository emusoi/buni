// The open page, across the file: its screens side (flows, links) and its system side (calls, parts, requirements).
// Every row opens what it names.
import { useContext, useMemo, useState, type ReactNode } from "react";
import { Braces, FileText, ListChecks, Monitor, Server, Workflow, type LucideIcon } from "lucide-react";
import { pageLabel, type Doc, type Id } from "buni/format/doc.ts";
import { callName } from "buni/tools/calls.ts";
import { pageSummary } from "./pageSummary.ts";
import type { Hit } from "./search.ts";
import { OwnersContext } from "./SystemCanvas.tsx";

const pageIcon = (p: { terminal?: unknown }): LucideIcon => (p.terminal ? Monitor : FileText);

function Row({ icon: Icon, title, detail, onClick }: { icon: LucideIcon; title: string; detail?: string; onClick: () => void }) {
  return (
    <button type="button" className="sum-row" onClick={onClick}>
      <Icon size={14} strokeWidth={1.75} />
      <span className="sum-title">{title}</span>
      {detail && <span className="sum-detail">{detail}</span>}
    </button>
  );
}

/** A titled group of rows; long ones show their first five until asked. */
function Group({ title, rows }: { title: string; rows: ReactNode[] }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  return (
    <section className="sum-group">
      <h3>{title} <span className="n">{rows.length}</span></h3>
      {all ? rows : rows.slice(0, 5)}
      {!all && rows.length > 5 && <button type="button" className="link-btn sum-more" onClick={() => setAll(true)}>Show all {rows.length}</button>}
    </section>
  );
}

export function PageSummary({ doc, page, onJump, onOpenElsewhere }: { doc: Doc; page: Id; onJump: (hit: Hit) => void; onOpenElsewhere?: ((page: Id) => void) | undefined }) {
  const s = useMemo(() => pageSummary(doc, page), [doc, page]);
  const owners = useContext(OwnersContext);
  if (!s) return null;
  const sys = (select: Extract<Hit, { kind: "system" }>["select"], view: Extract<Hit, { kind: "system" }>["view"], icon: Extract<Hit, { kind: "system" }>["icon"], title: string) =>
    onJump({ kind: "system", id: "id" in select ? select.id : "", select, view, icon, title, detail: "" });
  const tied = s.client || s.calls.length || s.requirements.length;
  return (
    <div className="page-summary">
      <div className="layer-head">
        <span className="layer-icon">{s.page.terminal ? <Monitor size={15} /> : <FileText size={15} />}</span>
        <div className="layer-who">
          <b>{s.page.name}</b>
          {/* A screen's route is edited here; a state keeps its screen's, and a graphic has none. */}
          {s.page.route !== undefined && s.page.state === undefined ? (
            <input key={s.page.route} className="route-field mono" defaultValue={s.page.route} aria-label="Route" title="Where this page lives on the site"
              onBlur={(e) => {
                const field = e.currentTarget, was = s.page.route ?? "", route = field.value.trim();
                if (!route || route === was) { field.value = was; return; }
                // Refused (taken, or not a path): back to the route it has, with the reason on hover.
                void window.buni.edit("rename_page", { page: s.page.id, route }).then((r) => { if (!r.ok) { field.value = was; field.title = r.reply; } });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = s.page.route ?? ""; e.currentTarget.blur(); } }} />
          ) : <span>{pageLabel(doc, s.page)}</span>}
        </div>
      </div>

      {s.client && (
        <section className="sum-group">
          <h3>Client</h3>
          <Row icon={s.page.terminal ? Monitor : Server} title={s.client.name} detail={s.client.tech} onClick={() => sys({ kind: "part", id: s.client?.id ?? "" }, "map", "part", s.client?.name ?? "")} />
        </section>
      )}
      {/* The system side first: it is what the canvas can't show. */}
      <Group title="Calls" rows={s.calls.map((c) => (
        <Row key={c.value.id} icon={Braces} title={callName(c)} detail={doc.parts[c.value.service]?.name} onClick={() => sys({ kind: c.rest ? "endpoint" : "operation", id: c.value.id }, "api", "call", callName(c))} />
      ))} />
      <Group title="Serves" rows={s.requirements.map((q) => <Row key={q.id} icon={ListChecks} title={q.title} detail={q.priority} onClick={() => sys({ kind: "requirement", id: q.id }, "requirements", "requirement", q.title)} />)} />
      <Group title="In flows" rows={s.flows.map((f) => <Row key={f.id} icon={Workflow} title={f.name} onClick={() => onJump({ kind: "flow", id: f.id, title: f.name, detail: "" })} />)} />
      <Group title="Goes to" rows={s.out.map((p) => <Row key={p.id} icon={pageIcon(p)} title={p.name} onClick={() => onJump({ kind: "page", id: p.id, title: p.name, detail: "" })} />)} />
      <Group title="Goes to other files" rows={s.away.map((p) => <Row key={p.id} icon={FileText} title={p.name} detail={owners[p.id]?.replace(/^.*\//, "")} onClick={() => onOpenElsewhere?.(p.id)} />)} />
      <Group title="Comes from" rows={s.in.map((p) => <Row key={p.id} icon={pageIcon(p)} title={p.name} onClick={() => onJump({ kind: "page", id: p.id, title: p.name, detail: "" })} />)} />
      {!tied && <p className="hint">Not tied to the system yet. Say which client it belongs to, and link its buttons and forms to the calls they make.</p>}
      <p className="hint">Click a layer to style it; add things with the bar at the bottom of the canvas.</p>
    </div>
  );
}
