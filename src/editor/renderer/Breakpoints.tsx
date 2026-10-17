// A page at every width it must work at, side by side and live: what a change does at each size, seen at once.
import { useLayoutEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Tablet, X } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import { srcdoc } from "./Canvas.tsx";
import { widthOf } from "./layout.ts";

/** With no other widths set, the sizes worth checking any page at. */
const FALLBACK = [1440, 768, 390];
const NAME = (w: number) => (w < 600 ? "Phone" : w < 1100 ? "Tablet" : "Desktop");
const ICON = (w: number) => (w < 600 ? Smartphone : w < 1100 ? Tablet : Monitor);

export function Breakpoints({ doc, page, dir, onEdit, onClose }: {
  doc: Doc;
  page: Id;
  dir: string;
  /** Back to the canvas, editing the page at this width (its own width: undefined). */
  onEdit: (width: number | undefined) => void;
  onClose: () => void;
}) {
  const p = doc.pages[page];
  const own = widthOf(doc, page);
  const widths = [...new Set([own, ...(p?.widths?.length ? p.widths : FALLBACK)])].sort((a, b) => b - a);
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(1200);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setRoom(el.clientWidth);
    fit();
    const o = new ResizeObserver(fit);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  if (!p) return null;
  // One scale for all, so sizes compare truly: the widths side by side fill the room, never past half size.
  const gap = 32;
  const scale = Math.min(0.5, (room - gap * (widths.length - 1)) / widths.reduce((a, w) => a + w, 0));
  const html = srcdoc(doc, page, dir);
  return (
    <div className="breakpoints">
      <header className="breakpoints-head">
        <b>{p.name}</b><span>at {widths.length} widths</span>
        <button type="button" className="icon-btn" aria-label="Back to the canvas" title="Back to the canvas (Esc)" onClick={onClose}><X size={15} /></button>
      </header>
      <div className="breakpoints-row" ref={box} style={{ gap }}>
        {widths.map((w) => {
          const Icon = ICON(w);
          return (
            <button type="button" key={w} className="breakpoint" title={`Edit ${p.name} at ${w} px`} onClick={() => onEdit(w === own ? undefined : w)}>
              <span className="breakpoint-label"><Icon size={12} /> {NAME(w)} <span className="mono">{w}</span>{w === own && <em>own</em>}</span>
              <span className="breakpoint-frame" style={{ width: w * scale, height: 900 * scale }}>
                <iframe title={`${p.name} at ${w}`} sandbox="" srcDoc={html} tabIndex={-1} style={{ width: w, height: 900, transform: `scale(${scale})` }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
