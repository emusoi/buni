// The API view: what each part offers others, designed before it is built. Callers on the left, each API as a card of
// its operations (GraphQL fields beside the REST calls that serve them), the picked operation written in the inspector.
// Every change is set_api or set_operation, so undo, live sync and the format's checks apply.
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { GRAPHQL_TYPES, HTTP_METHODS, operationLabel, operationsOf, type Architecture, type Id, type Operation, type Part } from "buni/format/doc.ts";
import { Draft, send } from "./Fields.tsx";
import { usePanZoom } from "./PanZoom.tsx";

import { apiLayout, CALLER_W, GAP, HEAD, ROW } from "./apiLayout.ts";

const badge = (op: Operation) => (op.method ?? "GET").toLowerCase();

/** `select`: an operation (or part) to start on, as ?arch=api&select=ID links say. */
export function ApiView({ arch, file, select, onToast }: { arch: Architecture; file: string; select?: Id | undefined; onToast: (text: string) => void }) {
  const layout = useMemo(() => apiLayout(arch), [arch]);
  const [picked, setPicked] = useState<{ part: Id; op?: Id } | undefined>(() => {
    const hit = operationsOf(arch).find((x) => x.op.id === select);
    return hit ? { part: hit.part.id, op: hit.op.id } : select && arch.parts[select]?.api ? { part: select } : undefined;
  });
  const part = picked ? arch.parts[picked.part] : undefined;
  const op = part?.api?.operations.find((o) => o.id === picked?.op);
  const rowOf = new Map(layout.cards.flatMap((c) => c.rows.map((r) => [r.op.id, { card: c, y: r.y + ROW / 2 }] as const)));
  const cardOf = new Map(layout.cards.map((c) => [c.part.id, c]));
  const add = async (p: Part) => {
    const args = p.api?.kind === "graphql" ? { part: p.id, type: "query", field: "newField" } : { part: p.id, method: "GET", path: "/new" };
    const r = await window.buni.edit("set_operation", args);
    if (!r.ok) return onToast(r.reply);
    const made = /operation (\S+) on/.exec(r.reply)?.[1];
    setPicked({ part: p.id, ...(made ? { op: made } : {}) });
  };
  const write = async (format: "openapi" | "graphql") => {
    const r = await window.buni.edit("export_architecture", { format });
    onToast(r.reply);
  };
  const kinds = new Set(layout.cards.map((c) => c.part.api!.kind));
  const pan = usePanZoom(layout, () => setPicked(undefined));
  if (!layout.cards.length) {
    const services = Object.values(arch.parts).filter((p) => p.kind === "service" || p.kind === "worker");
    return (
      <div className="arch-flows-empty">
        <div className="arch-api-empty">
          <b>No API designed yet</b>
          <p>Say what a part offers before it is built: REST operations (written to openapi.yaml) or GraphQL fields (schema.graphql). Your agent does it with <code>set_api</code> and <code>set_operation</code>; or start one here.</p>
          {services.map((p) => (
            <div key={p.id} className="arch-api-start">
              <span>{p.name}</span>
              <button type="button" className="arch-btn" onClick={() => void send({ tool: "set_api", args: { part: p.id, kind: "rest", spec: "openapi.yaml" } }).then((e) => e && onToast(e))}>REST</button>
              <button type="button" className="arch-btn" onClick={() => void send({ tool: "set_api", args: { part: p.id, kind: "graphql", spec: "schema.graphql" } }).then((e) => e && onToast(e))}>GraphQL</button>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      <div ref={pan.host} className="arch-api" {...pan.handlers}>
        <div className="arch-api-plane" style={{ width: layout.width, height: layout.height, transform: pan.transform }}>
          <svg className="arch-links" width={layout.width} height={layout.height} aria-hidden>
            {layout.callers.flatMap((c) => c.to.map((to) => {
              const card = cardOf.get(to);
              if (!card) return null;
              const [x1, y1, x2, y2] = [c.x + CALLER_W, c.y + 32, card.x, card.y + HEAD / 2];
              const mx = x1 + GAP / 2;
              // A card past the first column is reached over the top of the ones in between.
              const d = x2 - x1 <= GAP + 1 ? `M${x1} ${y1} H${mx} V${y2} H${x2}` : `M${x1} ${y1} H${mx} V24 H${x2 - 20} V${y2} H${x2}`;
              return <path key={`${c.part.id}>${to}`} d={d} fill="none" style={{ stroke: "rgb(var(--ink-rgb) / 0.35)" }} />;
            }))}
            {layout.cards.flatMap((card) => card.rows.flatMap((r) => {
              const to = r.op.resolves ? rowOf.get(r.op.resolves) : undefined;
              if (!to) return [];
              const lit = picked?.op === r.op.id || picked?.op === r.op.resolves;
              const right = to.card.x > card.x;
              const [x1, x2] = right ? [card.x + card.w, to.card.x] : [card.x, to.card.x];
              const bend = right ? (x1 + x2) / 2 : Math.min(x1, x2) - 40;
              return [<path key={r.op.id} d={`M${x1} ${r.y + ROW / 2} C${bend} ${r.y + ROW / 2} ${bend} ${to.y} ${x2} ${to.y}`} fill="none" strokeWidth={lit ? 1.75 : 1.25} style={{ stroke: lit ? "var(--arch-blue)" : "rgb(var(--ink-rgb) / 0.35)" }} />];
            }))}
          </svg>
          {layout.callers.length > 0 && <span className="arch-caption" style={{ left: 24, top: 44 }}>Calls it</span>}
          {layout.callers.map((c) => (
            <div key={c.part.id} className="arch-card" style={{ left: c.x, top: c.y, width: CALLER_W, cursor: "default" }}>
              <span className="arch-lbl">{c.part.tech ?? c.part.kind}</span>
              <span className="arch-name">{c.part.name}</span>
              {c.part.about && <span className="arch-sub">{c.part.about.replace(/\.$/, "")}</span>}
            </div>
          ))}
          {layout.cards.map((card) => (
            <div key={card.part.id} className={`arch-api-card${picked?.part === card.part.id && !picked.op ? " selected" : ""}`} style={{ left: card.x, top: card.y, width: card.w, height: card.h }}>
              <button type="button" className="arch-api-head" style={{ height: HEAD }} onClick={() => setPicked({ part: card.part.id })}>
                <span className="arch-lbl">{card.part.api!.kind === "rest" ? "REST" : "GraphQL"} · {card.part.name}</span>
                <span className="arch-name">{card.part.api!.spec ?? (card.part.api!.kind === "rest" ? "openapi.yaml" : "schema.graphql")}</span>
              </button>
              {card.sections.map((s) => <span key={s.label} className="arch-api-section" style={{ top: s.y - card.y }}>{s.label}</span>)}
              {card.rows.map((r) => (
                <button key={r.op.id} type="button" className={`arch-api-row${picked?.op === r.op.id ? " on" : ""}`} style={{ top: r.y - card.y, height: ROW }}
                  onClick={() => setPicked({ part: card.part.id, op: r.op.id })}>
                  {r.op.field !== undefined ? (
                    <><span className="arch-api-field">{r.op.field}</span>{r.op.returns && <span className="arch-api-note mono">{r.op.returns}</span>}</>
                  ) : (
                    <><span className={`arch-api-method ${badge(r.op)}`}>{r.op.method ?? "GET"}</span><span className="arch-api-field">{r.op.path}</span>{r.op.responses?.[0] && <span className="arch-api-note">{r.op.responses[0].split(/\s/)[0]}</span>}</>
                  )}
                </button>
              ))}
              <button type="button" className="arch-api-row add" style={{ top: card.add - card.y, height: ROW }} onClick={() => void add(card.part)}>
                <Plus size={12} />{card.part.api!.kind === "rest" ? "Add operation" : "Add field"}
              </button>
            </div>
          ))}
        </div>
        {pan.zoom}
        <div className="arch-legend arch-api-legend">
          <span><i className="arch-api-method get">GET</i>reads</span>
          <span><i className="arch-api-method post">POST</i>changes</span>
          <span><i className="arch-api-line" />field served by operation</span>
        </div>
      </div>
      <aside className="arch-inspector picked">
        {op && part ? <OperationForm key={op.id} arch={arch} part={part} op={op} onToast={onToast} onRemoved={() => setPicked({ part: part.id })} />
        : part?.api ? (
          <>
            <span className="arch-lbl">{part.api.kind === "rest" ? "REST API" : "GraphQL API"}</span>
            <b className="arch-inspector-name">{part.name}</b>
            <p className="arch-about">{part.api.operations.length} operation{part.api.operations.length === 1 ? "" : "s"}. Written to its spec file when you write the drafts.</p>
            <div className="arch-field"><label className="arch-field-key" htmlFor="api-spec">Spec file</label>
              <div className="arch-field-value"><Draft id="api-spec" value={part.api.spec ?? ""} placeholder={part.api.kind === "rest" ? "openapi.yaml" : "schema.graphql"}
                onCommit={(v) => send({ tool: "set_api", args: { part: part.id, spec: v.trim() || null } })} /></div></div>
          </>
        ) : (
          <>
            <b className="arch-inspector-name">API</b>
            <p className="arch-about">What each part offers the others, written before it is built. Click an operation to change it; the lines show which REST call serves each GraphQL field.</p>
          </>
        )}
        <div className="arch-actions">
          {kinds.has("rest") && <button type="button" className="arch-btn" onClick={() => void write("openapi")} title={`Draft openapi.yaml files next to ${file}`}>Write openapi.yaml</button>}
          {kinds.has("graphql") && <button type="button" className="arch-btn" onClick={() => void write("graphql")}>Write schema.graphql</button>}
        </div>
      </aside>
    </>
  );
}

/** The picked operation's fields, each committed through set_operation. */
function OperationForm({ arch, part, op, onToast, onRemoved }: { arch: Architecture; part: Part; op: Operation; onToast: (text: string) => void; onRemoved: () => void }) {
  const set = (changes: Record<string, unknown>) => send({ tool: "set_operation", args: { part: part.id, id: op.id, ...changes } });
  const rest = part.api?.kind !== "graphql";
  const others = operationsOf(arch).filter((x) => x.part.id !== part.id);
  const callers = operationsOf(arch).filter((x) => x.op.resolves === op.id);
  const text = (key: string, label: string, value: string | undefined, opts: { long?: boolean; placeholder?: string; mono?: boolean } = {}) => (
    <div className="arch-field">
      <label className="arch-field-key" htmlFor={`op-${key}`}>{label}</label>
      <div className="arch-field-value">
        <Draft id={`op-${key}`} value={value ?? ""} long={opts.long} placeholder={opts.placeholder} className={opts.mono ? "mono" : undefined}
          onCommit={(v) => set({ [key]: v.trim() || null })} />
      </div>
    </div>
  );
  return (
    <>
      <span className="arch-lbl">{rest ? "REST operation" : "GraphQL field"} · {part.name}</span>
      <b className="arch-inspector-name mono">{operationLabel(op)}</b>
      <p className="arch-about">Written by your agent or by you; the agent reads it back before it builds.</p>
      <div className="arch-section">
        {rest ? (
          <div className="arch-field">
            <label className="arch-field-key" htmlFor="op-method">Method</label>
            <div className="arch-field-value">
              <select id="op-method" className="arch-input" value={op.method ?? "GET"} onChange={(e) => void set({ method: e.target.value }).then((err) => err && onToast(err))}>
                {HTTP_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="arch-field">
            <label className="arch-field-key" htmlFor="op-type">Type</label>
            <div className="arch-field-value">
              <select id="op-type" className="arch-input" value={op.type ?? "query"} onChange={(e) => void set({ type: e.target.value }).then((err) => err && onToast(err))}>
                {GRAPHQL_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
        )}
        {rest ? text("path", "Path", op.path, { placeholder: "/returns/{id}", mono: true }) : text("field", "Field", op.field, { placeholder: "requestRefund(returnId: ID!)", mono: true })}
        {!rest && text("returns", "Returns", op.returns, { placeholder: "Refund", mono: true })}
        {text("about", "What it does", op.about, { long: true, placeholder: "Refunds a return once the parcel is scanned." })}
        {text("request", "Request", op.request, { long: true, placeholder: "RefundRequest { amount, reason }", mono: true })}
        <div className="arch-field">
          <label className="arch-field-key" htmlFor="op-responses">Responses</label>
          <div className="arch-field-value">
            <Draft id="op-responses" long value={(op.responses ?? []).join("\n")} placeholder={"202 Refund queued\n409 Not scanned yet"} className="mono"
              onCommit={(v) => { const list = v.split("\n").map((l) => l.trim()).filter(Boolean); return set({ responses: list.length ? list : null }); }} />
          </div>
        </div>
        <div className="arch-field">
          <label className="arch-field-key" htmlFor="op-resolves">Served by</label>
          <div className="arch-field-value">
            <select id="op-resolves" className="arch-input" value={op.resolves ?? ""} onChange={(e) => void set({ resolves: e.target.value || null }).then((err) => err && onToast(err))}>
              <option value="">Nothing else</option>
              {others.map((x) => <option key={x.op.id} value={x.op.id}>{x.part.name}: {operationLabel(x.op)}</option>)}
            </select>
          </div>
        </div>
        {callers.length > 0 && (
          <div className="arch-row"><span className="arch-row-key">Serves</span><span className="arch-row-value">{callers.map((x) => `${x.part.name}, ${operationLabel(x.op)}`).join("; ")}</span></div>
        )}
      </div>
      <button type="button" className="arch-text-btn danger" onClick={() => void set({ remove: true }).then((err) => (err ? onToast(err) : onRemoved()))}>Remove this operation</button>
    </>
  );
}
