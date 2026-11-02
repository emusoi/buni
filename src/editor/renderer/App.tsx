import { ImportHtml } from "./ImportHtml.tsx";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpen, GitBranch, Ellipsis, FolderOpen, FolderTree, Layers as LayersIcon, PanelLeftOpen, Search, Keyboard, Eye, EyeOff, Lock, Unlock, ArrowLeft, ChevronDown, ChevronLeft, Plus, ChevronRight, Component, FileText, Image, Library, PenTool, Play as PlayIcon, Sparkles, Square, Type, Workflow, X, type LucideIcon, Share, FilePlus, Undo2, Redo2 } from "lucide-react";
import { childrenOf, optionsOf, pageLabel, pagesInOrder, walkFlow, withProject, type Doc, type Id, type Node } from "buni/format/doc.ts";
import type { BuniApi, EditTool, HomeFile, PageExport, Snapshot } from "../api.ts";
import { graphicOf } from "buni/tools/html.ts";
import { Canvas, type AgentSpot, type Landing } from "./Canvas.tsx";
import { DocPanel } from "./DocPanel.tsx";
import { InsertBar, Inspector, OpenFile, UsedElsewhere } from "./Inspector.tsx";
import { Export } from "./Export.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { AskCard } from "./AskCard.tsx";
import { Changes } from "./Changes.tsx";
import { Breakpoints } from "./Breakpoints.tsx";
import { Guides } from "./Guides.tsx";
import { ARRIVE, isArrival } from "./arrive.ts";
import { NameDialog } from "./Ask.tsx";
import { FileTabs } from "./FileTabs.tsx";
import { History } from "./History.tsx";
import { Shortcuts } from "./Shortcuts.tsx";
import { placeImage } from "./images.ts";
import { useSidebar } from "./SidebarToggle.tsx";
import { useDismiss } from "./useDismiss.ts";
import { agentColor, agentInitials, ConnectAgent } from "./Connect.tsx";
import { Palette, type Action } from "./Palette.tsx";
import { pageOfNode, type Hit } from "./search.ts";
import { Journey } from "./Journey.tsx";
import { OwnersContext } from "./owners.ts";
import { Play } from "./Play.tsx";
import { Inspiration, LibraryHealth, LibraryPanel, QuickInsert, type InsertMode } from "./Library.tsx";
import { PageList } from "./PageList.tsx";
import { ProjectSwitch, siblings } from "./ProjectSwitch.tsx";
import { loadProject, useProject } from "./projectStore.ts";
import { archParams, ArchitectureMode } from "./architecture/ArchitectureMode.tsx";
import { TabletButton } from "./tablet/Connect.tsx";
import { MarksPanel } from "./tablet/Marks.tsx";
import { TabletView } from "./tablet/Tablet.tsx";
import { marksOn } from "buni/tools/ink.ts";

declare global {
  interface Window {
    buni: BuniApi;
  }
}

/** The right panel (Design, Agent, Doc) can be dragged wider for long agent conversations. */
const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");

/** What the Export menu offers for a page: pictures and PDF always; SVG and an icon set when the page is fit for them. */
/** How long after its last edit an agent still counts as working here. */
const WORKING_MS = 60_000;

/** A path written relative to the file at `from`, as the file's own path. */
export const besideFile = (from: string, rel: string): string => decodeURIComponent(new URL(rel, `file://${from}`).pathname);

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
/** Opened from the tablet's QR (pair.ts): the design to draw on, not the editor. */
const TABLET = new URLSearchParams(location.search).get("tablet") === "1";

export function App({ snap }: { snap: Snapshot }) {
  // A link can open the design on one page (?page=): the extension's "Open in buni" lands on what was captured.
  const [page, setPage] = useState<Id | undefined>(() => new URLSearchParams(location.search).get("page") ?? undefined);
  const [selected, setSelected] = useState<Id>();
  const [panel, setPanel] = useState<"design" | "agent" | "doc" | "marks">("design");
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
  const [reveal, setReveal] = useState<{ page: Id; at: number } | undefined>(() => { const p = new URLSearchParams(location.search).get("page"); return p ? { page: p, at: Date.now() } : undefined; });
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
  // ?compact=1, or a window under 640px (Chrome's side panel): both panels start folded so the canvas has the room;
  // ⌘\ brings them back, and what's remembered for wide windows is left alone.
  const compact = new URLSearchParams(location.search).get("compact") === "1" || matchMedia("(max-width: 640px)").matches ? false : undefined;
  const [sidebarOpen, toggleSidebar] = useSidebar("buni.sidebar", false, compact);
  const [panelOpen, togglePanel] = useSidebar("buni.panel", false, compact);
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
  /** Component board in focus on the canvas, instead of a page. */
  const [component, setComponent] = useState<Id>();
  const [play, setPlay] = useState<{ page: Id; flow?: Id }>();
  /** Screens (pages, components, flows) or Architecture (how the app behind them is built and shipped); ?arch= opens the second. */
  const [mode, setMode] = useState<"screens" | "architecture">(() => (archParams(location.search) ? "architecture" : "screens"));

  // The design with what it imports, so instances of a core file's components draw; those stay edited in their own file.
  const doc = snap.system;
  const imported = useMemo(() => new Set(Object.keys(snap.owners).filter((id) => doc.shared[id])), [snap.owners, doc.shared]);
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
  // Layers this window has drawn before: a layer that lands new rises in, one that changed only flashes.
  // Which those were is settled when an edit first arrives, so a redraw in the meantime doesn't restart it.
  const seen = useRef<Set<Id> | undefined>(undefined);
  seen.current ??= new Set(Object.keys(doc.nodes));
  const freshOf = useRef(new Map<string, Id[]>());
  const landing: Landing[] = edits
    .filter((e) => e.author !== "you" && Date.now() - Date.parse(e.at) < 3000)
    // Only the tops of what landed: a new section outlined once, not every layer inside it.
    .map((e) => {
      const nodes = e.nodes.filter((id) => !e.nodes.includes(doc.nodes[id]?.parent ?? ""));
      const key = `${e.author} ${e.at} ${e.label}`;
      if (!freshOf.current.has(key)) freshOf.current.set(key, nodes.filter((id) => !seen.current?.has(id)));
      return { nodes, fresh: freshOf.current.get(key) ?? [], color: colorOf(e.author) };
    });
  useEffect(() => { for (const id of Object.keys(doc.nodes)) seen.current?.add(id); });
  // Who is working now: agents connected over MCP, and any that edited in the last minute (the buni command, another
  // tab); each is marked where it last edited, and the canvas can follow it.
  const working = [...new Set([...connected, ...edits.filter((e) => e.author !== "you" && Date.now() - Date.parse(e.at) < WORKING_MS).map((e) => e.author)])];
  useEffect(() => {
    const last = Math.max(0, ...edits.filter((e) => e.author !== "you").map((e) => Date.parse(e.at)));
    const left = [3000, WORKING_MS].map((ms) => last + ms - Date.now()).filter((ms) => ms > 0);
    if (!left.length) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.min(...left) + 50);
    return () => clearTimeout(t);
  }, [edits, landing.length, working.length]);
  const agentCount = connected.length;
  // The other tabs on this file: who, and where. Their selections are outlined like an agent's spot, in their colour.
  const peers = (snap.present ?? []).filter((p) => p.tab !== window.buni.tab);
  const people = [...new Set(peers.map((p) => p.who))];
  // What the toolbar says: who is editing where, who is here, or who is connected.
  const presence = working[0]
    ? `${working[0]} is editing ${doc.pages[pageOfNode(doc, snap.recent[working[0]]?.[0] ?? "") ?? ""]?.name ?? "this design"}`
    : peers[0] ? `${peers[0].who} is on ${doc.pages[peers[0].page ?? ""]?.name ?? "this design"}${peers.length > 1 ? ` and ${peers.length - 1} more here` : ""}`
    : connected.length ? `${connected.join(" and ")} connected` : undefined;
  const spots: AgentSpot[] = [
    ...working.flatMap((name) => {
      const at = snap.recent[name]?.[0];
      return at ? [{ agent: name, nodes: [at], label: name, color: agentColor(name) }] : [];
    }),
    ...peers.flatMap((p) => (p.node && doc.nodes[p.node] ? [{ agent: `tab:${p.tab}`, nodes: [p.node], label: p.who, color: agentColor(p.who) }] : [])),
  ];
  // Tell the others where this tab is, a moment after it settles.
  useEffect(() => {
    if (!window.buni.presence) return;
    const t = setTimeout(() => void window.buni.presence?.(activePage, selected).catch(() => undefined), 150);
    return () => clearTimeout(t);
  }, [activePage, selected]);
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
    setComponent(undefined);
    const was = pageNow.current;
    setPage(id);
    // Set outside setPage's updater: React runs updaters later, and one clearing the selection there undid a jump's.
    if (select !== undefined) setSelected(select);
    else if (was !== id) setSelected(undefined);
  }, []);
  /** Opens the file a page or component of another file lives in, at it; playing the page, if `play`. */
  const openElsewhere = (page: Id, play = false) => {
    const file = snap.owners[page];
    if (!file) return;
    // Handed to the next window by the tab, as hosts open a file with no more than its path.
    try { sessionStorage.setItem(ARRIVE, JSON.stringify({ page, play })); } catch { /* the file opens at its start */ }
    void window.buni.open(besideFile(snap.path, file));
  };
  // Arrived by a link from another file: go to its page, playing if the link was followed in Play.
  useEffect(() => {
    let arrive: unknown;
    try { arrive = JSON.parse(sessionStorage.getItem(ARRIVE) ?? "null"); sessionStorage.removeItem(ARRIVE); } catch { return; }
    if (!isArrival(arrive)) return;
    if (snap.view.shared[arrive.page]) { openComponent(arrive.page); setReveal({ page: arrive.page, at: Date.now() }); }
    else if (!snap.view.pages[arrive.page]) return;
    else if (arrive.play) setPlay({ page: arrive.page, ...(arrive.flow ? { flow: arrive.flow } : {}) });
    else openPage(arrive.page);
  }, []);
  // Layer shortcuts, as in other design tools. Copy and paste ride the clipboard events, so they work on the web and
  // under the desktop app's Edit menu alike.
  useEffect(() => {
    // Where the key was pressed, not what has focus now: a field's own Enter blurs it before this runs.
    const typing = (e: Event) => { const el = e.target; return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable); };
    const run = (tool: EditTool, args: Record<string, unknown>, pick?: (reply: string) => Id | undefined) =>
      void window.buni.edit(tool, args).then((r) => { if (!r.ok) setToast(r.reply); else if (pick) setSelected(pick(r.reply)); });
    const onKey = (e: KeyboardEvent) => {
      const n = selected ? doc.nodes[selected] : undefined;
      // Architecture mode has keys of its own; a layer left selected on a page isn't what they mean.
      if (!n || typing(e) || mode === "architecture") return;
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
      if (!selected || !doc.nodes[selected] || typing(e)) return;
      e.preventDefault();
      const nodes = [selected, ...also.filter((x) => doc.nodes[x])];
      e.clipboardData?.setData("text/plain", JSON.stringify({ buni: "layers", nodes }));
      setToast(`Copied ${nodes.length === 1 ? "the layer" : `${nodes.length} layers`}; paste with ⌘V.`);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e)) return;
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
  }, [selected, also, doc, page, mode]);
  const [toast, setToast] = useState<string>();
  // The mark the Marks panel points at, lit on the page.
  const [litMark, setLitMark] = useState<Id>();
  // A tablet's marks arriving: say so once, and open the Marks panel for them.
  const markCount = Object.values(snap.view.comments).filter((c) => c.ink && c.state !== "resolved").length;
  const marksSeen = useRef(markCount);
  useEffect(() => {
    const before = marksSeen.current;
    marksSeen.current = markCount;
    if (TABLET || markCount <= before) return;
    const newest = Object.values(snap.view.comments).filter((c) => c.ink).sort((a, b) => (b.posts[0]?.at ?? "").localeCompare(a.posts[0]?.at ?? ""))[0];
    if (!newest?.ink?.from) return;
    const where = newest.ink.view ? `the ${newest.ink.view} view` : newest.ink.flow ? `the flow ${snap.view.flows[newest.ink.flow]?.name ?? ""}` : (newest.ink.page && snap.view.pages[newest.ink.page]?.name) || "a page";
    setToast(`${newest.ink.from} drew a mark on ${where}`);
    if (newest.ink.page === page) setPanel("marks");
  }, [markCount, snap.view, page]);
  // The open page at every width side by side, in place of the canvas.
  const [comparing, setComparing] = useState(false);
  const [guides, setGuides] = useState(false);
  useEffect(() => {
    // ⇧3 beside the canvas's ⇧1 (every page) and ⇧2 (this page): this page at every width. Esc goes back.
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "Digit3") { e.preventDefault(); setComparing((c) => !c); }
      else if (e.key === "Escape") setComparing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The toolbar's one menu, and the Versions or Export sheet it opens.
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState<"versions" | "export">();
  const moreRef = useRef<HTMLSpanElement>(null);
  useDismiss(more, useCallback(() => setMore(false), []), moreRef);
  // An agent's edit on a page you aren't looking at: said once, with a way there.
  const [agentNote, setAgentNote] = useState<{ author: string; label: string; page: Id; node: Id | undefined }>();
  const lastNoted = useRef(edits.at(-1)?.at ?? "");
  useEffect(() => {
    const e = edits.at(-1);
    if (!e || e.at === lastNoted.current) return;
    lastNoted.current = e.at;
    const node = e.nodes[0];
    const where = node ? pageOfNode(doc, node) : undefined;
    if (e.author === "you" || !where || where === activePage) return;
    // Watching beside a page (compact), the canvas follows the agent to what it's changing, a new "· Next" page and all.
    if (compact !== undefined) { setPage(where); setReveal({ page: where, at: Date.now() }); return; }
    setAgentNote({ author: e.author, label: e.label, page: where, node });
  }, [edits, doc, activePage, compact]);
  useEffect(() => {
    if (!agentNote) return;
    const t = setTimeout(() => setAgentNote(undefined), 6000);
    return () => clearTimeout(t);
  }, [agentNote]);
  // A layer's right-click menu, and the comment it can start.
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [commenting, setCommenting] = useState<Id>();
  const openMenu = useCallback((x: number, y: number) => setMenu({ x, y }), []);
  const runEdit = (tool: EditTool, args: Record<string, unknown>, pick?: (reply: string) => Id | undefined) =>
    void window.buni.edit(tool, args).then((r) => { if (!r.ok) setToast(r.reply); else if (pick) setSelected(pick(r.reply)); });
  const [finding, setFinding] = useState(false);
  // The project's designs as summaries, one request per tab: the sidebar's list, ⌘P and the use counts read it.
  const project = useProject(snap.path);
  const [switching, setSwitching] = useState(false);
  // How often the project's other designs place this file's components (a core's).
  const usedElsewhere = useMemo(() => Object.fromEntries(project.find((f) => f.path === snap.path)?.components.map((c) => [c.id, c.usedElsewhere]) ?? []), [project, snap.path]);
  // The whole app, this design and the project's others in full, for walking and playing flows that cross from one
  // into the next: loaded only when Play or a flow's board is open, not with every design.
  const [others, setOthers] = useState<Doc[]>([]);
  const crossing = play !== undefined || journey !== undefined;
  useEffect(() => {
    if (!crossing || project.length < 2) return;
    // An agent may be editing another design while you play: the summaries say when one changed, cheaply, and
    // only then are the designs read again.
    let seen = "", live = true;
    const read = async (fresh: boolean) => {
      const files = fresh ? siblings(await loadProject(true), snap.path) : project;
      const others = files.filter((f) => f.path !== snap.path);
      const stamp = others.map((f) => `${f.path}@${f.modified}`).join();
      if (!live || stamp === seen) return;
      seen = stamp;
      const paths = others.map((f) => f.path);
      const docs = await (window.buni.documents ? window.buni.documents(paths).then((d) => Object.values(d)) : window.buni.home().then((all) => all.filter((f) => paths.includes(f.path)).map((f) => f.doc)));
      if (live) setOthers(docs);
    };
    void read(false);
    // ponytail: polls every 2s while Play or a flow is open; a pushed change per file would replace it.
    const t = setInterval(() => void read(true), 2000);
    return () => { live = false; clearInterval(t); };
  }, [crossing, project, snap.path]);
  const app = useMemo(() => withProject(doc, others), [doc, others]);
  const fileOfPage = useMemo(() => new Map(project.flatMap((f) => f.pages.filter((p) => !snap.view.pages[p.id]).map((p) => [p.id, f.path] as const))), [project, snap.view.pages]);
  /** Opens a page here, or in the design of the project it belongs to. */
  const showPage = (page: Id) => { const file = fileOfPage.get(page); if (file && !snap.view.pages[page]) openAt(file, page); else openPage(page); };
  /** Opens another design of the project, at one of its pages if given. */
  const openAt = (path: string, page?: Id) => {
    if (page) try { sessionStorage.setItem(ARRIVE, JSON.stringify({ page, play: false })); } catch { /* opens at its start */ }
    void window.buni.open(path);
  };
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
      // ⌘P: another design of the project, or a page in one, by name.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        setSwitching((f) => !f);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInserting((f) => !f);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanel("agent");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openComponent = (id: Id) => {
    // A core file's component is edited there.
    if (!snap.view.shared[id] && snap.owners[id]) return openElsewhere(id);
    setJourney(undefined);
    setComponent(id);
    setSideTab("library");
    setSelected(snap.view.shared[id]?.root);
    setPanel("design");
  };
  // Changes only with the document, so the canvas's boards don't all re-render with every other change here.
  const selectBoard = useCallback((id: Id) => (snap.view.shared[id] ? openComponent(id) : openPage(id)), [snap.view]);
  const jump = (hit: Hit) => {
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
    if (!id) return setToast(r.reply);
    // A new web page of a design looks like the one open: its background and font, so it isn't a white sheet.
    // The first page of a design looks like the project's: the newest other design's first page.
    const sibling = async () => {
      const other = siblings(await window.buni.home(), snap.path).filter((f) => f.path !== snap.path && f.preview).sort((a, b) => b.modified.localeCompare(a.modified))[0];
      return other?.preview ? other.doc.nodes[other.doc.pages[other.preview]?.frame ?? ""]?.style : undefined;
    };
    const look = preset ? undefined : activePage ? snap.view.nodes[snap.view.pages[activePage]?.frame ?? ""]?.style : await sibling();
    const frameId = r.reply.match(/root frame (\S+?)[.;]/)?.[1];
    const carried = Object.fromEntries((["background", "fontFamily", "color", "minHeight"] as const).flatMap((k) => (look?.[k] ? [[k, look[k]]] : [])));
    if (frameId && Object.keys(carried).length) await window.buni.edit("update_styles", { nodes: [frameId], style: carried });
    openPage(id);
    // A new page is named first, as a new file is.
    setRenaming(id);
  };
  /** Renames a page; one still at its placeholder route takes a route from its new name. */
  const renamePage = async (id: Id, given: string) => {
    const p = snap.view.pages[id];
    const name = given.trim();
    if (!p || !name || name === p.name) return;
    const slug = `/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const taken = new Set(Object.values(snap.view.pages).filter((x) => x.id !== id).map((x) => x.route));
    const route = p.route && /^\/untitled-\d+$/.test(p.route) && slug !== "/" && !taken.has(slug) ? slug : undefined;
    const r = await window.buni.edit("rename_page", { page: id, name, ...(route ? { route } : {}) });
    if (!r.ok) setToast(r.reply);
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
            if (renaming === p.id) return (
              <form key={p.id} className={`row rename${indent ? " indent" : ""}`} onSubmit={(e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get("name"); if (typeof name === "string") void renamePage(p.id, name); setRenaming(undefined); }}>
                <FileText size={16} strokeWidth={1.75} />
                <input name="name" className="field" defaultValue={p.name} autoFocus onFocus={(e) => e.currentTarget.select()} aria-label="Page name" onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === "Escape" && setRenaming(undefined)} />
              </form>
            );
            return (
              <Fragment key={p.id}>
                <button
                  type="button"
                  draggable
                  className={`row${indent || p.option ? " indent" : ""}${open ? " active" : ""}${dropAt?.id === p.id ? (dropAt.before ? " drop-before" : " drop-after") : ""}`}
                  onClick={() => { openPage(p.id); setReveal({ page: p.id, at: Date.now() }); }}
                  onDoubleClick={() => setRenaming(p.id)}
                  title={p.option ? `Option of ${doc.pages[p.option.of]?.name ?? "a page"}: ${p.option.idea}. Double-click to rename` : "Double-click to rename"}
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
                  {p.option ? <GitBranch size={16} strokeWidth={1.75} className="dim" /> : <FileText size={16} strokeWidth={1.75} />}
                  <span className="name">{p.name}</span>
                  {(() => {
                    // An agent working on this page shows here too, in its colour.
                    const here = spots.find((sp) => sp.nodes[0] !== undefined && pageOfNode(doc, sp.nodes[0]) === p.id);
                    return here && <span className="page-agent" style={{ background: here.color }} title={`${here.agent} is working here`} />;
                  })()}
                  <span className="meta">{p.option ? "option" : (() => {
                    // Other takes on this page wait under it (explore_page); pick_option makes one live.
                    const n = optionsOf(doc, p.id).length;
                    return n ? `${pageLabel(doc, p)} · ${n} option${n === 1 ? "" : "s"}` : pageLabel(doc, p);
                  })()}</span>
                </button>
              </Fragment>
            );
          };

  const actions: Action[] = [
    { id: "page", title: "New page", icon: FilePlus, run: () => void addPage() },
    { id: "ask", title: "Connect a coding agent…", detail: "Claude Code or Codex", icon: Sparkles, run: () => setPanel("agent") },
    { id: "keys", title: "Keyboard shortcuts", icon: Keyboard, run: () => setKeysShown(true) },
    { id: "guides", title: "Design guides", icon: BookOpen, run: () => setGuides(true) },
    ...(activePage ? [{ id: "play", title: `Play from ${doc.pages[activePage]?.name ?? "this page"}`, icon: PlayIcon, run: () => setPlay({ page: activePage }) }] : []),
    { id: "site", title: "Share as a website…", detail: "HTML + CSS", icon: Share, run: () => void window.buni.exportSite().then((r) => r && setToast(`Exported ${r.files} files to ${tilde(r.dir)}`)) },
    { id: "undo", title: "Undo", keys: "⌘Z", icon: Undo2, run: () => void window.buni.undo().then((r) => setToast(r.reply)) },
    { id: "redo", title: "Redo", keys: "⇧⌘Z", icon: Redo2, run: () => void window.buni.redo().then((r) => setToast(r.reply)) },
  ];

  // A window too narrow for both panels shows the inspector alone; the sidebar comes back from the menu or ⌘\.
  const bothOpen = useRef(false);
  bothOpen.current = sidebarOpen && panelOpen;
  const hideSidebar = useRef(toggleSidebar);
  hideSidebar.current = toggleSidebar;
  useEffect(() => {
    // Only on becoming narrow (and on opening narrow): reopening the sidebar afterwards is the person's call.
    const narrow = window.matchMedia("(max-width: 900px)");
    const fit = () => { if (narrow.matches && bothOpen.current) hideSidebar.current(false); };
    fit();
    narrow.addEventListener("change", fit);
    return () => narrow.removeEventListener("change", fit);
  }, []);
  // The side panels float over the canvas; what they cover, for fitting pages and laying out the views beneath.
  if (TABLET) {
    return (
      <>
        <TabletView doc={doc} dir={snap.dir} fileName={fileName} onToast={setToast} />
        {toast && <div className="toast" role="status">{toast}</div>}
      </>
    );
  }
  const floating: CSSProperties & Record<`--${string}`, string> = { "--float-right": panelOpen ? `${panelWidth + 20}px` : "0px" };
  return (
    <div className={`app editor${sidebarOpen ? "" : " sidebar-collapsed"}${mode === "architecture" ? " arch-mode" : ""}`} style={floating}>
      <header className="tabs topbar">
        <div className="bar-lead">
          <ProjectSwitch path={snap.path} name={fileName.replace(/\.buni$/, "")} detail={snap.path.split("/").at(-2) ?? ""} />
          <Changes version={snap.view} onToast={setToast} />
        </div>
        <FileTabs />
        <nav className="modes-bar" role="tablist" aria-label="Mode">
          {([["screens", "Screens"], ["architecture", "Architecture"]] as const).map(([m, label]) => (
            <button type="button" key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{label}</button>
          ))}
        </nav>
        <div className="bar-trail">
        {/* Who's in the file and what they're doing; clicking opens the agent panel. Saving is silent: it always happens. */}
        {presence && (
          <button type="button" className="presence" title="Agents" aria-label="Open the agent panel" onClick={() => setPanel("agent")}>
            {connected.map((name) => (
              <span key={name} className="presence-dot" style={{ background: agentColor(name) }} title={`${name} · connected`}>{agentInitials(name)}</span>
            ))}
            {people.map((name) => (
              <span key={`person:${name}`} className="presence-dot person" style={{ background: agentColor(name) }} title={`${name} · here`}>{agentInitials(name)}</span>
            ))}
            <span className="presence-text" title={presence}>{[...connected, ...people].length ? [...connected, ...people].join(", ") : working.join(", ")}</span>
          </button>
        )}
        <History onToast={setToast} shown={sheet === "versions"} onClose={() => setSheet(undefined)} />
        <TabletButton onToast={setToast} />
        {activePage && mode === "screens" && (
          <button type="button" className="icon-btn" title="Play from this page" aria-label="Play from this page" onClick={() => activePage && setPlay({ page: activePage, ...(shownJourney ? { flow: shownJourney } : {}) })}>
            <PlayIcon size={16} strokeWidth={1.75} />
          </button>
        )}
        <Export
          shown={sheet === "export"}
          onClose={() => setSheet(undefined)}
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
          {activePage && pageExports(doc, activePage).map(([label, detail, as]) => (
            <button type="button" key={`${label} ${detail}`} className="menu-chat preset" onClick={() => exportAs(activePage, as)}>
              <span className="menu-name">{doc.pages[activePage]?.name} as {label}</span>
              <span className="menu-state">{detail}</span>
            </button>
          ))}
        </Export>
        {/* Everything else the window can do, one click away and out of sight until then. */}
        <span className="export-anchor" ref={moreRef}>
          <button type="button" className="icon-btn" aria-label="More" aria-expanded={more} title="More" onClick={() => setMore((m) => !m)}><Ellipsis size={17} /></button>
          {more && (
            <div className="agent-menu export-menu more-menu" role="menu" onClick={() => setMore(false)}>
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => setSheet("versions")}><span className="menu-name">Versions…</span><span className="menu-state">save, go back</span></button>
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => setSheet("export")}><span className="menu-name">Export…</span><span className="menu-state">file, site, PDF</span></button>
              {activePage && <button type="button" role="menuitem" className="menu-chat preset" onClick={() => setComparing(true)}><span className="menu-name">Every width side by side</span><span className="menu-state">⇧3</span></button>}
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => setImportingHtml(true)}><span className="menu-name">Import HTML…</span><span className="menu-state" /></button>
              <div className="menu-rule" />
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => toggleSidebar()}><span className="menu-name">{sidebarOpen ? "Hide" : "Show"} sidebar</span><span className="menu-state" /></button>
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => togglePanel()}><span className="menu-name">{panelOpen ? "Hide" : "Show"} inspector</span><span className="menu-state">⌘\ both</span></button>
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => setKeysShown(true)}><span className="menu-name">Keyboard shortcuts</span><span className="menu-state">?</span></button>
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => setGuides(true)}><span className="menu-name">Design guides</span><span className="menu-state">what agents read</span></button>
              <div className="menu-rule" />
              <button type="button" role="menuitem" className="menu-chat preset" onClick={() => void window.buni.close()}><span className="menu-name">All designs</span><span className="menu-state" /></button>
            </div>
          )}
        </span>
        </div>
      </header>
      {mode === "architecture" && <ArchitectureMode doc={doc} name={fileName} onToast={setToast} />}
      {/* Folded away, the sidebar leaves a strip of what it holds; each opens it at that place. */}
      {mode === "screens" && !sidebarOpen && (
        <nav className="side-rail" aria-label="Sidebar">
          <button type="button" className="icon-btn" title="Find anything (⌘K)" aria-label="Find anything" onClick={() => setFinding(true)}><Search size={17} strokeWidth={1.75} /></button>
          <button type="button" className="icon-btn" title="Other designs in this project (⌘P)" aria-label="Other designs" onClick={() => setSwitching(true)}><FolderTree size={17} strokeWidth={1.75} /></button>
          {([["pages", FileText, "Pages"], ["layers", LayersIcon, "Layers"], ["library", Library, "Components"]] as const).map(([at, Icon, label]) => (
            <button type="button" key={at} className={`icon-btn${spots.length && at === "pages" ? " busy" : ""}`} title={label} aria-label={label} onClick={() => {
              if (at === "library") setSideTab("library");
              else { setSideTab("pages"); setOutline(at); }
              toggleSidebar(true);
            }}><Icon size={17} strokeWidth={1.75} /></button>
          ))}
          <span className="grow" />
          <button type="button" className="icon-btn" title="Show the sidebar" aria-label="Show the sidebar" onClick={() => toggleSidebar(true)}><PanelLeftOpen size={17} strokeWidth={1.75} /></button>
        </nav>
      )}
      {mode === "screens" && <>
      <aside className="sidebar">
        {sideTab === "pages" && (
          <div className="side-tabs" role="tablist" aria-label="Outline">
            <button type="button" role="tab" aria-selected={outline === "pages"} className={outline === "pages" ? "on" : ""} onClick={() => setOutline("pages")}>Pages</button>
            <button type="button" role="tab" aria-selected={outline === "layers"} className={outline === "layers" ? "on" : ""} onClick={() => setOutline("layers")}>Layers</button>
          </div>
        )}
        <nav className="tree">
          {sideTab === "pages" && outline === "pages" && project.length > 1 && (
            // The project's designs, one click apart; ⌘P finds one, or a page in one, by name.
            <div className="project-list">
              <div className="section-label">Project <span className="n" title="⌘P goes to any of them">⌘P</span></div>
              {project.map((f) => (
                <button type="button" key={f.path} className={`row${f.path === snap.path ? " active" : ""}`} aria-current={f.path === snap.path ? "page" : undefined} title={f.agentNote ?? f.path} onClick={() => f.path !== snap.path && openAt(f.path)}>
                  <FolderOpen size={15} strokeWidth={1.75} />
                  <span className="name">{f.name}</span>
                  {f.agentNote && <span className="page-agent" style={{ background: "var(--accent)" }} />}
                  <span className="meta">{f.pages.length || f.components.length}</span>
                </button>
              ))}
            </div>
          )}
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
              <PageList pages={pageFilter.trim() ? pages.filter(matchesPage) : pages} folded={folded} renderPage={pageRow} onFold={(key) => setFolded((f) => {
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
              <input name="name" className="field" defaultValue={f.name} autoFocus onFocus={(e) => e.currentTarget.select()} aria-label="Flow name" onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === "Escape" && setRenaming(undefined)} />
            </form>
          ) : (
            <button type="button" key={f.id} className={`row flow-row${f.id === shownJourney ? " active" : ""}`} onClick={() => setJourney(f.id)} onDoubleClick={() => setRenaming(f.id)} title="Double-click to rename">
              <Workflow size={16} strokeWidth={1.75} />
              <span className="name">{f.name}</span>
              <span className="meta">{(() => {
                // Counted here; a flow that walks on into another design says so, its full count shown when opened.
                const walk = walkFlow(app, f.start);
                const on = walk.pages.some((p) => Object.values(app.connections).some((c) => c.page === p && !app.pages[c.to] && !c.nav));
                return `${walk.pages.length}${on ? "+" : ""} screens`;
              })()}</span>
              <span className="row-x" role="button" aria-label={`Remove flow ${f.name}`} title="Remove this flow (the pages stay)" onClick={(e) => { e.stopPropagation(); if (shownJourney === f.id) setJourney(undefined); void window.buni.edit("set_flow", { flow: f.id, remove: true }).then((r) => setToast(r.reply)); }}><X size={12} /></span>
            </button>
          ))}
          <div className="section-label with-action">
            Components <span className="n">{Object.keys(doc.shared).length || ""}</span>
            <button type="button" className="icon-btn small" title="Components: open the library to make or place one" aria-label="Open the component library" onClick={() => setSideTab("library")}><Plus size={14} /></button>
          </div>
          {Object.keys(doc.shared).length === 0 && <p className="rail-empty">Make a layer a component to reuse it across pages; the library keeps them.</p>}
          {Object.values(doc.shared).sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            imported.has(c.id) ? (
              // A core file's component is edited there: its row opens that file.
              <button type="button" key={c.id} className="row" title={`From ${snap.owners[c.id]}: open it to edit`} onClick={() => openElsewhere(c.id)}>
                <Component size={16} strokeWidth={1.75} className="dim" />
                <span className="name">{c.name}</span>
                <span className="meta">{snap.owners[c.id]?.replace(/^.*\//, "")}</span>
              </button>
            ) : (
              <button type="button" key={c.id} className={`row${c.id === component ? " active" : ""}`} onClick={() => { openComponent(c.id); setReveal({ page: c.id, at: Date.now() }); }}>
                <Component size={16} strokeWidth={1.75} />
                <span className="name">{c.name}</span>
                <span className="meta">{uses.get(c.id) ?? 0}</span>
              </button>
            )
          ))}
            </>
          ) : (
            <>
              <button type="button" className="row" onClick={() => setSideTab("pages")}>
                <ChevronLeft size={14} className="dim" />
                <span className="name">Pages</span>
              </button>
              <LibraryPanel doc={doc} imported={imported} path={snap.path} dir={snap.dir} page={activePage} open={component} onOpen={openComponent} onInsert={() => setInserting(true)} onHealth={() => setHealth(true)} />
              <Inspiration page={activePage && doc.pages[activePage] ? { id: activePage, name: doc.pages[activePage]!.name } : undefined} onSaved={setToast}
                onUse={(file, name) => void window.buni.edit("use_inspiration", { pattern: file }).then((r) => setToast(r.ok ? `${name} is on a page of its own now: take its structure, make it yours.` : r.reply))} />
              {compRoot && (
                <>
                  <div className="section-label">Layers of {doc.shared[component ?? ""]?.name}</div>
                  <Layers doc={doc} root={compRoot} depth={0} selected={selected} also={also} expanded={new Set([...expanded, compRoot.id])} onToggle={toggle} onSelect={selectNode} />
                </>
              )}
            </>
          )}
        </nav>
      </aside>
      <main className="main">
        <div className="workspace">
          {shownJourney ? (
            <Journey doc={app} dir={snap.dir} flow={shownJourney} onPlay={(page) => setPlay({ page, flow: shownJourney })} onOpenPage={showPage} />
          ) : comparing && activePage && doc.pages[activePage] ? (
            <Breakpoints doc={doc} page={activePage} dir={snap.dir} onClose={() => setComparing(false)} onEdit={(w) => { viewWidth(activePage, w); setComparing(false); }} />
          ) : (
            <div className="canvas-wrap">
            <Canvas
              doc={doc}
              imported={imported}
              dir={snap.dir}
              activePage={component ?? activePage}
              selected={selected}
              also={also}
              viewAt={viewAt}
              onSelectPage={selectBoard}
              onSelectNode={selectNode}
              onMenu={openMenu}
              onMovePage={movePage}
              focus={spots}
              landing={landing}
              reveal={reveal}
              onTidy={(at) => void tidyPages(at)}
              owners={snap.owners}
              usedElsewhere={usedElsewhere}
              onOpenElsewhere={openElsewhere}
            />
            <InsertBar doc={doc} node={selected ? doc.nodes[selected] : undefined} root={frame?.id} onAdded={setSelected} onError={setToast} />
            </div>
          )}
          {panelOpen && (
          <aside className="inspector-panel" style={{ width: panelWidth }}>
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
                {activePage && (panel === "marks" || marksOn(doc, activePage).length > 0) && (
                  <button type="button" role="tab" aria-selected={panel === "marks"} className={panel === "marks" ? "on" : ""} onClick={() => setPanel("marks")}>
                    Marks{marksOn(doc, activePage).length ? ` · ${marksOn(doc, activePage).length}` : ""}
                  </button>
                )}
              </div>
            </div>
            <div className={`panel-body${panel === "agent" ? " fill" : ""}`}>
            {panel === "design" && <OwnersContext.Provider value={snap.owners}><UsedElsewhere.Provider value={usedElsewhere}><OpenFile.Provider value={snap.path}><Inspector doc={doc} onOpenElsewhere={openElsewhere} ownTokens={snap.view.imports?.length ? snap.view.tokens : undefined} node={selected ? doc.nodes[selected] : undefined} also={also.filter((x) => doc.nodes[x])} root={frame?.id} page={component ? undefined : activePage} onJump={jump} preview={activePage && doc.pages[activePage]?.route === undefined && !doc.pages[activePage]?.terminal ? { page: activePage, dir: snap.dir } : undefined} onDeleted={() => setSelected(undefined)} onSelect={setSelected} onOpenComponent={openComponent} onWiden={() => setPanelWidth((w) => clampPanel(Math.max(w, 560)))} viewWidth={activePage ? viewAt[activePage] : undefined} onViewWidth={viewWidth} onCompare={() => setComparing(true)} dir={snap.dir}  /></OpenFile.Provider></UsedElsewhere.Provider></OwnersContext.Provider>}
            {panel === "agent" && <ConnectAgent doc={doc} mcpUrl={snap.mcpUrl} connected={connected} recent={snap.recent} edits={edits} onShow={(node) => { const p = pageOfNode(doc, node); if (p) { openPage(p, node); setReveal({ page: p, at: Date.now() }); } else setSelected(node); }} onToast={setToast} />}
            {panel === "doc" && <DocPanel doc={doc} fileName={fileName} />}
            {panel === "marks" && activePage && <MarksPanel doc={doc} page={activePage} lit={litMark} onLight={setLitMark} onShow={(node) => { setSelected(node); setReveal({ page: activePage, at: Date.now() }); }} onToast={setToast} />}
            </div>
          </aside>
          )}
        </div>
      </main>
      </>}
      {toast && <div className="toast" role="status">{toast}</div>}
      {agentNote && !toast && (
        <div className="toast agent-note" role="status">
          <span className="presence-dot" style={{ background: agentColor(agentNote.author) }}>{agentInitials(agentNote.author)}</span>
          <span>{agentNote.label} · {doc.pages[agentNote.page]?.name}</span>
          <button type="button" onClick={() => { openPage(agentNote.page, agentNote.node); setReveal({ page: agentNote.page, at: Date.now() }); setAgentNote(undefined); }}>Show</button>
        </div>
      )}
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
      {snap.asking?.[0] && (() => {
        const q = snap.asking[0];
        const n = q.node ? doc.nodes[q.node] : undefined;
        return <AskCard key={q.id} q={q} more={snap.asking.length - 1} layer={n ? n.name : undefined} onShow={() => { const p = q.node ? pageOfNode(doc, q.node) : undefined; if (p && q.node) { openPage(p, q.node); setReveal({ page: p, at: Date.now() }); } }} />;
      })()}
      {menu && selected && doc.nodes[selected] && (
        <ContextMenu doc={doc} node={selected} page={activePage} at={menu} onRun={runEdit} onComment={() => setCommenting(selected)} onClose={() => setMenu(undefined)} />
      )}
      {commenting && (
        <NameDialog title="Comment" label="What should change here? Agents read comments and answer them." initial="" action="Comment"
          onSubmit={(body) => { setCommenting(undefined); if (body.trim()) runEdit("comment", { node: commenting, body: body.trim() }); }}
          onClose={() => setCommenting(undefined)} />
      )}
      {finding && <Palette doc={doc} actions={actions} onPick={jump} onClose={() => setFinding(false)} />}
      {switching && <Palette doc={doc} only placeholder="Go to a design, or a page in one" onPick={jump} onClose={() => setSwitching(false)} actions={project.filter((f) => f.path !== snap.path).flatMap((f): Action[] => [
        { id: f.path, title: f.name, detail: f.pages.length ? `${f.pages.length} page${f.pages.length === 1 ? "" : "s"}` : `${f.components.length} components`, icon: FolderOpen, run: () => openAt(f.path) },
        ...f.pages.map((p) => ({ id: `${f.path}#${p.id}`, title: p.name, detail: `${f.name}${p.route ? ` · ${p.route}` : ""}`, icon: FileText, run: () => openAt(f.path, p.id) })),
      ])} />}
      {play && doc.pages[play.page] && (
        <Play
          doc={app}
          dir={snap.dir}
          start={play.page}
          {...(play.flow ? { flow: play.flow } : {})}
          startWidth={viewAt[play.page]}
          onClose={() => setPlay(undefined)}
          onLeave={(page) => openElsewhere(page, true)}
          onSend={(request) => {
            setPlay(undefined);
            askAgent(request);
          }}
        />
      )}
      {importingHtml && <ImportHtml at={selNode?.kind === "frame" ? { parent: selNode.id } : selNode?.parent ? { parent: selNode.parent, after: selNode.id } : frame ? { parent: frame.id } : undefined} onClose={() => setImportingHtml(false)} onImported={(page, node, message) => { setImportingHtml(false); if (page) openPage(page); if (node) setSelected(node); setToast(message); }} />}
      {keysShown && <Shortcuts onClose={() => setKeysShown(false)} />}
      {guides && <Guides onClose={() => setGuides(false)} />}
    </div>
  );
}
