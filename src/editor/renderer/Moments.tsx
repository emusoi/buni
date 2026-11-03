// The page's motion as moments under the canvas: six frames from rest to the last arrival, each held at its time,
// so order and pace are read in one glance; Play runs it for real. The same moments buni shot --frames draws.
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import { MOMENT_CLOCK_JS, motionCss, SCRIPT_MOMENTS_MS } from "buni/tools/html.ts";
import { srcdoc } from "./Canvas.tsx";
import { widthOf } from "./layout.ts";
import { entrancesOn, momentTimes, motionEnd } from "./moments.ts";

const COUNT = 6;
const EACH = 132;
const TALL = 84;

/** One moment: the page in an iframe, every animation held at `time`; a live page's clock is stepped there. */
function Moment({ html, time, width, live }: { html: string; time: number; width: number; live: boolean }) {
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
            sandbox={live ? "allow-same-origin allow-scripts" : "allow-same-origin"}
            src={url}
            width={width}
            height={Math.round(TALL / scale)}
            style={{ transform: `scale(${scale})` }}
            onLoad={(e) => {
              const w = e.currentTarget.contentWindow as (Window & { __buniHold?: (ms: number) => Promise<void> }) | null;
              if (w?.__buniHold) void w.__buniHold(time);
              else for (const a of w?.document.getAnimations() ?? []) { a.pause(); a.currentTime = time; }
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
  const live = Boolean(doc.pages[page]?.live);
  const width = widthOf(doc, page);
  // Reduced motion is what people who ask for less see: every layer at rest, nothing held mid-way.
  const html = useMemo(() => srcdoc(doc, page, dir, reduced ? "" : motionCss(doc, { scrollByTime: true }), mode, live ? `<script>${MOMENT_CLOCK_JS}</script>` : ""), [doc, page, dir, mode, reduced, live]);
  const moving = new Set(entrancesOn(doc, page).map(([id]) => id)).size;
  // A live page's own script is followed for its first seconds; a loop is caught where it is at each moment.
  const end = Math.max(motionEnd(doc, page), live ? SCRIPT_MOMENTS_MS : 0);
  if (!end) return null;
  return (
    <section className="moments" aria-label="Moments">
      <div className="moments-head">
        <button type="button" className="icon-btn" title="Play the page" aria-label="Play the page" onClick={onPlay}><Play size={14} /></button>
        <b>Moments</b>
        <span className="dim">{live && !moving ? "scripts" : "load"} · 0 to {end} ms · {moving ? `${moving} ${moving === 1 ? "layer moves" : "layers move"}` : "the page's script, a loop caught where it is"}</span>
        <span className="grow" />
        <label className="switch-label">
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
          Reduced motion
        </label>
      </div>
      <div className="moments-row">
        {momentTimes(end, COUNT).map((t) => <Moment key={`${t}-${reduced}`} html={html} time={t} width={width} live={live} />)}
      </div>
    </section>
  );
}
