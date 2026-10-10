import { ImportHtml } from "./ImportHtml.tsx";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Keyboard, Eye, EyeOff, Lock, Unlock, ArrowLeft, Network, ChevronDown, ChevronLeft, Plus, ChevronRight, Component, FileText, Image, LayoutTemplate, Library, ListChecks, PenTool, Play as PlayIcon, Sparkles, Square, Type, Workflow, X, type LucideIcon, Share, FilePlus, Copy, Undo2, Redo2 } from "lucide-react";
import { childrenOf, pageLabel, pagesInOrder, walkFlow, type Doc, type Id, type Node } from "buni/format/doc.ts";
import type { BuniApi, EditTool, PageExport, Snapshot } from "../api.ts";
import { graphicOf } from "buni/tools/html.ts";
import { Canvas, type AgentSpot, type Landing } from "./Canvas.tsx";
import { DocPanel } from "./DocPanel.tsx";
import { InsertBar, Inspector } from "./Inspector.tsx";
import { HandOff } from "./HandOff.tsx";
import { FileTabs } from "./FileTabs.tsx";
import { History } from "./History.tsx";
import { Shortcuts } from "./Shortcuts.tsx";
import { Agents } from "./Agents.tsx";
import { placeImage } from "./images.ts";
import { SidebarToggle, useSidebar } from "./SidebarToggle.tsx";
import { useDismiss } from "./useDismiss.ts";
import { agentColor, agentInitials, ConnectAgent } from "./Connect.tsx";
import { Palette, type Action } from "./Palette.tsx";
import { contextText } from "buni/tools/context.ts";
import { pageOfNode, type Hit } from "./search.ts";
import { Journey } from "./Journey.tsx";
import { SystemInspector, SystemScreen, VIEW_META } from "./System.tsx";
import { PLAN_VIEWS, SystemRail } from "./SystemRail.tsx";
import { OwnersContext } from "./SystemCanvas.tsx";
import type { SystemSelection, SystemView } from "./system.ts";
import { Play } from "./Play.tsx";
import { LibraryHealth, LibraryPanel, QuickInsert, type InsertMode } from "./Library.tsx";
import { PageList } from "./PageList.tsx";

declare global {
  interface Window {
    buni: BuniApi;
  }
}

/** The right panel (Design, Agent, Doc) can be dragged wider for long agent conversations. */
const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");

/** What the Export menu offers for a page: pictures and PDF always; SVG and an icon set when the page is fit for them. */
type Mode = "screens" | "system" | "plan" | "agents";
const MODES: readonly [Mode, string, LucideIcon][] = [["screens", "Screens", LayoutTemplate], ["system", "System", Network], ["plan", "Plan", ListChecks], ["agents", "Agents", Bot]];

function pageExports(doc: Doc, pageId: Id): [string, string, PageExport][] {
  const style = doc.nodes[doc.pages[pageId]?.frame ?? ""]?.style ?? {};
  const square = style.width !== undefined && style.width === style.height;
  return [
    ["PNG", "1×", { format: "png", scale: 1 }],
    ["PNG", "2×", { format: "png", scale: 2 }],
    ["PDF", "", { format: "pdf" }],
    ...(graphicOf(doc, pageId) ? [["SVG", "vector", { format: "svg" }] satisfies [string, string, PageExport]] : []),
    ...(square ? [["App icon set", "16–1024, .ico, .icns", { format: "icons" }] satisfies [string, string, PageExport]] : []),
  ];
}

interface GraphicPreset {
  name: string;
  width: number;
  height: number;
}
/** Fixed-size boards that are not part of the site. */
const GRAPHIC_PRESETS: GraphicPreset[] = [
  { name: "Logo", width: 512, height: 512 },
  { name: "App icon", width: 1024, height: 1024 },
  { name: "Social post", width: 1080, height: 1080 },
  { name: "Story", width: 1080, height: 1920 },
  { name: "Slide", width: 1920, height: 1080 },
];
const PANEL_DEFAULT = 320;
const clampPanel = (w: number) => Math.round(Math.min(640, Math.max(280, w)));

const KIND_ICON: Record<Node["kind"], LucideIcon> = { frame: Square, text: Type, image: Image, svg: PenTool, instance: Component };

/** A disclosure arrow inside a row; its own click only toggles. */
function Twisty({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <span
      className="twisty"
      role="button"
      aria-label={open ? "Collapse" : "Expand"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </span>
  );
}

/** A layer and, when expanded, its children. Containers start collapsed. */
function Layers({ doc, root, depth, selected, also = [], expanded, onToggle, onSelect }: {
  doc: Doc; root: Node; depth: number; selected: Id | undefined; also?: readonly Id[];
  expanded: ReadonlySet<Id>; onToggle: (id: Id) => void; onSelect: (id: Id, add?: boolean) => void;
}) {
  const Icon = KIND_ICON[root.kind];
  const kids = childrenOf(doc, root.id);
  const open = expanded.has(root.id);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  const rename = (name: string) => {
    setRenaming(false);
    if (name.trim() && name.trim() !== root.name) void window.buni.edit("rename_layer", { node: root.id, name: name.trim() });
  };
  // Dropped onto an open frame, a layer goes inside it; onto anything else, right after it.
  const drop = (moved: Id) => {
    if (moved === root.id || !doc.nodes[moved]) return;
    for (let p = root.parent; p !== undefined; p = doc.nodes[p]?.parent) if (p === moved) return;
    const into = root.kind === "frame" && open;
    if (!into && root.parent === undefined) return;
    void window.buni.edit("move_nodes", into ? { nodes: [moved], parent: root.id, after: "" } : { nodes: [moved], parent: root.parent, after: root.id });
  };
  return (
    <>
      {renaming ? (
        <input className="row layer rename-layer" style={{ paddingLeft: 14 + depth * 14 }} autoFocus defaultValue={root.name} aria-label="Layer name"
          onFocus={(e) => e.currentTarget.select()} onBlur={(e) => rename(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") rename(e.currentTarget.value); if (e.key === "Escape") setRenaming(false); e.stopPropagation(); }} />
      ) : (
        <button
          type="button"
          className={`row layer${root.id === selected || also.includes(root.id) ? " selected" : ""}${over ? " drop" : ""}${root.hidden ? " is-hidden" : ""}`}
          style={{ paddingLeft: 14 + depth * 14 }}
          onClick={(e) => onSelect(root.id, e.shiftKey)}
          onDoubleClick={() => setRenaming(true)}
          title="Double-click to rename, drag to move"
          draggable={root.parent !== undefined}
          onDragStart={(e) => { e.dataTransfer.setData("application/x-buni-layer", root.id); e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-buni-layer")) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); drop(e.dataTransfer.getData("application/x-buni-layer")); }}
        >
          {kids.length > 0 ? <Twisty open={open} onToggle={() => onToggle(root.id)} /> : <span className="twisty" />}
          <Icon size={13} strokeWidth={1.75} className={root.kind === "instance" ? "kind shared" : "kind"} />
          <span className="name">{root.name}</span>
          {kids.length > 0 && !open && <span className="count">{kids.length}</span>}
          {root.parent !== undefined && (
            <span className="layer-flags">
              {([["hidden", root.hidden ? EyeOff : Eye, root.hidden ? "Show" : "Hide"], ["locked", root.locked ? Lock : Unlock, root.locked ? "Unlock" : "Lock"]] as const).map(([flag, Icon, verb]) => (
                <span key={flag} role="button" tabIndex={0} aria-label={`${verb} ${root.name}`} title={verb} className={`layer-flag${root[flag] ? " on" : ""}`}
                  onClick={(e) => { e.stopPropagation(); void window.buni.edit("set_layer", { nodes: [root.id], [flag]: !root[flag] }); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void window.buni.edit("set_layer", { nodes: [root.id], [flag]: !root[flag] }); } }}>
                  <Icon size={12} strokeWidth={1.75} />
                </span>
              ))}
            </span>
          )}
        </button>
      )}
      {open && kids.map((c) => (
        <Layers key={c.id} doc={doc} root={c} depth={depth + 1} selected={selected} also={also} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
      ))}
    </>
  );
}


/** The editor for one open file; remounted when another file opens. */
export function App({ snap }: { snap: Snapshot }) {
  const [page, setPage] = useState<Id>();
  const [selected, setSelected] = useState<Id>();
  const [panel, setPanel] = useState<"design" | "agent" | "doc">("design");
  /** Layers shown open in the sidebar; page and component roots start open, everything else closed. */
  const [expanded, setExpanded] = useState<Set<Id>>(() => new Set());
  /** Pages whose layer list is hidden even while open. */
  const [folded, setFolded] = useState<Set<Id>>(() => new Set());
  const [pageFilter, setPageFilter] = useState("");
  const matchesPage = (p: { name: string; route?: string | undefined }) => {
    const q = pageFilter.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.route ?? "").toLowerCase().includes(q);
  };
  const toggle = useCallback((id: Id) => setExpanded((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);
  /** The left sidebar shows pages and flows, or the component library. */
  const [sideTab, setSideTab] = useState<"pages" | "library">("pages");
  const [outline, setOutline] = useState<"pages" | "layers">("pages");
  const [reveal, setReveal] = useState<{ page: Id; at: number }>();
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      return clampPanel(Number(localStorage.getItem("buni.panelWidth")) || PANEL_DEFAULT);
    } catch {
      return PANEL_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("buni.panelWidth", String(panelWidth));
    } catch {
      // Remembering the width is a convenience; without storage it resets each launch.
    }
  }, [panelWidth]);
  // Each side panel hides on its own; ⌘\ hides both for a focused view of the canvas, and brings both back.
  const [sidebarOpen, toggleSidebar] = useSidebar("buni.sidebar", false);
  const [panelOpen, togglePanel] = useSidebar("buni.panel", false);
  const anyOpen = sidebarOpen || panelOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "\\")) return;
      e.preventDefault();
      toggleSidebar(!anyOpen);
      togglePanel(!anyOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyOpen, toggleSidebar, togglePanel]);
  /** Flow whose journey fills the main area; undefined shows the canvas. */
  const [journey, setJourney] = useState<Id>();
  /** Flow whose name is being edited in the rail. */
  const [renaming, setRenaming] = useState<Id>();
  /** The System view in the main area, when there is no journey open; undefined shows the canvas. */
  const [system, setSystem] = useState<SystemView>();
  /** What the System area's inspector shows. */
  const [sysSel, setSysSel] = useState<SystemSelection>();
  /** Screens, System or Plan: which things the rail lists. The last lens of each is kept for coming back. */
  const [agentsOpen, setAgentsOpen] = useState(false);
  const mode: Mode = agentsOpen ? "agents" : system ? (PLAN_VIEWS.includes(system) ? "plan" : "system") : "screens";
  const [lastLens, setLastLens] = useState<{ system: SystemView; plan: SystemView }>({ system: "map", plan: "requirements" });
  useEffect(() => { if (system) setLastLens((l) => (PLAN_VIEWS.includes(system) ? { ...l, plan: system } : { ...l, system })); }, [system]);
  const goMode = (m: Mode) => {
    setAgentsOpen(m === "agents");
    if (m === "agents") return;
    setJourney(undefined);
    setSysSel(undefined);
    if (m === "screens") { setSystem(undefined); setSideTab("pages"); }
    else setSystem(lastLens[m]);
  };
  /** Component board in focus on the canvas, instead of a page. */
  const [component, setComponent] = useState<Id>();
  const [play, setPlay] = useState<{ page: Id; flow?: Id }>();

  const doc = snap.view;
  // How many times each component is placed, for the rail.
  const uses = useMemo(() => {
    const n = new Map<Id, number>();
    for (const node of Object.values(doc.nodes)) if (node.kind === "instance") n.set(node.shared, (n.get(node.shared) ?? 0) + 1);
    return n;
  }, [doc.nodes]);
  const pages = pagesInOrder(doc);
  const activePage = page && doc.pages[page] ? page : pages[0]?.id;
  const connected = snap.connected ?? [];
  const colorOf = agentColor;
  // What agents changed in the last few seconds lands on the canvas in their colour; a tick clears it after.
  const [, tick] = useState(0);
  const edits = snap.edits ?? [];
  const landing: Landing[] = edits
    .filter((e) => e.author !== "you" && Date.now() - Date.parse(e.at) < 3000)
    // Only the tops of what landed: a new section outlined once, not every layer inside it.
    .map((e) => ({ nodes: e.nodes.filter((id) => !e.nodes.includes(doc.nodes[id]?.parent ?? "")), color: colorOf(e.author) }));
  useEffect(() => {
    if (!landing.length) return;
    const t = setTimeout(() => tick((n) => n + 1), 3000);
    return () => clearTimeout(t);
  }, [edits, landing.length]);
  const agentCount = connected.length;
  // Coding agents connected over MCP are marked where they last edited.
  const spots: AgentSpot[] = connected.flatMap((name) => {
    const at = snap.recent[name]?.[0];
    return at ? [{ agent: name, nodes: [at], label: name, color: agentColor(name) }] : [];
  });
  // Pages shown at one of their other widths; while one is, its layers are styled at that width.
  const [viewAt, setViewAt] = useState<Record<Id, number>>({});
  const viewWidth = useCallback((pageId: Id, w: number | undefined) => setViewAt((v) => {
    const { [pageId]: _old, ...rest } = v;
    return w === undefined ? rest : { ...rest, [pageId]: w };
  }), []);
  // Shift adds a layer to the selection, or takes it out again; a plain click starts over.
  const [also, setAlso] = useState<Id[]>([]);
  const selectedNow = useRef(selected);
  selectedNow.current = selected;
  useEffect(() => setAlso([]), [selected]);
  const selectNode = useCallback((id: Id | undefined, add?: boolean) => {
    if (add && id && selectedNow.current && selectedNow.current !== id) setAlso((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
    else setSelected(id);
  }, []);
  // Read by openPage, which shouldn't change identity whenever the page does.
  const pageNow = useRef(page);
  pageNow.current = page;
  /** Shows a page, selecting `select` on it; otherwise a layer from another page stays behind. */
  const openPage = useCallback((id: Id, select?: Id) => {
    setJourney(undefined);
    setSystem(undefined);
    setComponent(undefined);
    const was = pageNow.current;
    setPage(id);
    // Set outside setPage's updater: React runs updaters later, and one clearing the selection there undid a jump's.
    if (select !== undefined) setSelected(select);
    else if (was !== id) setSelected(undefined);
  }, []);
  // Layer shortcuts, as in other design tools. Copy and paste ride the clipboard events, so they work on the web and
  // under the desktop app's Edit menu alike.
  useEffect(() => {
    const typing = () => { const el = document.activeElement; return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable); };
    const run = (tool: EditTool, args: Record<string, unknown>, pick?: (reply: string) => Id | undefined) =>
      void window.buni.edit(tool, args).then((r) => { if (!r.ok) setToast(r.reply); else if (pick) setSelected(pick(r.reply)); });
    const onKey = (e: KeyboardEvent) => {
      const n = selected ? doc.nodes[selected] : undefined;
      if (!n || typing()) return;
      const mod = e.metaKey || e.ctrlKey;
      const siblings = n.parent ? childrenOf(doc, n.parent) : [];
      const at = siblings.findIndex((x) => x.id === n.id);
      const all = [n.id, ...also.filter((x) => doc.nodes[x])];
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        run("delete_nodes", { nodes: all }, () => undefined);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        run("duplicate_nodes", { nodes: all }, (r) => r.match(/Copied: ([^,.\s]+)/)?.[1]);
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        run("wrap_nodes", { nodes: all }, (r) => r.match(/Frame (\S+) holds/)?.[1]);
      } else if (e.key === "Enter" && !mod) {
        // Enter goes into a frame, Shift+Enter out to its parent.
        e.preventDefault();
        const next = e.shiftKey ? n.parent : childrenOf(doc, n.id)[0]?.id;
        if (next && doc.nodes[next]?.parent !== undefined) setSelected(next);
      } else if (!mod && n.parent && (e.key === "ArrowUp" || e.key === "ArrowLeft") && at > 0) {
        // Layers sit in a flow, so arrows move a layer among its siblings rather than by pixels.
        e.preventDefault();
        run("move_nodes", { nodes: [n.id], parent: n.parent, after: siblings[at - 2]?.id ?? "" });
      } else if (!mod && n.parent && (e.key === "ArrowDown" || e.key === "ArrowRight") && at >= 0 && at < siblings.length - 1) {
        e.preventDefault();
        run("move_nodes", { nodes: [n.id], parent: n.parent, after: siblings[at + 1]?.id });
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!selected || !doc.nodes[selected] || typing()) return;
      e.preventDefault();
      const nodes = [selected, ...also.filter((x) => doc.nodes[x])];
      e.clipboardData?.setData("text/plain", JSON.stringify({ buni: "layers", nodes }));
      setToast(`Copied ${nodes.length === 1 ? "the layer" : `${nodes.length} layers`}; paste with ⌘V.`);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing()) return;
      // A copied image (a screenshot, a logo) goes in as an image layer.
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      const pageRoot = page && doc.pages[page] ? doc.pages[page].frame : undefined;
      if (image && pageRoot) {
        e.preventDefault();
        const t = selected ? doc.nodes[selected] : undefined;
        const at = t?.kind === "frame" ? { parent: t.id } : t?.parent ? { parent: t.parent, after: t.id } : { parent: pageRoot };
        void placeImage(image, at).then((r) => ("id" in r ? setSelected(r.id) : setToast(r.error)));
        return;
      }
      let copied: unknown;
      try { copied = JSON.parse(e.clipboardData?.getData("text/plain") ?? ""); } catch { return; }
      if (typeof copied !== "object" || copied === null || !("buni" in copied) || !("nodes" in copied) || !Array.isArray(copied.nodes)) return;
      const nodes = copied.nodes.filter((x): x is Id => typeof x === "string" && doc.nodes[x] !== undefined);
      if (!nodes.length) return setToast("Those layers are not in this file.");
      e.preventDefault();
      // Into the selected frame, else after the selected layer, else onto the open page.
      const target = selected ? doc.nodes[selected] : undefined;
      const into = target?.kind === "frame" ? { parent: target.id } : target?.parent ? { parent: target.parent, after: target.id } : page && doc.pages[page] ? { parent: doc.pages[page].frame } : undefined;
      if (!into) return;
      run("duplicate_nodes", { nodes, ...into }, (r) => r.match(/Copied: (\S+)/)?.[1]?.replace(/[,.]$/, ""));
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("copy", onCopy); document.removeEventListener("paste", onPaste); };
  }, [selected, also, doc, page]);
  const [toast, setToast] = useState<string>();
  const [finding, setFinding] = useState(false);
  const [keysShown, setKeysShown] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "?" || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      e.preventDefault();
      setKeysShown((k) => !k);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [importingHtml, setImportingHtml] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [health, setHealth] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFinding((f) => !f);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInserting((f) => !f);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanel("agent");
      }
      // ⌘1 Screens, ⌘2 System, ⌘3 Plan.
      const mode = (e.metaKey || e.ctrlKey) && !e.shiftKey ? MODES[Number(e.key) - 1]?.[0] : undefined;
      if (mode) {
        e.preventDefault();
        modeKey.current(mode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const modeKey = useRef(goMode);
  modeKey.current = goMode;
  const openComponent = (id: Id) => {
    setJourney(undefined);
    setSystem(undefined);
    setComponent(id);
    setSideTab("library");
    setSelected(snap.view.shared[id]?.root);
    setPanel("design");
  };
  // Changes only with the document, so the canvas's boards don't all re-render with every other change here.
  const selectBoard = useCallback((id: Id) => (snap.view.shared[id] ? openComponent(id) : openPage(id)), [snap.view]);
  const jump = (hit: Hit) => {
    if (hit.kind === "system") {
      setJourney(undefined);
      setSystem(hit.view);
      setSysSel(hit.select);
      setPanel("design");
      return;
    }
    if (hit.kind === "flow") return setJourney(hit.id);
    if (hit.kind === "component") return openComponent(hit.id);
    openPage(hit.kind === "page" ? hit.id : hit.page, hit.kind === "layer" ? hit.id : undefined);
    setReveal({ page: hit.kind === "page" ? hit.id : hit.page, at: Date.now() });
    if (hit.kind === "layer") setPanel("design");
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(
    () =>
      window.buni.onUndoKey((which) => {
        const el = document.activeElement;
        // Typing in a field: undo the typing, not the design.
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return void document.execCommand(which);
        void window.buni[which]().then((r) => setToast(r.reply));
      }),
    [],
  );
  const [newMenu, setNewMenu] = useState(false);
  const newMenuAnchor = useRef<HTMLDivElement>(null);
  useDismiss(newMenu, useCallback(() => setNewMenu(false), []), newMenuAnchor);
  const exportAs = (pageId: Id, as: PageExport) => {
    void window.buni.exportPage(pageId, as).then(
      (r) => r && setToast(`Saved ${tilde(r.path)}`),
      (e: unknown) => setToast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)),
    );
  };
  /** A web page, or a fixed-size graphic when given a preset. */
  const addPage = async (preset?: GraphicPreset) => {
    setNewMenu(false);
    const taken = new Set(Object.values(snap.view.pages).map((p) => p.route));
    let n = 1;
    while (taken.has(`/untitled-${n}`)) n++;
    const r = await window.buni.edit(
      "create_page",
      preset ? { name: preset.name, width: preset.width, height: preset.height } : { name: `Untitled ${n}`, route: `/untitled-${n}` },
    );
    const id = r.reply.match(/Created page (\S+) /)?.[1];
    if (id) openPage(id);
    else setToast(r.reply);
  };
  // Open the path to whatever is selected, e.g. after clicking it on the canvas.
  useEffect(() => {
    if (!selected) return;
    const path: Id[] = [];
    for (let n = snap.view.nodes[selected]; n?.parent !== undefined; n = snap.view.nodes[n.parent]) path.push(n.parent);
    if (path.some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...path]));
  }, [selected, snap]);
  const movePage = useCallback(
    (id: Id, x: number, y: number) => void (snap.view.shared[id] ? window.buni.edit("move_component", { component: id, x, y }) : window.buni.movePage(id, x, y)),
    [snap],
  );
  const tidyPages = useCallback(async (at: Map<Id, { x: number; y: number }>) => {
    for (const [id, p] of at) {
      const now = snap.view.pages[id];
      if (now?.x !== p.x || now?.y !== p.y) await window.buni.movePage(id, p.x, p.y);
    }
  }, [snap]);
  /** Sidebar drag: the page being dragged, and where it would land. */
  const [dragPage, setDragPage] = useState<Id>();
  const [dropAt, setDropAt] = useState<{ id: Id; before: boolean }>();
  const dropPage = (target: Id, before: boolean) => {
    const moving = dragPage;
    setDragPage(undefined);
    setDropAt(undefined);
    if (!moving || moving === target) return;
    const order = pagesInOrder(snap.view).map((p) => p.id).filter((id) => id !== moving);
    const i = order.indexOf(target);
    const after = before ? order[i - 1] : target;
    void window.buni.reorderPage(moving, after);
  };

  const frame = activePage ? doc.nodes[doc.pages[activePage]?.frame ?? ""] : undefined;
  const fileName = snap.path.split("/").at(-1) ?? snap.path;
  const flows = Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1));
  const shownJourney = journey && doc.flows[journey] ? journey : undefined;

  const compRoot = component ? doc.nodes[doc.shared[component]?.root ?? ""] : undefined;
  // Where ⌘I puts a component: after the selected layer on the page, or at the end of the page.
  const selNode = selected ? doc.nodes[selected] : undefined;
  const onPage = selNode && frame && selNode.id !== frame.id && selNode.parent !== undefined;
  const insertWhere = onPage ? `after ${selNode.name}` : frame ? `at the end of ${doc.pages[activePage ?? ""]?.name ?? "the page"}` : "on a page";
  /** Copies a request for the coding agent connected to the file. */
  const askAgent = (request: string) => {
    setPanel("agent");
    void navigator.clipboard.writeText(request).then(() => setToast("Copied the request; paste it to your coding agent."));
  };
  const insert = async (id: Id, mode: InsertMode) => {
    setInserting(false);
    if (!frame || !activePage) return setToast("Open a page first");
    const name = doc.shared[id]?.name ?? id;
    if (mode === "agent") {
      askAgent(`Place the component "${name}" (id ${id}) on the page "${doc.pages[activePage]?.name}" ${onPage ? `right after the layer "${selNode.name}" (id ${selNode.id})` : "at the end"}, then adapt its text and overrides so it fits what is around it.`);
      return;
    }
    const inside = mode === "inside" && selNode?.kind === "frame" ? selNode.id : undefined;
    const args = inside ? { component: id, parent: inside } : onPage && selNode.parent ? { component: id, parent: selNode.parent, after: selNode.id } : { component: id, parent: frame.id };
    const r = await window.buni.edit("place_component", args);
    setToast(r.ok ? `Inserted ${name}` : r.reply);
  };

  const pageRow = (p: (typeof pages)[number], indent = false) => {
            const open = p.id === activePage;
            return (
              <Fragment key={p.id}>
                <button
                  type="button"
                  draggable
                  className={`row${indent ? " indent" : ""}${open ? " active" : ""}${dropAt?.id === p.id ? (dropAt.before ? " drop-before" : " drop-after") : ""}`}
                  onClick={() => { openPage(p.id); setReveal({ page: p.id, at: Date.now() }); }}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragPage(p.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragPage) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropAt({ id: p.id, before: e.clientY < r.top + r.height / 2 });
                  }}
                  onDragLeave={() => setDropAt(undefined)}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropPage(p.id, dropAt?.before ?? false);
                  }}
                  onDragEnd={() => {
                    setDragPage(undefined);
                    setDropAt(undefined);
                  }}
                >
                  <FileText size={16} strokeWidth={1.75} />
                  <span className="name">{p.name}</span>
                  <span className="meta">{pageLabel(doc, p)}</span>
                </button>
              </Fragment>
            );
          };

  const actions: Action[] = [
    { id: "page", title: "New page", icon: FilePlus, run: () => void addPage() },
    { id: "ask", title: "Connect a coding agent…", detail: "Claude Code or Codex", icon: Sparkles, run: () => setPanel("agent") },
    { id: "keys", title: "Keyboard shortcuts", icon: Keyboard, run: () => setKeysShown(true) },
    ...(activePage ? [{ id: "play", title: `Play from ${doc.pages[activePage]?.name ?? "this page"}`, icon: PlayIcon, run: () => setPlay({ page: activePage }) }] : []),
    { id: "screens", title: "Go to Screens", keys: "⌘1", icon: LayoutTemplate, run: () => goMode("screens") },
    { id: "system", title: "Go to System", keys: "⌘2", icon: Network, run: () => goMode("system") },
    { id: "plan", title: "Go to Plan", keys: "⌘3", icon: ListChecks, run: () => goMode("plan") },
    { id: "agents", title: "Go to Agents", detail: "design agents and their cases", keys: "⌘4", icon: Workflow, run: () => goMode("agents") },
    { id: "site", title: "Share as a website…", detail: "HTML + CSS", icon: Share, run: () => void window.buni.exportSite().then((r) => r && setToast(`Exported ${r.files} files to ${tilde(r.dir)}`)) },
    ...(Object.keys(snap.system.parts).length ? [
      { id: "pdf", title: "Share the system design as a PDF…", icon: Share, run: () => void window.buni.exportSystem().then((r) => r && setToast(`Saved ${tilde(r.path)}`)) },
      { id: "brief", title: "Copy the brief for the whole system", detail: "paste it to any agent", icon: Copy, run: () => { const r = contextText(snap.system); if (r.ok) { void navigator.clipboard.writeText(r.text).then(() => setToast("Copied the brief; paste it to any agent.")); } } },
    ] : []),
    { id: "undo", title: "Undo", keys: "⌘Z", icon: Undo2, run: () => void window.buni.undo().then((r) => setToast(r.reply)) },
    { id: "redo", title: "Redo", keys: "⇧⌘Z", icon: Redo2, run: () => void window.buni.redo().then((r) => setToast(r.reply)) },
  ];

  return (
    <div className={`app editor${sidebarOpen ? "" : " sidebar-collapsed"}${mode === "agents" ? " agents-open" : ""}`}>
      <header className="tabs topbar">
        {/* Hidden with ⌘\, the rail comes back from here. */}
        {!sidebarOpen && <SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} hint="⌘\\ shows both panels" />}
        <nav className="crumbs" aria-label="Where you are">
          <button type="button" onClick={() => void window.buni.close()} title="All designs"><ArrowLeft size={14} /> Designs</button>
          <span aria-hidden="true">/</span>
          <b title={snap.path}>{fileName.replace(/\.buni$/, "")}</b>
        </nav>
        <FileTabs />
        <div className="modes-bar" role="tablist" aria-label="Mode">
          {MODES.map(([m, label, Icon], i) => (
            <button type="button" key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => goMode(m)} title={`${label} (⌘${i + 1})`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {/* Who's in the file, people and agents; clicking one opens the agent panel. Saving is silent: it always happens. */}
        <button type="button" className="presence" title="Agents" aria-label="Open the agent panel" onClick={() => setPanel("agent")}>
          {snap.connected?.map((name) => (
            <span key={name} className="presence-dot" style={{ background: agentColor(name) }} title={`${name} · connected`}>{agentInitials(name)}</span>
          ))}
        </button>
        {mode === "screens" && <button type="button" className="bar-btn ghost" onClick={() => setImportingHtml(true)}>Import HTML</button>}
        <History onToast={setToast} />
        <SidebarToggle side="right" open={panelOpen} onToggle={togglePanel} hint="⌘\\ hides or shows both panels" />
        {activePage && (
          <button type="button" className="bar-btn ghost" title="Play from this page" onClick={() => activePage && setPlay({ page: activePage, ...(shownJourney ? { flow: shownJourney } : {}) })}>
            <PlayIcon size={14} /> Play
          </button>
        )}
        <HandOff
          system={snap.system}
          path={snap.path}
          page={system ? undefined : activePage}
          flow={shownJourney ?? (activePage ? Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1)).find((f) => walkFlow(doc, f.start).pages.includes(activePage))?.id : undefined)}
          part={sysSel?.kind === "part" ? sysSel.id : undefined}
          onToast={setToast}
        >
          {window.buni.downloadFile && (
            <button type="button" className="menu-chat preset" onClick={() => void window.buni.downloadFile?.().then((r) => setToast(`Saved ${r.path}; commit it, or open it in the desktop app`))}>
              <span className="menu-name">The .buni file</span>
              <span className="menu-state">to keep in a repo</span>
            </button>
          )}
          <button type="button" className="menu-chat preset" onClick={() => void window.buni.exportSite().then((r) => r && setToast(`Exported ${r.files} files to ${tilde(r.dir)}`))}>
            <span className="menu-name">Website…</span>
            <span className="menu-state">HTML + CSS</span>
          </button>
          {Object.keys(snap.system.parts).length > 0 && (
            <button type="button" className="menu-chat preset" onClick={() => void window.buni.exportSystem().then((r) => r && setToast(`Saved ${tilde(r.path)}`))}>
              <span className="menu-name">System design…</span>
              <span className="menu-state">PDF to share</span>
            </button>
          )}
          {activePage && !system && pageExports(doc, activePage).map(([label, detail, as]) => (
            <button type="button" key={`${label} ${detail}`} className="menu-chat preset" onClick={() => exportAs(activePage, as)}>
              <span className="menu-name">{doc.pages[activePage]?.name} as {label}</span>
              <span className="menu-state">{detail}</span>
            </button>
          ))}
        </HandOff>
      </header>
      {mode === "agents" && <Agents doc={doc} />}
      <aside className="sidebar">
        {mode !== "screens" && system ? (
          <OwnersContext.Provider value={snap.owners}>
            <SystemRail doc={snap.system} mode={mode === "plan" ? "plan" : "system"} view={system} selection={sysSel} onSelect={(s) => { setSysSel(s); setPanel("design"); }} onView={setSystem} onToast={setToast} />
          </OwnersContext.Provider>
        ) : (<>
        {sideTab === "pages" && (
          <div className="side-tabs" role="tablist" aria-label="Outline">
            <button type="button" role="tab" aria-selected={outline === "pages"} className={outline === "pages" ? "on" : ""} onClick={() => setOutline("pages")}>Pages</button>
            <button type="button" role="tab" aria-selected={outline === "layers"} className={outline === "layers" ? "on" : ""} onClick={() => setOutline("layers")}>Layers</button>
          </div>
        )}
        <nav className="tree">
          {sideTab === "pages" && outline === "layers" ? (
            frame && activePage
              ? <Layers doc={doc} root={frame} depth={0} selected={selected} also={also} expanded={new Set([...expanded, frame.id])} onToggle={toggle} onSelect={selectNode} />
              : <p className="rail-empty">Open a page to see its layers.</p>
          ) : sideTab === "pages" ? (
            <>
              <div className="section-label with-action" ref={newMenuAnchor}>
                Pages <span className="n">{pages.length}</span>
                <button type="button" className="icon-btn small" title="New page or graphic" aria-label="New page or graphic" aria-expanded={newMenu} onClick={() => setNewMenu((m) => !m)}>
                  <Plus size={14} />
                </button>
                {newMenu && (
                  <div className="agent-menu new-menu" onPointerLeave={() => setNewMenu(false)} onKeyDown={(e) => e.key === "Escape" && setNewMenu(false)}>
                    <button type="button" className="menu-chat" onClick={() => void addPage()}>
                      <span className="menu-name">Web page</span>
                    </button>
                    <div className="menu-label">Graphics</div>
                    {GRAPHIC_PRESETS.map((g) => (
                      <button type="button" key={g.name} className="menu-chat preset" onClick={() => void addPage(g)}>
                        <span className="menu-name">{g.name}</span>
                        <span className="menu-state">{g.width}×{g.height}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {pages.length === 0 && <p className="rail-empty">Every screen of your product is a page. + adds one, or ask your coding agent.</p>}
              {/* A long list gets a filter: names and routes, as typed. */}
              {pages.length > 12 && (
                <input className="field rail-filter" type="search" placeholder={`Find among ${pages.length} pages`} value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setPageFilter(""); }} aria-label="Find a page" />
              )}
              {pageFilter.trim() && pages.filter(matchesPage).length === 0 && <p className="rail-empty">No page matches “{pageFilter.trim()}”.</p>}
              <PageList pages={pageFilter.trim() ? pages.filter(matchesPage) : pages} parts={doc.parts} folded={folded} renderPage={pageRow} onFold={(key) => setFolded((f) => {
                const next = new Set(f);
                if (!next.delete(key)) next.add(key);
                return next;
              })} />
          <div className="section-label with-action">
            Flows <span className="n">{flows.length || ""}</span>
            {activePage && (
              <button type="button" className="icon-btn small" title={`New flow starting on ${doc.pages[activePage]?.name}`} aria-label="New flow" onClick={() => void window.buni.edit("set_flow", { name: `From ${doc.pages[activePage]?.name ?? "here"}`, start: activePage }).then((r) => {
                if (!r.ok) return setToast(r.reply);
                const id = r.reply.match(/^Flow (\S+) /)?.[1];
                if (id) { setJourney(id); setRenaming(id); }
              })}>
                <Plus size={14} />
              </button>
            )}
          </div>
          {flows.length === 0 && <p className="rail-empty">A flow is a path through linked pages that you can play. + starts one on the page you're on.</p>}
          {flows.map((f) => renaming === f.id ? (
            <form key={f.id} className="row rename" onSubmit={(e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get("name"); if (typeof name === "string" && name.trim()) void window.buni.edit("set_flow", { flow: f.id, name: name.trim() }).then((r) => !r.ok && setToast(r.reply)); setRenaming(undefined); }}>
              <Workflow size={16} strokeWidth={1.75} />
              <input name="name" className="field" defaultValue={f.name} autoFocus aria-label="Flow name" onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === "Escape" && setRenaming(undefined)} />
            </form>
          ) : (
            <button type="button" key={f.id} className={`row flow-row${f.id === shownJourney ? " active" : ""}`} onClick={() => setJourney(f.id)} onDoubleClick={() => setRenaming(f.id)} title="Double-click to rename">
              <Workflow size={16} strokeWidth={1.75} />
              <span className="name">{f.name}</span>
              <span className="meta">{walkFlow(doc, f.start).pages.length} screens</span>
              <span className="row-x" role="button" aria-label={`Remove flow ${f.name}`} title="Remove this flow (the pages stay)" onClick={(e) => { e.stopPropagation(); if (shownJourney === f.id) setJourney(undefined); void window.buni.edit("set_flow", { flow: f.id, remove: true }).then((r) => setToast(r.reply)); }}><X size={12} /></span>
            </button>
          ))}
          <div className="section-label with-action">
            Components <span className="n">{Object.keys(doc.shared).length || ""}</span>
            <button type="button" className="icon-btn small" title="Components: open the library to make or place one" aria-label="Open the component library" onClick={() => setSideTab("library")}><Plus size={14} /></button>
          </div>
          {Object.keys(doc.shared).length === 0 && <p className="rail-empty">Make a layer a component to reuse it across pages; the library keeps them.</p>}
          {Object.values(doc.shared).sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <button type="button" key={c.id} className={`row${c.id === component ? " active" : ""}`} onClick={() => { openComponent(c.id); setReveal({ page: c.id, at: Date.now() }); }}>
              <Component size={16} strokeWidth={1.75} />
              <span className="name">{c.name}</span>
              <span className="meta">{uses.get(c.id) ?? 0}</span>
            </button>
          ))}
            </>
          ) : (
            <>
              <button type="button" className="row" onClick={() => setSideTab("pages")}>
                <ChevronLeft size={14} className="dim" />
                <span className="name">Pages</span>
              </button>
              <LibraryPanel doc={doc} dir={snap.dir} page={activePage} open={component} onOpen={openComponent} onInsert={() => setInserting(true)} onHealth={() => setHealth(true)} />
              {compRoot && (
                <>
                  <div className="section-label">Layers of {doc.shared[component ?? ""]?.name}</div>
                  <Layers doc={doc} root={compRoot} depth={0} selected={selected} also={also} expanded={new Set([...expanded, compRoot.id])} onToggle={toggle} onSelect={selectNode} />
                </>
              )}
            </>
          )}
        </nav>
        </>)}
      </aside>
      <main className="main">
        <div className="workspace" style={{ gridTemplateColumns: panelOpen ? `minmax(0, 1fr) ${panelWidth}px` : "minmax(0, 1fr)" }}>
          {shownJourney ? (
            <Journey doc={doc} dir={snap.dir} flow={shownJourney} onPlay={(page) => setPlay({ page, flow: shownJourney })} onOpenPage={openPage} />
          ) : system ? (
            <OwnersContext.Provider value={snap.owners}><SystemScreen doc={snap.system} fileName={fileName} view={system} selection={sysSel} onSelect={setSysSel} onOpenPage={openPage} onToast={setToast} onView={setSystem} /></OwnersContext.Provider>
          ) : (
            <div className="canvas-wrap">
            <Canvas
              doc={doc}
              dir={snap.dir}
              activePage={component ?? activePage}
              selected={selected}
              also={also}
              viewAt={viewAt}
              onSelectPage={selectBoard}
              onSelectNode={selectNode}
              onMovePage={movePage}
              focus={spots}
              landing={landing}
              reveal={reveal}
              onTidy={(at) => void tidyPages(at)}
            />
            <InsertBar doc={doc} node={selected ? doc.nodes[selected] : undefined} root={frame?.id} onAdded={setSelected} onError={setToast} />
            </div>
          )}
          {panelOpen && (
          <aside className="inspector-panel">
            <div
              className="panel-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              title="Drag to resize · double-click to reset"
              onDoubleClick={() => setPanelWidth(PANEL_DEFAULT)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const x0 = e.clientX;
                const w0 = panelWidth;
                const move = (ev: PointerEvent) => setPanelWidth(clampPanel(w0 + x0 - ev.clientX));
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
            <div className="panel-tabs">
              <div className="segmented" role="tablist">
                <button type="button" role="tab" aria-selected={panel === "design"} className={panel === "design" ? "on" : ""} onClick={() => setPanel("design")}>Inspect</button>
                <button type="button" role="tab" aria-selected={panel === "agent"} className={panel === "agent" ? "on" : ""} onClick={() => setPanel("agent")}>
                  {agentCount ? `Agents · ${agentCount}` : "Agents"}
                </button>
                <button type="button" role="tab" aria-selected={panel === "doc"} className={panel === "doc" ? "on" : ""} onClick={() => setPanel("doc")}>Doc</button>
              </div>
            </div>
            <div className={`panel-body${panel === "agent" ? " fill" : ""}`}>
            {panel === "design" && system && !shownJourney && <OwnersContext.Provider value={snap.owners}><SystemInspector doc={snap.system} dir={snap.dir} view={system} selection={sysSel} onSelect={setSysSel} onOpenPage={openPage} onToast={setToast} /></OwnersContext.Provider>}
            {panel === "design" && !(system && !shownJourney) && <Inspector doc={doc} node={selected ? doc.nodes[selected] : undefined} also={also.filter((x) => doc.nodes[x])} root={frame?.id} page={component ? undefined : activePage} onJump={jump} preview={activePage && doc.pages[activePage]?.route === undefined && !doc.pages[activePage]?.terminal ? { page: activePage, dir: snap.dir } : undefined} onDeleted={() => setSelected(undefined)} onSelect={setSelected} onOpenComponent={openComponent} onWiden={() => setPanelWidth((w) => clampPanel(Math.max(w, 560)))} viewWidth={activePage ? viewAt[activePage] : undefined} onViewWidth={viewWidth} />}
            {panel === "agent" && <ConnectAgent doc={doc} mcpUrl={snap.mcpUrl} connected={connected} recent={snap.recent} edits={edits} onShow={(node) => { const p = pageOfNode(doc, node); if (p) { openPage(p, node); setReveal({ page: p, at: Date.now() }); } else setSelected(node); }} onToast={setToast} />}
            {panel === "doc" && <DocPanel doc={doc} fileName={fileName} />}
            </div>
          </aside>
          )}
        </div>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {health && (
        <LibraryHealth
          doc={doc}
          dir={snap.dir}
          onClose={() => setHealth(false)}
          onAsk={(request) => {
            setHealth(false);
            askAgent(request);
          }}
        />
      )}
      {inserting && <QuickInsert doc={doc} dir={snap.dir} where={insertWhere} onInsert={(id, mode) => void insert(id, mode)} onClose={() => setInserting(false)} />}
      {finding && <Palette doc={doc} system={snap.system} actions={actions} onPick={jump} onClose={() => setFinding(false)} />}
      {play && doc.pages[play.page] && (
        <Play
          doc={doc}
          dir={snap.dir}
          start={play.page}
          {...(play.flow ? { flow: play.flow } : {})}
          startWidth={viewAt[play.page]}
          onClose={() => setPlay(undefined)}
          onSend={(request) => {
            setPlay(undefined);
            askAgent(request);
          }}
        />
      )}
      {importingHtml && <ImportHtml at={selNode?.kind === "frame" ? { parent: selNode.id } : selNode?.parent ? { parent: selNode.parent, after: selNode.id } : frame ? { parent: frame.id } : undefined} onClose={() => setImportingHtml(false)} onImported={(page, node, message) => { setImportingHtml(false); if (page) openPage(page); if (node) setSelected(node); setToast(message); }} />}
      {keysShown && <Shortcuts onClose={() => setKeysShown(false)} />}
    </div>
  );
}
