import { useDraft } from "./useDraft.ts";
import { useState, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { runtimesFor } from "buni/format/parse.ts";
import { PRIMITIVES, type Access, type ApiStyle, type FailurePolicy, type Phase, type Priority, type Question, type Requirement, type Role, type CachePolicy, type Cluster, type ClusterKind, type Column, type Environment, type Placement, type Runtime, type Doc, type Endpoint, type ErrorCase, type Field, type Id, type Link, type LinkKind, type Method, type Operation, type OperationKind, type Part, type PartKind, type QueueEvent, type Shape, type Table, type Trace, type TraceStep } from "buni/format/doc.ts";
import type { EditTool } from "../api.ts";
import { allCalls, callName, linkKindFor } from "./system.ts";

const PART_KINDS: PartKind[] = ["client", "service", "store", "cache", "queue", "external"];
const LINK_KINDS: LinkKind[] = ["calls", "reads", "writes", "publishes", "subscribes"];
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const OP_KINDS: OperationKind[] = ["query", "mutation", "subscription"];
const API_STYLES: [ApiStyle, string][] = [["rest", "REST"], ["graphql", "GraphQL"], ["none", "Worker"]];
const CLUSTER_KINDS: [ClusterKind, string][] = [["kubernetes", "Kubernetes"], ["ecs", "ECS"], ["nomad", "Nomad"], ["vms", "VMs"]];
const LINK_TARGET: Record<LinkKind, readonly PartKind[]> = { calls: ["service", "external"], reads: ["store", "cache"], writes: ["store", "cache"], publishes: ["queue"], subscribes: ["queue"] };

/** Runs one tool; the form stays open with the reason when it is refused. */
export function useSave(onDone: (reply: string) => void): { error: string | undefined; save: (tool: EditTool, args: Record<string, unknown>) => Promise<boolean> } {
  const [error, setError] = useState<string>();
  return {
    error,
    save: async (tool, args) => {
      try {
        const r = await window.buni.edit(tool, args);
        if (!r.ok) { setError(r.reply); return false; }
        setError(undefined); onDone(r.reply); return true;
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    },
  };
}

export function Form({ title, kicker, error, onSave, onDelete, children }: {
  title: ReactNode; kicker: string; error: string | undefined; onSave: () => Promise<boolean>; onDelete?: () => void; children: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  return (
    <form className="sys-form" onChangeCapture={() => setState("idle")} onSubmit={(e) => { e.preventDefault(); if (state === "saving") return; setState("saving"); void onSave().then((ok) => setState(ok ? "saved" : "idle")); }}>
      <div className="sys-form-head">
        <span className="sys-kicker">{kicker}</span>
        <div className="sys-form-title">{title}</div>
      </div>
      {children}
      {error && <div role="alert" className="notice sys-refusal">{error}</div>}
      <div className="sys-form-actions">
        {onDelete && <button type="button" className="btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>}
        <span className="grow" />
        <span role="status">{state === "saved" ? "Saved" : ""}</span><button type="submit" className="btn primary" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="sys-row">
      <span className="sys-row-label">{label}{hint && <span className="sys-row-hint"> · {hint}</span>}</span>
      {children}
    </div>
  );
}

export function Text({ value, onChange, placeholder, mono, label }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; label?: string }) {
  return <input className={`field${mono ? " mono" : ""}`} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

/** A few options side by side. */
export function Segments<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="sys-segments" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function Pick<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label?: string }) {
  return (
    <select className="field" value={value} aria-label={label} onChange={(e) => onChange(options.find(([v]) => v === e.target.value)?.[0] ?? value)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}

/** A set of ids chosen from a list, as toggles. */
export function Checks({ options, value, onChange, empty = "None to pick yet." }: { options: readonly [Id, string][]; value: readonly Id[]; onChange: (v: Id[]) => void; empty?: string }) {
  if (options.length === 0) return <span className="hint">{empty}</span>;
  return (
    <span className="sys-checks">
      {options.map(([id, label]) => {
        const on = value.includes(id);
        return (
          <button key={id} type="button" className={`sys-chip link${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== id) : [...value, id])}>
            {label}
          </button>
        );
      })}
    </span>
  );
}

function Types({ doc }: { doc: Doc }) {
  const types = [...PRIMITIVES, ...Object.values(doc.shapes).map((s) => s.name)];
  return <datalist id="sys-types">{types.flatMap((t) => [<option key={t} value={t} />, <option key={`${t}[]`} value={`${t}[]`} />])}</datalist>;
}

/** Rows of name, type and optional; types suggest primitives and shapes. */
/** An endpoint body: a shape whole (picked, its fields shown), or a list of fields to edit. */
function Body({ doc, shape, fields, onShape, onFields }: { doc: Doc; shape: Id | undefined; fields: Field[]; onShape: (s: Id | undefined) => void; onFields: (f: Field[]) => void }) {
  const shapes = Object.values(doc.shapes).filter((s) => !s.values).sort((a, b) => a.name.localeCompare(b.name));
  const picked = shape ? doc.shapes[shape] : undefined;
  return (
    <div className="sys-grid">
      <select className="field" aria-label="Body" value={shape ?? ""} onChange={(e) => onShape(e.target.value || undefined)}>
        <option value="">Fields, listed here</option>
        {shapes.map((s) => <option key={s.id} value={s.id}>{s.name}, the whole body</option>)}
      </select>
      {picked
        ? <p className="hint mono">{picked.fields.map((f) => `${f.name}${f.optional ? "?" : ""}: ${f.type}`).join(", ") || "no fields yet"}</p>
        : <Fields doc={doc} value={fields} onChange={onFields} />}
    </div>
  );
}

function Fields({ doc, value, onChange, noun = "Field" }: { doc: Doc; value: Field[]; onChange: (v: Field[]) => void; noun?: string }) {
  const set = (i: number, f: Field) => onChange(value.map((x, j) => (j === i ? f : x)));
  return (
    <div className="sys-grid">
      <Types doc={doc} />
      {value.map((f, i) => (
        <div key={i} className="sys-grid-row">
          <input className="field mono" value={f.name} placeholder="name" aria-label={`${noun} name`} onChange={(e) => set(i, { ...f, name: e.target.value })} />
          <input className="field mono" value={f.type} placeholder="type" list="sys-types" aria-label={`${noun} type`} onChange={(e) => set(i, { ...f, type: e.target.value })} />
          <label className="sys-tick" title="Optional"><input type="checkbox" checked={f.optional ?? false} onChange={(e) => set(i, { name: f.name, type: f.type, ...(e.target.checked ? { optional: true } : {}) })} /> opt</label>
          <button type="button" className="icon-btn small" aria-label={`Remove ${noun.toLowerCase()}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={12} /></button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...value, { name: "", type: "string" }])}><Plus size={12} /> {noun}</button>
    </div>
  );
}

function Errors({ value, onChange, placeholder }: { value: ErrorCase[]; onChange: (v: ErrorCase[]) => void; placeholder: string }) {
  const set = (i: number, e: ErrorCase) => onChange(value.map((x, j) => (j === i ? e : x)));
  return (
    <div className="sys-grid">
      {value.map((e, i) => (
        <div key={i} className="sys-grid-row">
          <input className="field mono narrow" value={e.code} placeholder={placeholder} aria-label="Error code" onChange={(ev) => set(i, { ...e, code: ev.target.value })} />
          <input className="field" value={e.when} placeholder="when…" aria-label="When it happens" onChange={(ev) => set(i, { ...e, when: ev.target.value })} />
          <button type="button" className="icon-btn small" aria-label="Remove error" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={12} /></button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...value, { code: "", when: "" }])}><Plus size={12} /> Error</button>
    </div>
  );
}

/** Cache on or off, where, for how long and under which key. */
function CacheEditor({ doc, value, onChange, allowed, why }: { doc: Doc; value: CachePolicy | undefined; onChange: (v: CachePolicy | undefined) => void; allowed: boolean; why: string }) {
  const caches = Object.values(doc.parts).filter((p) => p.kind === "cache");
  if (!allowed) return <span className="hint">{why}</span>;
  if (caches.length === 0) return <span className="hint">Add a cache part on the map first.</span>;
  if (!value) return <button type="button" className="link-btn" onClick={() => onChange({ part: caches[0]?.id ?? "", ttlSeconds: 300, key: "" })}><Plus size={12} /> Cache it</button>;
  const presets: [string, number][] = [["30 s", 30], ["1 min", 60], ["5 min", 300], ["1 h", 3600]];
  return (
    <div className="sys-grid sys-cache">
      <div className="sys-grid-row">
        <Pick label="Cache" value={value.part} options={caches.map((c) => [c.id, c.name] as const)} onChange={(part) => onChange({ ...value, part })} />
        <button type="button" className="icon-btn small" aria-label="Stop caching" title="Stop caching" onClick={() => onChange(undefined)}><X size={12} /></button>
      </div>
      <div className="sys-segments">
        {presets.map(([label, s]) => <button key={s} type="button" className={value.ttlSeconds === s ? "on" : ""} onClick={() => onChange({ ...value, ttlSeconds: s })}>{label}</button>)}
      </div>
      <div className="sys-grid-row">
        <input className="field mono narrow" type="number" min={1} value={value.ttlSeconds} aria-label="Seconds" onChange={(e) => onChange({ ...value, ttlSeconds: Number(e.target.value) })} />
        <span className="hint">s under</span>
        <Text mono label="Cache key" value={value.key} placeholder="plans:{currency}" onChange={(key) => onChange({ ...value, key })} />
      </div>
    </div>
  );
}

export function PartForm({ part, onDone }: { part: Part; onDone: () => void }) {
  const [d, setD] = useDraft({ kind: part.kind, name: part.name, purpose: part.purpose, tech: part.tech ?? "", api: part.api ?? "rest", ifDown: part.ifDown ?? "" });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker={part.kind}
      title={part.name}
      error={error}
      onSave={() => save("set_part", { part: part.id, kind: d.kind, name: d.name, purpose: d.purpose, tech: d.tech, ...(d.kind === "service" ? { api: d.api } : {}), ifDown: d.ifDown })}
      onDelete={() => void save("delete_system", { what: "part", id: part.id })}
    >
      <Row label="Name"><Text label="Name" value={d.name} onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Kind"><Pick label="Kind" value={d.kind} options={PART_KINDS.map((k) => [k, k] as const)} onChange={(kind) => setD({ ...d, kind })} /></Row>
      {d.kind === "service" && <Row label="API style"><Segments value={d.api} options={API_STYLES} onChange={(api) => setD({ ...d, api })} /></Row>}
      <Row label="Built on"><Text label="Built on" value={d.tech} placeholder="Postgres 16, Bun + Hono…" onChange={(tech) => setD({ ...d, tech })} /></Row>
      <Row label="Purpose"><textarea className="field text" rows={3} aria-label="Purpose" value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })} /></Row>
      <Row label="If it is down" hint="what people see"><textarea className="field text" rows={2} aria-label="If it is down" value={d.ifDown} placeholder="Pricing shows cached plans; quotes can't be sent and the form says so." onChange={(e) => setD({ ...d, ifDown: e.target.value })} /></Row>
    </Form>
  );
}

export function LinkForm({ doc, link, from: initialFrom, onDone }: { doc: Doc; link: Link | undefined; from?: Id; onDone: (reply: string) => void }) {
  const starters = Object.values(doc.parts).filter((p) => !["store", "cache", "queue"].includes(p.kind));
  const [from, setFrom] = useState(link?.from ?? (starters.some((p) => p.id === initialFrom) ? initialFrom : undefined) ?? starters[0]?.id ?? "");
  const destinations = (id: Id) => Object.values(doc.parts).filter((p) => doc.parts[id] && linkKindFor(doc.parts[id]!, p));
  const [toId, setTo] = useState(link?.to ?? destinations(from)[0]?.id ?? "");
  const [d, setD] = useDraft<{ kind: LinkKind; note: string; carries: Id[]; failure: FailurePolicy }>({ kind: link?.kind ?? (doc.parts[from] && doc.parts[toId] ? linkKindFor(doc.parts[from]!, doc.parts[toId]!) : undefined) ?? "calls", note: link?.note ?? "", carries: link?.carries ?? [], failure: link?.failure ?? {} });
  const f = d.failure;
  const setF = (k: keyof FailurePolicy, v: string) => {
    const { [k]: _, ...rest } = f;
    const num = k === "timeoutMs" || k === "retries";
    setD({ ...d, failure: v === "" ? rest : { ...rest, [k]: num ? Number(v) : v } });
  };
  const { error, save } = useSave(onDone);
  const name = (id: Id) => doc.parts[id]?.name ?? id;
  const to = doc.parts[toId];
  const kinds = LINK_KINDS.filter((k) => !to || LINK_TARGET[k].includes(to.kind));
  return (
    <Form
      kicker="link"
      title={link ? <>{name(from)} <span className="dim">→</span> {name(toId)}</> : "Connect parts"}
      error={error}
      onSave={() => save("link_parts", { ...(link ? { link: link.id } : {}), from, to: toId, kind: d.kind, note: d.note, carries: d.carries, failure: d.failure })}
      {...(link ? { onDelete: () => void save("delete_system", { what: "link", id: link.id }) } : {})}
    >
      {!link && <>
        <Row label="Source part"><Pick label="Source part" value={from} options={starters.map((p) => [p.id, p.name])} onChange={(id) => { const to = destinations(id)[0]; setFrom(id); setTo(to?.id ?? ""); setD({ ...d, kind: to ? linkKindFor(doc.parts[id]!, to) ?? "calls" : "calls" }); }} /></Row>
        <Row label="Destination part"><Pick label="Destination part" value={toId} options={destinations(from).map((p) => [p.id, p.name])} onChange={(id) => { setTo(id); setD({ ...d, kind: linkKindFor(doc.parts[from]!, doc.parts[id]!) ?? "calls" }); }} /></Row>
        {!to && <p className="hint">Add a service, store, cache, queue or external system to connect to.</p>}
      </>}
      <Row label="How they talk"><Segments value={d.kind} options={kinds.map((k) => [k, k] as const)} onChange={(kind) => setD({ ...d, kind })} /></Row>
      <Row label="Carries" hint="shapes on this link"><Checks options={Object.values(doc.shapes).map((s) => [s.id, s.name])} value={d.carries} onChange={(carries) => setD({ ...d, carries })} empty="No shapes yet; add them in Shapes." /></Row>
      <Row label="Note"><Text label="Note" value={d.note} placeholder="HTTPS, JSON, bearer token…" onChange={(note) => setD({ ...d, note })} /></Row>
      <Row label="When it fails" hint="slow or down">
        <div className="sys-grid">
          <div className="sys-grid-row">
            <input className="field mono narrow" type="number" min={1} placeholder="ms" aria-label="Timeout in ms" value={f.timeoutMs ?? ""} onChange={(e) => setF("timeoutMs", e.target.value)} />
            <span className="hint">ms timeout,</span>
            <input className="field mono narrow" type="number" min={0} max={20} placeholder="0" aria-label="Retries" value={f.retries ?? ""} onChange={(e) => setF("retries", e.target.value)} />
            <span className="hint">retries</span>
          </div>
          <Text mono label="Idempotency key" value={f.idempotencyKey ?? ""} placeholder="Idempotency-Key header" onChange={(v) => setF("idempotencyKey", v)} />
          <Text label="Fallback" value={f.fallback ?? ""} placeholder="Keep the form and say it didn't send" onChange={(v) => setF("fallback", v)} />
        </div>
      </Row>
    </Form>
  );
}

export function ShapeForm({ doc, shape, onDone }: { doc: Doc; shape: Shape | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ name: shape?.name ?? "", note: shape?.note ?? "", fields: shape?.fields ?? [{ name: "id", type: "id" }], values: shape?.values ?? [""], isEnum: shape?.values !== undefined });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker={d.isEnum ? "enum" : "shape"}
      title={shape ? shape.name : "New shape"}
      error={error}
      onSave={() => save("set_shape", { ...(shape ? { shape: shape.id } : {}), name: d.name, ...(d.isEnum ? { fields: [], values: d.values.filter(Boolean) } : { fields: d.fields }), ...(d.note ? { note: d.note } : {}) })}
      {...(shape ? { onDelete: () => void save("delete_system", { what: "shape", id: shape.id }) } : {})}
    >
      <Row label="Name"><Text label="Name" value={d.name} placeholder="Quote" mono onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Kind"><Segments value={d.isEnum ? "enum" : "fields"} options={[["fields", "Fields"], ["enum", "Enum"]] as const} onChange={(k) => setD({ ...d, isEnum: k === "enum" })} /></Row>
      {d.isEnum ? (
        <Row label="Values">
          <div className="sys-grid">
            {d.values.map((v, i) => (
              <div key={i} className="sys-grid-row">
                <input className="field mono" value={v} placeholder="draft" aria-label="Value" onChange={(e) => setD({ ...d, values: d.values.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button type="button" className="icon-btn small" aria-label="Remove value" onClick={() => setD({ ...d, values: d.values.filter((_, j) => j !== i) })}><X size={12} /></button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => setD({ ...d, values: [...d.values, ""] })}><Plus size={12} /> Value</button>
          </div>
        </Row>
      ) : (
        <Row label="Fields"><Fields doc={doc} value={d.fields} onChange={(fields) => setD({ ...d, fields })} /></Row>
      )}
      <Row label="Note"><Text label="Note" value={d.note} placeholder="What it is, when the name doesn't say" onChange={(note) => setD({ ...d, note })} /></Row>
    </Form>
  );
}

type TouchFields = { reads: Id[]; writes: Id[]; emits: Id[]; invalidates: Id[] };

/** The data a call touches and what it makes stale, shared by REST and GraphQL forms. */
function Touches({ doc, self, d, set }: { doc: Doc; self: Id | undefined; d: TouchFields; set: (patch: Partial<TouchFields>) => void }) {
  const tables: [Id, string][] = Object.values(doc.tables).map((t) => [t.id, t.name]);
  const cached: [Id, string][] = allCalls(doc).filter((c) => c.value.cache && c.value.id !== self).map((c) => [c.value.id, callName(c)]);
  return (
    <>
      <Row label="Reads"><Checks options={tables} value={d.reads} onChange={(reads) => set({ reads })} /></Row>
      <Row label="Writes"><Checks options={tables} value={d.writes} onChange={(writes) => set({ writes })} /></Row>
      <Row label="Emits"><Checks options={Object.values(doc.events).map((e) => [e.id, e.name])} value={d.emits} onChange={(emits) => set({ emits })} /></Row>
      <Row label="Makes stale"><Checks options={cached} value={d.invalidates} onChange={(invalidates) => set({ invalidates })} empty="Nothing is cached yet." /></Row>
    </>
  );
}

type Who = Access["who"] | "";

/** Who may call it: nobody said yet, anyone, anyone signed in, or some roles; and which rows. */
function AccessEditor({ doc, value, onChange }: { doc: Doc; value: Access | undefined; onChange: (v: Access | undefined) => void }) {
  const who: Who = value?.who ?? "";
  const set = (w: Who) => onChange(w === "" ? undefined : { who: w, ...(w === "roles" ? { roles: value?.roles ?? [] } : {}), ...(value?.rule ? { rule: value.rule } : {}) });
  const roles = Object.values(doc.roles).sort((a, b) => (a.index < b.index ? -1 : 1));
  return (
    <div className="sys-grid">
      <Segments value={who} options={[["", "None"], ["public", "Public"], ["signed-in", "Signed in"], ["roles", "Roles"]]} onChange={set} />
      {value?.who === "roles" && <Checks options={roles.map((r) => [r.id, r.name])} value={value.roles ?? []} onChange={(r) => onChange({ ...value, roles: r })} empty="No roles yet; add them in Access." />}
      {value && <Text label="Rule" value={value.rule ?? ""} placeholder="only their workspace's quotes" onChange={(rule) => { const { rule: _, ...rest } = value; onChange(rule ? { ...rest, rule } : rest); }} />}
    </div>
  );
}

/** Saves a call, then clears its access when the form cleared it (set_endpoint and set_operation keep access when it is left out). */
async function saveCall(save: (tool: EditTool, args: Record<string, unknown>) => Promise<boolean>, tool: "set_endpoint" | "set_operation", args: Record<string, unknown>, id: Id | undefined, had: boolean, access: Access | undefined) {
  if (!await save(tool, { ...args, ...(access ? { access } : {}) })) return false;
  return id && had && !access ? save("set_access", { call: id }) : true;
}

export function EndpointForm({ doc, service, endpoint, onDone }: { doc: Doc; service: Id; endpoint: Endpoint | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({
    method: endpoint?.method ?? "GET", path: endpoint?.path ?? "/", summary: endpoint?.summary ?? "",
    request: endpoint?.request ?? [], response: endpoint?.response ?? [],
    requestShape: endpoint?.requestShape, responseShape: endpoint?.responseShape,
    reads: endpoint?.reads ?? [], writes: endpoint?.writes ?? [], emits: endpoint?.emits ?? [],
    cache: endpoint?.cache, invalidates: endpoint?.invalidates ?? [], errors: endpoint?.errors ?? [], access: endpoint?.access,
  });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker={`endpoint · ${doc.parts[service]?.name ?? service}`}
      title={endpoint ? `${endpoint.method} ${endpoint.path}` : "New endpoint"}
      error={error}
      onSave={() => saveCall(save, "set_endpoint", {
        ...(endpoint ? { endpoint: endpoint.id } : {}), service, method: d.method, path: d.path, summary: d.summary,
        request: d.requestShape ?? d.request, response: d.responseShape ?? d.response, reads: d.reads, writes: d.writes, emits: d.emits,
        cache: d.cache ?? null, invalidates: d.invalidates, errors: d.errors.filter((e) => e.code),
      }, endpoint?.id, !!endpoint?.access, d.access)}
      {...(endpoint ? { onDelete: () => void save("delete_system", { what: "endpoint", id: endpoint.id }) } : {})}
    >
      <Row label="Route">
        <div className="sys-grid-row">
          <Pick label="Method" value={d.method} options={METHODS.map((m) => [m, m] as const)} onChange={(method) => setD({ ...d, method, ...(method !== "GET" ? { cache: undefined } : {}) })} />
          <Text label="Path" value={d.path} mono placeholder="/quotes/{id}" onChange={(path) => setD({ ...d, path })} />
        </div>
      </Row>
      <Row label="Does"><Text label="Summary" value={d.summary} placeholder="What it does" onChange={(summary) => setD({ ...d, summary })} /></Row>
      <Row label="Who may call"><AccessEditor doc={doc} value={d.access} onChange={(access) => setD({ ...d, access })} /></Row>
      <Row label="Takes"><Body doc={doc} shape={d.requestShape} fields={d.request} onShape={(requestShape) => setD({ ...d, requestShape })} onFields={(request) => setD({ ...d, request })} /></Row>
      <Row label="Returns"><Body doc={doc} shape={d.responseShape} fields={d.response} onShape={(responseShape) => setD({ ...d, responseShape })} onFields={(response) => setD({ ...d, response })} /></Row>
      <Touches doc={doc} self={endpoint?.id} d={d} set={(p) => setD({ ...d, ...p })} />
      <Row label="Cache"><CacheEditor doc={doc} value={d.cache} onChange={(cache) => setD({ ...d, cache })} allowed={d.method === "GET"} why="Only GET responses are cached." /></Row>
      <Row label="Can fail" hint="a page state for each"><Errors value={d.errors} placeholder="409" onChange={(errors) => setD({ ...d, errors })} /></Row>
    </Form>
  );
}

export function OperationForm({ doc, service, operation, onDone }: { doc: Doc; service: Id; operation: Operation | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({
    kind: operation?.kind ?? "query", name: operation?.name ?? "", summary: operation?.summary ?? "",
    args: operation?.args ?? [], returns: operation?.returns.replace(/\[\]$/, "") ?? "", list: operation?.returns.endsWith("[]") ?? false, nullable: operation?.nullable ?? false,
    reads: operation?.reads ?? [], writes: operation?.writes ?? [], emits: operation?.emits ?? [],
    cache: operation?.cache, invalidates: operation?.invalidates ?? [], errors: operation?.errors ?? [], access: operation?.access,
  });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker={`GraphQL · ${doc.parts[service]?.name ?? service}`}
      title={operation ? `${operation.kind} ${operation.name}` : "New operation"}
      error={error}
      onSave={() => saveCall(save, "set_operation", {
        ...(operation ? { operation: operation.id } : {}), service, kind: d.kind, name: d.name, summary: d.summary,
        args: d.args, returns: `${d.returns}${d.list ? "[]" : ""}`, ...(d.nullable ? { nullable: true } : {}),
        reads: d.reads, writes: d.writes, emits: d.emits, cache: d.cache ?? null, invalidates: d.invalidates, errors: d.errors.filter((e) => e.code),
      }, operation?.id, !!operation?.access, d.access)}
      {...(operation ? { onDelete: () => void save("delete_system", { what: "operation", id: operation.id }) } : {})}
    >
      <Row label="Kind"><Segments value={d.kind} options={OP_KINDS.map((k) => [k, k] as const)} onChange={(kind) => setD({ ...d, kind, ...(kind !== "query" ? { cache: undefined } : {}) })} /></Row>
      <Row label="Name"><Text label="Name" value={d.name} mono placeholder="plans, updatePlan" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Does"><Text label="Summary" value={d.summary} placeholder="What it does" onChange={(summary) => setD({ ...d, summary })} /></Row>
      <Row label="Who may call"><AccessEditor doc={doc} value={d.access} onChange={(access) => setD({ ...d, access })} /></Row>
      <Row label="Arguments"><Fields doc={doc} noun="Argument" value={d.args} onChange={(args) => setD({ ...d, args })} /></Row>
      <Row label="Returns">
        <div className="sys-grid-row">
          <Types doc={doc} />
          <input className="field mono" list="sys-types" value={d.returns} placeholder="Plan" aria-label="Returns" onChange={(e) => setD({ ...d, returns: e.target.value })} />
          <label className="sys-tick"><input type="checkbox" checked={d.list} onChange={(e) => setD({ ...d, list: e.target.checked })} /> list</label>
          <label className="sys-tick"><input type="checkbox" checked={d.nullable} onChange={(e) => setD({ ...d, nullable: e.target.checked })} /> null</label>
        </div>
      </Row>
      <Touches doc={doc} self={operation?.id} d={d} set={(p) => setD({ ...d, ...p })} />
      <Row label="Cache"><CacheEditor doc={doc} value={d.cache} onChange={(cache) => setD({ ...d, cache })} allowed={d.kind === "query"} why="Only queries are cached." /></Row>
      <Row label="Can fail" hint="a page state for each"><Errors value={d.errors} placeholder="NOT_FOUND" onChange={(errors) => setD({ ...d, errors })} /></Row>
    </Form>
  );
}

export function TableForm({ doc, store, table, onDone }: { doc: Doc; store: Id; table: Table | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft<{ name: string; columns: Column[] }>({ name: table?.name ?? "", columns: table?.columns ?? [{ name: "id", type: "uuid", primary: true }] });
  const { error, save } = useSave(onDone);
  const set = (i: number, c: Column) => setD({ ...d, columns: d.columns.map((x, j) => (j === i ? c : x)) });
  const flag = (c: Column, k: "primary" | "nullable" | "unique", on: boolean): Column => {
    const { [k]: _, ...rest } = c;
    return on ? { ...rest, [k]: true } : rest;
  };
  const refs = Object.values(doc.tables).filter((t) => t.store === store).flatMap((t) => t.columns.map((c): [string, string] => [`${t.id}\n${c.name}`, `${t.name}.${c.name}`]));
  return (
    <Form
      kicker={`table · ${doc.parts[store]?.name ?? store}`}
      title={table ? table.name : "New table"}
      error={error}
      onSave={() => save("set_table", { ...(table ? { table: table.id } : {}), store, name: d.name, columns: d.columns })}
      {...(table ? { onDelete: () => void save("delete_system", { what: "table", id: table.id }) } : {})}
    >
      <Row label="Name"><Text label="Name" value={d.name} mono placeholder="quotes" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Columns">
        <div className="sys-grid">
          {d.columns.map((c, i) => (
            <div key={i} className="sys-col-edit">
              <div className="sys-grid-row">
                <input className="field mono" value={c.name} placeholder="name" aria-label="Column name" onChange={(e) => set(i, { ...c, name: e.target.value })} />
                <input className="field mono" value={c.type} placeholder="text" aria-label="Column type" onChange={(e) => set(i, { ...c, type: e.target.value })} />
                <button type="button" className="icon-btn small" aria-label="Remove column" onClick={() => setD({ ...d, columns: d.columns.filter((_, j) => j !== i) })}><X size={12} /></button>
              </div>
              <div className="sys-grid-row">
                {(["primary", "nullable", "unique"] as const).map((k) => (
                  <button key={k} type="button" className={`sys-flag${c[k] ? " on" : ""}`} aria-pressed={c[k] ?? false} onClick={() => set(i, flag(c, k, !c[k]))}>{k === "primary" ? "key" : k === "nullable" ? "null" : "unique"}</button>
                ))}
                <select className="field narrow" value={c.classification ?? ""} aria-label="Sensitivity" title="personal: about a person; secret: never shown or logged" onChange={(e) => {
                  const { classification: _, ...rest } = c;
                  const v = e.target.value;
                  set(i, v === "personal" || v === "secret" ? { ...rest, classification: v } : rest);
                }}>
                  <option value="">plain</option>
                  <option value="personal">personal</option>
                  <option value="secret">secret</option>
                </select>
                <select className="field" value={c.ref ? `${c.ref.table}\n${c.ref.column}` : ""} aria-label="Foreign key" onChange={(e) => {
                  const [t, col] = e.target.value.split("\n");
                  const { ref: _, ...rest } = c;
                  set(i, t && col ? { ...rest, ref: { table: t, column: col } } : rest);
                }}>
                  <option value="">no foreign key</option>
                  {refs.map(([v, text]) => <option key={v} value={v}>→ {text}</option>)}
                </select>
              </div>
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => setD({ ...d, columns: [...d.columns, { name: "", type: "text" }] })}><Plus size={12} /> Column</button>
        </div>
      </Row>
    </Form>
  );
}

export function EventForm({ doc, queue, event, onDone }: { doc: Doc; queue: Id; event: QueueEvent | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ name: event?.name ?? "", payload: event?.payload ?? [] });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker={`event · ${doc.parts[queue]?.name ?? queue}`}
      title={event ? event.name : "New event"}
      error={error}
      onSave={() => save("set_event", { ...(event ? { event: event.id } : {}), queue, name: d.name, payload: d.payload })}
      {...(event ? { onDelete: () => void save("delete_system", { what: "event", id: event.id }) } : {})}
    >
      <Row label="Name"><Text label="Name" value={d.name} mono placeholder="quote.created" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Carries"><Fields doc={doc} value={d.payload} onChange={(payload) => setD({ ...d, payload })} /></Row>
    </Form>
  );
}

export function TraceForm({ doc, trace, onDone }: { doc: Doc; trace: Trace | undefined; onDone: (reply: string) => void }) {
  const firstLink = Object.values(doc.links)[0];
  const blank = (): TraceStep => ({ from: firstLink?.from ?? "", to: firstLink?.to ?? "", action: "" });
  const [d, setD] = useDraft({ name: trace?.name ?? "", page: trace?.page ?? "", steps: trace?.steps ?? [blank()] });
  const { error, save } = useSave(onDone);
  const parts = Object.values(doc.parts).map((p) => [p.id, p.name] as const);
  const vias: [string, string][] = [["", "no call"], ...allCalls(doc).map((c): [string, string] => [c.value.id, callName(c)]), ...Object.values(doc.events).map((e): [string, string] => [e.id, `event ${e.name}`])];
  const shapes: [string, string][] = [["", "no shape"], ...Object.values(doc.shapes).map((s): [string, string] => [s.id, s.name])];
  const set = (i: number, s: TraceStep) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const opt = (s: TraceStep, k: "via" | "carries", v: string): TraceStep => {
    const { [k]: _, ...rest } = s;
    return v ? { ...rest, [k]: v } : rest;
  };
  return (
    <Form
      kicker="trace"
      title={trace ? trace.name : "New trace"}
      error={error}
      onSave={() => save("set_trace", { ...(trace ? { trace: trace.id } : {}), name: d.name, ...(d.page ? { page: d.page } : {}), steps: d.steps })}
      {...(trace ? { onDelete: () => void save("delete_system", { what: "trace", id: trace.id }) } : {})}
    >
      <Row label="Action"><Text label="Name" value={d.name} placeholder="Submit a quote" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Starts on"><Pick label="Page" value={d.page} options={[["", "no page"], ...Object.values(doc.pages).filter((p) => p.route !== undefined).map((p) => [p.id, p.name] as const)]} onChange={(page) => setD({ ...d, page })} /></Row>
      <Row label="Steps">
        <div className="sys-grid">
          {d.steps.map((s, i) => (
            <div key={i} className="sys-step-edit">
              <div className="sys-grid-row">
                <span className="sys-step-n">{i + 1}</span>
                <Pick label="From" value={s.from} options={parts} onChange={(from) => set(i, { ...s, from })} />
                <span className="dim">→</span>
                <Pick label="To" value={s.to} options={parts} onChange={(to) => set(i, { ...s, to })} />
                <button type="button" className="icon-btn small" aria-label="Remove step" onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })}><X size={12} /></button>
              </div>
              <Text label="What happens" value={s.action} placeholder="insert quotes" onChange={(action) => set(i, { ...s, action })} />
              <div className="sys-grid-row">
                <Pick label="Via" value={s.via ?? ""} options={vias} onChange={(v) => set(i, opt(s, "via", v))} />
                <Pick label="Carries" value={s.carries ?? ""} options={shapes} onChange={(v) => set(i, opt(s, "carries", v))} />
              </div>
              <div className="sys-grid-row">
                <label className="sys-tick"><input type="checkbox" checked={s.async ?? false} onChange={(e) => { const { async: _, ...rest } = s; set(i, e.target.checked ? { ...rest, async: true } : rest); }} /> after the response</label>
                <span className="grow" />
                <input className="field mono narrow" type="number" min={0} placeholder="ms" aria-label="Time budget in ms" value={s.ms ?? ""} onChange={(e) => { const { ms: _, ...rest } = s; set(i, e.target.value === "" ? rest : { ...rest, ms: Number(e.target.value) }); }} />
              </div>
              <Text label="If it fails" value={s.ifFails ?? ""} placeholder="if it fails, the person sees…" onChange={(v) => { const { ifFails: _, ...rest } = s; set(i, v ? { ...rest, ifFails: v } : rest); }} />
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => setD({ ...d, steps: [...d.steps, { ...blank(), from: d.steps.at(-1)?.to ?? blank().from }] })}><Plus size={12} /> Step</button>
        </div>
      </Row>
    </Form>
  );
}

export function EnvironmentForm({ environment, onDone }: { environment: Environment | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ name: environment?.name ?? "", provider: environment?.provider ?? "", regions: (environment?.regions ?? []).join(", ") });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker="environment"
      title={environment ? environment.name : "New environment"}
      error={error}
      onSave={() => save("set_environment", { ...(environment ? { environment: environment.id } : {}), name: d.name, provider: d.provider, regions: d.regions.split(",").map((r) => r.trim()).filter(Boolean) })}
      {...(environment ? { onDelete: () => void save("delete_system", { what: "environment", id: environment.id }) } : {})}
    >
      <Row label="Name"><Text label="Name" value={d.name} mono placeholder="prod" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Provider"><Text label="Provider" value={d.provider} placeholder="aws, gcp, fly, vercel…" onChange={(provider) => setD({ ...d, provider })} /></Row>
      <Row label="Regions" hint="comma separated"><Text label="Regions" value={d.regions} mono placeholder="us-east-1, eu-west-1" onChange={(regions) => setD({ ...d, regions })} /></Row>
    </Form>
  );
}

export function ClusterForm({ doc, environment, cluster, onDone }: { doc: Doc; environment: Id; cluster: Cluster | undefined; onDone: (reply: string) => void }) {
  const env = doc.environments[environment];
  const [d, setD] = useDraft({ name: cluster?.name ?? "", kind: cluster?.kind ?? "kubernetes", region: cluster?.region ?? env?.regions[0] ?? "", version: cluster?.version ?? "" });
  const { error, save } = useSave(onDone);
  return (
    <Form
      kicker={`cluster · ${env?.name ?? environment}`}
      title={cluster ? cluster.name : "New cluster"}
      error={error}
      onSave={() => save("set_cluster", { ...(cluster ? { cluster: cluster.id } : {}), environment, name: d.name, kind: d.kind, region: d.region, ...(d.version ? { version: d.version } : {}) })}
      {...(cluster ? { onDelete: () => void save("delete_system", { what: "cluster", id: cluster.id }) } : {})}
    >
      <Row label="Name"><Text label="Name" value={d.name} mono placeholder="prod-use1" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Kind"><Segments value={d.kind} options={CLUSTER_KINDS} onChange={(kind) => setD({ ...d, kind })} /></Row>
      <Row label="Region"><Pick label="Region" value={d.region} options={(env?.regions ?? []).map((r) => [r, r] as const)} onChange={(region) => setD({ ...d, region })} /></Row>
      <Row label="Version"><Text label="Version" value={d.version} placeholder="EKS 1.30" onChange={(version) => setD({ ...d, version })} /></Row>
    </Form>
  );
}

const RUNTIME_TEXT: Record<Runtime, string> = { deployment: "Deployment", statefulset: "StatefulSet", daemonset: "DaemonSet", cronjob: "CronJob", job: "Job", container: "Container", function: "Function", static: "Static", managed: "Managed", vm: "VM" };
const K8S: readonly Runtime[] = ["deployment", "statefulset", "daemonset", "cronjob", "job"];
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function PlacementForm({ doc, part, environment, placement, onDone }: { doc: Doc; part: Id; environment: Id; placement: Placement | undefined; onDone: (reply: string) => void }) {
  const p = doc.parts[part];
  const env = doc.environments[environment];
  const fits = p ? runtimesFor(p) : [];
  const [d, setD] = useDraft({
    runtime: placement?.runtime ?? fits[0] ?? "deployment",
    regions: placement?.regions ?? (env?.regions.slice(0, 1) ?? []),
    cluster: placement?.cluster ?? "", namespace: placement?.namespace ?? "",
    min: placement?.scale?.min?.toString() ?? "", max: placement?.scale?.max?.toString() ?? "", cpuTarget: placement?.scale?.cpuTarget?.toString() ?? "",
    cpu: placement?.resources?.cpu ?? "", memory: placement?.resources?.memory ?? "",
    host: placement?.ingress?.host ?? "", path: placement?.ingress?.path ?? "/",
    schedule: placement?.schedule ?? "", service: placement?.service ?? "",
    config: (placement?.config ?? []).join(", "), secrets: (placement?.secrets ?? []).join(", "),
    replicas: placement?.replicas?.toString() ?? "", note: placement?.note ?? "",
  });
  const { error, save } = useSave(onDone);
  const k8s = K8S.includes(d.runtime);
  const clusters = Object.values(doc.clusters).filter((c) => c.environment === environment && c.kind === "kubernetes");
  const takesTraffic = p?.kind === "client" || (p?.kind === "service" && p.api !== "none");
  const holdsData = p?.kind === "store" || p?.kind === "cache" || p?.kind === "queue";
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const submit = () => {
    const cluster = k8s ? d.cluster || clusters[0]?.id : undefined;
    const clusterRegion = cluster ? doc.clusters[cluster]?.region : undefined;
    const scale = num(d.min) !== undefined && num(d.max) !== undefined ? { min: num(d.min), max: num(d.max), ...(num(d.cpuTarget) !== undefined ? { cpuTarget: num(d.cpuTarget) } : {}) } : undefined;
    return save("place", {
      part, environment, runtime: d.runtime, regions: clusterRegion ? [clusterRegion] : d.regions,
      ...(cluster ? { cluster, namespace: d.namespace || undefined } : {}),
      ...(scale ? { scale } : {}),
      ...(d.cpu || d.memory ? { resources: { ...(d.cpu ? { cpu: d.cpu } : {}), ...(d.memory ? { memory: d.memory } : {}) } } : {}),
      ...(takesTraffic && d.host ? { ingress: { host: d.host, path: d.path || "/" } } : {}),
      ...(d.runtime === "cronjob" ? { schedule: d.schedule } : {}),
      ...(d.service ? { service: d.service } : {}),
      config: list(d.config), secrets: list(d.secrets),
      ...(num(d.replicas) !== undefined ? { replicas: num(d.replicas) } : {}),
      ...(d.note ? { note: d.note } : {}),
    });
  };
  return (
    <Form
      kicker={`placement · ${env?.name ?? environment}`}
      title={p?.name ?? part}
      error={error}
      onSave={submit}
      {...(placement ? { onDelete: () => void save("delete_system", { what: "placement", id: placement.id }) } : {})}
    >
      <Row label="Runs as"><Segments value={d.runtime} options={fits.map((r) => [r, RUNTIME_TEXT[r]] as const)} onChange={(runtime) => setD({ ...d, runtime })} /></Row>
      {k8s ? (
        <>
          <Row label="Cluster">{clusters.length ? <Pick label="Cluster" value={d.cluster || clusters[0]?.id || ""} options={clusters.map((c) => [c.id, `${c.name} · ${c.region}`] as const)} onChange={(cluster) => setD({ ...d, cluster })} /> : <span className="hint">Add a Kubernetes cluster to {env?.name} first.</span>}</Row>
          <Row label="Namespace"><Text label="Namespace" value={d.namespace} mono placeholder="quotes" onChange={(namespace) => setD({ ...d, namespace })} /></Row>
        </>
      ) : (
        <Row label="Regions"><Checks options={(env?.regions ?? []).map((r) => [r, r])} value={d.regions} onChange={(regions) => setD({ ...d, regions })} /></Row>
      )}
      {(d.runtime === "managed" || d.runtime === "static" || d.runtime === "function" || d.runtime === "vm") && (
        <Row label="Service"><Text label="Service" value={d.service} placeholder={d.runtime === "managed" ? "RDS Postgres 16" : d.runtime === "static" ? "CloudFront + S3" : "Lambda"} onChange={(service) => setD({ ...d, service })} /></Row>
      )}
      {d.runtime === "cronjob" && <Row label="Schedule"><Text label="Schedule" value={d.schedule} mono placeholder="0 3 * * *" onChange={(schedule) => setD({ ...d, schedule })} /></Row>}
      {(k8s || d.runtime === "function" || d.runtime === "vm") && d.runtime !== "cronjob" && d.runtime !== "job" && (
        <Row label="Scale" hint={d.runtime === "function" ? "instances" : "pods"}>
          <div className="sys-grid-row">
            <input className="field mono narrow" type="number" min={0} placeholder="min" aria-label="Minimum" value={d.min} onChange={(e) => setD({ ...d, min: e.target.value })} />
            <span className="dim">to</span>
            <input className="field mono narrow" type="number" min={0} placeholder="max" aria-label="Maximum" value={d.max} onChange={(e) => setD({ ...d, max: e.target.value })} />
            <span className="dim">at</span>
            <input className="field mono narrow" type="number" min={1} max={100} placeholder="CPU %" aria-label="CPU target" value={d.cpuTarget} onChange={(e) => setD({ ...d, cpuTarget: e.target.value })} />
          </div>
        </Row>
      )}
      {k8s && (
        <Row label="Resources" hint="per pod">
          <div className="sys-grid-row">
            <Text label="CPU" value={d.cpu} mono placeholder="250m" onChange={(cpu) => setD({ ...d, cpu })} />
            <Text label="Memory" value={d.memory} mono placeholder="256Mi" onChange={(memory) => setD({ ...d, memory })} />
          </div>
        </Row>
      )}
      {takesTraffic && (
        <Row label="Ingress" hint="outside traffic">
          <div className="sys-grid-row">
            <Text label="Host" value={d.host} mono placeholder="api.example.com" onChange={(host) => setD({ ...d, host })} />
            <Text label="Path" value={d.path} mono placeholder="/" onChange={(path) => setD({ ...d, path })} />
          </div>
        </Row>
      )}
      {holdsData && <Row label="Standbys"><input className="field mono narrow" type="number" min={0} aria-label="Standby replicas" value={d.replicas} onChange={(e) => setD({ ...d, replicas: e.target.value })} /></Row>}
      <Row label="Config" hint="names"><Text label="Config" value={d.config} mono placeholder="PLAN_CACHE_TTL" onChange={(config) => setD({ ...d, config })} /></Row>
      <Row label="Secrets" hint="names, never values"><Text label="Secrets" value={d.secrets} mono placeholder="DATABASE_URL, STRIPE_KEY" onChange={(secrets) => setD({ ...d, secrets })} /></Row>
      <Row label="Note"><Text label="Note" value={d.note} placeholder="Why it runs this way" onChange={(note) => setD({ ...d, note })} /></Row>
    </Form>
  );
}

// ---------------------------------------------------------------------------------------------
// The design process: phases, requirements, questions, roles

export function PhaseForm({ phase, onDone }: { phase: Phase | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ name: phase?.name ?? "", goal: phase?.goal ?? "" });
  const { error, save } = useSave(onDone);
  return (
    <Form kicker="phase" title={phase ? phase.name : "New phase"} error={error}
      onSave={() => save("set_phase", { ...(phase ? { phase: phase.id } : {}), name: d.name, ...(d.goal ? { goal: d.goal } : {}) })}
      {...(phase ? { onDelete: () => void save("delete_system", { what: "phase", id: phase.id }) } : {})}>
      <Row label="Name"><Text label="Name" value={d.name} placeholder="v1, later" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Goal"><Text label="Goal" value={d.goal} placeholder="What this phase delivers" onChange={(goal) => setD({ ...d, goal })} /></Row>
    </Form>
  );
}

/** Everything a requirement can be served by, grouped by what it is. */
export function servable(doc: Doc): [string, [Id, string][]][] {
  const by = <T extends { id: Id; name: string }>(xs: Record<Id, T>): [Id, string][] => Object.values(xs).map((x) => [x.id, x.name]);
  return [
    ["Parts", by(doc.parts)],
    ["Calls", allCalls(doc).map((c): [Id, string] => [c.value.id, callName(c)])],
    ["Tables", by(doc.tables)],
    ["Traces", by(doc.traces)],
    ["Pages", Object.values(doc.pages).filter((p) => p.route !== undefined).map((p): [Id, string] => [p.id, p.name])],
    ["Events", by(doc.events)],
  ];
}

/** Toggles grouped by kind, with a filter once there are many. */
export function GroupedChecks({ groups, value, onChange }: { groups: [string, [Id, string][]][]; value: readonly Id[]; onChange: (v: Id[]) => void }) {
  const [q, setQ] = useState("");
  const total = groups.reduce((n, [, xs]) => n + xs.length, 0);
  const match = (label: string) => !q || label.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="sys-grid">
      {total > 20 && <Text label="Filter" value={q} placeholder="Filter…" onChange={setQ} />}
      {groups.map(([h, xs]) => {
        const shown = xs.filter(([id, label]) => value.includes(id) || match(label));
        return shown.length ? <div key={h}><span className="sys-row-hint">{h}</span><Checks options={shown} value={value} onChange={onChange} /></div> : null;
      })}
    </div>
  );
}

const PRIORITIES: [Priority, string][] = [["must", "Must"], ["should", "Should"], ["could", "Could"]];

export function RequirementForm({ doc, requirement, phase, onDone }: { doc: Doc; requirement: Requirement | undefined; phase?: Id; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ title: requirement?.title ?? "", detail: requirement?.detail ?? "", priority: requirement?.priority ?? "must", phase: requirement?.phase ?? phase ?? "", servedBy: requirement?.servedBy ?? [] });
  const { error, save } = useSave(onDone);
  const phases = Object.values(doc.phases).sort((a, b) => (a.index < b.index ? -1 : 1));
  return (
    <Form kicker={`requirement${requirement ? ` · ${requirement.id}` : ""}`} title={requirement ? requirement.title : "New requirement"} error={error}
      onSave={() => save("set_requirement", { ...(requirement ? { requirement: requirement.id } : {}), title: d.title, priority: d.priority, servedBy: d.servedBy, ...(d.detail ? { detail: d.detail } : {}), ...(d.phase ? { phase: d.phase } : {}) })}
      {...(requirement ? { onDelete: () => void save("delete_system", { what: "requirement", id: requirement.id }) } : {})}>
      <Row label="Outcome" hint="something you can check"><textarea className="field text" rows={2} aria-label="Outcome" value={d.title} placeholder="A buyer sends a quote in under a minute" onChange={(e) => setD({ ...d, title: e.target.value })} /></Row>
      <Row label="Priority"><Segments value={d.priority} options={PRIORITIES} onChange={(priority) => setD({ ...d, priority })} /></Row>
      <Row label="Phase"><Pick label="Phase" value={d.phase} options={[["", "no phase yet"], ...phases.map((p) => [p.id, p.name] as const)]} onChange={(p) => setD({ ...d, phase: p })} /></Row>
      <Row label="Detail"><textarea className="field text" rows={2} aria-label="Detail" value={d.detail} onChange={(e) => setD({ ...d, detail: e.target.value })} /></Row>
      <Row label="Served by" hint="what makes it true"><GroupedChecks groups={servable(doc)} value={d.servedBy} onChange={(servedBy) => setD({ ...d, servedBy })} /></Row>
    </Form>
  );
}

export function QuestionForm({ doc, question, kind, onDone }: { doc: Doc; question: Question | undefined; kind?: Question["kind"]; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ kind: question?.kind ?? kind ?? "question", text: question?.text ?? "", options: question?.options ?? [{ name: "" }, { name: "" }], about: question?.about ?? [] });
  const [why, setWhy] = useState("");
  const { error, save } = useSave(onDone);
  const setO = (i: number, patch: Partial<Question["options"][number]>) => setD({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const options = d.options.filter((o) => o.name).map((o) => ({ name: o.name, ...(o.pros ? { pros: o.pros } : {}), ...(o.cons ? { cons: o.cons } : {}) }));
  return (
    <>
      <Form kicker={d.kind === "assumption" ? "assumption" : question?.status === "decided" ? "decided" : "open question"} title={question ? question.text : d.kind === "assumption" ? "New assumption" : "New question"} error={error}
        onSave={() => save("set_question", { ...(question ? { question: question.id } : {}), kind: d.kind, text: d.text, options: d.kind === "question" ? options : [], about: d.about })}
        {...(question ? { onDelete: () => void save("delete_system", { what: "question", id: question.id }) } : {})}>
        <Row label="Kind"><Segments value={d.kind} options={[["question", "Not decided"], ["assumption", "Taken as given"]]} onChange={(k) => setD({ ...d, kind: k })} /></Row>
        <Row label={d.kind === "assumption" ? "We assume" : "Question"}><textarea className="field text" rows={2} aria-label="Text" value={d.text} placeholder={d.kind === "assumption" ? "Under 500 quotes a day in v1" : "SQS or a Redis queue for Jobs?"} onChange={(e) => setD({ ...d, text: e.target.value })} /></Row>
        {d.kind === "question" && (
          <Row label="Options" hint="with their honest cost">
            <div className="sys-grid">
              {d.options.map((o, i) => (
                <div key={i} className="sys-col-edit">
                  <div className="sys-grid-row">
                    <Text label="Option" value={o.name} placeholder={`Option ${i + 1}`} onChange={(name) => setO(i, { name })} />
                    <button type="button" className="icon-btn small" aria-label="Remove option" onClick={() => setD({ ...d, options: d.options.filter((_, j) => j !== i) })}><X size={12} /></button>
                  </div>
                  <Text label="For" value={o.pros ?? ""} placeholder="for…" onChange={(pros) => setO(i, { pros })} />
                  <Text label="Against" value={o.cons ?? ""} placeholder="against…" onChange={(cons) => setO(i, { cons })} />
                </div>
              ))}
              <button type="button" className="link-btn" onClick={() => setD({ ...d, options: [...d.options, { name: "" }] })}><Plus size={12} /> Option</button>
            </div>
          </Row>
        )}
        <Row label="About"><GroupedChecks groups={servable(doc)} value={d.about} onChange={(about) => setD({ ...d, about })} /></Row>
      </Form>
      {question && (
        <div className="sys-handoff">
          {question.status === "decided"
            ? <><b>{question.kind === "assumption" ? "Confirmed" : `Decided: ${question.chosen ?? ""}`}</b><button type="button" className="btn" onClick={() => void save("decide_question", { question: question.id, reopen: true })}>Reopen</button></>
            : <>
                <b>{question.kind === "assumption" ? "Confirm it" : "Decide"}</b>
                <Text label="Why" value={why} placeholder="why…" onChange={setWhy} />
                <div className="sys-checks">
                  {question.kind === "assumption"
                    ? <button type="button" className="btn" onClick={() => void save("decide_question", { question: question.id, ...(why ? { why } : {}) })}>Confirm</button>
                    : question.options.map((o) => <button key={o.name} type="button" className="btn" onClick={() => void save("decide_question", { question: question.id, option: o.name, ...(why ? { why } : {}) })}>{o.name}</button>)}
                </div>
                <p className="hint">Recorded as a decision too.</p>
              </>}
        </div>
      )}
    </>
  );
}

export function RoleForm({ doc, role, onDone }: { doc: Doc; role: Role | undefined; onDone: (reply: string) => void }) {
  const [d, setD] = useDraft({ name: role?.name ?? "", description: role?.description ?? "" });
  const { error, save } = useSave(onDone);
  const calls = role ? allCalls(doc).filter((c) => c.value.access?.roles?.includes(role.id)) : [];
  return (
    <Form kicker="role" title={role ? role.name : "New role"} error={error}
      onSave={() => save("set_role", { ...(role ? { role: role.id } : {}), name: d.name, description: d.description })}
      {...(role ? { onDelete: () => void save("delete_system", { what: "role", id: role.id }) } : {})}>
      <Row label="Name"><Text label="Name" value={d.name} placeholder="admin, reviewer" onChange={(name) => setD({ ...d, name })} /></Row>
      <Row label="Who they are"><textarea className="field text" rows={2} aria-label="Description" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Row>
      {role && <Row label="May call">{calls.length ? <span className="sys-checks">{calls.map((c) => <code key={c.value.id} className="sys-chip">{callName(c)}</code>)}</span> : <span className="hint">Nothing yet; drag calls onto this role in Access.</span>}</Row>}
    </Form>
  );
}
