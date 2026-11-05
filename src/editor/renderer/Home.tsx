import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FilePlus, SquareArrowOutUpRight, Workflow, Sparkles, Folder, FolderOpen, LayoutGrid, Pencil, Plus, Search, Sparkle, Terminal, Trash2, Upload, UserRound, Users, X } from "lucide-react";
import type { HomeFile, Space } from "../api.ts";
import { srcdoc } from "./Canvas.tsx";
import { ConfirmDialog, NameDialog } from "./Ask.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { SidebarToggle, useSidebar } from "./SidebarToggle.tsx";
import { FileTabs } from "./FileTabs.tsx";
import { Profile, ThemeSwitch } from "./Profile.tsx";
import { widthOf } from "./layout.ts";
import { NewDesign } from "./NewDesign.tsx";
import { walkFlow } from "buni/format/doc.ts";
import { openSiteTab } from "./arrive.ts";

const THUMB_W = 200;

/** "edited 2 min ago": how long ago, in the words a person would use. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  if (s < 14 * 86400) return "last week";
  if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))} weeks ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Last two folders of a long path, enough to tell projects apart. */
function short(folder: string, space?: Space): string {
  // A design on disk names its folder; hosted, the store's root ("/designs/…", a space's) is only the store's.
  if (space && folder.startsWith(`${space.root}/`)) return folder.slice(space.root.length + 1);
  const parts = folder.replace(/^\/designs\//, "").split("/").filter(Boolean);
  if (folder.startsWith("/designs/")) return parts.join("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : folder;
}

function Thumb({ file, badge }: { file: HomeFile; badge?: string | undefined }) {
  const { doc, preview } = file;
  const dir = file.path.slice(0, file.path.lastIndexOf("/"));
  const html = useMemo(() => (preview ? srcdoc(doc, preview, dir) : ""), [doc, preview, dir]);
  const live = badge && <span className="thumb-badge"><span className="live" />{badge}</span>;
  if (!preview) return <div className="card-thumb">{live}<span className="card-empty">No pages yet</span></div>;
  const width = widthOf(doc, preview);
  const scale = THUMB_W / width;
  return (
    <div className="card-thumb">
      {live}
      <div className="card-page" style={{ width: THUMB_W, height: Math.round(900 * scale) }}>
        <iframe title={file.name} sandbox="allow-same-origin" srcDoc={html} width={width} height={900} style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      </div>
    </div>
  );
}

type Sort = "recent" | "name" | "pages";
const SORTS: [Sort, string][] = [["recent", "Recent"], ["name", "Name"], ["pages", "Pages"]];
const sorted = (files: readonly HomeFile[], by: Sort): HomeFile[] =>
  by === "recent" ? [...files] : [...files].sort((a, b) => (by === "name" ? a.name.localeCompare(b.name) : b.pages - a.pages));

/** Where coding agents connect, on a host whose agents come in over MCP (the web). */
function AgentsHere() {
  return (
    <div className="rail-card">
      <b><span className="live" /> Agents connect here</b>
      <code>{location.host}/mcp</code>
      <span>Open a design for the line to paste into Claude Code or Codex.</span>
    </div>
  );
}

/** Rename and delete, where the host keeps the files itself (the web); the desktop has Finder for that. */
function FileActions({ file, onAsk }: { file: HomeFile; onAsk: (a: Asking) => void }) {
  if (!window.buni.renameFile || !window.buni.removeFile) return null;
  return (
    <div className="card-actions">
      <button type="button" title="Rename" aria-label={`Rename ${file.name}`} onClick={() => onAsk({ kind: "rename", file })}><Pencil size={13} /></button>
      <button type="button" title="Delete" aria-label={`Delete ${file.name}`} onClick={() => onAsk({ kind: "delete", file })}><Trash2 size={13} /></button>
    </div>
  );
}

/** What the home screen is asking the person, if anything. */
type Asking = { kind: "new" } | { kind: "rename"; file: HomeFile } | { kind: "delete"; file: HomeFile };

export function Home({ notice }: { notice?: string | undefined } = {}) {
  const [sidebarOpen, toggleSidebar] = useSidebar();
  const [files, setFiles] = useState<HomeFile[]>();
  const [folder, setFolder] = useState<string>();
  const [sort, setSort] = useState<Sort>("recent");
  const [onlyAgents, setOnlyAgents] = useState(false);
  const [asking, setAsking] = useState<Asking>();
  // Where the host names files itself (the web), a new design is named first; the desktop asks where to save it.
  const create = () => (window.buni.renameFile ? setAsking({ kind: "new" }) : void run(window.buni.create()));
  const search = useRef<HTMLInputElement>(null);
  // ⌘K finds a design, as it finds things inside one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | undefined>(notice);

  const refresh = () => void window.buni.home().then(setFiles);
  useEffect(refresh, []);
  // Spaces (the web): the person's own designs and each organization's. One space is no choice; with more, the
  // sidebar switches between them, and projects and designs are the chosen space's.
  const [spaces, setSpaces] = useState<Space[]>([]);
  useEffect(() => { void window.buni.spaces?.().then(setSpaces, () => undefined); }, []);
  const [spaceRoot, setSpaceRoot] = useState<string>(() => { try { return localStorage.getItem("buni:space") ?? ""; } catch { return ""; } });
  // One space still sets how folders read (each design starts in a folder of its own); the switcher shows from two.
  const space = spaces.find((s) => s.root === spaceRoot) ?? spaces[0];
  const pickSpace = (root: string) => { setSpaceRoot(root); setFolder(undefined); try { localStorage.setItem("buni:space", root); } catch { /* a private window */ } };
  const inSpace = useMemo(() => (files ?? []).filter((f) => !space || f.space?.root === space.root), [files, space]);

  // By parent, then name, so a project's folders sit together.
  const tail = (f: string) => f.split("/").filter(Boolean).slice(-2);
  const byTail = (a: string, b: string) => { const [x = "", y = ""] = tail(a); const [u = "", v = ""] = tail(b); return x === u ? y.localeCompare(v) : x.localeCompare(u); };
  const folders = useMemo(() => [...new Set(inSpace.map((f) => f.folder))].sort(byTail), [inSpace]);
  const showProjects = folders.length > 1 && (!space || folders.some((f) => inSpace.filter((x) => x.folder === f).length > 1));
  const q = query.trim().toLowerCase();
  const working = inSpace.filter((f) => f.agentNote).length;
  // Two designs with one name are told apart by their folder.
  const named = new Map<string, number>();
  for (const f of inSpace) named.set(f.name, (named.get(f.name) ?? 0) + 1);
  const shown = sorted(inSpace, sort).filter((f) => (folder === undefined || f.folder === folder) && (!onlyAgents || f.agentNote) && (!q || `${f.name} ${f.folder}`.toLowerCase().includes(q)));
  const now = Date.now();
  const run = (p: Promise<void>) => p.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <Wordmark height={18} />
          <SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />
        </div>
        <div className="search">
          <label>
            <Search size={15} strokeWidth={1.75} />
            <input ref={search} placeholder="Search designs" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())} />
            <span className="kbd">⌘K</span>
          </label>
        </div>
        <nav className="tree">
          {space && spaces.length > 1 && (
            <>
              <div className="section-label">Spaces</div>
              <div className="nav">
                {spaces.map((s) => (
                  <button type="button" key={s.root} className={`row${s.root === space.root ? " active" : ""}`} onClick={() => pickSpace(s.root)} title={s.members?.length ? s.members.map((m) => m.name).join(", ") : undefined}>
                    {s.members && s.members.length > 1 ? <Users size={16} strokeWidth={1.75} /> : <UserRound size={16} strokeWidth={1.75} />}
                    <span className="name">{s.name}</span>
                    <span className="count">{(files ?? []).filter((f) => f.space?.root === s.root).length}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="nav">
            <button type="button" className={`row${folder === undefined && !onlyAgents ? " active" : ""}`} onClick={() => { setFolder(undefined); setOnlyAgents(false); }}>
              <LayoutGrid size={16} strokeWidth={1.75} />
              <span className="name">All designs</span>
              {files && <span className="count">{inSpace.length}</span>}
            </button>
            <button type="button" className={`row${onlyAgents ? " active" : ""}`} onClick={() => { setFolder(undefined); setOnlyAgents(true); }}>
              <Sparkles size={16} strokeWidth={1.75} />
              <span className="name">Agents working</span>
              {working > 0 && <span className="count working">{working}</span>}
            </button>
            <button type="button" className="row" onClick={() => void run(window.buni.openExample())}>
              <BookOpen size={16} strokeWidth={1.75} />
              <span className="name">Example</span>
            </button>
          </div>
          {/* A project is a folder of designs; one is no choice, so projects show when designs live in several. In a
              space, where every design starts in a folder of its own, they show once a folder holds more than one. */}
          {showProjects && <div className="section-label">Projects</div>}
          {showProjects && folders.map((f) => {
            const Icon = f === folder ? FolderOpen : Folder;
            // "designs" alone repeats across projects, so each folder reads as its parent, then itself; in a space, as itself.
            const [parent, name] = space ? [short(f, space)] : f.split("/").filter(Boolean).slice(-2);
            return (
              <button type="button" key={f} className={`row folder-row${f === folder ? " active" : ""}`} onClick={() => setFolder(f)} title={f}>
                <Icon size={16} strokeWidth={1.75} />
                <span className="name">{name ? <><span className="folder-parent">{parent}</span><span className="folder-sep">/</span>{name}</> : parent ?? f}</span>
                <span className="count">{inSpace.filter((x) => x.folder === f).length}</span>
              </button>
            );
          })}
        </nav>
        <div className="rail-foot-stack">
          {space && space.members && space.members.length > 1 && (
            <div className="rail-card" title={space.members.map((m) => `${m.name}${m.email ? ` · ${m.email}` : ""}`).join("\n")}>
              <b><Users size={13} /> In {space.name}</b>
              <span>{space.members.map((m) => m.name).join(", ")}</span>
            </div>
          )}
          <AgentsHere />
          <ThemeSwitch />
        </div>
        <Profile />
      </aside>
      <main className="main">
        <div className="tabs">
          {!sidebarOpen && <SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />}
          <FileTabs />
        </div>
        <div className="home">
          {files && files.length > 0 && <header className="home-head">
            <div>
              <h1>{onlyAgents ? "Agents working" : folder ? folder.split("/").filter(Boolean).at(-1) : space && spaces.length > 1 ? space.name : "Designs"}</h1>
              {onlyAgents && <p>Designs a coding agent is editing right now.</p>}
            </div>
            <div className="home-actions">
              <button type="button" className="bar-btn ghost" onClick={() => void run(window.buni.open())}><Upload size={14} /> {window.buni.renameFile ? "Import" : "Open…"}</button>
              <button type="button" className="bar-btn primary" onClick={create}><Plus size={14} /> New design</button>
            </div>
          </header>}
          {error && <div className="notice dismissable" role="alert">{error}<button type="button" className="icon-btn small" aria-label="Dismiss" onClick={() => setError(undefined)}><X size={13} /></button></div>}
          {!files && <div className="home-loading" aria-label="Loading designs">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>}
          {files && files.length === 0 && (
            <div className="welcome">
              <p className="welcome-lede">Design the screens, the flows between them and the journeys through them.<span>Then hand it to an agent to build.</span></p>
              <div className="welcome-ways">
                <button type="button" onClick={create}><FilePlus size={18} /><b>New design</b><span>Start by hand, or connect a coding agent to draft it.</span></button>
                <button type="button" onClick={() => void run(window.buni.openExample())}><Sparkle size={18} /><b>Explore the example</b><span>A small steel shop: screens, components and a flow. Click around; it’s a copy.</span></button>
                <button type="button" onClick={() => void run(window.buni.open())}><FolderOpen size={18} /><b>{window.buni.renameFile ? "Import a file" : "Open a file"}</b><span>Any .buni file{window.buni.renameFile ? ", with the images it uses." : ". Designs are plain files you can commit and diff."}</span></button>
              </div>
              <p className="welcome-agents"><Terminal size={14} /> Using Claude Code or Codex? <code>buni skill</code> teaches it buni, and <code>buni context FILE</code> hands it a brief.</p>
            </div>
          )}
          {shown.length > 0 && (
            <div className="home-row">
              <div className="filters">
                {SORTS.map(([id, label]) => (
                  <button type="button" key={id} className={id === sort ? "on" : ""} onClick={() => setSort(id)}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {onlyAgents && shown.length === 0 && <p className="home-empty">No agent is working in a design right now. Open one for the line that connects Claude Code or Codex.</p>}
          <div className="cards">
            {shown.map((f) => (
              <div key={f.path} className="card-wrap">
                <button type="button" className="card" onClick={() => void run(window.buni.open(f.path))} title={f.path}>
                  <Thumb file={f} badge={f.agentNote} />
                  <span className="card-name">{f.name}</span>
                  <span className="card-meta">{f.pages} page{f.pages === 1 ? "" : "s"} · edited {ago(f.modified, now)}{(folders.length > 1 || (named.get(f.name) ?? 0) > 1) && short(f.folder, f.space) !== f.name ? ` · ${short(f.folder, f.space)}` : ""}</span>
                </button>
                <FileActions file={f} onAsk={setAsking} />
              </div>
            ))}
          </div>
          {(() => {
            // The paths through the designs shown, each opened as a website at its first screen.
            const paths = shown.flatMap((f) => Object.values(f.doc.flows).map((flow) => ({ f, flow, screens: walkFlow(f.doc, flow.start).pages.length })));
            if (!paths.length || onlyAgents) return null;
            return (
              <section className="home-flows">
                <h2>Flows</h2>
                {paths.map(({ f, flow, screens }) => (
                  <button type="button" key={`${f.path} ${flow.id}`} className="home-flow" title={`Open ${flow.name} as a website, from its first screen`} onClick={() => openSiteTab(f.path, flow.start)}>
                    <Workflow size={15} />
                    <b>{flow.name}</b>
                    <span>{f.name} · {screens} {screens === 1 ? "screen" : "screens"}</span>
                    <SquareArrowOutUpRight size={14} />
                  </button>
                ))}
              </section>
            );
          })()}
        </div>
      </main>
      {asking?.kind === "new" && (
        <NewDesign files={files ?? []} folder={folder} space={space} onClose={() => setAsking(undefined)} onCreate={(name, options) => { setAsking(undefined); void run(window.buni.create(name, options)); }} />
      )}
      {asking?.kind === "rename" && (
        <NameDialog title={`Rename ${asking.file.name}`} label="New name" initial={asking.file.name} action="Rename" onClose={() => setAsking(undefined)} onSubmit={(name) => {
          setAsking(undefined);
          if (name !== asking.file.name) void window.buni.renameFile?.(asking.file.path, name).then(refresh, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
        }} />
      )}
      {asking?.kind === "delete" && (
        <ConfirmDialog title={`Delete ${asking.file.name}?`} body={`Its ${asking.file.pages} page${asking.file.pages === 1 ? "" : "s"}, its components and its images go for good. This can't be undone.`} action="Delete" onClose={() => setAsking(undefined)} onConfirm={() => {
          setAsking(undefined);
          void window.buni.removeFile?.(asking.file.path).then(refresh, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
        }} />
      )}
    </div>
  );
}
