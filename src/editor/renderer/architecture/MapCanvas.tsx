// The architecture map: cards absolutely placed from the layout, one SVG of links under them, panned and zoomed.
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Id } from "buni/format/doc.ts";
import type { Card } from "./model.ts";
import { moved, nearestBox, revealBy, snapMove, tabOrder, type Direction, type Guide, type MapBox, type MapLayout, type Point, type RoutedLink } from "./layout.ts";

/** How a flow shows the map: what is lit now, what stays shown, and whether the rest dims. */
export interface Look {
  lit: ReadonlySet<Id>;
  shown: ReadonlySet<Id>;
  dimRest: boolean;
}
export type State = "lit" | "normal" | "dim";

export function stateOf(look: Look | undefined, ids: readonly Id[], context: readonly Id[] = []): State {
  if (!look) return "normal";
  if (ids.some((id) => look.lit.has(id))) return "lit";
  if (!look.dimRest || [...ids, ...context].some((id) => look.shown.has(id) || look.lit.has(id))) return "normal";
  return "dim";
}

const STROKE = { live: "rgba(255,255,255,0.35)", planned: "rgba(196,167,255,0.6)", deploy: "rgba(232,196,106,0.55)", added: "rgba(110,200,150,0.7)", removed: "rgba(255,138,128,0.7)", lit: "#8aaeff" } as const;

export function CardBody({ card, children }: { card: Card; children?: ReactNode }) {
  return (
    <>
      <span className="arch-lbl">{card.label}</span>
      <b className="arch-name">{card.name}</b>
      {card.sub && <span className="arch-sub">{card.sub}</span>}
      {card.replicas && <Replicas min={card.replicas.min} max={card.replicas.max} />}
      {card.note && <span className="arch-sub">{card.note}</span>}
      {card.chips?.map((row, i) => (
        <div key={i} className="arch-chips">{row.map((c) => <span key={c} className="arch-chip">{c}</span>)}</div>
      ))}
      {card.adds && <div className="arch-chips">{card.adds.map((c) => <span key={c} className="arch-chip add">{c}</span>)}</div>}
      {children}
    </>
  );
}

export function Replicas({ min, max, color }: { min: number; max: number; color?: string }) {
  return (
    <div className="arch-reps" aria-label={`${min} replicas${max > min ? `, up to ${max}` : ""}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={i < min ? "on" : ""} style={i < min && color ? { background: color } : undefined} />)}
    </div>
  );
}

function arrow(pts: readonly Point[]): string {
  const [a, b] = [pts.at(-2), pts.at(-1)];
  if (!a || !b) return "";
  const [dx, dy] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
  const [x, y] = b;
  return dx ? `${x},${y} ${x - 7 * dx},${y - 4} ${x - 7 * dx},${y + 4}` : `${x},${y} ${x - 4},${y - 7 * dy} ${x + 4},${y - 7 * dy}`;
}

const strokeOf = (l: RoutedLink, s: State) => (s === "lit" ? (l.tone === "deploy" ? "#e8c46a" : STROKE.lit) : STROKE[l.tone === "live" ? "live" : l.tone]);

const ARROWS: Partial<Record<string, Direction>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

export interface MapCanvasProps {
  layout: MapLayout;
  /** Changes when a different map is shown (level, environment): the view fits it again. */
  fitKey: string;
  look?: Look;
  selected?: Id | undefined;
  onSelect?: (id: Id | undefined) => void;
  /** Step numbers drawn on the boxes they belong to, by box key. */
  badges?: ReadonlyMap<string, number>;
  /** Draws a box differently (a canary split), by key. */
  render?: (box: MapBox, state: State) => ReactNode | undefined;
  /** Above a box, by key: a payload being carried. */
  bubble?: { key: string; text: string } | undefined;
  /** Kept clear at the bottom (a timeline over the canvas). */
  bottomInset?: number;
  footer?: ReactNode;
  /** Dragging from a card's edge handle onto another card: which cards have one, and the drop. */
  canLink?: (box: MapBox) => boolean;
  onLink?: (from: MapBox, to: MapBox, at: { x: number; y: number }) => void;
  /** Dragging a card moves it: which can be, and where they were put (top-left, by key) once dropped. */
  movable?: (box: MapBox) => boolean;
  /** Resolves false when the move was refused: the cards go back. */
  onMove?: (to: ReadonlyMap<string, Point>) => Promise<boolean>;
}

export function MapCanvas({ layout: given, fitKey, look, selected, onSelect, badges, render, bubble, bottomInset = 0, footer, canLink, onLink, movable, onMove }: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  // Cards being dragged, drawn where they are going with the links routed round them; once dropped, held there until
  // the file says so (or the move is refused), so nothing jumps back in between.
  const [moving, setMoving] = useState<{ to: ReadonlyMap<string, Point>; guides: Guide[]; done?: boolean }>();
  useEffect(() => setMoving((m) => (m?.done ? undefined : m)), [given]);
  const layout = useMemo(() => (moving ? moved(given, moving.to) : given), [given, moving]);
  const justMoved = useRef(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const fit = (keep?: Id) => {
    const r = host.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    // The whole width, at no more than 100%; a tall map scrolls (or pans) rather than shrinking out of reading.
    const k = Math.max(0.4, Math.min(1, r.width / layout.width));
    const v = { k, x: Math.max(0, (r.width - layout.width * k) / 2), y: 0 };
    // What is selected stays in sight.
    const b = keep === undefined ? undefined : [...layout.boxes, ...layout.frames].find((x) => x.ids[0] === keep);
    if (b) {
      v.x += revealBy(v.x + b.x * k, b.w * k, r.width);
      v.y += revealBy(v.y + b.y * k, b.h * k, r.height);
    }
    setView(v);
  };
  useLayoutEffect(() => fit(selected), [fitKey]);
  // The canvas narrows when a pane opens beside it and widens when one closes (or the window resizes): fit again.
  const refit = useEffectEvent(() => fit(selected));
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      refit();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const onWheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault();
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    if (e.ctrlKey || e.metaKey) {
      const [px, py] = [e.clientX - r.left, e.clientY - r.top];
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // React's wheel listener is passive: a pinch would zoom the whole window too.
    const wheel = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  // Dragging the background pans; a click on it (no drag) clears the selection.
  const drag = useRef<{ x: number; y: number; moved: boolean }>(undefined);
  const zoomBy = (f: number) => setView((v) => {
    const r = host.current?.getBoundingClientRect();
    const [px, py] = r ? [r.width / 2, r.height / 2] : [0, 0];
    const k = Math.min(2.5, Math.max(0.3, v.k * f));
    return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
  });
  // Pans so `el` (a card, a title, a label) shows; what focus would scroll the clipped canvas to, the view does instead.
  const reveal = (el: Element) => {
    const host_ = host.current;
    if (!host_) return;
    host_.scrollLeft = host_.scrollTop = 0;
    const [h, r] = [host_.getBoundingClientRect(), el.getBoundingClientRect()];
    const [dx, dy] = [revealBy(r.left - h.left, r.width, h.width), revealBy(r.top - h.top, r.height, h.height)];
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const order = useMemo(() => tabOrder(layout), [layout]);
  const linkState = (l: RoutedLink): State => (l.ids[0] !== undefined && l.ids[0] === selected ? "lit" : stateOf(look, l.ids, l.context));
  // A link being drawn: from a card's handle to the pointer, in the plane's coordinates.
  const [drawing, setDrawing] = useState<{ from: MapBox; x: number; y: number }>();
  const toPlane = (cx: number, cy: number): Point => {
    const r = host.current?.getBoundingClientRect();
    return r ? [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k] : [0, 0];
  };
  const startMove = (b: MapBox) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !onMove || !movable?.(b)) return;
    e.stopPropagation();
    justMoved.current = false;
    const start = toPlane(e.clientX, e.clientY);
    // Its Ingress and Service go along with a workload; the rest are what it lines up with.
    const others = given.boxes.filter((x) => x !== b && !x.key.startsWith(`${b.key}#`));
    let to: Map<string, Point> | undefined;
    const move = (m: PointerEvent) => {
      const [px, py] = toPlane(m.clientX, m.clientY);
      const [dx, dy] = [px - start[0], py - start[1]];
      if (!to && Math.abs(dx) + Math.abs(dy) < 4 / view.k) return;
      const snap = snapMove({ ...b, x: b.x + dx, y: b.y + dy }, others);
      to = new Map([[b.key, [snap.x, snap.y]]]);
      setMoving({ to, guides: snap.guides });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!to) return;
      justMoved.current = true;
      setMoving({ to, guides: [], done: true });
      const mine = to;
      void onMove(to).then((ok) => { if (!ok) setMoving((m) => (m?.to === mine ? undefined : m)); });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const startLink = (from: MapBox) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const [x, y] = toPlane(e.clientX, e.clientY);
    setDrawing({ from, x, y });
    const move = (m: PointerEvent) => { const [mx, my] = toPlane(m.clientX, m.clientY); setDrawing({ from, x: mx, y: my }); };
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrawing(undefined);
      const [ux, uy] = toPlane(u.clientX, u.clientY);
      const to = layout.boxes.find((b) => b !== from && canLink?.(b) && ux >= b.x && ux <= b.x + b.w && uy >= b.y && uy <= b.y + b.h);
      if (to) onLink?.(from, to, { x: u.clientX, y: u.clientY });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      ref={host}
      className="arch-canvas"
      onFocus={(e) => { if (e.target !== host.current && !e.target.closest(".arch-zoom")) reveal(e.target); }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest(".arch-card, .arch-zoom, .arch-hit, .arch-frame-title, .arch-link-label")) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        d.moved = true;
        drag.current = { x: e.clientX, y: e.clientY, moved: true };
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) onSelect?.(undefined);
        drag.current = undefined;
      }}
    >
      <div className="arch-plane" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="arch-links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
          {[...layout.links].sort((a, b) => Number(linkState(a) === "lit") - Number(linkState(b) === "lit")).map((l) => {
            const s = linkState(l);
            const stroke = strokeOf(l, s);
            return (
              <g key={l.key} opacity={s === "dim" ? 0.25 : 1}>
                <path d={`M${l.points.map((p) => p.join(" ")).join(" L")}`} fill="none" stroke={stroke} strokeWidth={s === "lit" ? 1.6 : 1.3} strokeDasharray={l.tone === "live" ? undefined : "4 4"} />
                <polygon points={arrow(l.points)} fill={stroke} />
                {onSelect && l.ids[0] !== undefined && (
                  <path className="arch-hit" d={`M${l.points.map((p) => p.join(" ")).join(" L")}`} onClick={() => onSelect(l.ids[0])} />
                )}
              </g>
            );
          })}
          {moving?.guides.map((g, i) => (
            <line key={i} className="arch-guide" x1={g.axis === "x" ? g.at : g.from} x2={g.axis === "x" ? g.at : g.to} y1={g.axis === "x" ? g.from : g.at} y2={g.axis === "x" ? g.to : g.at} />
          ))}
          {drawing && (
            <path className="arch-drawing" d={`M${drawing.from.x + drawing.from.w} ${drawing.from.y + drawing.from.h / 2} L${drawing.x} ${drawing.y}`} />
          )}
        </svg>
        {layout.captions.map((c) => <span key={`${c.text} ${c.x} ${c.y}`} className="arch-caption" style={{ left: c.x, top: c.y }}>{c.text}</span>)}
        {/* Frames and cards in reading order, so Tab goes a frame's title, then its cards, then the next frame. */}
        {order.map((stop) => {
          if ("frame" in stop) {
            const f = stop.frame;
            const id = onSelect ? f.ids[0] : undefined;
            const title = <>{f.title.lead}<b>{f.title.bold}</b>{f.title.rest}{f.title.link && <span className="arch-link-text">{f.title.link}</span>}</>;
            return (
              <div key={f.key} className={`arch-frame ${stateOf(look, f.ids)}${f.ids[0] !== undefined && f.ids[0] === selected ? " selected" : ""}`} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
                {id !== undefined
                  ? <button type="button" className="arch-frame-title pickable" onClick={() => onSelect?.(id)}>{title}</button>
                  : <span className="arch-frame-title">{title}</span>}
              </div>
            );
          }
          const b = stop.box;
          const s = stateOf(look, b.ids, b.context);
          const own = b.ids[0] ?? b.context?.[0];
          const badge = badges?.get(b.key);
          return (
            <div
              key={b.key}
              role="button"
              tabIndex={0}
              className={`arch-card tone-${b.card.tone} ${s}${b.ids[0] !== undefined && b.ids[0] === selected ? " selected" : ""}${moving?.to.has(b.key) && !moving.done ? " moving" : ""}${movable?.(b) ? " movable" : ""}`}
              style={{ left: b.x, top: b.y, width: b.w, minHeight: b.h }}
              onPointerDown={startMove(b)}
              onClick={() => {
                // The click that ends a drag isn't a pick.
                if (justMoved.current) { justMoved.current = false; return; }
                onSelect?.(own);
              }}
              data-key={b.key}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(own); return; }
                // Arrows move to the nearest card that way.
                const dir = ARROWS[e.key];
                const to = dir && nearestBox(layout.boxes, b, dir);
                if (!to) return;
                e.preventDefault();
                host.current?.querySelector<HTMLElement>(`.arch-card[data-key="${CSS.escape(to.key)}"]`)?.focus({ preventScroll: true });
              }}
            >
              {render?.(b, s) ?? <CardBody card={b.card} />}
              {badge !== undefined && <span className="arch-badge">{badge}</span>}
              {onLink && canLink?.(b) && <span className="arch-handle" title="Drag onto another part to link them" onPointerDown={startLink(b)} onClick={(e) => e.stopPropagation()} />}
            </div>
          );
        })}
        {layout.links.filter((l) => l.at && l.label).map((l) => {
          const s = linkState(l);
          return (
            onSelect && l.ids[0] !== undefined
              ? <button key={l.key} type="button" className={`arch-link-label ${s} tone-${l.tone} pickable`} style={{ left: l.at![0], top: l.at![1] }} onClick={() => onSelect(l.ids[0])}>{l.label}</button>
              : <span key={l.key} className={`arch-link-label ${s} tone-${l.tone}`} style={{ left: l.at![0], top: l.at![1] }}>{l.label}</span>
          );
        })}
        {bubble && (() => {
          const b = layout.boxes.find((x) => x.key === bubble.key);
          return b && <code className="arch-bubble" style={{ left: b.x + b.w / 2, top: b.y - 46 }}>{bubble.text}</code>;
        })()}
      </div>
      {footer}
      <div className="arch-zoom" style={{ bottom: 16 + bottomInset }}>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Minus size={13} /></button>
        <button type="button" aria-label="Fit" title="Fit" onClick={() => fit()}><span>{Math.round(view.k * 100)}%</span></button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Plus size={13} /></button>
        <button type="button" aria-label="Fit the map" title="Fit the map" onClick={() => fit()}><Maximize size={12} /></button>
      </div>
    </div>
  );
}
