// The other versions of a thing, side by side in the Inspector: a component's variants (its group) and a screen's
// states. Each opens with a click, and a new one is a copy to change from there.
import { useState } from "react";
import { Component, Layers, Plus } from "lucide-react";
import { statesOf, type Doc, type Id } from "buni/format/doc.ts";

function AddNamed({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState<string>();
  if (name === undefined) return <button type="button" className="link-btn" onClick={() => setName("")}><Plus size={12} /> {label}</button>;
  return (
    <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onAdd(name.trim()).then((ok) => ok && setName(undefined)); }}>
      <input className="field" autoFocus placeholder={placeholder} aria-label={label} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setName(undefined)} />
      <button type="submit" className="link-btn" disabled={!name.trim()}>Add</button>
    </form>
  );
}

/** The open variant's properties, each editable, and a way to add one; a use picks among variants by them. */
function VariantProps({ doc, component, onError }: { doc: Doc; component: Id; onError: (m: string | undefined) => void }) {
  const self = doc.shared[component];
  const [adding, setAdding] = useState({ key: "", value: "" });
  if (!self) return null;
  const set = async (props: Record<string, string>) => {
    const r = await window.buni.edit("set_variant", { component, props });
    onError(r.ok ? undefined : r.reply);
    return r.ok;
  };
  return (
    <div className="variant-editor">
      <span className="prop-name">This variant</span>
      {Object.entries(self.variant ?? {}).map(([k, v]) => (
        <div key={k} className="sys-grid-row">
          <span className="variant-key mono">{k}</span>
          <input key={v} className="field" defaultValue={v} aria-label={`${k} value`} onBlur={(e) => { const x = e.currentTarget.value.trim(); if (x !== v) void set({ [k]: x }); }} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          <button type="button" className="icon-btn small" aria-label={`Remove ${k}`} onClick={() => void set({ [k]: "" })}>×</button>
        </div>
      ))}
      <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); if (adding.key.trim() && adding.value.trim()) void set({ [adding.key.trim()]: adding.value.trim() }).then((ok) => ok && setAdding({ key: "", value: "" })); }}>
        <input className="field mono" placeholder="Property, e.g. Tone" aria-label="Property" value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value })} />
        <input className="field" placeholder="Value, e.g. Primary" aria-label="Value" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
        <button type="submit" className="link-btn">Set</button>
      </form>
    </div>
  );
}

/** A component's set: every component in its group, with a way to add another. */
export function ComponentVariants({ doc, component, onOpen, onError }: { doc: Doc; component: Id; onOpen: (id: Id) => void; onError: (m: string | undefined) => void }) {
  const self = doc.shared[component];
  if (!self) return null;
  const cut = self.name.lastIndexOf("/");
  const group = cut > 0 ? self.name.slice(0, cut).trim() : undefined;
  const set = Object.values(doc.shared).filter((x) => x.id === self.id || (group !== undefined && x.name.lastIndexOf("/") > 0 && x.name.slice(0, x.name.lastIndexOf("/")).trim() === group)).sort((a, b) => (a.name < b.name ? -1 : 1));
  return (
    <section className="variants" aria-label="Variants">
      <div className="variants-head"><b>{group ? `${group} set` : "Variants"}</b><span className="hint">{group ? `${set.length} components; a use can switch between them` : `Name it "Group / ${self.name}" to start a set`}</span></div>
      {set.map((v) => (
        <button key={v.id} type="button" className={`variant-row${v.id === self.id ? " on" : ""}`} onClick={() => onOpen(v.id)}>
          <Component size={12} /> {group ? v.name.slice(v.name.lastIndexOf("/") + 1).trim() : v.name}
          {v.variant && <span className="variant-props">{Object.entries(v.variant).map(([k, x]) => `${k}: ${x}`).join(" · ")}</span>}
        </button>
      ))}
      {group && <VariantProps doc={doc} component={self.id} onError={onError} />}
      <AddNamed label="Variant" placeholder="Its name, e.g. Secondary" onAdd={async (name) => {
        const r = await window.buni.edit("add_variant", { component: self.id, name });
        onError(r.ok ? undefined : r.reply);
        const id = r.reply.match(/Component (\S+) "/)?.[1];
        if (r.ok && id) onOpen(id);
        return r.ok;
      }} />
    </section>
  );
}

/** A screen and its states, each a click away, with a way to add a state. */
export function PageStates({ doc, page, onOpen, onError }: { doc: Doc; page: Id; onOpen: (id: Id) => void; onError: (m: string | undefined) => void }) {
  const p = doc.pages[page];
  if (!p || p.route === undefined || p.terminal) return null;
  const screen = p.state === undefined ? p : Object.values(doc.pages).find((x) => x.route === p.route && x.state === undefined) ?? p;
  const family = [screen, ...statesOf(doc, screen)];
  return (
    <section className="variants" aria-label="States">
      <div className="variants-head"><b>States</b><span className="hint">{family.length > 1 ? `${family.length - 1} besides the screen` : "Error, empty, loading: each its own copy"}</span></div>
      {family.map((s) => (
        <button key={s.id} type="button" className={`variant-row${s.id === page ? " on" : ""}`} onClick={() => onOpen(s.id)}>
          <Layers size={12} /> {s.state ?? "The screen"}
        </button>
      ))}
      <AddNamed label="State" placeholder="e.g. Empty, Error, Loading" onAdd={async (state) => {
        const r = await window.buni.edit("duplicate_page", { page: screen.id, state });
        onError(r.ok ? undefined : r.reply);
        const id = r.reply.match(/Created page (\S+)/)?.[1];
        if (r.ok && id) onOpen(id);
        return r.ok;
      }} />
    </section>
  );
}
