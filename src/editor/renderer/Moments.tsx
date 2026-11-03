// The page's motion as moments under the canvas: six frames from rest to the last arrival, each held at its time,
// so order and pace are read in one glance; Play runs it for real. The same moments buni shot --frames draws.
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import { motionCss } from "buni/tools/html.ts";
import { srcdoc } from "./Canvas.tsx";
import { widthOf } from "./layout.ts";
import { entrancesOn, momentTimes, motionEnd } from "./moments.ts";

const COUNT = 6;
const EACH = 132;
const TALL = 84;

/** One moment: the page in an iframe, every animation paused at `time`. */
function Moment({ html, time, width }: { html: string; time: number; width: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [html]);
  const scale = EACH / width;
  return (
    <figure className="moment">
      <div className="moment-frame" style={{ width: EACH, height: TALL }}>
        {url && (
          <iframe
            title={`${time} ms`}
            sandbox="allow-same-origin"
            src={url}
            width={width}
            height={Math.round(TALL / scale)}
            style={{ transform: `scale(${scale})` }}
            onLoad={(e) => {
              // Two frames later the held moment is what the frame shows, as the filmstrip does.
              for (const a of e.currentTarget.contentDocument?.getAnimations() ?? []) { a.pause(); a.currentTime = time; }
            }}
          />
        )}
      </div>
      <figcaption className="mono">{time} ms</figcaption>
    </figure>
  );
}

export function Moments({ doc, page, dir, mode, onPlay }: { doc: Doc; page: Id; dir: string; mode?: string | undefined; onPlay: () => void }) {
  const [reduced, setReduced] = useState(false);
  const end = motionEnd(doc, page);
  const width = widthOf(doc, page);
  // Reduced motion is what people who ask for less see: every layer at rest, nothing held mid-way.
  const html = useMemo(() => srcdoc(doc, page, dir, reduced ? "" : motionCss(doc, { scrollByTime: true }), mode), [doc, page, dir, mode, reduced]);
  const moving = new Set(entrancesOn(doc, page).map(([id]) => id)).size;
  if (!end) return null;
  return (
    <section className="moments" aria-label="Moments">
      <div className="moments-head">
        <button type="button" className="icon-btn" title="Play the page" aria-label="Play the page" onClick={onPlay}><Play size={14} /></button>
        <b>Moments</b>
        <span className="dim">load · 0 to {end} ms · {moving} {moving === 1 ? "layer moves" : "layers move"}</span>
        <span className="grow" />
        <label className="switch-label">
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
          Reduced motion
        </label>
      </div>
      <div className="moments-row">
        {momentTimes(end, COUNT).map((t) => <Moment key={`${t}-${reduced}`} html={html} time={t} width={width} />)}
      </div>
    </section>
  );
}
