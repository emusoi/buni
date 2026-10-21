// The inspector's fields: each one shows a value, commits on Enter or blur through the architecture tools (so undo,
// live sync and the format's checks all apply), and says under itself why a change was refused.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { ARCH_COLLECTIONS, type ArchCollection, type Architecture, type Cluster, type Id, type NodePool, type Play, type PlayStep, type Workload } from "buni/format/doc.ts";
import { FORMS, PLANNABLE, TOOL, changeFor, labelOf, planChange, poolOptions, readInput, refOptions, valueOf, type Call, type Field, type FieldValue } from "./edit.ts";

/** Runs a call; resolves to the refusal, or undefined when it went in. */
export async function send(call: Call): Promise<string | undefined> {
  const r = await window.buni.edit(call.tool, call.args);
  return r.ok ? undefined : r.reply;
}

const shown = (v: FieldValue): string => (v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

/** A labelled control with the refusal under it. */
function Row({ label, id, error, children, wide }: { label: string; id: string; error: string | undefined; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`arch-field${wide ? " wide" : ""}`}>
      <label className="arch-field-key" htmlFor={id}>{label}</label>
      <div className="arch-field-value">
        {children}
        {error && <span className="arch-field-error" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/** Text typed and committed on Enter or blur; Escape puts it back. A thing changed elsewhere shows unless you're typing. */
export function Draft({ id, value, onCommit, long, placeholder, autoFocus, className, label }: {
  id?: string; value: string; onCommit: (raw: string) => Promise<string | undefined> | void; long?: boolean; placeholder?: string | undefined;
  autoFocus?: boolean; className?: string; label?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const editing = useRef(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing.current) setDraft(value); }, [value]);
  useEffect(() => { if (autoFocus) { ref.current?.focus(); ref.current?.select(); } }, [autoFocus]);
  const commit = async () => {
    editing.current = false;
    if (draft === value) return setError(undefined);
    setError((await onCommit(draft)) || undefined);
  };
  const props = {
    ref, id, value: draft, placeholder, className: `arch-input${className ? ` ${className}` : ""}${error ? " bad" : ""}`, "aria-label": label,
    "aria-invalid": error ? true : undefined,
    onFocus: () => { editing.current = true; },
    onChange: (e: { target: { value: string } }) => { editing.current = true; setDraft(e.target.value); },
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); editing.current = false; setDraft(value); setError(undefined); (e.target as HTMLElement).blur(); }
      else if (e.key === "Enter" && (!long || e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
    },
  };
  return (
    <>
      {long ? <textarea rows={2} {...props} /> : <input type="text" spellCheck={false} {...props} />}
      {error && <span className="arch-field-error" role="alert">{error}</span>}
    </>
  );
}

/** Strings as chips, each removable; type and Enter (or a comma) to add one, Backspace on empty takes the last. */
function Chips({ id, items, labels, onChange, options, placeholder }: {
  id: string; items: string[]; labels?: (s: string) => string; onChange: (next: string[]) => void;
  /** Picks from these instead of typing: [value, label]. */
  options?: [string, string][]; placeholder?: string | undefined;
}) {
  const [draft, setDraft] = useState("");
  const add = (s: string) => { const t = s.trim(); if (t && !items.includes(t)) onChange([...items, t]); setDraft(""); };
  const rest = options?.filter(([v]) => !items.includes(v));
  return (
    <div className="arch-chips-edit">
      {items.map((s) => (
        <span key={s} className="arch-chip">{labels?.(s) ?? s}<button type="button" aria-label={`Remove ${labels?.(s) ?? s}`} onClick={() => onChange(items.filter((x) => x !== s))}><X size={10} /></button></span>
      ))}
      {options ? (
        rest && rest.length > 0 && (
          <select id={id} className="arch-input arch-add-pick" value="" onChange={(e) => add(e.target.value)} aria-label="Add">
            <option value="">+ add</option>
            {rest.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )
      ) : (
        <input id={id} type="text" spellCheck={false} className="arch-input arch-chip-input" value={draft} placeholder={items.length ? "+ add" : placeholder ?? "+ add"}
          onChange={(e) => { const v = e.target.value; if (v.endsWith(",")) add(v.slice(0, -1)); else setDraft(v); }}
          onBlur={() => add(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && items.length) onChange(items.slice(0, -1));
          }} />
      )}
    </div>
  );
}

/** One field of a thing, the control its kind needs. */
export function FieldRow({ arch, c, thing, field, autoFocus, title }: {
  arch: Architecture; c: ArchCollection; thing: { id: Id; plan?: Id; status?: string }; field: Field; autoFocus?: boolean;
  /** Drawn as the inspector's heading. */
  title?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string>();
  const value = valueOf(thing, field.key);
  const commit = async (next: FieldValue): Promise<string | undefined> => {
    const call = changeFor(c, thing, field, next);
    const why = !call ? undefined : "error" in call ? call.error : await send(call);
    setError(why);
    return why;
  };
  if (title) {
    return (
      <div className="arch-title-field">
        <Draft id={id} label={field.label} className="title" value={shown(value)} placeholder={field.placeholder} autoFocus={autoFocus}
          onCommit={(raw) => commit(readInput("text", raw) as FieldValue)} />
      </div>
    );
  }
  const none = field.required ? [] : [<option key="" value="">—</option>];
  switch (field.kind) {
    case "select":
      return (
        <Row label={field.label} id={id} error={error}>
          <select id={id} className="arch-input" value={shown(value)} onChange={(e) => void commit(e.target.value || undefined)}>
            {none}{(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
      );
    case "pool": {
      const pools = poolOptions(arch, thing as Workload);
      const v = shown(value);
      return (
        <Row label={field.label} id={id} error={error}>
          <select id={id} className="arch-input" value={v} onChange={(e) => void commit(e.target.value || undefined)}>
            <option value="">{pools.length ? "—" : "— the cluster has no pools"}</option>
            {v && !pools.includes(v) && <option value={v}>{v}</option>}
            {pools.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
      );
    }
    case "ref": {
      const opts = refOptions(arch, c, field, thing.id);
      const v = shown(value);
      return (
        <Row label={field.label} id={id} error={error}>
          <select id={id} className="arch-input" value={v} onChange={(e) => void commit(e.target.value || undefined)}>
            {none}{v && !opts.some(([o]) => o === v) && <option value={v}>{v}</option>}
            {opts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
          </select>
        </Row>
      );
    }
    case "plan": {
      const plans = Object.values(arch.plans).sort((a, b) => a.name.localeCompare(b.name));
      return (
        <Row label={field.label} id={id} error={error}>
          <select id={id} className="arch-input" value={thing.plan ?? ""} onChange={(e) => {
            void send(planChange(c, thing, e.target.value || undefined)).then(setError);
          }}>
            <option value="">{plans.length ? "— live, no plan" : "— no plans yet"}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Row>
      );
    }
    case "bool":
      return (
        <Row label={field.label} id={id} error={error}>
          <input id={id} type="checkbox" className="arch-check" checked={value === true} onChange={(e) => void commit(e.target.checked)} />
        </Row>
      );
    case "list":
      return (
        <Row label={field.label} id={id} error={error}>
          <Chips id={id} items={Array.isArray(value) ? value.map(String) : []} placeholder={field.placeholder} onChange={(next) => void commit(next)} />
        </Row>
      );
    case "refs": {
      const opts = field.ref ? refOptions(arch, c, field, thing.id) : [];
      return (
        <Row label={field.label} id={id} error={error}>
          <Chips id={id} items={Array.isArray(value) ? value.map(String) : []} labels={(s) => labelOf(arch, s)} options={opts} onChange={(next) => void commit(next)} />
        </Row>
      );
    }
    default: {
      const kind = field.kind;
      return (
        <Row label={field.label} id={id} error={undefined}>
          <Draft id={id} value={shown(value)} long={kind === "long"} placeholder={field.placeholder} autoFocus={autoFocus}
            onCommit={(raw) => { const v = readInput(kind, raw); return v !== null && typeof v === "object" && !Array.isArray(v) ? Promise.resolve(v.error) : commit(v); }} />
        </Row>
      );
    }
  }
}

/** A thing's form: its sections and fields; the first field (its name) as the heading, focused when it is new. */
export function ThingForm({ arch, c, id, focus, sections, heading = true }: {
  arch: Architecture; c: ArchCollection; id: Id; focus?: boolean;
  /** Which sections to draw, by index; all when left out. */
  sections?: number[]; heading?: boolean;
}) {
  const thing = arch[c][id];
  if (!thing) return null;
  const all = FORMS[c].map((s, i) => [s, i] as const).filter(([, i]) => !sections || sections.includes(i));
  const first = FORMS[c][0]!.fields[0]!;
  const titled = heading && first.key === "name";
  return (
    <>
      {titled && <FieldRow key={`${id} title`} arch={arch} c={c} thing={thing} field={first} title autoFocus={focus} />}
      {all.map(([s, i]) => (
        <section key={i} className="arch-section">
          {s.title && <span className="arch-section-title">{s.title}</span>}
          {s.fields.filter((f) => !(titled && f === first) && (f.kind !== "plan" || PLANNABLE.includes(c))).map((f, k) => (
            <FieldRow key={`${id} ${f.key}`} arch={arch} c={c} thing={thing} field={f} autoFocus={focus && !titled && i === 0 && k === 0} />
          ))}
        </section>
      ))}
      {c === "clusters" && <Pools cluster={thing as Cluster} />}
      {c === "plays" && <Steps arch={arch} play={thing as Play} />}
    </>
  );
}

/** A cluster's node pools, each a small form; the list is sent whole. */
function Pools({ cluster }: { cluster: Cluster }) {
  const pools = cluster.pools ?? [];
  const [error, setError] = useState<string>();
  const save = async (next: NodePool[]) => { const why = await send({ tool: TOOL.clusters, args: { id: cluster.id, pools: next.length ? next : null } }); setError(why); return why; };
  const set = (i: number, patch: Partial<NodePool>) => save(pools.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <section className="arch-section">
      <span className="arch-section-title">Node pools</span>
      {pools.map((p, i) => (
        <div key={i} className="arch-sub-form">
          <div className="arch-sub-head">
            <Draft label="Pool name" className="strong" value={p.name} onCommit={(raw) => set(i, { name: raw.trim() })} />
            <button type="button" className="arch-icon-btn" aria-label={`Remove pool ${p.name}`} onClick={() => void save(pools.filter((_, k) => k !== i))}><X size={12} /></button>
          </div>
          <div className="arch-sub-grid">
            <Draft label="Machine" placeholder="machine" value={p.machine ?? ""} onCommit={(raw) => { const { machine: _, ...rest } = p; return save(pools.map((x, k) => (k === i ? { ...rest, ...(raw.trim() ? { machine: raw.trim() } : {}) } : x))); }} />
            <Draft label="Min nodes" placeholder="min" value={String(p.min)} onCommit={(raw) => (Number.isInteger(Number(raw)) && raw.trim() ? set(i, { min: Number(raw) }) : Promise.resolve("min is a whole number"))} />
            <Draft label="Max nodes" placeholder="max" value={String(p.max)} onCommit={(raw) => (Number.isInteger(Number(raw)) && raw.trim() ? set(i, { max: Number(raw) }) : Promise.resolve("max is a whole number"))} />
            <label className="arch-inline-check"><input type="checkbox" className="arch-check" checked={p.spot === true} onChange={(e) => { const { spot: _, ...rest } = p; void save(pools.map((x, k) => (k === i ? { ...rest, ...(e.target.checked ? { spot: true } : {}) } : x))); }} />spot</label>
          </div>
        </div>
      ))}
      {error && <span className="arch-field-error" role="alert">{error}</span>}
      <button type="button" className="arch-text-btn" onClick={() => void save([...pools, { name: pools.length ? `pool-${pools.length + 1}` : "general", min: 1, max: 3 }])}>+ Add node pool</button>
    </section>
  );
}

/** A play's steps in order: name, what it touches, the check it must pass; the list is sent whole. */
function Steps({ arch, play }: { arch: Architecture; play: Play }) {
  const [error, setError] = useState<string>();
  const save = async (next: PlayStep[]) => { const why = await send({ tool: TOOL.plays, args: { id: play.id, steps: next } }); setError(why); return why; };
  const set = (i: number, patch: Partial<PlayStep>) => save(play.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const drop = (i: number, key: "about" | "check", raw: string) => {
    const s = { ...play.steps[i]! };
    if (raw.trim()) s[key] = raw.trim();
    else delete s[key];
    return save(play.steps.map((x, k) => (k === i ? s : x)));
  };
  const touchable = ARCH_COLLECTIONS.filter((x) => x !== "plays" && x !== "plans" && x !== "stages")
    .flatMap((x) => Object.keys(arch[x]).map((id): [string, string] => [id, labelOf(arch, id)]));
  return (
    <section className="arch-section">
      <span className="arch-section-title">Steps</span>
      {play.steps.map((s, i) => (
        <div key={i} className="arch-sub-form">
          <div className="arch-sub-head">
            <span className="arch-step-n small">{i + 1}</span>
            <Draft label={`Step ${i + 1} name`} className="strong" value={s.name} onCommit={(raw) => (raw.trim() ? set(i, { name: raw.trim() }) : Promise.resolve("a step needs a name"))} />
            <button type="button" className="arch-icon-btn" aria-label={`Remove step ${i + 1}`} disabled={play.steps.length === 1} onClick={() => void save(play.steps.filter((_, k) => k !== i))}><X size={12} /></button>
          </div>
          <Draft label={`Step ${i + 1} about`} placeholder="what happens" value={s.about ?? ""} onCommit={(raw) => drop(i, "about", raw)} />
          <Chips id={`${play.id}-${i}-touches`} items={s.touches} labels={(x) => labelOf(arch, x)} options={touchable} onChange={(next) => void set(i, { touches: next })} />
          <Draft label={`Step ${i + 1} check`} placeholder="check it must pass" value={s.check ?? ""} onCommit={(raw) => drop(i, "check", raw)} />
        </div>
      ))}
      {error && <span className="arch-field-error" role="alert">{error}</span>}
      <button type="button" className="arch-text-btn" onClick={() => void save([...play.steps, { name: `Step ${play.steps.length + 1}`, touches: [] }])}>+ Add step</button>
    </section>
  );
}
