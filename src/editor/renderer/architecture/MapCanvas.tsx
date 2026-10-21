// The architecture map: cards absolutely placed from the layout, one SVG of links under them, panned and zoomed.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Id } from "buni/format/doc.ts";
import type { Card } from "./model.ts";
import type { MapBox, MapLayout, Point, RoutedLink } from "./layout.ts";

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
}

export function MapCanvas({ layout, fitKey, look, selected, onSelect, badges, render, bubble, bottomInset = 0, footer }: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const fit = () => {
    const r = host.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    // The whole width, at no more than 100%; a tall map scrolls (or pans) rather than shrinking out of reading.
    const k = Math.max(0.4, Math.min(1, r.width / layout.width));
    setView({ k, x: Math.max(0, (r.width - layout.width * k) / 2), y: 0 });
  };
  useLayoutEffect(fit, [fitKey]);
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
  const linkState = (l: RoutedLink) => stateOf(look, l.ids, l.context);
  return (
    <div
      ref={host}
      className="arch-canvas"
      onPointerDown={(e) => {
        if ((e.target as Element).closest(".arch-card, .arch-zoom")) return;
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
              </g>
            );
          })}
        </svg>
        {layout.frames.map((f) => (
          <div key={f.key} className={`arch-frame ${stateOf(look, f.ids)}`} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
            <span className="arch-frame-title">
              {f.title.lead}<b>{f.title.bold}</b>{f.title.rest}{f.title.link && <span className="arch-link-text">{f.title.link}</span>}
            </span>
          </div>
        ))}
        {layout.captions.map((c) => <span key={`${c.text} ${c.x} ${c.y}`} className="arch-caption" style={{ left: c.x, top: c.y }}>{c.text}</span>)}
        {layout.boxes.map((b) => {
          const s = stateOf(look, b.ids, b.context);
          const own = b.ids[0] ?? b.context?.[0];
          const badge = badges?.get(b.key);
          return (
            <div
              key={b.key}
              role="button"
              tabIndex={0}
              className={`arch-card tone-${b.card.tone} ${s}${b.ids[0] !== undefined && b.ids[0] === selected ? " selected" : ""}`}
              style={{ left: b.x, top: b.y, width: b.w, minHeight: b.h }}
              onClick={() => onSelect?.(own)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(own); } }}
            >
              {render?.(b, s) ?? <CardBody card={b.card} />}
              {badge !== undefined && <span className="arch-badge">{badge}</span>}
            </div>
          );
        })}
        {layout.links.filter((l) => l.at && l.label).map((l) => {
          const s = linkState(l);
          return (
            <span key={l.key} className={`arch-link-label ${s} tone-${l.tone}`} style={{ left: l.at![0], top: l.at![1] }}>{l.label}</span>
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
        <button type="button" aria-label="Fit" title="Fit" onClick={fit}><span>{Math.round(view.k * 100)}%</span></button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Plus size={13} /></button>
        <button type="button" aria-label="Fit the map" title="Fit the map" onClick={fit}><Maximize size={12} /></button>
      </div>
    </div>
  );
}
