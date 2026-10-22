// The design on a tablet, to draw on with a pen: Pencil draws, a finger moves and zooms. Marks are saved as comments
// when the pen pauses (server.ts lets a tablet do that and little else), so they show on the Mac as they're made.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, Hand, Highlighter, Lasso, PanelLeft, PenLine, Pencil, Redo2, Trash2, Type, Undo2, X } from "lucide-react";
import { pagesInOrder, type Doc, type Id, type Stroke } from "buni/format/doc.ts";
import { marksOn } from "buni/tools/ink.ts";
import { nodeAt, srcdoc } from "../Canvas.tsx";
import { widthOf } from "../layout.ts";
import { InkLayer, StrokePaths } from "./Ink.tsx";
import { sendMarks } from "./Marks.tsx";

type Tool = "pen" | "highlighter" | "eraser" | "lasso" | "note";
/** The pen's colours: red to mark up, blue for a second voice, ink for writing; ink follows the theme. */
const COLORS = [["Red", "#c8331f"], ["Blue", "#2f6bff"], ["Ink", "var(--ink)"]] as const;
/** How long the pen rests before what it drew is kept as one mark. */
const SETTLE_MS = 1200;
/** A highlighter is yellow whatever the pen's colour, as one on paper is. */
const HIGHLIGHT = "#facc15";
const device = () => (/iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1 ? "iPad" : /Android/.test(navigator.userAgent) ? "Android tablet" : "tablet");
// The ink's own colour is kept in the file, so "var(--ink)" is written as what it shows now.
const solid = (c: string) => (c.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() || "#18181b" : c);

/** Whether a point is inside a closed loop of x, y pairs (even-odd rule). */
function inside(loop: readonly number[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
    const xi = loop[i] ?? 0, yi = loop[i + 1] ?? 0, xj = loop[j] ?? 0, yj = loop[j + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The distance from a point to the nearest point of a stroke, in page pixels. */
function near(s: Stroke, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < s.points.length; i += 2) best = Math.min(best, Math.hypot((s.points[i] ?? 0) - x, (s.points[i + 1] ?? 0) - y));
  return best;
}

export function TabletView({ doc, dir, fileName, onToast }: { doc: Doc; dir: string; fileName: string; onToast: (text: string) => void }) {
  const pages = useMemo(() => pagesInOrder(doc).filter((p) => p.state === undefined && !p.terminal), [doc]);
  const [pageId, setPageId] = useState<Id | undefined>(() => new URLSearchParams(location.search).get("page") ?? undefined);
  const page = (pageId && doc.pages[pageId]) || pages[0];
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0][1]);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<Stroke[]>([]);
  // The line under the pen: kept in a ref as events come faster than renders, mirrored to state to draw it.
  const [drawing, setDrawing] = useState<Stroke | undefined>();
  const line = useRef<Stroke | undefined>(undefined);
  const draw = (s: Stroke | undefined) => { line.current = s; setDrawing(s); };
  // Marks the lasso caught, to erase together.
  const [caught, setCaught] = useState<Id[]>([]);
  const [note, setNote] = useState<{ x: number; y: number; text: string } | undefined>();
  const [view, setView] = useState({ x: 0, y: 24, k: 1 });
  const [height, setHeight] = useState(900);
  // Marks this tablet drew, newest last, for undo; what undo took, for redo.
  const [mine, setMine] = useState<Id[]>([]);
  const [undone, setUndone] = useState<{ strokes: Stroke[]; node: Id; body?: string }[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; k: number; cx: number; cy: number; d: number } | undefined>(undefined);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const width = page ? widthOf(doc, page.id) : 390;
  const html = useMemo(() => (page ? srcdoc(doc, page.id, dir) : ""), [doc, page, dir]);

  // Fit the page's width on screen when it opens; a person zooms from there.
  useLayoutEffect(() => {
    const w = stage.current?.clientWidth ?? 1024;
    const k = Math.min(1.5, (w - 64) / width);
    setView({ x: (w - width * k) / 2, y: 24, k });
  }, [page?.id, width]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = stage.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0) - view.x) / view.k, y: (e.clientY - (r?.top ?? 0) - view.y) / view.k };
  };

  /** Keeps what the pen drew since it last rested as one mark, on the layer under where it started. */
  const save = async (strokes: Stroke[], body?: string, at?: Id) => {
    if (!page || !strokes.length) return;
    const first = strokes[0];
    const node = at ?? nodeAt(frame.current, first?.points[0] ?? 0, first?.points[1] ?? 0) ?? page.frame;
    const r = await window.buni.edit("mark", { page: page.id, node, strokes, from: device(), ...(body ? { body } : {}) });
    const id = r.reply.match(/thread (\S+)\)/)?.[1];
    if (!r.ok) onToast(r.reply);
    else if (id) setMine((m) => [...m, id]);
  };
  const flush = () => {
    clearTimeout(settle.current);
    setPending((p) => { if (p.length) void save(p); return []; });
  };
  useEffect(() => () => clearTimeout(settle.current), []);
  // The tap that placed the note would take focus back; give it to the note once the tap is over.
  const noting = note !== undefined;
  useEffect(() => { if (noting) requestAnimationFrame(() => noteBox.current?.focus()); }, [noting]);
  // Moving to another page keeps what was drawn on this one.
  const open = (id: Id) => { flush(); setPageId(id); setPicking(false); const u = new URL(location.href); u.searchParams.set("page", id); history.replaceState(null, "", u); };

  const erase = (x: number, y: number) => {
    if (!page) return;
    const hit = marksOn(doc, page.id).find((c) => (c.ink?.strokes ?? []).some((s) => near(s, x, y) < 10 / view.k + s.width));
    if (hit) void window.buni.edit("mark", { remove: hit.id });
    setPending((p) => p.filter((s) => near(s, x, y) >= 10 / view.k + s.width));
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Keep the pen's line when it leaves the page; a pointer that's already gone can't be held, and needn't be.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* drawn without capture */ }
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      startGesture();
      return;
    }
    const p = toPage(e);
    if (tool === "note") { e.preventDefault(); setNote({ x: p.x, y: p.y, text: "" }); return; }
    if (tool === "eraser") { erase(p.x, p.y); return; }
    setCaught([]);
    clearTimeout(settle.current);
    draw({ tool: tool === "lasso" ? "pen" : tool, color: tool === "lasso" ? "#2f6bff" : tool === "highlighter" ? HIGHLIGHT : solid(color), width: tool === "highlighter" ? 16 : 2.5, points: [round(p.x), round(p.y)] });
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      if (!touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moveGesture();
      return;
    }
    if (tool === "eraser" && e.buttons) { const p = toPage(e); erase(p.x, p.y); return; }
    const d = line.current;
    if (!d) return;
    // The pen reports more points than frames: take them all, so a quick line stays smooth.
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const events = coalesced.length ? coalesced : [e.nativeEvent];
    const pts = events.flatMap((ev) => { const p = toPage(ev); return [round(p.x), round(p.y)]; });
    draw({ ...d, points: [...d.points, ...pts] });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") { touches.current.delete(e.pointerId); startGesture(); return; }
    const done = line.current;
    if (!done) return;
    draw(undefined);
    // A lasso picks the marks most of whose ink it went round; it isn't kept.
    if (tool === "lasso") {
      if (page) setCaught(marksOn(doc, page.id).filter((c) => {
        const pts = (c.ink?.strokes ?? []).flatMap((s) => s.points);
        let n = 0;
        for (let i = 0; i + 1 < pts.length; i += 2) if (inside(done.points, pts[i] ?? 0, pts[i + 1] ?? 0)) n++;
        return n > pts.length / 4;
      }).map((c) => c.id));
      return;
    }
    setPending((p) => [...p, done]);
    setUndone([]);
    clearTimeout(settle.current);
    settle.current = setTimeout(flush, SETTLE_MS);
  };

  // One finger moves the page, two pinch to zoom around where they are.
  const startGesture = () => {
    const ts = [...touches.current.values()];
    if (!ts.length) { gesture.current = undefined; return; }
    const cx = ts.reduce((a, t) => a + t.x, 0) / ts.length, cy = ts.reduce((a, t) => a + t.y, 0) / ts.length;
    const d = ts.length > 1 ? Math.hypot((ts[0]?.x ?? 0) - (ts[1]?.x ?? 0), (ts[0]?.y ?? 0) - (ts[1]?.y ?? 0)) : 0;
    gesture.current = { ...view, cx, cy, d };
  };
  const moveGesture = () => {
    const g = gesture.current;
    const ts = [...touches.current.values()];
    if (!g || !ts.length) return;
    const cx = ts.reduce((a, t) => a + t.x, 0) / ts.length, cy = ts.reduce((a, t) => a + t.y, 0) / ts.length;
    const d = ts.length > 1 ? Math.hypot((ts[0]?.x ?? 0) - (ts[1]?.x ?? 0), (ts[0]?.y ?? 0) - (ts[1]?.y ?? 0)) : 0;
    const k = g.d && d ? Math.min(4, Math.max(0.25, (g.k * d) / g.d)) : g.k;
    const r = stage.current?.getBoundingClientRect();
    const ox = g.cx - (r?.left ?? 0), oy = g.cy - (r?.top ?? 0);
    setView({ k, x: cx - (r?.left ?? 0) - ((ox - g.x) * k) / g.k, y: cy - (r?.top ?? 0) - ((oy - g.y) * k) / g.k });
  };

  const undo = () => {
    if (pending.length) { setPending((p) => p.slice(0, -1)); return; }
    const last = mine.at(-1);
    const c = last ? doc.comments[last] : undefined;
    setMine((m) => m.slice(0, -1));
    if (!c?.ink) return;
    const said = c.posts[0]?.body;
    setUndone((u) => [...u, { strokes: c.ink?.strokes ?? [], node: c.node, ...(said && !said.startsWith("Drew ") ? { body: said } : {}) }]);
    void window.buni.edit("mark", { remove: c.id });
  };
  const redo = () => {
    const last = undone.at(-1);
    if (!last) return;
    setUndone((u) => u.slice(0, -1));
    void save(last.strokes, last.body, last.node);
  };
  const keepNote = () => {
    if (!note) return;
    const text = note.text.trim();
    setNote(undefined);
    if (!text) return;
    // A note is a mark too: a small ring where it was tapped, and the words.
    const ring = Array.from({ length: 13 }, (_, i) => [round(note.x + 6 * Math.cos((i / 12) * 2 * Math.PI)), round(note.y + 6 * Math.sin((i / 12) * 2 * Math.PI))]).flat();
    void save([{ tool: "pen", color: solid(color), width: 2.5, points: ring }], text);
  };

  const count = page ? marksOn(doc, page.id).length + (pending.length ? 1 : 0) : 0;
  const at = page ? pages.findIndex((p) => p.id === page.id) + 1 : 0;
  return (
    <div className="tablet">
      <header className="tablet-bar">
        <button type="button" className="tablet-bar-btn" aria-expanded={picking} onClick={() => setPicking((v) => !v)}><PanelLeft size={20} /> Pages</button>
        <div className="tablet-title"><b>{page?.name ?? "No pages yet"}</b><span>{fileName.replace(/\.buni$/, "")}, page {at} of {pages.length}</span></div>
        <span className="tablet-live"><i />Live on your Mac</span>
        <button type="button" className="tablet-send" disabled={!count} onClick={() => { flush(); if (page) void sendMarks(page.id, (t) => onToast(t.replace("Copied", "On your Mac's clipboard:"))); }}>
          Send {count || ""} mark{count === 1 ? "" : "s"} to Claude
        </button>
      </header>
      {picking && (
        <nav className="tablet-pages" aria-label="Pages">
          {pages.map((p) => {
            const n = marksOn(doc, p.id).length;
            return (
              <button type="button" key={p.id} className={p.id === page?.id ? "on" : ""} onClick={() => open(p.id)}>
                <span>{p.name}</span>{n > 0 && <span className="tablet-count">{n}</span>}
              </button>
            );
          })}
        </nav>
      )}
      <div ref={stage} className={`tablet-stage tool-${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {page && (
          <div className="tablet-page" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <iframe
              ref={frame}
              title={page.name}
              sandbox="allow-same-origin"
              srcDoc={html}
              width={width}
              height={height}
              onLoad={() => setHeight(frame.current?.contentDocument?.documentElement.scrollHeight || 900)}
            />
            <InkLayer doc={doc} page={page.id} width={width} />
            <svg className="ink-layer" width={width} height={1} viewBox={`0 0 ${width} 1`} aria-hidden>
              {caught.map((id) => <g key={id} className="tablet-caught"><StrokePaths strokes={doc.comments[id]?.ink?.strokes ?? []} /></g>)}
              <StrokePaths strokes={drawing ? [...pending, drawing] : pending} />
            </svg>
            {caught.length > 0 && (() => {
              const first = doc.comments[caught[0] ?? ""]?.ink?.strokes[0]?.points ?? [0, 0];
              return (
                <div className="tablet-note tablet-caught-bar" style={{ left: first[0], top: (first[1] ?? 0) - 56, transform: `scale(${1 / view.k})` }} onPointerDown={(e) => e.stopPropagation()}>
                  <div>
                    <button type="button" className="tablet-btn" onClick={() => setCaught([])}><X size={14} /> Keep</button>
                    <button type="button" className="tablet-btn dark" onClick={() => { for (const id of caught) void window.buni.edit("mark", { remove: id }); setCaught([]); }}><Trash2 size={14} /> Erase {caught.length} mark{caught.length === 1 ? "" : "s"}</button>
                  </div>
                </div>
              );
            })()}
            {note && (
              <div className="tablet-note" style={{ left: note.x, top: note.y + 12, transform: `scale(${1 / view.k})` }} onPointerDown={(e) => e.stopPropagation()}>
                <textarea ref={noteBox} rows={3} placeholder="What should change here?" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
                <div><button type="button" className="tablet-btn" onClick={() => setNote(undefined)}><X size={14} /> Cancel</button><button type="button" className="tablet-btn dark" onClick={keepNote}>Keep note</button></div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="tablet-tools" role="toolbar" aria-label="Pen tools">
        {([["pen", PenLine, "Pen"], ["highlighter", Highlighter, "Highlighter"], ["eraser", Eraser, "Eraser"], ["lasso", Lasso, "Lasso"], ["note", Type, "Note"]] as const).map(([t, Icon, label]) => (
          <button type="button" key={t} className={tool === t ? "on" : ""} aria-pressed={tool === t} title={label} aria-label={label} onClick={() => setTool(t)}><Icon size={22} /></button>
        ))}
        <span className="tablet-sep" />
        {COLORS.map(([label, c]) => (
          <button type="button" key={label} className={`tablet-swatch${color === c ? " on" : ""}`} aria-pressed={color === c} title={label} aria-label={label} onClick={() => setColor(c)}><i style={{ background: c, color: c }} /></button>
        ))}
        <span className="tablet-sep" />
        <button type="button" title="Undo" aria-label="Undo" disabled={!pending.length && !mine.length} onClick={undo}><Undo2 size={22} /></button>
        <button type="button" title="Redo" aria-label="Redo" disabled={!undone.length} onClick={redo}><Redo2 size={22} /></button>
      </div>
      <div className="tablet-hint" aria-hidden><span><Pencil size={14} /> Pencil draws</span><span><Hand size={14} /> Finger moves and zooms</span></div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
