import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleDashed, Component, Copy, FolderX, GitMerge, Plus, Search, Sparkles, X } from "lucide-react";
import { libraryReport, usesOf } from "buni/tools/library.ts";
import type { Doc, Id } from "buni/format/doc.ts";
import { componentSrcdoc } from "./Canvas.tsx";
import { componentWidth } from "./layout.ts";
import { libraryGroups, libraryItems, type LibraryFilter, type LibraryItem } from "./library.ts";

/** A component drawn small: its content measured, scaled to fit the box and centred. */
export function ComponentThumb({ doc, dir, id, width, height }: { doc: Doc; dir: string; id: Id; width: number; height: number }) {
  // Shrink-wrap the root so a small part is measured at its own size; an explicit width still wins.
  const html = useMemo(() => componentSrcdoc(doc, id, dir, "body>*{width:max-content}"), [doc, id, dir]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>();
  const w = componentWidth(doc, id);
  const measure = () => {
    const r = frame.current?.contentDocument?.body.firstElementChild?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) setBox({ w: r.right, h: r.bottom });
  };
  const pad = 8;
  const scale = box ? Math.min((width - pad * 2) / box.w, (height - pad * 2) / box.h, 1) : 0;
  const x = box ? (width - box.w * scale) / 2 : 0;
  const y = box ? (height - box.h * scale) / 2 : 0;
  return (
    <div className="thumb-box" style={{ width, height }}>
      <iframe
        ref={frame}
        title={doc.shared[id]?.name ?? id}
        sandbox="allow-same-origin"
        srcDoc={html}
        width={w}
        height={1200}
        style={{ transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: "0 0", width: w, height: 1200, visibility: box ? "visible" : "hidden" }}
        onLoad={measure}
      />
    </div>
  );
}

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "here", label: "On this page" },
  { id: "unused", label: "Unused" },
];

/** The sidebar's Library tab: components by group, as thumbnails, searchable and filterable. */
export function LibraryPanel({ doc, dir, page, open, onOpen, onInsert, onHealth }: {
  doc: Doc;
  dir: string;
  page: Id | undefined;
  open: Id | undefined;
  onOpen: (id: Id) => void;
  onInsert: () => void;
  onHealth: () => void;
}) {
  const report = useMemo(() => libraryReport(doc), [doc]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => libraryItems(doc), [doc]);
  const groups = libraryGroups(items, query, filter, page);
  // Big libraries start folded past the first few groups, so the list opens short.
  useEffect(() => {
    if (groups.length > 4) setClosed(new Set(groups.slice(3).map((g) => g.name)));
    // Only when the library first appears or its size class changes.
  }, [groups.length > 4]);

  if (items.length === 0) return <p className="hint side-empty">No components yet. Select a layer and make it a component, or ask the agent.</p>;
  return (
    <div className="library">
      <label className="library-search">
        <Search size={14} className="dim" />
        <input placeholder={`Search ${items.length} component${items.length === 1 ? "" : "s"}`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="library-filters">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
        <button type="button" className="library-insert" title="Insert a component (⌘I)" onClick={onInsert}><Plus size={13} /> ⌘I</button>
      </div>
      {(report.duplicates.length > 0 || report.unused.length > 0) && (
        <button type="button" className="health-strip" onClick={onHealth}>
          <Sparkles size={14} />
          <span>{[report.duplicates.length && `${report.duplicates.length} near-duplicate group${report.duplicates.length === 1 ? "" : "s"}`, report.unused.length && `${report.unused.length} unused`].filter(Boolean).join(" · ")}</span>
          <ChevronRight size={14} />
        </button>
      )}
      {groups.length === 0 && <p className="hint side-empty">Nothing matches.</p>}
      {groups.map((g) => {
        const isOpen = !closed.has(g.name) || query !== "";
        return (
          <div key={g.name} className="library-group">
            <button type="button" className={`library-group-head${g.name === "Unsorted" ? " warn" : ""}`} onClick={() => setClosed((c) => {
              const next = new Set(c);
              if (!next.delete(g.name)) next.add(g.name);
              return next;
            })}>
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {g.name === "Unsorted" && <FolderX size={13} />}
              <span className="name">{g.name}</span>
              <span className="n">{g.items.length}</span>
            </button>
            {isOpen && (
              <div className="library-tiles">
                {g.items.map((i) => <Tile key={i.id} doc={doc} dir={dir} item={i} on={i.id === open} onOpen={onOpen} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Tile({ doc, dir, item, on, onOpen }: { doc: Doc; dir: string; item: LibraryItem; on: boolean; onOpen: (id: Id) => void }) {
  return (
    <button type="button" className={`library-tile${on ? " on" : ""}`} title={`${item.full} · ${item.uses} use${item.uses === 1 ? "" : "s"}`} onClick={() => onOpen(item.id)}>
      <ComponentThumb doc={doc} dir={dir} id={item.id} width={104} height={52} />
      <span className="meta"><span className="name">{item.name}</span><span className={item.uses === 0 ? "warn" : ""}>{item.uses}×</span></span>
    </button>
  );
}

export type InsertMode = "after" | "inside" | "agent";

/** ⌘I: find a component by name, see it, and place it where you are working. */
export function QuickInsert({ doc, dir, where, onInsert, onClose }: {
  doc: Doc;
  dir: string;
  /** Where it will go, for the footer, e.g. "after Hero". */
  where: string;
  onInsert: (id: Id, mode: InsertMode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const items = useMemo(() => libraryItems(doc), [doc]);
  const groups = libraryGroups(items, query, "all", undefined);
  const flat = groups.flatMap((g) => g.items);
  useEffect(() => setCursor(0), [query]);
  const current = flat[cursor];
  let n = -1;

  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-insert" role="dialog" aria-label="Insert a component">
        <label className="palette-input">
          <Search size={16} strokeWidth={1.75} />
          <input
            autoFocus
            placeholder="Insert a component…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, flat.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === "Enter" && current) {
                e.preventDefault();
                onInsert(current.id, e.altKey ? "agent" : e.shiftKey ? "inside" : "after");
              }
            }}
          />
          <span className="kbd">{flat.length} of {items.length}</span>
        </label>
        <div className="qi-body">
          <div className="qi-list">
            {flat.length === 0 && <p className="hint palette-empty">No component matches “{query}”.</p>}
            {groups.map((g) => (
              <div key={g.name}>
                <div className="qi-group">{g.name}</div>
                {g.items.map((i) => {
                  n += 1;
                  const idx = n;
                  return (
                    <button type="button" key={i.id} className={`qi-row${idx === cursor ? " on" : ""}`} onPointerMove={() => setCursor(idx)} onClick={() => onInsert(i.id, "after")}>
                      <Component size={14} className="purple" />
                      <span className="name">{i.name}</span>
                      <span className="uses">{i.uses}×</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="qi-preview">
            {current && (
              <>
                <ComponentThumb doc={doc} dir={dir} id={current.id} width={300} height={170} />
                <b>{current.name}</b>
                <span>{current.full} · {current.uses} use{current.uses === 1 ? "" : "s"}{current.pages.size ? ` on ${current.pages.size} page${current.pages.size === 1 ? "" : "s"}` : ""}</span>
              </>
            )}
          </div>
        </div>
        <div className="qi-foot"><span><b>↵</b> insert {where}</span><span><b>⇧↵</b> insert inside</span><span><b>⌥↵</b> copy a request to adapt it</span><span className="grow" /><span>esc</span></div>
      </div>
    </div>
  );
}

/** What needs attention in a big library, with one-click fixes; grouping is handed to the agent. */
export function LibraryHealth({ doc, dir, onClose, onAsk }: { doc: Doc; dir: string; onClose: () => void; onAsk: (request: string) => void }) {
  const report = useMemo(() => libraryReport(doc), [doc]);
  const [error, setError] = useState<string>();
  const name = (id: Id) => doc.shared[id]?.name ?? id;
  const run = async (tool: "merge_components" | "delete_component", args: Record<string, unknown>) => {
    const r = await window.buni.edit(tool, args);
    setError(r.ok ? undefined : r.reply);
  };
  const total = Object.keys(doc.shared).length;
  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="health" role="dialog" aria-label="Library health">
        <header>
          <div>
            <h2>{total} component{total === 1 ? "" : "s"}</h2>
            <p>A big library stays usable when it stays small in the ways that matter.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="health-stats">
          <div><Copy size={16} className="accent" /><b>{report.duplicates.length}</b><span>near-duplicate group{report.duplicates.length === 1 ? "" : "s"}</span></div>
          <div><CircleDashed size={16} className="dim" /><b>{report.unused.length}</b><span>unused</span></div>
          <div><FolderX size={16} className="warn" /><b>{report.ungrouped.length}</b><span>without a group</span></div>
        </div>
        {error && <div className="notice">{error}</div>}
        <div className="health-body">
          {report.duplicates.map((g) => (
            <section key={g.keep} className="health-card">
              <div className="health-title"><b>{g.others.length + 1} components look the same</b><span>Same layers; they differ only in a few styles.</span></div>
              <div className="dupes">
                <div className="dupe keep"><ComponentThumb doc={doc} dir={dir} id={g.keep} width={150} height={70} /><b>{name(g.keep)}</b><span>{usesOf(doc, g.keep)} use{usesOf(doc, g.keep) === 1 ? "" : "s"} · keep</span></div>
                {g.others.map((o) => (
                  <div key={o.id} className="dupe"><ComponentThumb doc={doc} dir={dir} id={o.id} width={150} height={70} /><b>{name(o.id)}</b><span className="diff">{o.differences.join(", ") || "identical"}</span></div>
                ))}
              </div>
              <div className="health-actions">
                <button type="button" className="play-send" onClick={() => void run("merge_components", { into: g.keep, from: g.others.map((o) => o.id) })}><GitMerge size={14} /> Merge into {name(g.keep)}</button>
                <span className="hint">Uses move over with their text and links; ⌘Z undoes it.</span>
              </div>
            </section>
          ))}
          {report.unused.length > 0 && (
            <section className="health-card">
              <div className="health-title"><b>Unused · {report.unused.length}</b><span>Not placed on any page.</span></div>
              {report.unused.map((id) => (
                <div key={id} className="unused-row">
                  <Component size={14} className="purple" /><span className="name">{name(id)}</span>
                  <button type="button" className="link-btn" onClick={() => void run("delete_component", { component: id })}>Delete</button>
                </div>
              ))}
            </section>
          )}
          {report.ungrouped.length > 0 && (
            <section className="health-card">
              <div className="health-title"><b>Without a group · {report.ungrouped.length}</b><span>{report.ungrouped.slice(0, 6).map(name).join(", ")}{report.ungrouped.length > 6 ? "…" : ""}</span></div>
              <div className="health-actions">
                <button type="button" className="bar-btn" onClick={() => onAsk(`Group the component library: rename each of these components to "Group / Name" (e.g. "Buttons / Primary", "Navigation / Top bar") with rename_component, reusing groups that already exist. Components: ${report.ungrouped.map((id) => `${name(id)} (${id})`).join(", ")}.`)}>
                  <Sparkles size={14} /> Copy a request to group them
                </button>
              </div>
            </section>
          )}
          {report.duplicates.length + report.unused.length + report.ungrouped.length === 0 && <p className="hint">Nothing to fix: no duplicates, nothing unused, everything grouped.</p>}
        </div>
      </div>
    </div>
  );
}
