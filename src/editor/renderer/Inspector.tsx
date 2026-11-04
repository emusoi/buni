import { Sources } from "./Sources.tsx";
import { Fragment, createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Code2, TextCursorInput, AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight, ChevronDown, ChevronRight, Component, Heading, Image, LayoutGrid, MousePointerClick, Plus, Square, Trash2, Type, type LucideIcon } from "lucide-react";
import { EASINGS, ENTRANCES, isUseLink, optionsOf, pageVersionsOf, pageName, pagesInOrder, type Transition, MOTION_TRIGGERS, RESPONSES, entersOn, pickVariant, setOf, variantProperties, childrenOf, type Doc, type Motion, type MotionTrigger, type Id, type InstanceNode, type Node, type Page, type SharedSection, type TerminalScreen } from "buni/format/doc.ts";
import type { EditResult, EditTool } from "../api.ts";
import { PageSummary } from "./PageSummary.tsx";
import type { Hit } from "./search.ts";
import { useProject } from "./projectStore.ts";
import { NameDialog } from "./Ask.tsx";
import { OwnersContext } from "./owners.ts";
import { SmallSizes } from "./SmallSizes.tsx";
import { Tokens } from "./Tokens.tsx";
import { ago } from "./Home.tsx";
import { curvePoints, motionSentence } from "./moments.ts";
import { EASE } from "buni/tools/html.ts";
import { Widths } from "./Widths.tsx";
import { ComponentVariants, PageStates } from "./Variants.tsx";
import { CodeView } from "./CodeView.tsx";
import { Comments } from "./Comments.tsx";
import { placeImage } from "./images.ts";
import { ImagePicker } from "./ImagePicker.tsx";

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
const TRANSITIONS: [Transition, string][] = [["none", "Appears at once"], ["fade", "Fades in"], ["slide-left", "Slides in from the right"], ["slide-right", "Slides in from the left"]];

/** A text layer the insert bar just added, whose text the person types next. */
let typeNext: Id | undefined;

const ADD: { label: string; icon: LucideIcon; html: string }[] = [
  { label: "Heading", icon: Heading, html: '<h2 style="margin:0;font-size:36px;line-height:1.15;font-weight:700">Heading</h2>' },
  { label: "Text", icon: Type, html: '<p style="margin:0;font-size:18px;line-height:1.5">Write something here.</p>' },
  { label: "Box", icon: Square, html: '<div layer-name="Box" style="padding:24px;min-height:120px;background:#EDEDE9;border-radius:4px"></div>' },
  { label: "Row", icon: LayoutGrid, html: '<div layer-name="Row" style="display:flex;gap:24px;padding:24px;min-height:80px"></div>' },
  { label: "Field", icon: TextCursorInput, html: '<label layer-name="Field" style="display:flex;flex-direction:column;gap:6px;max-width:480px;font-size:14px;font-weight:600">Label<input placeholder="Type here" style="padding:12px 14px;border:1px solid #CFCBBF;border-radius:6px;background:#fff;font-size:15px;font-weight:400"></label>' },
  { label: "Button", icon: MousePointerClick, html: '<a layer-name="Button" style="display:inline-block;padding:12px 20px;background:#16140F;color:#fff;border-radius:4px;font-family:-apple-system, sans-serif;font-size:14px;font-weight:600;text-decoration:none">Button</a>' },
  { label: "Image", icon: Image, html: '<div layer-name="Image" style="aspect-ratio:16/9;background:linear-gradient(160deg, #C9C4B8, #8F897C)"></div>' },
];

/** Where a new layer goes: inside a selected container, after any other selected layer, else at the end of the page. */
function target(node: Node | undefined, root: Id | undefined, beside = false): { parent: Id; after?: Id } | undefined {
  if (!node) return root ? { parent: root } : undefined;
  if (node.kind === "frame" && !(beside && node.parent)) return { parent: node.id };
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
function textsOf(doc: Doc, root: Id): { key: string; name: string; text: string }[] {
  const out: { key: string; name: string; text: string }[] = [];
  // Into a use of another component too (a card's button): its texts are overridden by path, "use/layer", and read as
  // that use already shows them.
  const visit = (n: Node, prefix: string, outer: InstanceNode | undefined, depth: number) => {
    if (n.kind === "text") out.push({ key: `${prefix}${n.id}`, name: n.name, text: outer?.overrides[n.id]?.text ?? n.text });
    if (n.kind === "instance" && depth < 4) {
      const inner = doc.nodes[doc.shared[n.shared]?.root ?? ""];
      if (inner) visit(inner, `${prefix}${n.id}/`, n, depth + 1);
    }
    for (const c of childrenOf(doc, n.id)) visit(c, prefix, outer, depth);
  };
  const r = doc.nodes[root];
  if (r) visit(r, "", undefined, 0);
  return out;
}

/** The page a node is on, if any. */
function pageOfNodeIn(doc: Doc, id: Id): Id | undefined {
  let n = doc.nodes[id];
  while (n?.parent) n = doc.nodes[n.parent];
  return n ? Object.values(doc.pages).find((p) => p.frame === n?.id)?.id : undefined;
}

/**
 * Where clicking a layer goes: a page here, or one of a file this one imports. On a component's layer the link holds
 * on every page that uses it (a nav item); off, it goes nowhere.
 */
/** Pages a link may go to: this design's, the ones it imports, then the rest of the project's (imported when picked). */
function useLinkTargets(doc: Doc) {
  const owners = useContext(OwnersContext);
  const path = useContext(OpenFile);
  // The project's other designs, read once a layer here is selected: any of their pages can be linked to.
  const project = useProject(path).filter((f) => f.path !== path);
  const away = new Map<string, { id: Id; name: string; route?: string | undefined; file?: string }[]>();
  const add = (file: string, p: { id: Id; name: string; route?: string | undefined }, imports?: string) => { if (!doc.pages[p.id] && !(away.get(file) ?? []).some((x) => x.id === p.id)) away.set(file, [...(away.get(file) ?? []), { ...p, ...(imports ? { file: imports } : {}) }]); };
  for (const p of Object.values(doc.elsewhere ?? {})) add(owners[p.id] ?? "another file", p);
  for (const f of project) for (const p of f.pages) if (p.route !== undefined && !doc.elsewhere?.[p.id]) add(`${f.name}.buni`, p, `${f.name}.buni`);
  return { here: pagesInOrder(doc).filter((p) => p.route !== undefined), away, owners };
}

/**
 * Where clicking `node` goes, picked from the project's pages. A component's layer links on every page of this design
 * that uses it; `page` is where its current link is read (the page a use was selected on).
 */
function LinkPicker({ doc, node, page, onError }: { doc: Doc; node: Id; page?: Id | undefined; onError: (m: string | undefined) => void }) {
  const { here, away } = useLinkTargets(doc);
  const links = Object.values(doc.connections).filter((c) => c.node === node && (page === undefined || c.page === page) && c.trigger === "click" && !c.condition);
  const to = links[0]?.to ?? "";
  if (here.length + away.size === 0) return null;
  const set = async (target: Id, transition: Transition = links[0]?.transition ?? "none") => {
    const file = [...away.values()].flat().find((p) => p.id === target)?.file;
    if (file) {
      const r = await window.buni.edit("import_file", { path: file });
      if (!r.ok) return onError(r.reply);
    }
    const r = target
      ? await window.buni.edit("connect", { node, ...(page && doc.shared[page] ? { page } : {}), to: target, trigger: "click", transition, durationMs: transition === "none" ? 0 : 250 })
      : await unlink();
    onError(r.ok ? undefined : r.reply);
  };
  // Unlinked as it was linked: on every page that uses it, or on every use; a link drawn from an every-use one isn't
  // this design's to remove.
  const unlink = () => {
    const all = Object.values(doc.connections).filter((c) => c.node === node && (page && doc.shared[page] ? c.page === page : !doc.shared[c.page]) && !isUseLink(c.id) && c.trigger === "click" && !c.condition).map((c) => c.id);
    return all.length ? window.buni.edit("disconnect", { connections: all }) : Promise.resolve({ ok: true, reply: "" });
  };
  const name = (p: { name: string; route?: string | undefined }) => `${p.name}${p.route ? ` · ${p.route}` : ""}`;
  return (
    <>
      <label className="select" title="Where clicking it goes, in Play and on the exported site">
        <select value={to} onChange={(e) => void set(e.target.value)} aria-label="Links to">
          <option value="">Goes nowhere</option>
          {/* A link to a page no longer listed (a graphic, say) still shows where it goes. */}
          {to && !here.some((p) => p.id === to) && ![...away.values()].flat().some((p) => p.id === to) && <option value={to}>{pageName(doc, to)}</option>}
          <optgroup label="This design">{here.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}</optgroup>
          {[...away].map(([file, pages]) => <optgroup key={file} label={file}>{pages.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}</optgroup>)}
        </select>
      </label>
      {links[0] && isUseLink(links[0].id) && <span className="hint">As on every use of its component; picking here sets this design's own.</span>}
      {/* How the next page comes in, in Play: the canvas shows only where it goes. */}
      {to && (
        <label className="select" title="How the page it opens comes in, in Play">
          <select value={links[0]?.transition ?? "none"} onChange={(e) => { const t = TRANSITIONS.find(([v]) => v === e.target.value)?.[0]; if (t) void set(to, t); }} aria-label="Transition">
            {TRANSITIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

/** Where clicking a layer goes; a page's own frame is the page, and a core file's layers are linked from their uses. */
function LinkSection({ doc, node, onError }: { doc: Doc; node: Node; onError: (m: string | undefined) => void }) {
  const owners = useContext(OwnersContext);
  const component = componentOf(doc, node);
  if (node.parent === undefined || owners[component?.id ?? ""] !== undefined) return null;
  // A component's layer links on every use of it: here, and in the designs that build on this one (a core's nav).
  return (
    <Group title={component ? "Link on every use" : "Link"} empty={!Object.values(doc.connections).some((c) => c.node === node.id)} summary={Object.values(doc.connections).some((c) => c.node === node.id) ? undefined : "None"}>
      <LinkPicker doc={doc} node={node.id} page={component?.id} onError={onError} />
    </Group>
  );
}

/** The layers of a use that can be clicked (its texts and the buttons in it), each linked on this page alone. */
function UseLinks({ doc, use, onError }: { doc: Doc; use: InstanceNode; onError: (m: string | undefined) => void }) {
  const page = pageOfNodeIn(doc, use.id);
  const root = doc.nodes[doc.shared[use.shared]?.root ?? ""];
  if (!page || !root) return null;
  // Not into the components it holds: a button inside a nav is one thing to click.
  const out: Node[] = [];
  const walk = (n: Node) => {
    if (n.kind === "text" || n.kind === "instance" || n.tag === "a" || n.tag === "button") return void out.push(n);
    for (const c of childrenOf(doc, n.id)) walk(c);
  };
  walk(root);
  if (!out.length) return null;
  return (
    <>
      <div className="group-title sub">Links in this use<span className="hint"> · on every page here that uses it</span></div>
      {out.map((n) => (
        <div key={n.id} className="prop stacked">
          <span className="prop-name">{n.kind === "instance" ? doc.shared[n.shared]?.name ?? n.name : n.name}</span>
          <LinkPicker doc={doc} node={n.id} page={page} onError={onError} />
        </div>
      ))}
    </>
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
        const source = t.text;
        const own = node.overrides[t.key]?.text;
        return (
          <label key={t.key} className="prop stacked">
            <span className="prop-name">{t.name}{own !== undefined && <span className="overridden"> · changed</span>}</span>
            <Field
              value={own ?? source}
              onSave={(v) => void (v === source || v === "" ? run({ node: t.key, reset: true }) : run({ node: t.key, text: v }))}
            />
          </label>
        );
      })}
      {Object.keys(node.overrides).length > 0 && (
        <button type="button" className="link-btn" onClick={() => void Promise.all(Object.keys(node.overrides).map((id) => run({ node: id, reset: true })))}>
          Reset all changes
        </button>
      )}
      <UseLinks doc={doc} use={node} onError={onError} />
    </section>
  );
}

/** The canvas toolbar: adds a layer inside the selected frame, after any other selected layer, or to the page. */
export function InsertBar({ doc, node, root, onAdded, onError }: { doc: Doc; node: Node | undefined; root: Id | undefined; onAdded: (id: Id) => void; onError: (m: string) => void }) {
  // A frame takes the next layer inside it, or after it once that's asked for; the choice is per selection.
  const [beside, setBeside] = useState<Id>();
  const after = node !== undefined && beside === node.id;
  const at = target(node, root, after);
  const [writing, setWriting] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  if (!at) return null;
  // Said as a sentence, so it's plain where the next layer lands.
  const where = !node ? "Adds to the end of the page" : node.kind === "frame" && !after ? `Adds inside ${node.name}` : `Adds after ${node.name}`;
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
              const made = r.reply.match(/Created \d+ nodes?: ([^.]+)/)?.[1]?.split(/,\s*/) ?? [];
              // Text just added is typed next: its field opens focused, the placeholder selected. A field's label is its
              // text (Shift+Enter then selects the whole field, and ⌘D makes the next).
              const id = a.label === "Field" ? made[1] : made[0];
              if (r.ok && id && (a.label === "Heading" || a.label === "Text" || a.label === "Field")) typeNext = id;
              if (r.ok && id) onAdded(id);
              else if (!r.ok) onError(r.reply);
            }}
          >
            <a.icon size={15} strokeWidth={1.75} />
            <span>{a.label}</span>
          </button>
        ))}
      {node?.kind === "frame" && node.parent
        ? <button type="button" className="insert-where" title="Switch between inside it and after it" onClick={() => setBeside(after ? undefined : node.id)}>{where} ⇄</button>
        : <span className="insert-where">{where}</span>}
    </div>
  );
}

/**
 * A titled group of fields; its title folds it, and the fold is remembered by title across layers and launches.
 * Folded, it still says in a line what it holds (`summary`), so a panel of folded groups reads at a glance.
 */
function Group({ title, summary, empty = false, children }: { title: string; summary?: string; empty?: boolean; children: ReactNode }) {
  const key = `buni.fold.${title}`;
  // Folded by choice, remembered; otherwise a group with nothing set starts folded, its summary saying so.
  const [shut, setShut] = useState(() => {
    try {
      const kept = localStorage.getItem(key);
      return kept === null ? empty : kept === "1";
    } catch {
      return empty;
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
        {shut ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="group-name">{title}</span>
        {shut && summary && <span className="group-summary">{summary}</span>}
      </button>
      {!shut && children}
    </section>
  );
}

const COLOR = /^(color|background|border)/;
/** A style value said briefly: a token by its name, a font by its first family. */
const short = (v: string | undefined) => v?.replace(/var\(--([\w-]+)\)/g, "$1").split(",")[0]?.replace(/"/g, "").trim();
const KIND_ICON: Record<Node["kind"], LucideIcon> = { frame: Square, text: Type, image: Image, svg: Component, instance: Component };

const TRIGGER_LABEL: Record<MotionTrigger, string> = { load: "Load", scroll: "Scroll", hover: "Hover", press: "Press" };
const EFFECT_DEFAULT_MS: Record<MotionTrigger, number> = { load: 700, scroll: 600, hover: 150, press: 120 };
const EFFECT_LABEL: Record<string, string> = { "slide-left": "Slide ←", "slide-right": "Slide →" };

/** The curve drawn small: a cubic-bezier from the bottom-left to the top-right of its box. */
function Curve({ motion }: { motion: Motion }) {
  const [a, b, c, d] = curvePoints(motion);
  const w = 72, h = 44, pad = 4;
  const x = (v: number) => pad + v * (w - 2 * pad);
  const y = (v: number) => h - pad - v * (h - 2 * pad);
  return (
    <svg className="motion-curve" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`M${x(0)} ${y(0)}H${x(1)}`} className="axis" />
      <path d={`M${x(0)} ${y(0)}C${x(a)} ${y(b)} ${x(c)} ${y(d)} ${x(1)} ${y(1)}`} className="line" />
    </svg>
  );
}

/**
 * How the layer moves in Play and on the exported site: one trigger at a time, its motion read as a sentence, the
 * same choices set_motion has. The canvas shows the layer at rest; the Moments strip under it shows the timing.
 */
function MotionSection({ node, onError }: { node: Node; onError: (m: string | undefined) => void }) {
  const list = node.motion ?? [];
  const [trigger, setTrigger] = useState<MotionTrigger>(() => list[0]?.trigger ?? "load");
  const m = list.find((x) => x.trigger === trigger);
  const effects = entersOn(trigger) ? ENTRANCES : RESPONSES;
  const save = async (next: Motion[]) => {
    const r = await window.buni.edit("set_motion", { node: node.id, motion: next });
    onError(r.ok ? undefined : r.reply);
  };
  const change = (next: Motion | undefined) => void save(MOTION_TRIGGERS.flatMap((x) => (x === trigger ? (next ? [next] : []) : list.filter((y) => y.trigger === x))));
  const ms = (v: string) => Math.max(0, Math.min(10_000, Math.round(Number.parseFloat(v) || 0)));
  return (
    <Group title="Motion" empty={!list.length} summary={list.length ? list.map((x) => motionSentence(x)).join(" ") : "Still"}>
      <p className={`motion-sentence${m ? "" : " still"}`}>{m ? motionSentence(m) : `${entersOn(trigger) ? "Enters" : "Answers"} as it is: pick how it ${entersOn(trigger) ? "enters" : "responds"}.`}</p>
      <div className="segmented motion-triggers" role="tablist">
        {MOTION_TRIGGERS.map((t) => (
          <button type="button" key={t} role="tab" aria-selected={t === trigger} className={t === trigger ? "on" : ""} onClick={() => setTrigger(t)}>
            {TRIGGER_LABEL[t]}{list.some((x) => x.trigger === t) && <span className="motion-dot" aria-label="has motion" />}
          </button>
        ))}
      </div>
      <div className="chips motion-effects">
        {effects.map((e) => (
          <button type="button" key={e} className={`chip-btn${m?.effect === e ? " on" : ""}`} aria-pressed={m?.effect === e}
            onClick={() => change(m?.effect === e ? undefined : { ...(m ?? { trigger, durationMs: EFFECT_DEFAULT_MS[trigger], easing: "out" }), effect: e })}>
            {EFFECT_LABEL[e] ?? e[0]?.toUpperCase() + e.slice(1)}
          </button>
        ))}
      </div>
      {m && (
        <>
          <div className="motion-rows">
            <div className="motion-row"><span className="prop-name">{trigger === "scroll" ? "Reads over" : "Duration"}</span><Num prefix="ms" title={trigger === "scroll" ? "How far down the scroll it plays, in ms of reading" : "Duration"} value={String(m.durationMs)} onSave={(v) => change({ ...m, durationMs: ms(v) })} /></div>
            <div className="motion-row"><span className="prop-name">Easing</span><Select title="Easing" value={m.easing} options={EASINGS.map((e): [string, string] => [e, e])} onChange={(v) => { const easing = EASINGS.find((e) => e === v); if (easing) { const { curve: _c, ...rest } = m; change({ ...rest, easing }); } }} /></div>
            {entersOn(trigger) && <div className="motion-row"><span className="prop-name">Delay</span><Num prefix="ms" title="Delay before it starts" value={m.delayMs === undefined ? "" : String(m.delayMs)} placeholder="0" onSave={(v) => { const { delayMs: _d, ...rest } = m; change(v.trim() ? { ...rest, delayMs: ms(v) } : rest); }} /></div>}
            {entersOn(trigger) && <div className="motion-row"><span className="prop-name">Children one by one</span><Num prefix="ms" title="The children enter one after another, this far apart" value={m.staggerMs === undefined ? "" : String(m.staggerMs)} placeholder="Off" onSave={(v) => { const { staggerMs: _s, ...rest } = m; change(v.trim() ? { ...rest, staggerMs: ms(v) } : rest); }} /></div>}
          </div>
          <div className="motion-curve-row"><Curve motion={m} /><span className="mono dim">{m.curve ?? EASE[m.easing]}</span></div>
        </>
      )}
      <p className="hint">People who ask for less motion see the layer at rest. One motion per trigger; what this can’t say goes in a comment on the layer.</p>
    </Group>
  );
}

/**
 * A mesh gradient from the design's colours: soft radial washes of the accent, its tint and a surface over the
 * background, as the "mesh" fills design tools offer; plain CSS, so it exports as it draws.
 */
export function meshFill(doc: Doc): string {
  const names = Object.keys(doc.tokens);
  const pick = (want: RegExp, fallback: string) => { const n = names.find((t) => want.test(t)); return n ? `var(${n})` : fallback; };
  const accent = pick(/accent$|primary$|brand$/, "#5b6cf0");
  const tint = pick(/accent-tint|tint|accent-2|secondary/, "#c7d2fe");
  const surface = pick(/surface|warm|muted/, "#fde68a");
  const base = pick(/^--bg$|background|paper/, "#ffffff");
  return `radial-gradient(at 18% 22%, ${tint} 0, transparent 55%), radial-gradient(at 82% 12%, ${accent} 0, transparent 50%), radial-gradient(at 58% 92%, ${surface} 0, transparent 58%), ${base}`;
}

/** A border-radius shorthand as its four corners, clockwise from top-left. */
export function cornerRadii(shorthand: string): [string, string, string, string] {
  const [a = "0", b, c, d] = shorthand.trim().split("/")[0]?.split(/\s+/).filter(Boolean) ?? [];
  return [a, b ?? a, c ?? a, d ?? b ?? a];
}

/** Four corners as the shortest shorthand that means them. */
export function radiusShorthand([tl, tr, br, bl]: [string, string, string, string]): string {
  if (tl === tr && tr === br && br === bl) return tl;
  if (tl === br && tr === bl) return `${tl} ${tr}`;
  if (tr === bl) return `${tl} ${tr} ${br}`;
  return `${tl} ${tr} ${br} ${bl}`;
}

/** `transform` with its rotation set to `deg` (none when blank), other functions kept. */
export function withRotation(transform: string, deg: string): string {
  const rest = transform.replace(/rotate\([^)]*\)/g, "").trim().replace(/\s+/g, " ");
  const n = deg.trim();
  return [rest, n && n !== "0" ? `rotate(${n}deg)` : ""].filter(Boolean).join(" ");
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
    <label className={`select${value ? "" : " unset"}`} title={title}>
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

/** "name@version" or a CDN URL as a library: jsdelivr serves a package by name and version. */
export function libraryFrom(text: string): { name: string; url: string } | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (/^https?:\/\//.test(t)) return { name: t.replace(/^https?:\/\/[^/]+\/(npm\/|ajax\/libs\/)?/, "").split(/[@/?]/).find(Boolean) ?? t, url: t };
  const at = t.lastIndexOf("@");
  if (at <= 0) return undefined;
  const name = t.slice(0, at), version = t.slice(at + 1);
  if (!name || !version || /\s/.test(t)) return undefined;
  return { name, url: `https://cdn.jsdelivr.net/npm/${name}@${version}` };
}

/** One of a live page's own files: its text, edited in place and written back with write_file. */
function LiveFile({ doc, page, kind, dir, onError }: { doc: Doc; page: Id; kind: "css" | "js"; dir: string | undefined; onError: (m: string | undefined) => void }) {
  const id = doc.pages[page]?.live?.[kind];
  const path = id === undefined ? undefined : doc.attachments[id]?.path;
  const [text, setText] = useState<string>();
  const [draft, setDraft] = useState<string>();
  useEffect(() => {
    setDraft(undefined);
    if (!path || dir === undefined) { setText(""); return; }
    let gone = false;
    fetch(`${window.buni.assetBase ?? "file://"}${dir.split("/").map(encodeURIComponent).join("/")}/${path}?v=${Date.now()}`).then((r) => (r.ok ? r.text() : "")).then((t) => { if (!gone) setText(t); }, () => { if (!gone) setText(""); });
    return () => { gone = true; };
  }, [path, dir, id]);
  const shown = draft ?? text ?? "";
  const save = async () => {
    const r = await window.buni.edit("write_file", { page, kind, text: shown });
    onError(r.ok ? undefined : r.reply);
    if (r.ok) { setText(shown); setDraft(undefined); }
  };
  return (
    <div className="live-file">
      <div className="live-file-head"><span className="mono">{path ?? `live/${page}.${kind}`}</span>{draft !== undefined && draft !== text && <button type="button" className="link-btn" onClick={() => void save()}>Save</button>}</div>
      <textarea className="mono" spellCheck={false} rows={Math.min(14, Math.max(3, shown.split("\n").length))} value={shown} placeholder={kind === "css" ? ".b-ID { … }  or your classes" : 'import { animate } from "motion"; …'} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== undefined && draft !== text) void save(); }} />
    </div>
  );
}

/** A page made live: scripts run in its preview, with libraries from a pinned CDN and a stylesheet and script of its own. */
function LiveSection({ doc, page, dir, onError }: { doc: Doc; page: Id; dir: string | undefined; onError: (m: string | undefined) => void }) {
  const live = doc.pages[page]?.live;
  const [adding, setAdding] = useState("");
  const call = async (tool: EditTool, args: Record<string, unknown>) => {
    const r = await window.buni.edit(tool, args);
    onError(r.ok ? undefined : r.reply);
    return r.ok;
  };
  const libraries = live?.libraries ?? [];
  return (
    <Group title="Live page" empty={!live} summary={live ? `scripts run · ${libraries.length} ${libraries.length === 1 ? "library" : "libraries"}` : "Still"}>
      <label className="switch-label">
        <input type="checkbox" checked={Boolean(live)} onChange={(e) => void call("set_live", { page, live: e.target.checked })} />
        Scripts run on the canvas
      </label>
      {live && (
        <>
          <div className="group-title sub">Libraries</div>
          {libraries.map((l, i) => (
            <div className="live-lib" key={l.url}>
              <span className="mono name" title={l.url}>{l.name}</span>
              <span className="mono dim">{l.url.replace(/^https:\/\//, "").split("/")[0]}</span>
              <button type="button" className="icon-btn small" aria-label={`Remove ${l.name}`} onClick={() => void call("set_live", { page, libraries: libraries.filter((_, at) => at !== i) })}><Trash2 size={12} /></button>
            </div>
          ))}
          <form className="live-add" onSubmit={(e) => { e.preventDefault(); const lib = libraryFrom(adding); if (!lib) { onError("name@version, or a URL on cdnjs, jsdelivr, unpkg or Google Fonts"); return; } void call("set_live", { page, libraries: [...libraries, lib] }).then((ok) => { if (ok) setAdding(""); }); }}>
            <input className="field mono" placeholder="name@version, or a CDN URL" value={adding} onChange={(e) => setAdding(e.target.value)} />
          </form>
          <p className="hint">Pinned versions from cdnjs, jsdelivr, unpkg or Google Fonts only; the export and the agent see the same list.</p>
          <div className="group-title sub">Files</div>
          <LiveFile doc={doc} page={page} kind="css" dir={dir} onError={onError} />
          <LiveFile doc={doc} page={page} kind="js" dir={dir} onError={onError} />
          <p className="hint">Reach a layer by its class .b-ID, or by the classes a layer keeps from class="". Layers stay layers.</p>
        </>
      )}
    </Group>
  );
}

/** A page's points in time, newest first: who, when, what; Restore puts one back, Branch a take goes another way from it. */
function VersionsSection({ doc, page, onError }: { doc: Doc; page: Id; onError: (m: string | undefined) => void }) {
  const versions = pageVersionsOf(doc, page).slice().reverse();
  const [naming, setNaming] = useState(false);
  const now = Date.now();
  const run = (tool: EditTool, args: Record<string, unknown>) => void window.buni.edit(tool, args).then((r) => onError(r.ok ? undefined : r.reply));
  return (
    <Group title="Versions" empty={!versions.length} summary={versions.length ? `${versions.length}` : "None yet"}>
      <div className="takes-rows">
        {versions.map((v) => (
          <div key={v.id} className="version-row">
            <span className="takes-dot" />
            <span className="version-body"><b>v{v.n}</b> <span className="dim">{v.by} · {ago(v.at, now)}</span>{v.note && <span className="version-note">{v.note}</span>}</span>
            <button type="button" className="link-btn" onClick={() => run("restore_version", { version: v.id })}>Restore</button>
          </div>
        ))}
      </div>
      <div className="takes-actions">
        <button type="button" className="btn small" onClick={() => setNaming(true)}>Save a version</button>
        <span className="hint">A point to come back to; ⌘Z is still there for the last edit.</span>
      </div>
      {naming && <NameDialog title="Save a version" label="What this point is" initial="" action="Save" onClose={() => setNaming(false)} onSubmit={(note) => { setNaming(false); run("save_version", { page, note }); }} />}
    </Group>
  );
}

/** A page's takes: the live one and its options, listed; Open shows them side by side to pick. */
function TakesSection({ doc, page, onOpenTakes, onJump, onError }: { doc: Doc; page: Id; onOpenTakes: (page: Id) => void; onJump: (hit: Hit) => void; onError: (m: string | undefined) => void }) {
  const p = doc.pages[page];
  const live = p?.option ? doc.pages[p.option.of] : p;
  if (!live) return null;
  const takes = [live, ...optionsOf(doc, live.id)];
  if (takes.length < 2 && !live.picked) return null;
  return (
    <Group title="Takes" summary={`${takes.length}`}>
      <div className="takes-rows">
        {takes.map((t) => (
          <button type="button" key={t.id} className={`takes-row${t.id === page ? " here" : ""}`} onClick={() => onJump({ kind: "page", id: t.id, title: t.name, detail: "" })}>
            <span className={`takes-dot${t.id === live.id ? " live" : ""}`} />
            <span className="takes-name">{t.name}</span>
            <small>{t.id === live.id ? "live" : t.option?.idea ? "" : ""}</small>
          </button>
        ))}
      </div>
      {live.picked && <p className="motion-sentence"><b>Picked</b> {live.picked.why}</p>}
      <div className="takes-actions">
        <button type="button" className="btn small" onClick={() => onOpenTakes(live.id)}>Open the {takes.length} takes</button>
        <button type="button" className="link-btn" onClick={() => void window.buni.edit("add_task", { title: `Another take of ${live.name}`, page: live.id }).then((r) => onError(r.ok ? undefined : r.reply))}>+ Ask for another take</button>
      </div>
    </Group>
  );
}

/** The open design's path, for what depends on its project (the other designs a link may go to). */
export const OpenFile = createContext("");

/** How often other designs of the project place this file's components, by component: they change with it too. */
export const UsedElsewhere = createContext<Readonly<Record<Id, number>>>({});

export function Inspector({ doc, ownTokens, node, also = [], root, preview, page, onJump, onDeleted, onSelect, onOpenComponent, onOpenElsewhere, onOpenTakes, onWiden, viewWidth, onViewWidth, onCompare, dir }: {
  doc: Doc;
  /** This file's own tokens, when some come from an imported file. */
  ownTokens?: Doc["tokens"] | undefined;
  node: Node | undefined;
  /** More layers selected with Shift: style changes apply to them too. */
  also?: readonly Id[];
  /** Make the panel wide enough to read code. */
  onWiden?: () => void;
  /** The width the open page is shown at, when not its own; style edits then apply at that width. */
  viewWidth?: number | undefined;
  onViewWidth?: (page: Id, width: number | undefined) => void;
  /** Shows the page at all its widths side by side. */
  onCompare?: () => void;
  /** The design's folder, where its images live. */
  dir?: string;
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
  /** Opens the file a page of another file lives in, at that page. */
  onOpenElsewhere?: ((page: Id) => void) | undefined;
  /** Shows a page's takes side by side, to pick one. */
  onOpenTakes?: ((page: Id) => void) | undefined;
}) {
  const [notice, setNotice] = useState<string>();
  const [namingComponent, setNamingComponent] = useState(false);
  // Design or Code, remembered for next time; a convenience, so a browser that won't store it just starts on Design.
  const [mode, setModeState] = useState<"design" | "code">(() => { try { return localStorage.getItem("buni.inspectorMode") === "code" ? "code" : "design"; } catch { return "design"; } });
  const setMode = (m: "design" | "code") => { setModeState(m); try { localStorage.setItem("buni.inspectorMode", m); } catch { /* not stored */ } };
  const [adding, setAdding] = useState("");
  /** Properties added by name but not given a value yet. */
  const [added, setAdded] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [corners, setCorners] = useState(false);
  useEffect(() => {
    setNotice(undefined);
    setAdded([]);
  }, [node?.id]);

  if (!node) {
    return (
      <div className="inspector editing">
        {page && doc.pages[page] ? <PageSummary doc={doc} page={page} onJump={onJump} onOpenElsewhere={onOpenElsewhere} /> : <p className="hint">{Object.keys(doc.pages).length ? "Click a layer or anything on the canvas to edit it. Add things with the bar at the bottom of the canvas." : "Use + beside Pages or Import HTML to start."}</p>}
        {page && doc.pages[page] && onViewWidth && <Widths doc={doc} page={page} viewWidth={viewWidth} onView={(w) => onViewWidth(page, w)} onCompare={onCompare} onError={setNotice} />}
        {page && doc.pages[page] && <PageStates doc={doc} page={page} onOpen={(id) => onJump({ kind: "page", id, title: doc.pages[id]?.name ?? id, detail: "" })} onError={setNotice} />}
        {page && doc.pages[page] && <VersionsSection doc={doc} page={page} onError={setNotice} />}
        {page && doc.pages[page] && onOpenTakes && <TakesSection doc={doc} page={page} onOpenTakes={onOpenTakes} onJump={onJump} onError={setNotice} />}
        {page && doc.pages[page] && !doc.pages[page]?.terminal && <LiveSection doc={doc} page={page} dir={dir} onError={setNotice} />}
        {(() => { const open = Object.values(doc.shared).find((x) => x.root === root); return open ? <ComponentVariants doc={doc} component={open.id} onOpen={onOpenComponent} onError={setNotice} /> : null; })()}
        {notice && <div className="notice">{notice}</div>}
        {page ? <Sources key={page} doc={doc} id={page} /> : (() => { const component = Object.values(doc.shared).find((c) => c.root === root); return component ? <Sources key={component.id} doc={doc} id={component.id} /> : null; })()}
        <Tokens doc={doc} own={ownTokens} onError={setNotice} />
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
  // The corners one by one: the radius shorthand read as four, written back as few as say the same.
  const radii = cornerRadii(st.borderRadius ?? "");
  const setCorner = (i: number, v: string) => {
    const next = [...radii] as [string, string, string, string];
    next[i] = v.trim() || "0";
    setStyle("borderRadius", radiusShorthand(next));
  };
  const rotation = /rotate\((-?[\d.]+)deg\)/.exec(st.transform ?? "")?.[1] ?? "";
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
  const elsewhere = useContext(UsedElsewhere);
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
      {source && <ComponentVariants doc={doc} component={source.id} onOpen={onOpenComponent} onError={setNotice} />}
      {source && (
        <div className="notice component-note">
          Part of the <b>{source.name}</b> component. {(() => { const n = usesOf(doc, source.id) + (elsewhere[source.id] ?? 0); return `Changes here show in ${n === 1 ? "its 1 use" : `all ${n} uses`}${elsewhere[source.id] ? `, ${elsewhere[source.id]} in other designs` : ""}.`; })()}
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
            autoFocus={node.id === typeNext}
            onFocus={(e) => { if (node.id === typeNext) { typeNext = undefined; e.currentTarget.select(); } }}
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
      {node.kind === "image" && dir !== undefined && (
        <Group title="Image" summary={doc.attachments[node.asset]?.path.split("/").at(-1)}>
          <ImagePicker doc={doc} node={node} dir={dir} onError={setNotice} />
        </Group>
      )}
      <LinkSection doc={doc} node={node} onError={setNotice} />
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
        <Group title="Typography" summary={[short(st.fontFamily), st.fontWeight, st.fontSize].filter(Boolean).join(" · ") || "Inherited"}>
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
        <Group title="Layout" summary={st.display === "grid" ? "Grid" : st.display?.includes("flex") ? `${st.flexDirection === "column" ? "Column" : "Row"}${st.gap ? ` · gap ${st.gap}` : ""}` : "None"}>
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
          {st.display?.includes("flex") && (
            <div className="prow">
              <Select title="Whether children wrap to the next line when they don't fit" value={st.flexWrap ?? ""} options={[["", "No wrap"], ["wrap", "Wrap"], ["wrap-reverse", "Wrap, last line first"]]} onChange={(v) => setStyle("flexWrap", v)} />
            </div>
          )}
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
      <Group title="Size" empty={!st.width && !st.height && !st.maxWidth && !st.minHeight && !st.minWidth && !st.maxHeight} summary={`${st.width ?? "Hug"} × ${st.height ?? "Hug"}`}>
        <div className="prow">
          <Num prefix="W" title="Width: a size, 100% to fill, empty to hug" value={st.width ?? ""} placeholder="Hug" onSave={(v) => setStyle("width", v)} />
          <Num prefix="H" title="Height: a size, empty to hug" value={st.height ?? ""} placeholder="Hug" onSave={(v) => setStyle("height", v)} />
        </div>
        <div className="prow">
          <Num prefix="Min W" title="Minimum width" value={st.minWidth ?? ""} onSave={(v) => setStyle("minWidth", v)} />
          <Num prefix="Max W" title="Maximum width" value={st.maxWidth ?? ""} onSave={(v) => setStyle("maxWidth", v)} />
        </div>
        <div className="prow">
          <Num prefix="Min H" title="Minimum height" value={st.minHeight ?? ""} onSave={(v) => setStyle("minHeight", v)} />
          <Num prefix="Max H" title="Maximum height" value={st.maxHeight ?? ""} onSave={(v) => setStyle("maxHeight", v)} />
        </div>
      </Group>
      <Group title="Fill and shape" summary={[short(st.background ?? st.backgroundColor), st.borderRadius && `◜ ${st.borderRadius}`].filter(Boolean).join(" · ") || "None"} empty={!st.background && !st.backgroundColor && !st.borderRadius && !st.opacity && !st.border && !st.boxShadow}>
        <div className="prow">
          <ColorField doc={doc} value={st.background ?? st.backgroundColor ?? ""} onSave={(v) => setStyle(st.background === undefined && st.backgroundColor !== undefined ? "backgroundColor" : "background", v)} />
          <button type="button" className="icon-btn small" title="A soft mesh of the design's colours as the fill: three radial gradients over the base. Edit the value after." aria-label="Mesh gradient fill" onClick={() => void run("update_styles", { nodes: targets, style: { background: meshFill(doc), backgroundColor: "" }, ...(atWidth !== undefined ? { width: atWidth } : {}) })}>◍</button>
        </div>
        <div className="prow">
          {corners ? (
            <Num prefix="◜" title="Top-left corner" value={radii[0]} onSave={(v) => setCorner(0, v)} />
          ) : (
            <Num prefix="◜" title="Corner radius" value={st.borderRadius ?? ""} onSave={(v) => setStyle("borderRadius", v)} />
          )}
          {corners ? <Num prefix="◝" title="Top-right corner" value={radii[1]} onSave={(v) => setCorner(1, v)} /> : <Num prefix="α" title="Opacity, 0 to 1" value={st.opacity ?? ""} onSave={(v) => setStyle("opacity", v)} />}
          <button type="button" className={`icon-btn small${corners ? " active" : ""}`} title={corners ? "One radius for every corner" : "Each corner its own radius"} aria-label="Corners one by one" onClick={() => setCorners((v) => !v)}>◰</button>
        </div>
        {corners && (
          <div className="prow">
            <Num prefix="◟" title="Bottom-left corner" value={radii[3]} onSave={(v) => setCorner(3, v)} />
            <Num prefix="◞" title="Bottom-right corner" value={radii[2]} onSave={(v) => setCorner(2, v)} />
            <Num prefix="α" title="Opacity, 0 to 1" value={st.opacity ?? ""} onSave={(v) => setStyle("opacity", v)} />
          </div>
        )}
        <div className="prow"><Num prefix="Border" title="Border, e.g. 1px solid var(--rule)" value={st.border ?? ""} onSave={(v) => setStyle("border", v)} /></div>
        <div className="prow">
          <Select title="Shadow" value={st.boxShadow ?? ""} options={SHADOWS} onChange={(v) => setStyle("boxShadow", v)} />
        </div>
        <div className="prow">
          <Num prefix="Filter" title="CSS filter on the layer: blur(4px), grayscale(1), brightness(1.1)…" value={st.filter ?? ""} onSave={(v) => setStyle("filter", v)} />
          <Num prefix="Behind" title="Filter on what shows through the layer: blur(12px) for frosted glass" value={st.backdropFilter ?? ""} onSave={(v) => setStyle("backdropFilter", v)} />
        </div>
        <div className="prow">
          <Num prefix="Rotate" title="Degrees, clockwise; other transforms on the layer stay" value={rotation} placeholder="0" onSave={(v) => setStyle("transform", withRotation(st.transform ?? "", v))} />
        </div>
      </Group>
      {/* What a layer is and looks like comes first; what it shows, how it moves and what people said about it after. */}
      <MotionSection node={node} onError={setNotice} />
      <Comments doc={doc} node={node} onError={setNotice} />
      <Sources key={node.id} doc={doc} id={source?.root === node.id ? source.id : node.id} inherited={node.kind === "instance" ? doc.shared[node.shared] : undefined} />
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
          // Named first, as a component is reused by its name ("Cards / Box").
          onClick={() => setNamingComponent(true)}
        >
          <Component size={13} /> Make component
        </button>
      )}
      {namingComponent && (
        <NameDialog title="Make a component" label="Name" initial={node.name} action="Make component" onClose={() => setNamingComponent(false)} onSubmit={async (name) => {
          setNamingComponent(false);
          const r = await window.buni.edit("make_component", { node: node.id, name });
          const inst = r.reply.match(/instance (\S+) is/)?.[1];
          if (r.ok && inst) onSelect(inst);
          setNotice(r.ok ? undefined : r.reply);
        }} />
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
