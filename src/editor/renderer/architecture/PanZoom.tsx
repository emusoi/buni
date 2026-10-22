// Moving around a drawn view that isn't the map (the API view): drag empty space to pan, scroll to pan, pinch or
// ⌘-scroll to zoom, and the map's zoom buttons. The map keeps its own (MapCanvas.tsx): it also moves cards and picks.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

const MIN = 0.3, MAX = 2.5;
/** What a drag can start on without panning: anything you press or type in. */
const PRESSABLE = "button, input, textarea, select, a, [role='button']";

export function usePanZoom(size: { width: number; height: number }, onBackground?: () => void) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const fit = () => {
    const r = host.current?.getBoundingClientRect();
    if (!r || !size.width) return;
    // Shown at 100% when it fits, else as large as fits; never blown up past 100%.
    const k = Math.max(MIN, Math.min(1, (r.width - 32) / size.width, (r.height - 32) / size.height));
    setView({ k, x: 0, y: 0 });
  };
  useLayoutEffect(fit, [size.width, size.height]);
  const zoomAt = (k: number, px: number, py: number) => setView((v) => {
    const n = Math.min(MAX, Math.max(MIN, k));
    return { k: n, x: px - ((px - v.x) * n) / v.k, y: py - ((py - v.y) * n) / v.k };
  });
  const zoomBy = (f: number) => { const r = host.current?.getBoundingClientRect(); zoomAt(view.k * f, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2); };
  const onWheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault();
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    if (e.ctrlKey || e.metaKey) zoomAt(view.k * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Not React's passive listener: a pinch would zoom the whole window too.
    const wheel = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const drag = useRef<{ x: number; y: number; moved: boolean }>(undefined);
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as Element).closest(PRESSABLE)) return;
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* panned without capture */ }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.current = { x: e.clientX, y: e.clientY, moved: true };
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = undefined;
      if (d && !d.moved) onBackground?.();
    },
  };
  const zoom = (
    <div className="arch-zoom" style={{ bottom: 16 }}>
      <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Minus size={13} /></button>
      <button type="button" aria-label="Fit" title="Fit" onClick={fit}><span>{Math.round(view.k * 100)}%</span></button>
      <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Plus size={13} /></button>
      <button type="button" aria-label="Fit everything" title="Fit everything" onClick={fit}><Maximize size={12} /></button>
    </div>
  );
  return { host, handlers, zoom, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` };
}
