import { Sources } from "./Sources.tsx";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Code2, AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight, ChevronDown, ChevronRight, Component, Heading, Image, LayoutGrid, MousePointerClick, Plus, Square, Trash2, Type, type LucideIcon } from "lucide-react";
import { EASINGS, ENTRANCES, MOTION_TRIGGERS, RESPONSES, entersOn, pickVariant, setOf, variantProperties, childrenOf, responseFields, type Doc, type Motion, type MotionTrigger, type Id, type InstanceNode, type Node, type Page, type SharedSection, type TerminalScreen } from "buni/format/doc.ts";
import type { EditResult, EditTool } from "../api.ts";
import { PageSummary } from "./PageSummary.tsx";
import type { Hit } from "./search.ts";
import { SmallSizes } from "./SmallSizes.tsx";
import { Tokens } from "./Tokens.tsx";
import { Widths } from "./Widths.tsx";
import { ComponentVariants, PageStates } from "./Variants.tsx";
import { CodeView } from "./CodeView.tsx";
import { Comments } from "./Comments.tsx";
import { placeImage } from "./images.ts";

/** Shadows from none to large; a shadow set some other way still shows, as its own value. */
const SHADOWS: [string, string][] = [
  ["", "No shadow"],
  ["0 1px 2px rgb(0 0 0 / 0.08)", "Shadow · small"],
  ["0 4px 12px rgb(0 0 0 / 0.10)", "Shadow · medium"],
  ["0 12px 32px rgb(0 0 0 / 0.14)", "Shadow · large"],
];

/** Properties with their own controls; everything else is under Advanced CSS. */
const TYPED = new Set([
  "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "textAlign", "color",
  "display", "flexDirection", "gap", "padding", "alignItems", "justifyContent", "gridTemplateColumns", "boxShadow",
  "width", "height", "maxWidth", "minHeight", "background", "backgroundColor", "borderRadius", "border", "opacity",
]);
const WEIGHTS: [string, string][] = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]];
const FONTS = ["Manrope, sans-serif", "Inter, sans-serif", "system-ui, sans-serif", "Georgia, serif", "\"Iowan Old Style\", serif", "ui-monospace, monospace"];
/** Starting points for new layers; plain values so they read the same in any design. */
const ADD: { label: string; icon: LucideIcon; html: string }[] = [
  { label: "Heading", icon: Heading, html: '<h2 style="margin:0;font-size:36px;line-height:1.15;font-weight:700">Heading</h2>' },
  { label: "Text", icon: Type, html: '<p style="margin:0;font-size:18px;line-height:1.5">Write something here.</p>' },
  { label: "Box", icon: Square, html: '<div layer-name="Box" style="padding:24px;min-height:120px;background:#EDEDE9;border-radius:4px"></div>' },
  { label: "Row", icon: LayoutGrid, html: '<div layer-name="Row" style="display:flex;gap:24px;padding:24px;min-height:80px"></div>' },
  { label: "Button", icon: MousePointerClick, html: '<a layer-name="Button" style="display:inline-block;padding:12px 20px;background:#16140F;color:#fff;border-radius:4px;font-family:-apple-system, sans-serif;font-size:14px;font-weight:600;text-decoration:none">Button</a>' },
  { label: "Image", icon: Image, html: '<div layer-name="Image" style="aspect-ratio:16/9;background:linear-gradient(160deg, #C9C4B8, #8F897C)"></div>' },
];

/** Where a new layer goes: inside a selected container, after any other selected layer, else at the end of the page. */
function target(node: Node | undefined, root: Id | undefined): { parent: Id; after?: Id } | undefined {
  if (!node) return root ? { parent: root } : undefined;
  if (node.kind === "frame") return { parent: node.id };
  return node.parent ? { parent: node.parent, after: node.id } : undefined;
}

/** The component whose source tree holds this layer, if any. */
function componentOf(doc: Doc, node: Node): SharedSection | undefined {
  let n: Node | undefined = node;
  while (n?.parent !== undefined) n = doc.nodes[n.parent];
  return n && Object.values(doc.shared).find((s) => s.root === n?.id);
}

function usesOf(doc: Doc, sharedId: Id): number {
  return Object.values(doc.nodes).filter((n) => n.kind === "instance" && n.shared === sharedId).length;
}

/** Text layers inside a component, in order, for per-instance overrides. */
function textsOf(doc: Doc, root: Id): Node[] {
  const out: Node[] = [];
  const walk = (id: Id) => {
    for (const c of childrenOf(doc, id)) {
      if (c.kind === "text") out.push(c);
      walk(c.id);
    }
  };
  const r = doc.nodes[root];
  if (r?.kind === "text") out.push(r);
  walk(root);
  return out;
}

/** The page a node is on, if any. */
function pageOfNodeIn(doc: Doc, id: Id): Id | undefined {
  let n = doc.nodes[id];
  while (n?.parent) n = doc.nodes[n.parent];
  return n ? Object.values(doc.pages).find((p) => p.frame === n?.id)?.id : undefined;
}

/** Where a layer meets the system: the response field it shows, and the endpoint each of its links calls. */
function DataSection({ doc, node, onError }: { doc: Doc; node: Node; onError: (m: string | undefined) => void }) {
  const endpoints = Object.values(doc.endpoints).sort((a, b) => (a.index < b.index ? -1 : 1));
  if (endpoints.length === 0) return null;
  const run = async (tool: EditTool, args: Record<string, unknown>) => {
    const r = await window.buni.edit(tool, args);
    onError(r.ok ? undefined : r.reply);
  };
  const calls: [string, string][] = endpoints.map((e) => [e.id, `${e.method} ${e.path}`]);
  const links = Object.values(doc.connections).filter((c) => c.node === node.id);
  // The calls this screen touches come first: made from it, that lead to it, or already shown on it.
  let top = node;
  while (top.parent && doc.nodes[top.parent]) top = doc.nodes[top.parent] ?? top;
  const page = Object.values(doc.pages).find((p) => p.frame === top.id)?.id;
  const near = new Set(Object.values(doc.connections).flatMap((c) => (c.endpoint && (c.page === page || c.to === page) ? [c.endpoint] : [])));
  for (const n of Object.values(doc.nodes)) if (n.bind && page && pageOfNodeIn(doc, n.id) === page) near.add(n.bind.endpoint);
  if (node.bind) near.add(node.bind.endpoint);
  const group = (list: typeof endpoints) => list.filter((e) => responseFields(doc, { kind: "rest", endpoint: e }).length > 0).map((e) => (
    <optgroup key={e.id} label={`${e.method} ${e.path}`}>
      {responseFields(doc, { kind: "rest", endpoint: e }).map((f) => <option key={f} value={`${e.id}\n${f}`}>{f}</option>)}
    </optgroup>
  ));
  const others = endpoints.filter((e) => !near.has(e.id));
  return (
    <Group title="Data">
      <div className="data-row">
        <span className="prop-name">Shows</span>
        <label className="select" title="A field of an endpoint's response this layer shows">
          <select value={node.bind ? `${node.bind.endpoint}\n${node.bind.field}` : ""} onChange={(e) => {
            const [endpoint, field] = e.target.value.split("\n");
            void run("bind", endpoint ? { node: node.id, endpoint, field } : { node: node.id });
          }}>
            <option value="">Nothing live</option>
            {group(endpoints.filter((e) => near.has(e.id)))}
            {group(others)}
          </select>
        </label>
      </div>
      {links.map((c) => (
        <div key={c.id} className="data-row">
          <span className="prop-name">On {c.trigger} → {doc.pages[c.to]?.name ?? c.to}, calls</span>
          <Select
            title="The endpoint this link calls"
            value={c.endpoint ?? ""}
            options={[["", "No endpoint"], ...calls]}
            onChange={(v) => void run("connect", {
              node: c.node, page: c.page, to: c.to, trigger: c.trigger, transition: c.transition, durationMs: c.durationMs,
              ...(c.condition ? { condition: c.condition } : {}), endpoint: v,
            })}
          />
        </div>
      ))}
    </Group>
  );
}

/** An instance: which component it uses, and the text it shows differently. */
function InstanceSection({ doc, node, onOpen, onError, onSelect, atWidth }: { doc: Doc; node: InstanceNode; onOpen: (id: Id) => void; onError: (m: string | undefined) => void; onSelect: (id: Id) => void; atWidth?: number | undefined }) {
  const section = doc.shared[node.shared];
  const [styling, setStyling] = useState<{ layer: Id; prop: string; value: string }>({ layer: "", prop: "", value: "" });
  if (!section) return null;
  const run = async (args: Record<string, unknown>) => {
    const r = await window.buni.edit("override", { instance: node.id, ...args });
    onError(r.ok ? undefined : r.reply);
  };
  const texts = textsOf(doc, section.root);
  return (
    <section className="group component-group">
      <div className="group-title">Component</div>
      <div className="component-card">
        <Component size={15} strokeWidth={1.75} />
        <span className="name">{section.name}</span>
        <button type="button" className="link-btn" onClick={() => onOpen(section.id)}>Edit component</button>
      </div>
      {(() => {
        // A set with properties is picked property by property (Tone, Size); one without, by name. Either way the use
        // swaps to that component in place.
        const variant = (name: string) => name.slice(name.lastIndexOf("/") + 1).trim() || name;
        const group = section.name.includes("/") ? section.name.slice(0, section.name.lastIndexOf("/")).trim() : undefined;
        const set = setOf(doc, section.id);
        const props = variantProperties(set);
        const siblings = group ? set.filter((x) => x.id !== section.id) : Object.values(doc.shared).filter((x) => x.id !== section.id);
        const swap = async (to: Id) => {
          const r = await window.buni.edit("swap_component", { instance: node.id, component: to });
          onError(r.ok && !/dropped/.test(r.reply) ? undefined : r.reply);
        };
        return (
          <div className="component-actions">
            {props.length > 0 ? props.map(([k, values]) => (
              <label key={k} className="select prop-select" title={`${k}: swaps to the variant that has it`}>
                <span>{k}</span>
                <select value={section.variant?.[k] ?? ""} onChange={(e) => {
                  const to = pickVariant(set, { ...section.variant, [k]: e.target.value });
                  if (to && to.id !== section.id) void swap(to.id);
                }}>
                  {section.variant?.[k] === undefined && <option value="">—</option>}
                  {values.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )) : siblings.length > 0 && (
              <label className="select" title={group ? `Another ${group} component, in the same place` : "Another component, in the same place"}>
                <select value={section.id} onChange={(e) => void swap(e.target.value)}>
                  <option value={section.id}>{variant(section.name)}</option>
                  {siblings.map((x) => <option key={x.id} value={x.id}>{group ? variant(x.name) : x.name}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="link-btn" title="Turn this use into plain layers; it stops following the component" onClick={async () => {
              const r = await window.buni.edit("detach_instance", { instance: node.id });
              onError(r.ok ? undefined : r.reply);
              const root = r.reply.match(/Detached: (\S+) is/)?.[1];
              if (r.ok && root) onSelect(root);
            }}>Detach</button>
          </div>
        );
      })()}
      <div className="group-title sub">Style in this use{atWidth !== undefined ? ` at ${atWidth} px` : ""}</div>
      {(() => {
        // Styles this use gives the component's layers: everywhere, or at one of the page's widths.
        const layers = (function walk(id: Id): Node[] { return childrenOf(doc, id).flatMap((c) => [c, ...walk(c.id)]); })(section.root);
        const rows = Object.entries(node.overrides).flatMap(([id, ov]) => [
          ...Object.entries(ov.style ?? {}).map(([k, v]) => ({ id, k, v, w: undefined as number | undefined })),
          ...Object.entries(ov.at ?? {}).flatMap(([w, st]) => Object.entries(st).map(([k, v]) => ({ id, k, v, w: Number(w) }))),
        ]);
        const set = async (args: Record<string, unknown>) => {
          const r = await window.buni.edit("override", { instance: node.id, ...args });
          onError(r.ok ? undefined : r.reply);
          return r.ok;
        };
        return (
          <>
            {rows.map((r) => (
              <div key={`${r.id}:${r.k}:${r.w ?? ""}`} className="override-row">
                <span className="mono">{doc.nodes[r.id]?.name ?? r.id} · {r.k}: {r.v}{r.w !== undefined ? ` at ${r.w}` : ""}</span>
                <button type="button" className="icon-btn small" aria-label="Clear" title="Clear" onClick={() => void set({ node: r.id, style: { [r.k]: "" }, ...(r.w !== undefined ? { width: r.w } : {}) })}>×</button>
              </div>
            ))}
            <form className="override-style" onSubmit={(e) => {
              e.preventDefault();
              if (!styling.layer || !styling.prop.trim() || !styling.value.trim()) return;
              void set({ node: styling.layer, style: { [styling.prop.trim()]: styling.value.trim() }, ...(atWidth !== undefined ? { width: atWidth } : {}) }).then((ok) => ok && setStyling({ ...styling, prop: "", value: "" }));
            }}>
              <label className="select"><select aria-label="Layer in the component" value={styling.layer} onChange={(e) => setStyling({ ...styling, layer: e.target.value })}>
                <option value="">Layer…</option>
                {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
              <input className="field mono" aria-label="Property" placeholder="display" value={styling.prop} onChange={(e) => setStyling({ ...styling, prop: e.target.value })} />
              <input className="field mono" aria-label="Value" placeholder="none" value={styling.value} onChange={(e) => setStyling({ ...styling, value: e.target.value })} />
              <button type="submit" className="link-btn">Set</button>
            </form>
          </>
        );
      })()}
      {texts.length > 0 && <div className="group-title sub">Text in this use</div>}
      {texts.map((t) => {
        const source = t.kind === "text" ? t.text : "";
        const own = node.overrides[t.id]?.text;
        return (
          <label key={t.id} className="prop stacked">
            <span className="prop-name">{t.name}{own !== undefined && <span className="overridden"> · changed</span>}</span>
            <Field
              value={own ?? source}
              onSave={(v) => void (v === source || v === "" ? run({ node: t.id, reset: true }) : run({ node: t.id, text: v }))}
            />
          </label>
        );
      })}
      {Object.keys(node.overrides).length > 0 && (
        <button type="button" className="link-btn" onClick={() => void Promise.all(Object.keys(node.overrides).map((id) => run({ node: id, reset: true })))}>
          Reset all changes
        </button>
      )}
    </section>
  );
}

/** The canvas toolbar: adds a layer inside the selected frame, after any other selected layer, or to the page. */
export function InsertBar({ doc, node, root, onAdded, onError }: { doc: Doc; node: Node | undefined; root: Id | undefined; onAdded: (id: Id) => void; onError: (m: string) => void }) {
  const at = target(node, root);
  const [writing, setWriting] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  if (!at) return null;
  // Said as a sentence, so it's plain where the next layer lands.
  const where = !node ? "Adds to the end of the page" : node.kind === "frame" ? `Adds inside ${node.name}` : `Adds after ${node.name}`;
  return (
    <div className="insert-bar" role="toolbar" aria-label={`Add ${where}`}>
        {writing && (
          <div className="insert-code" role="dialog" aria-label={`Write HTML ${where}`} onKeyDown={(e) => e.key === "Escape" && setWriting(false)}>
            <div className="insert-code-head"><b>Write HTML</b><span className="hint">{where}</span><button type="button" className="icon-btn small" aria-label="Close" onClick={() => setWriting(false)}>×</button></div>
            <CodeView doc={doc} target={{ kind: "insert", ...at }} onApplied={(id, reply) => {
              setWriting(false);
              if (id) onAdded(id);
              const warning = reply.indexOf("Warning:");
              if (warning >= 0) onError(reply.slice(warning));
            }} />
          </div>
        )}
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif" hidden aria-hidden="true" onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          const r = await placeImage(file, at);
          if ("id" in r) onAdded(r.id); else onError(r.error);
        }} />
        <button type="button" className={`add-btn${writing ? " on" : ""}`} title={`Write HTML ${where}`} onClick={() => setWriting((w) => !w)} aria-label="Write HTML"><Code2 size={14} /><span>Code</span></button>
        {Object.keys(doc.shared).length > 0 && (
          <select
            className="add-component"
            value=""
            onChange={async (e) => {
              const r = await window.buni.edit("place_component", { component: e.target.value, ...at });
              const id = r.reply.match(/instance (\S+) of/)?.[1];
              if (r.ok && id) onAdded(id);
              else if (!r.ok) onError(r.reply);
            }}
          >
            <option value="" disabled>◆ Component</option>
            {Object.values(doc.shared).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {ADD.map((a) => (
          <button
            key={a.label}
            type="button"
            className="add-btn"
            title={`Add ${a.label.toLowerCase()} ${where}`}
            onClick={async () => {
              // With somewhere to keep files, Image asks for a real one; without, it adds a placeholder.
              if (a.label === "Image" && window.buni.uploadImage) return picker.current?.click();
              const r = await window.buni.edit("write_html", { ...at, html: a.html });
              const id = r.reply.match(/Created \d+ nodes?: ([^,.\s]+)/)?.[1];
              if (r.ok && id) onAdded(id);
              else if (!r.ok) onError(r.reply);
            }}
          >
            <a.icon size={15} strokeWidth={1.75} />
            <span>{a.label}</span>
          </button>
        ))}
      <span className="insert-where">{where}</span>
    </div>
  );
}

/** A titled group of fields; its title folds it, and the fold is remembered by title across layers and launches. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const key = `buni.fold.${title}`;
  const [shut, setShut] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const flip = () => {
    setShut(!shut);
    try {
      localStorage.setItem(key, shut ? "0" : "1");
    } catch {
      // Remembering the fold is a convenience.
    }
  };
  return (
    <section className={`group${shut ? " shut" : ""}`}>
      <button type="button" className="group-title fold" aria-expanded={!shut} onClick={flip}>
        {title}
        {shut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>
      {!shut && children}
    </section>
  );
}

const COLOR = /^(color|background|border)/;
const KIND_ICON: Record<Node["kind"], LucideIcon> = { frame: Square, text: Type, image: Image, svg: Component, instance: Component };

/** A labelled input in a row: a short prefix ("W", "Aa") and the stored value. */
const TRIGGER_LABEL: Record<MotionTrigger, string> = { load: "On load", scroll: "Into view", hover: "Hover", press: "Press" };
const EFFECT_DEFAULT_MS: Record<MotionTrigger, number> = { load: 700, scroll: 600, hover: 150, press: 120 };

/** How the layer moves in Play and on the exported site: one row per trigger, the same choices set_motion has. */
function MotionSection({ node, onError }: { node: Node; onError: (m: string | undefined) => void }) {
  const list = node.motion ?? [];
  const save = async (next: Motion[]) => {
    const r = await window.buni.edit("set_motion", { node: node.id, motion: next });
    onError(r.ok ? undefined : r.reply);
  };
  const change = (t: MotionTrigger, m: Motion | undefined) => void save(MOTION_TRIGGERS.flatMap((x) => (x === t ? (m ? [m] : []) : list.filter((y) => y.trigger === x))));
  const ms = (v: string) => Math.max(0, Math.min(10_000, Math.round(Number.parseFloat(v) || 0)));
  return (
    <Group title="Motion">
      {MOTION_TRIGGERS.map((t) => {
        const m = list.find((x) => x.trigger === t);
        const effects = entersOn(t) ? ENTRANCES : RESPONSES;
        return (
          <div key={t} className="motion-row">
            <div className="data-row">
              <span className="prop-name">{TRIGGER_LABEL[t]}</span>
              <Select
                title={entersOn(t) ? "How it enters" : "How it answers the pointer"}
                value={m?.effect ?? ""}
                options={[["", "Still"], ...effects.map((e): [string, string] => [e, e.replace("-", " ")])]}
                onChange={(v) => {
                  const effect = effects.find((e) => e === v);
                  change(t, effect ? { ...(m ?? { trigger: t, durationMs: EFFECT_DEFAULT_MS[t], easing: "out" }), effect } : undefined);
                }}
              />
            </div>
            {m && (
              <div className="motion-timing">
                <Num prefix="ms" title={t === "scroll" ? "How far down the scroll it plays, in ms of reading" : "Duration"} value={String(m.durationMs)} onSave={(v) => change(t, { ...m, durationMs: ms(v) })} />
                {entersOn(t) && <Num prefix="+" title="Delay, ms" value={m.delayMs === undefined ? "" : String(m.delayMs)} placeholder="0" onSave={(v) => { const { delayMs: _d, ...rest } = m; change(t, v.trim() ? { ...rest, delayMs: ms(v) } : rest); }} />}
                {entersOn(t) && <Num prefix="⋯" title="Stagger the children, ms apart" value={m.staggerMs === undefined ? "" : String(m.staggerMs)} placeholder="—" onSave={(v) => { const { staggerMs: _s, ...rest } = m; change(t, v.trim() ? { ...rest, staggerMs: ms(v) } : rest); }} />}
                <Select title="Easing" value={m.easing} options={EASINGS.map((e): [string, string] => [e, e])} onChange={(v) => { const easing = EASINGS.find((e) => e === v); if (easing) change(t, { ...m, easing }); }} />
              </div>
            )}
          </div>
        );
      })}
      <p className="hint">Plays in Play and on the exported site; the canvas shows the layer at rest.</p>
    </Group>
  );
}

function Num({ prefix, title, value, placeholder, onSave }: { prefix: string; title: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  return (
    <label className="num" title={title}>
      <span className="num-prefix">{prefix}</span>
      <Field value={value} placeholder={placeholder ?? "—"} onSave={onSave} />
    </label>
  );
}

function Select({ value, options, onChange, title }: { value: string; options: [string, string][]; onChange: (v: string) => void; title: string }) {
  const known = options.some(([v]) => v === value);
  return (
    <label className="select" title={title}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value || "—"}</option>}
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <ChevronDown size={12} className="dim" />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T | undefined; options: [T, LucideIcon, string][]; onChange: (v: T) => void }) {
  return (
    <div className="mini-seg">
      {options.map(([v, Icon, label]) => (
        <button type="button" key={v} className={v === value ? "on" : ""} title={label} aria-label={label} onClick={() => onChange(v)}><Icon size={14} /></button>
      ))}
    </div>
  );
}

/** A colour: swatch (opens the system picker), token menu, and the raw value. */
function ColorField({ doc, value, onSave }: { doc: Doc; value: string; onSave: (v: string) => void }) {
  const tokens = Object.entries(doc.tokens).filter(([, v]) => /^(#|rgb|hsl|oklch)/i.test(v.trim()));
  const token = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  return (
    <div className="color-field">
      <label className="chip-swatch big" style={{ background: value ? swatch(doc, value) : "transparent" }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(swatch(doc, value)) ? swatch(doc, value) : "#000000"} onChange={(e) => onSave(e.target.value)} />
      </label>
      {tokens.length > 0 ? (
        <Select
          title="Colour token"
          value={token ? `var(${token})` : value}
          options={[...tokens.map(([name]): [string, string] => [`var(${name})`, name.replace(/^--(color-)?/, "")]), ["", "None"]]}
          onChange={onSave}
        />
      ) : (
        <Field value={value} placeholder="none" mono onSave={onSave} />
      )}
    </div>
  );
}

function label(prop: string): string {
  return prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
}

/** Resolves a token reference for the swatch; the field still shows what is stored. */
function swatch(doc: Doc, value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => doc.tokens[name] ?? "transparent");
}

/** One text input that saves on Enter or blur and reverts on Escape. */
function Field(props: { value: string; placeholder?: string; mono?: boolean; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const save = () => {
    if (draft.trim() !== props.value) props.onSave(draft.trim());
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      setDraft(props.value);
      e.currentTarget.blur();
    }
  };
  return (
    <input
      className={`field${props.mono ? " mono" : ""}`}
      value={draft}
      placeholder={props.placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={keys}
    />
  );
}

/** The selected layer, editable. Every change is one edit through the design tools. */
const SURFACES: [TerminalScreen["surface"], string][] = [
  ["app", "Full-screen app"], ["inline", "Printed inline"], ["tmux-status", "tmux status line"], ["tmux-layout", "tmux layout"],
  ["tmux-popup", "tmux popup"], ["tmux-menu", "tmux menu"], ["zellij-plugin", "zellij plugin"], ["nvim-float", "Neovim float"],
  ["nvim-split", "Neovim split"], ["prompt", "Shell prompt"], ["picker", "Picker"],
];
const COLORS: [TerminalScreen["colors"], string][] = [["none", "No colour"], ["16", "16 colours"], ["256", "256 colours"], ["truecolor", "Full colour"]];

/** A terminal screen's surface, grid and colour, on its root frame. */
function ScreenSection({ page, onError }: { page: Page & { terminal: TerminalScreen }; onError: (m: string | undefined) => void }) {
  const t = page.terminal;
  const save = async (next: Partial<TerminalScreen>) => {
    const s = { ...t, ...next };
    // Printed inline has no height; anything else gets one back.
    const rows = s.surface === "inline" ? undefined : s.surface === "tmux-status" ? 1 : (s.rows ?? 24);
    const r = await window.buni.edit("set_screen", { page: page.id, surface: s.surface, cols: s.cols, ...(rows !== undefined ? { rows } : {}), colors: s.colors });
    onError(r.ok ? undefined : r.reply);
  };
  const cells = (v: string) => Number.parseInt(v, 10);
  return (
    <Group title="Screen">
      <Select title="Where in the terminal it shows" value={t.surface} options={SURFACES} onChange={(v) => void save({ surface: SURFACES.find(([s]) => s === v)?.[0] ?? t.surface })} />
      <div className="prop-pair">
        <label className="prop"><span className="prop-name">Cols</span><Field value={String(t.cols)} mono onSave={(v) => Number.isFinite(cells(v)) && void save({ cols: cells(v) })} /></label>
        {t.rows !== undefined && <label className="prop"><span className="prop-name">Rows</span><Field value={String(t.rows)} mono onSave={(v) => Number.isFinite(cells(v)) && void save({ rows: cells(v) })} /></label>}
      </div>
      <Select title="How much colour it is designed for" value={t.colors} options={COLORS} onChange={(v) => void save({ colors: COLORS.find(([c]) => c === v)?.[0] ?? t.colors })} />
    </Group>
  );
}

export function Inspector({ doc, node, also = [], root, preview, page, onJump, onDeleted, onSelect, onOpenComponent, onWiden, viewWidth, onViewWidth }: {
  doc: Doc;
  node: Node | undefined;
  /** More layers selected with Shift: style changes apply to them too. */
  also?: readonly Id[];
  /** Make the panel wide enough to read code. */
  onWiden?: () => void;
  /** The width the open page is shown at, when not its own; style edits then apply at that width. */
  viewWidth?: number | undefined;
  onViewWidth?: (page: Id, width: number | undefined) => void;
  /** Root frame of the page in view, for adding when nothing is selected. */
  root: Id | undefined;
  /** A graphic in view, shown at small sizes when nothing or its root frame is selected. */
  preview: { page: Id; dir: string } | undefined;
  /** The open page, summarised when no layer is selected. */
  page: Id | undefined;
  onJump: (hit: Hit) => void;
  onDeleted: () => void;
  onSelect: (id: Id) => void;
  onOpenComponent: (id: Id) => void;
}) {
  const [notice, setNotice] = useState<string>();
  // Design or Code, remembered for next time; a convenience, so a browser that won't store it just starts on Design.
  const [mode, setModeState] = useState<"design" | "code">(() => { try { return localStorage.getItem("buni.inspectorMode") === "code" ? "code" : "design"; } catch { return "design"; } });
  const setMode = (m: "design" | "code") => { setModeState(m); try { localStorage.setItem("buni.inspectorMode", m); } catch { /* not stored */ } };
  const [adding, setAdding] = useState("");
  /** Properties added by name but not given a value yet. */
  const [added, setAdded] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    setNotice(undefined);
    setAdded([]);
  }, [node?.id]);

  if (!node) {
    return (
      <div className="inspector editing">
        {page && doc.pages[page] && onViewWidth && <Widths doc={doc} page={page} viewWidth={viewWidth} onView={(w) => onViewWidth(page, w)} onError={setNotice} />}
        {page && doc.pages[page] && <PageStates doc={doc} page={page} onOpen={(id) => onJump({ kind: "page", id, title: doc.pages[id]?.name ?? id, detail: "" })} onError={setNotice} />}
        {(() => { const open = Object.values(doc.shared).find((x) => x.root === root); return open ? <ComponentVariants doc={doc} component={open.id} onOpen={onOpenComponent} onError={setNotice} /> : null; })()}
        {page && doc.pages[page] ? <PageSummary doc={doc} page={page} onJump={onJump} /> : <p className="hint">Click a layer or anything on the canvas to edit it. Add things with the bar at the bottom of the canvas.</p>}
        {notice && <div className="notice">{notice}</div>}
        {page ? <Sources key={page} doc={doc} id={page} /> : (() => { const component = Object.values(doc.shared).find((c) => c.root === root); return component ? <Sources key={component.id} doc={doc} id={component.id} /> : null; })()}
        <Tokens doc={doc} onError={setNotice} />
        {preview && <SmallSizes doc={doc} page={preview.page} dir={preview.dir} />}
      </div>
    );
  }

  const run = async (tool: EditTool, args: Record<string, unknown>) => {
    const r: EditResult = await window.buni.edit(tool, args);
    setNotice(r.ok ? undefined : r.reply);
    return r.ok;
  };
  const targets = [node.id, ...also];
  // Shown at another width, the page's layers are styled at that width: what shows is the style there.
  const atWidth = viewWidth !== undefined && page !== undefined && doc.pages[page]?.widths?.includes(viewWidth) && !componentOf(doc, node) ? viewWidth : undefined;
  const st = atWidth !== undefined ? { ...node.style, ...node.at?.[String(atWidth)] } : node.style;
  const setStyle = (prop: string, value: string) => void run("update_styles", { nodes: targets, style: { [prop]: value }, ...(atWidth !== undefined ? { width: atWidth } : {}) });
  const row = (prop: string) => {
    const value = st[prop] ?? "";
    return (
      <label key={prop} className="prop">
        <span className="prop-name">{label(prop)}</span>
        {COLOR.test(prop) && value && <span className="chip-swatch" style={{ background: swatch(doc, value) }} />}
        <Field value={value} placeholder="—" mono onSave={(v) => setStyle(prop, v)} />
      </label>
    );
  };
  const source = componentOf(doc, node);
  const onPage = !source && node.parent !== undefined && node.kind !== "instance";
  const extra = [...new Set([...Object.keys(st), ...added])].filter((p) => !TYPED.has(p)).sort();
  const fonts = [...new Set([...FONTS, ...Object.values(doc.nodes).flatMap((n) => (n.style.fontFamily ? [n.style.fontFamily] : [])), ...Object.keys(doc.tokens).filter((k) => /font/i.test(k)).map((k) => `var(${k})`)])];
  const parent = node.parent ? doc.nodes[node.parent] : undefined;
  const KindIcon = KIND_ICON[node.kind];
  const isFrame = node.kind === "frame";

  // Where the layer sits, from the page down; each step selects that layer.
  const trail: Node[] = [];
  for (let n = parent; n; n = n.parent ? doc.nodes[n.parent] : undefined) trail.unshift(n);
  const head = (
    <>
      {trail.length > 0 && (
        <nav className="crumbs" aria-label="Where this layer is">
          {trail.map((n) => (
            <Fragment key={n.id}><button type="button" onClick={() => onSelect(n.id)}>{n.name}</button><ChevronRight size={11} /></Fragment>
          ))}
        </nav>
      )}
      <div className="layer-head">
        <span className="layer-icon"><KindIcon size={15} /></span>
        <div className="layer-who">
          <b>{node.name}</b>
          <span>{node.kind === "text" ? "Text" : node.kind === "frame" ? "Frame" : node.kind === "instance" ? "Component use" : node.kind === "svg" ? "SVG" : "Image"}{node.tag ? ` · ${node.tag}` : ""}{parent ? ` · in ${parent.name}` : ""}</span>
        </div>
      </div>
      <div className="mode-tabs" role="tablist" aria-label="Edit as">
        {(["design", "code"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "design" ? "Design" : "Code"}</button>
        ))}
      </div>
    </>
  );
  if (mode === "code") {
    return (
      <div className="inspector editing">
        {head}
        <CodeView doc={doc} target={{ kind: "layer", node: node.id }} {...(onWiden ? { onWiden } : {})} />
      </div>
    );
  }
  return (
    <div className="inspector editing">
      {head}
      {atWidth !== undefined && (
        <div className="notice at-width">
          Styling at <b>{atWidth} px</b>: changes hold at this width and {atWidth < Number.parseInt(doc.nodes[doc.pages[page ?? ""]?.frame ?? ""]?.style.width ?? "1440", 10) ? "narrower" : "wider"}; the rest stays as it is.
          {node.at?.[String(atWidth)] && <button type="button" className="link-btn" onClick={() => void run("update_styles", { nodes: targets, width: atWidth, style: Object.fromEntries(Object.keys(node.at?.[String(atWidth)] ?? {}).map((k) => [k, ""])) })}>Clear {atWidth} px changes</button>}
        </div>
      )}
      {(() => {
        // A screen's layer carries its states along; a state's layer is its own.
        const twins = Object.values(doc.nodes).filter((n) => n.twin === node.id).length;
        const screen = node.twin ? doc.nodes[node.twin] : undefined;
        if (twins > 0) return <p className="hint twin-note">Style changes here reach the same layer in {twins} state{twins === 1 ? "" : "s"}.</p>;
        if (screen) return <p className="hint twin-note">A state's copy of {screen.name}: changes here stay in this state. <button type="button" className="link-btn" onClick={() => {
          let top = screen;
          while (top.parent && doc.nodes[top.parent]) top = doc.nodes[top.parent] ?? top;
          const on = Object.values(doc.pages).find((pg) => pg.frame === top.id);
          if (on) onJump({ kind: "layer", id: screen.id, page: on.id, title: screen.name, detail: on.name });
        }}>Edit it on the screen</button></p>;
        return null;
      })()}
      {also.length > 0 && <div className="notice">{also.length + 1} layers selected: style changes apply to all of them. Shift-click one to leave it out.</div>}
      {notice && <div className="notice">{notice}</div>}
      <Sources key={node.id} doc={doc} id={source?.root === node.id ? source.id : node.id} inherited={node.kind === "instance" ? doc.shared[node.shared] : undefined} />
      {source && <ComponentVariants doc={doc} component={source.id} onOpen={onOpenComponent} onError={setNotice} />}
      {source && (
        <div className="notice component-note">
          Part of the <b>{source.name}</b> component. Changes here show in all {usesOf(doc, source.id)} uses.
        </div>
      )}
      {preview && node.id === root && <SmallSizes doc={doc} page={preview.page} dir={preview.dir} />}
      {node.kind === "instance" && <InstanceSection doc={doc} node={node} onOpen={onOpenComponent} onError={setNotice} onSelect={onSelect} atWidth={atWidth} />}
      {(() => {
        const screen = Object.values(doc.pages).find((p) => p.frame === node.id);
        return screen?.terminal ? <ScreenSection page={{ ...screen, terminal: screen.terminal }} onError={setNotice} /> : null;
      })()}
      {node.kind === "text" && (
        <Group title="Text">
          <textarea
            key={`${node.id}:${node.text}`}
            className="field text"
            aria-label="Text content"
            defaultValue={node.text}
            rows={Math.min(8, Math.max(2, Math.ceil(node.text.length / 34)))}
            onBlur={(e) => {
              if (e.target.value !== node.text && e.target.value.trim()) void run("set_text", { node: node.id, text: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
            }}
          />
        </Group>
      )}
      {node.kind === "svg" && (
        <Group title="Markup">
          <textarea
            key={`${node.id}:${node.markup}`}
            className="field text markup"
            spellCheck={false}
            defaultValue={node.markup}
            rows={Math.min(14, Math.max(4, Math.ceil(node.markup.length / 40)))}
            onBlur={(e) => {
              if (e.target.value !== node.markup && e.target.value.trim()) void run("set_svg", { node: node.id, markup: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
            }}
          />
        </Group>
      )}
      {(node.kind === "text" || isFrame) && (
        <Group title="Typography">
          <div className="prow">
            <Select title="Font" value={st.fontFamily ?? ""} options={[["", "Inherit"], ...fonts.map((f): [string, string] => [f, f.replace(/var\(--([\w-]+)\)/, "$1").split(",")[0]?.replace(/"/g, "") ?? f])]} onChange={(v) => setStyle("fontFamily", v)} />
            <Select title="Weight" value={st.fontWeight ?? ""} options={[["", "Weight"], ...WEIGHTS]} onChange={(v) => setStyle("fontWeight", v)} />
          </div>
          <div className="prow">
            <Num prefix="Aa" title="Font size" value={st.fontSize ?? ""} onSave={(v) => setStyle("fontSize", v)} />
            <Num prefix="↕" title="Line height" value={st.lineHeight ?? ""} onSave={(v) => setStyle("lineHeight", v)} />
            <Num prefix="↔" title="Letter spacing" value={st.letterSpacing ?? ""} onSave={(v) => setStyle("letterSpacing", v)} />
          </div>
          <div className="prow">
            <Segmented value={st.textAlign} options={[["left", AlignLeft, "Left"], ["center", AlignCenter, "Centre"], ["right", AlignRight, "Right"], ["justify", AlignJustify, "Justify"]]} onChange={(v) => setStyle("textAlign", v)} />
            <ColorField doc={doc} value={st.color ?? ""} onSave={(v) => setStyle("color", v)} />
          </div>
        </Group>
      )}
      {isFrame && (
        <Group title="Layout">
          <div className="prow">
            <Segmented
              value={st.display === "grid" ? "grid" : st.display === "flex" || st.display === "inline-flex" ? (st.flexDirection === "column" ? "column" : "row") : undefined}
              options={[["row", ArrowRight, "Row"], ["column", ArrowDown, "Column"], ["grid", LayoutGrid, "Grid"]]}
              onChange={(v) => void run("update_styles", {
                nodes: targets,
                ...(atWidth !== undefined ? { width: atWidth } : {}),
                style: v === "grid"
                  ? { display: "grid", flexDirection: "", gridTemplateColumns: st.gridTemplateColumns || "repeat(2, minmax(0, 1fr))" }
                  : { display: "flex", flexDirection: v, gridTemplateColumns: "" },
              })}
            />
            <Num prefix="Gap" title="Gap between children" value={st.gap ?? ""} onSave={(v) => setStyle("gap", v)} />
          </div>
          {st.display === "grid" && (
            <div className="prow">
              <Num prefix="Cols" title="Columns: a number for equal ones, or any grid-template-columns" value={st.gridTemplateColumns?.match(/^repeat\((\d+), minmax\(0, 1fr\)\)$/)?.[1] ?? st.gridTemplateColumns ?? ""}
                onSave={(v) => setStyle("gridTemplateColumns", /^\d+$/.test(v) ? `repeat(${v}, minmax(0, 1fr))` : v)} />
            </div>
          )}
          <div className="prow">
            <Num prefix="Pad" title="Padding" value={st.padding ?? ""} onSave={(v) => setStyle("padding", v)} />
          </div>
          <div className="prow">
            <Select title="Align children" value={st.alignItems ?? ""} options={[["", "Align"], ["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["stretch", "Stretch"], ["baseline", "Baseline"]]} onChange={(v) => setStyle("alignItems", v)} />
            <Select title="Distribute children" value={st.justifyContent ?? ""} options={[["", "Justify"], ["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["space-between", "Space between"]]} onChange={(v) => setStyle("justifyContent", v)} />
          </div>
        </Group>
      )}
      <Group title="Size">
        <div className="prow">
          <Num prefix="W" title="Width: a size, 100% to fill, empty to hug" value={st.width ?? ""} placeholder="Hug" onSave={(v) => setStyle("width", v)} />
          <Num prefix="H" title="Height: a size, empty to hug" value={st.height ?? ""} placeholder="Hug" onSave={(v) => setStyle("height", v)} />
        </div>
        <div className="prow">
          <Num prefix="Max W" title="Maximum width" value={st.maxWidth ?? ""} onSave={(v) => setStyle("maxWidth", v)} />
          <Num prefix="Min H" title="Minimum height" value={st.minHeight ?? ""} onSave={(v) => setStyle("minHeight", v)} />
        </div>
      </Group>
      <Group title="Fill and shape">
        <div className="prow"><ColorField doc={doc} value={st.background ?? st.backgroundColor ?? ""} onSave={(v) => setStyle(st.background === undefined && st.backgroundColor !== undefined ? "backgroundColor" : "background", v)} /></div>
        <div className="prow">
          <Num prefix="◜" title="Corner radius" value={st.borderRadius ?? ""} onSave={(v) => setStyle("borderRadius", v)} />
          <Num prefix="α" title="Opacity, 0 to 1" value={st.opacity ?? ""} onSave={(v) => setStyle("opacity", v)} />
        </div>
        <div className="prow"><Num prefix="Border" title="Border, e.g. 1px solid var(--rule)" value={st.border ?? ""} onSave={(v) => setStyle("border", v)} /></div>
        <div className="prow">
          <Select title="Shadow" value={st.boxShadow ?? ""} options={SHADOWS} onChange={(v) => setStyle("boxShadow", v)} />
        </div>
      </Group>
      {/* What a layer is and looks like comes first; what it shows, how it moves and what people said about it after. */}
      <DataSection doc={doc} node={node} onError={setNotice} />
      <MotionSection node={node} onError={setNotice} />
      <Comments doc={doc} node={node} onError={setNotice} />
      <section className="group">
        <button type="button" className="group-title toggle" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Advanced CSS{extra.length ? ` · ${extra.length}` : ""}
        </button>
        {advanced && extra.map(row)}
        {advanced && <div className="prop add">
          <Plus size={13} />
          <input className="field mono" placeholder="property, e.g. border-left" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter" && adding.trim()) {
              const prop = adding.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
              setAdding("");
              setAdded((a) => [...a, prop]);
            }
          }} />
        </div>}
      </section>
      {onPage && (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const r = await window.buni.edit("make_component", { node: node.id });
            const inst = r.reply.match(/instance (\S+) is/)?.[1];
            if (r.ok && inst) onSelect(inst);
            setNotice(r.ok ? undefined : r.reply);
          }}
        >
          <Component size={13} /> Make component
        </button>
      )}
      <button
        type="button"
        className="btn danger"
        onClick={async () => {
          if (await run("delete_nodes", { nodes: targets })) onDeleted();
        }}
      >
        <Trash2 size={13} /> Delete layer
      </button>
    </div>
  );
}
