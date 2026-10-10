// The widths a page must work at: its own, and any others. A chip shows the page at that width on the canvas, and
// while it is shown there the Inspector edits the page's layers at that width only.
import { useState } from "react";
import { Monitor, Plus, Smartphone, Tablet, X } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import { widthOf } from "./layout.ts";

const COMMON: [number, string][] = [[390, "Phone"], [768, "Tablet"], [1024, "Small laptop"], [1440, "Desktop"], [1920, "Wide"]];
const icon = (w: number) => (w < 600 ? Smartphone : w < 1100 ? Tablet : Monitor);

export function Widths({ doc, page, viewWidth, onView, onError }: {
  doc: Doc;
  page: Id;
  viewWidth: number | undefined;
  onView: (width: number | undefined) => void;
  onError: (m: string | undefined) => void;
}) {
  const p = doc.pages[page];
  const [adding, setAdding] = useState(false);
  if (!p || p.terminal) return null;
  const own = widthOf(doc, page);
  const widths = p.widths ?? [];
  const all = [own, ...widths].sort((a, b) => a - b);
  const set = async (next: number[]) => {
    const r = await window.buni.edit("set_widths", { page, widths: next });
    onError(r.ok ? undefined : r.reply);
  };
  const shown = viewWidth ?? own;
  return (
    <section className="widths" aria-label="Widths">
      <div className="widths-head">
        <b>Widths</b>
        <span className="hint">{widths.length ? "Pick one to see and style the page there" : "Add the widths this page must work at"}</span>
      </div>
      <div className="width-chips">
        {all.map((w) => {
          const Icon = icon(w);
          return (
            <span key={w} className={`width-chip${w === shown ? " on" : ""}`}>
              <button type="button" onClick={() => onView(w === own ? undefined : w)} title={w === own ? "The page's own width" : `See ${p.name} at ${w} px`}>
                <Icon size={12} /> {w}{w === own ? <i> own</i> : null}
              </button>
              {w !== own && <button type="button" className="width-x" aria-label={`Remove ${w} px`} title="Remove this width and the styles kept for it" onClick={() => { if (shown === w) onView(undefined); void set(widths.filter((x) => x !== w)); }}><X size={10} /></button>}
            </span>
          );
        })}
        <button type="button" className="width-chip add" aria-label="Add a width" onClick={() => setAdding((a) => !a)}><Plus size={12} /></button>
      </div>
      {adding && (
        <div className="width-add">
          {COMMON.filter(([w]) => !all.includes(w)).map(([w, label]) => (
            <button key={w} type="button" className="link-btn" onClick={() => { setAdding(false); void set([...widths, w]).then(() => onView(w)); }}>{label} · {w}</button>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); const w = Number(new FormData(e.currentTarget).get("w")); if (Number.isInteger(w) && w >= 240 && w <= 3840) { setAdding(false); void set([...widths, w]).then(() => onView(w)); } }}>
            <input name="w" className="field mono" type="number" min={240} max={3840} placeholder="px" aria-label="Other width in px" />
          </form>
        </div>
      )}
    </section>
  );
}
