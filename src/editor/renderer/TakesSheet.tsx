// A page's takes side by side: the live one and its options, each with its idea, to play, edit, or pick. The pick is
// written with its why, which stays with the page.
import { useEffect, useMemo, useState } from "react";
import { Layers, Play, Sparkles, X } from "lucide-react";
import { optionsOf, type Doc, type Id, type Page } from "buni/format/doc.ts";
import { srcdoc } from "./Canvas.tsx";
import { widthOf } from "./layout.ts";

const CARD = 340;
const TALL = 212;

/** A page's own height from its frame, for fitting a picture of it; 900 when it has none. */
function heightOf(doc: Doc, page: Id): number {
  const style = doc.nodes[doc.pages[page]?.frame ?? ""]?.style;
  const given = style?.height ?? style?.minHeight ?? "";
  return /^\d+(?:\.\d+)?px$/.test(given) ? Number.parseFloat(given) : 900;
}
/** The picture fits the card: a wide page by width, a tall phone screen by height, so nothing is cut off. */
export function fit(width: number, height: number): { scale: number; w: number; h: number } {
  const scale = Math.min(CARD / width, TALL / height);
  return { scale, w: Math.round(width * scale), h: Math.round(height * scale) };
}

/** The page whose takes these are: a take's parent, else the page itself. */
export function liveOf(doc: Doc, page: Id): Page | undefined {
  const p = doc.pages[page];
  return p?.option ? doc.pages[p.option.of] : p;
}

function Thumb({ doc, page, dir, mode }: { doc: Doc; page: Id; dir: string; mode: string | undefined }) {
  const html = useMemo(() => srcdoc(doc, page, dir, "", mode), [doc, page, dir, mode]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [html]);
  const width = widthOf(doc, page);
  // Fitted by the page's own height first, then by the height it draws at (a phone screen is taller than it is wide).
  const [drawn, setDrawn] = useState<number>();
  const { scale, w, h } = fit(width, drawn ?? heightOf(doc, page));
  return (
    <div className="take-thumb" style={{ width: w, height: h }}>
      {url && <iframe title={doc.pages[page]?.name} sandbox={doc.pages[page]?.live ? "allow-same-origin allow-scripts" : "allow-same-origin"} src={url} width={width} height={Math.round(h / scale)} style={{ transform: `scale(${scale})` }}
        onLoad={(e) => { const d = e.currentTarget.contentDocument; const tall = d?.documentElement.scrollHeight; if (tall && Math.abs(tall - (drawn ?? heightOf(doc, page))) > 8) setDrawn(tall); }} />}
    </div>
  );
}

export function TakesSheet({ doc, dir, page, mode, onClose, onPlay, onEdit, onToast }: {
  doc: Doc; dir: string; page: Id; mode: string | undefined;
  onClose: () => void; onPlay: (page: Id) => void; onEdit: (page: Id) => void; onToast: (t: string) => void;
}) {
  const live = liveOf(doc, page);
  const [why, setWhy] = useState("");
  const [dropOthers, setDropOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  if (!live) return null;
  const takes = [live, ...optionsOf(doc, live.id)];
  const pick = async (take: Page) => {
    setBusy(true);
    const r = await window.buni.edit("pick_option", { option: take.id, why: why.trim() || "Picked in the editor", ...(dropOthers ? { others: "delete" } : {}) });
    setBusy(false);
    onToast(r.ok ? `${r.reply} ⌘Z takes it back.` : r.reply);
    // The winner is now the page on the canvas: open it there.
    if (r.ok) onEdit(take.id);
  };
  const another = async () => {
    const r = await window.buni.edit("add_task", { title: `Another take of ${live.name}`, page: live.id });
    onToast(r.ok ? "Asked. An agent on this design hears of it on its next step." : r.reply);
  };
  return (
    <div className="takes-dim" onClick={onClose}>
      <section className="takes-sheet" role="dialog" aria-label={`Takes of ${live.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="takes-head">
          <Layers size={16} className="dim" />
          <b>Takes of {live.name}</b>
          <span className="dim">{takes.length} · the live one shows on the canvas</span>
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => void another()}><Sparkles size={13} /> Ask for another take</button>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="takes-cards">
          {takes.map((t) => {
            const isLive = t.id === live.id;
            return (
              <article key={t.id} className={`take${isLive ? " live" : ""}`} style={{ width: Math.max(200, fit(widthOf(doc, t.id), heightOf(doc, t.id)).w) }}>
                <div className="take-pic">
                  <Thumb doc={doc} page={t.id} dir={dir} mode={mode} />
                  {isLive && <span className="take-live">Live now</span>}
                </div>
                <div className="take-name"><b>{t.name}</b>{t.live && <small>scripts run</small>}</div>
                <p className="take-idea">{t.option?.idea ?? (t.picked ? `Picked: ${t.picked.why}` : "The page as it is.")}</p>
                <div className="take-actions">
                  {isLive ? <span className="btn small is-live">Live</span> : <button type="button" className="btn small primary" disabled={busy} onClick={() => void pick(t)}>Pick this</button>}
                  <button type="button" className="btn small" onClick={() => onPlay(t.id)}><Play size={12} /> Play</button>
                  <button type="button" className="btn small" onClick={() => onEdit(t.id)}>Edit</button>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="takes-foot">
          <span className="dim">Why</span>
          <input className="field" placeholder="Written when you pick; it stays with the page" value={why} onChange={(e) => setWhy(e.target.value)} />
          <label className="switch-label"><input type="checkbox" checked={dropOthers} onChange={(e) => setDropOthers(e.target.checked)} /> Delete the others</label>
        </footer>
      </section>
    </div>
  );
}
