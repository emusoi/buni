// The open page, across the file: the flows it is in and the pages it links with. Every row opens what it names.
import { useContext, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, FileText, Monitor, Workflow, type LucideIcon } from "lucide-react";
import { pageLabel, type Doc, type Id } from "buni/format/doc.ts";
import { pageSummary } from "./pageSummary.ts";
import type { Hit } from "./search.ts";
import { OwnersContext } from "./owners.ts";

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

/** The page's own background and font, set here rather than by finding its root frame in Layers. */
function PageLook({ doc, frame }: { doc: Doc; frame: Id }) {
  const style = doc.nodes[frame]?.style ?? {};
  const tokens = Object.keys(doc.tokens);
  const colors = tokens.filter((t) => /^(#|rgb|hsl|oklch)/i.test(doc.tokens[t]?.trim() ?? "")).map((t) => `var(${t})`);
  const fonts = tokens.filter((t) => /font/i.test(t)).map((t) => `var(${t})`);
  const set = (prop: "background" | "fontFamily", value: string) => void window.buni.edit("update_styles", { nodes: [frame], style: { [prop]: value } });
  const pick = (label: string, prop: "background" | "fontFamily", options: string[]) => (
    <label className="sum-pick" title={label}>
      <span>{prop === "background" ? "Background" : "Font"}</span>
      <select value={style[prop] ?? ""} aria-label={label} onChange={(e) => set(prop, e.target.value)}>
        <option value="">{prop === "background" ? "White" : "System font"}</option>
        {[...new Set([...options, ...(style[prop] ? [style[prop]] : [])])].map((v) => <option key={v} value={v}>{v.replace(/^var\(--(.*)\)$/, "$1")}</option>)}
      </select>
    </label>
  );
  if (!colors.length && !fonts.length) return null;
  const name = (v: string | undefined, none: string) => v?.replace(/^var\(--(.*)\)$/, "$1") || none;
  // One line until opened: what the page looks like is set once and rarely changed.
  return (
    <details className="sum-group page-look fold">
      <summary><b>Look</b><span className="fold-value">{name(style.background, "White")} · {name(style.fontFamily, "System font")}</span></summary>
      {colors.length > 0 && pick("Page background", "background", colors)}
      {fonts.length > 0 && pick("Page font", "fontFamily", fonts)}
    </details>
  );
}

export function PageSummary({ doc, page, onJump, onOpenElsewhere }: { doc: Doc; page: Id; onJump: (hit: Hit) => void; onOpenElsewhere?: ((page: Id) => void) | undefined }) {
  const s = useMemo(() => pageSummary(doc, page), [doc, page]);
  const owners = useContext(OwnersContext);
  if (!s) return null;
  const go = (p: { id: Id; name: string }) => onJump({ kind: "page", id: p.id, title: p.name, detail: "" });
  const tied = s.flows.length || s.out.length || s.in.length || s.away.length;
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

      <PageLook doc={doc} frame={s.page.frame} />
      {(s.in.length > 0 || s.out.length > 0) && (
        <section className="sum-group where">
          <h3>Where it sits <span className="n">{s.in.length} in · {s.out.length + s.away.length} out</span></h3>
          {/* Where people come from, this page, where they go next: the page in its path at a glance. */}
          <div className="where-map">
            {s.in[0] ? <button type="button" className="where-node" title={s.in[0].name} onClick={() => go(s.in[0]!)}>{s.in[0].name}</button> : <span className="where-node none">Start</span>}
            <ArrowRight size={12} className="dim" />
            <span className="where-node here">This page</span>
            <ArrowRight size={12} className="dim" />
            {s.out[0] ? <button type="button" className="where-node" title={s.out[0].name} onClick={() => go(s.out[0]!)}>{s.out[0].name}</button> : <span className="where-node none">End</span>}
          </div>
          {s.flows.length > 0 && <div className="where-flows">{s.flows.map((f) => <button key={f.id} type="button" className="link-btn" onClick={() => onJump({ kind: "flow", id: f.id, title: f.name, detail: "" })}><Workflow size={12} /> {f.name}</button>)}</div>}
          {(s.in.length > 1 || s.out.length > 1 || s.away.length > 0) && (
            <details className="where-all">
              <summary className="link-btn">All {s.in.length + s.out.length + s.away.length} links</summary>
              <Group title="Comes from" rows={s.in.map((p) => <Row key={p.id} icon={pageIcon(p)} title={p.name} onClick={() => go(p)} />)} />
              <Group title="Goes to" rows={s.out.map((p) => <Row key={p.id} icon={pageIcon(p)} title={p.name} onClick={() => go(p)} />)} />
              <Group title="Goes to other files" rows={s.away.map((p) => <Row key={p.id} icon={FileText} title={p.name} detail={owners[p.id]?.replace(/^.*\//, "")} onClick={() => onOpenElsewhere?.(p.id)} />)} />
            </details>
          )}
        </section>
      )}
      {!s.in.length && !s.out.length && s.flows.length > 0 && <Group title="In flows" rows={s.flows.map((f) => <Row key={f.id} icon={Workflow} title={f.name} onClick={() => onJump({ kind: "flow", id: f.id, title: f.name, detail: "" })} />)} />}
      {!tied && <p className="hint">Not linked yet. Link its buttons and links to the pages they open, and name the paths through them as flows.</p>}
    </div>
  );
}
