// Pen marks drawn over a page: on the tablet as they're made, on the Mac's canvas as they arrive.
import type { Comment, Doc, Id, Stroke } from "buni/format/doc.ts";
import { inkBox, marksOn, strokePath } from "buni/tools/ink.ts";

export function StrokePaths({ strokes }: { strokes: readonly Stroke[] }) {
  // Highlighters under pens, as in screenshots (ink.ts), so a pen line over a highlight stays readable.
  const ordered = [...strokes.filter((s) => s.tool === "highlighter"), ...strokes.filter((s) => s.tool === "pen")];
  return (
    <>
      {ordered.map((s, i) => (
        <path key={i} d={strokePath(s.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={s.tool === "highlighter" ? 0.4 : 1} />
      ))}
    </>
  );
}

/** A page's open marks, numbered where each starts, in the page's own pixels; it lets clicks through. */
export function InkLayer({ doc, page, width, pins = true, lit }: { doc: Doc; page: Id; width: number; pins?: boolean; lit?: Id | undefined }) {
  const marks = marksOn(doc, page);
  if (!marks.length) return null;
  return (
    <svg className="ink-layer" width={width} height={1} viewBox={`0 0 ${width} 1`} aria-hidden>
      {marks.map((c) => <g key={c.id} className={lit === c.id ? "lit" : undefined}><StrokePaths strokes={c.ink?.strokes ?? []} /></g>)}
      {pins && marks.map((c, i) => <Pin key={c.id} comment={c} n={i + 1} />)}
    </svg>
  );
}

function Pin({ comment, n }: { comment: Comment; n: number }) {
  const b = inkBox(comment.ink?.strokes ?? []);
  return (
    <g className="ink-pin">
      <circle cx={b.x} cy={b.y} r={11} />
      <text x={b.x} y={b.y + 4} textAnchor="middle">{n}</text>
    </g>
  );
}
