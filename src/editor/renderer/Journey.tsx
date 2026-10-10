import { Fragment, useMemo, useState } from "react";
import { Play as PlayIcon } from "lucide-react";
import { walkFlow, type Doc, type Id, type JourneyStep } from "buni/format/doc.ts";
import { srcdoc } from "./Canvas.tsx";
import { widthOf } from "./layout.ts";

const COL = 260;
const THUMB = COL - 24;
const CURVE_H = 96;

export function Thumb({ doc, dir, page }: { doc: Doc; dir: string; page: Id }) {
  const width = widthOf(doc, page);
  const scale = THUMB / width;
  const html = useMemo(() => srcdoc(doc, page, dir), [doc, page, dir]);
  return (
    <div className="thumb" style={{ width: THUMB, height: Math.round(900 * scale) }}>
      <iframe title={doc.pages[page]?.name ?? page} sandbox="allow-same-origin" srcDoc={html} width={width} height={900} style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }} />
    </div>
  );
}

/** How sure the team is at each step, 1 (lost) to 5 (confident), as one line across the screens. */
function Curve({ steps }: { steps: readonly JourneyStep[] }) {
  const y = (c: number) => CURVE_H - 14 - ((c - 1) / 4) * (CURVE_H - 28);
  const points = steps.flatMap((s, i) => (s.confidence === undefined ? [] : [{ x: i * COL + COL / 2, y: y(s.confidence), c: s.confidence }]));
  return (
    <svg className="curve" width={steps.length * COL} height={CURVE_H}>
      {[1, 3, 5].map((c) => <line key={c} x1={0} x2={steps.length * COL} y1={y(c)} y2={y(c)} className="grid" />)}
      <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
      {points.map((p) => (
        <g key={p.x} className={p.c <= 2 ? "low" : ""}>
          <circle cx={p.x} cy={p.y} r={11} />
          <text x={p.x} y={p.y + 4}>{p.c}</text>
        </g>
      ))}
    </svg>
  );
}

/** Screens in a line with what the person does, thinks and meets at each one. */
export function Journey({ doc, dir, flow, onPlay, onOpenPage }: { doc: Doc; dir: string; flow: Id; onPlay: (start: Id) => void; onOpenPage: (id: Id) => void }) {
  const f = doc.flows[flow];
  const journey = Object.values(doc.journeys).find((j) => j.flow === flow);
  const steps: JourneyStep[] = journey?.steps ?? (f ? walkFlow(doc, f.start).pages.map((page) => ({ page, cells: {}, evidence: [] })) : []);
  const lanes = journey?.lanes ?? [];
  const [focus, setFocus] = useState<number>();
  if (!f) return <div className="empty">This flow no longer exists.</div>;

  return (
    <div className="journey">
      <header className="journey-head">
        <div>
          <div className="sub-label">Flow</div>
          <h2>{f.name}</h2>
        </div>
        <button type="button" className="btn primary play-btn" onClick={() => onPlay(f.start)}>
          <PlayIcon size={13} fill="currentColor" /> Play
        </button>
      </header>
      {!journey && <p className="hint journey-hint">No journey yet. Ask your agent to write one: “Map the journey for {f.name}”.</p>}
      <div className="journey-grid" style={{ gridTemplateColumns: `128px repeat(${steps.length}, ${COL}px)` }}>
        <div className="lane-label" />
        {steps.map((s, i) => (
          <button
            type="button"
            key={`screen-${i}`}
            className={`step${focus === i ? " focus" : ""}`}
            onMouseEnter={() => setFocus(i)}
            onMouseLeave={() => setFocus(undefined)}
            onClick={() => onOpenPage(s.page)}
          >
            <span className="step-name"><span className="step-no">{i + 1}</span>{doc.pages[s.page]?.name ?? s.page}</span>
            <Thumb doc={doc} dir={dir} page={s.page} />
          </button>
        ))}

        {journey && (
          <>
            <div className="lane-label">Confidence</div>
            <div className="curve-cell" style={{ gridColumn: `2 / span ${steps.length}` }}>
              <Curve steps={steps} />
            </div>
          </>
        )}

        {lanes.map((lane) => (
          <Fragment key={lane}>
            <div className="lane-label">{lane}</div>
            {steps.map((s, i) => (
              <div key={i} className={`cell${s.cells[lane] ? "" : " blank"}${focus === i ? " focus" : ""}${lane.toLowerCase().startsWith("watch") && s.cells[lane] ? " watch" : ""}`}>
                {s.cells[lane] ?? "—"}
              </div>
            ))}
          </Fragment>
        ))}

        {journey && steps.some((s) => s.evidence.length > 0) && (
          <>
            <div className="lane-label">Evidence</div>
            {steps.map((s, i) => (
              <div key={i} className="cell evidence">
                {s.evidence.map((a) => doc.attachments[a]?.path.split("/").at(-1) ?? a).join(", ") || "—"}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
