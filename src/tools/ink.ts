// Pen marks: comments that carry strokes drawn on a page (on a tablet). One drawing of them for the tablet, the
// canvas, screenshots and agents, so a mark looks the same wherever it is read.
import { architectureOf, INK_VIEWS, pagesInOrder, type Comment, type Doc, type Id, type InkView, type Stroke } from "../format/doc.ts";

const oldestFirst = (a: Comment, b: Comment) => (a.posts[0]?.at ?? "").localeCompare(b.posts[0]?.at ?? "") || a.id.localeCompare(b.id);

/** A page's marks still open, oldest first: the numbers people and agents call them by. */
export function marksOn(doc: Doc, page: Id): Comment[] {
  return Object.values(doc.comments).filter((c) => c.ink?.page === page && c.state !== "resolved").sort(oldestFirst);
}

/** An architecture view's marks still open, oldest first. */
export function marksOnView(doc: Doc, view: InkView): Comment[] {
  return Object.values(doc.comments).filter((c) => c.ink?.view === view && c.state !== "resolved").sort(oldestFirst);
}

/** A flow's marks still open, oldest first. */
export function marksOnFlow(doc: Doc, flow: Id): Comment[] {
  return Object.values(doc.comments).filter((c) => c.ink?.flow === flow && c.state !== "resolved").sort(oldestFirst);
}

/** Sketches of new screens on the Screens canvas, still open, oldest first. */
export function sketchesOpen(doc: Doc): Comment[] {
  return Object.values(doc.comments).filter((c) => c.ink?.sketch && c.state !== "resolved").sort(oldestFirst);
}

/** What an architecture mark points at, by name: the part or link under it, or the architecture itself. */
export function markTarget(doc: Doc, c: Comment): string {
  const arch = architectureOf(doc);
  const part = arch.parts[c.node];
  if (part) return part.name;
  const link = arch.links[c.node];
  if (link) return `${arch.parts[link.from]?.name ?? link.from} → ${arch.parts[link.to]?.name ?? link.to}`;
  return "the architecture";
}

/** A smooth SVG path through a stroke's points: straight segments between midpoints, so a fast line isn't jagged. */
export function strokePath(points: readonly number[]): string {
  const n = points.length / 2;
  if (n === 0) return "";
  const x = (i: number) => points[i * 2] ?? 0, y = (i: number) => points[i * 2 + 1] ?? 0;
  if (n === 1) return `M${x(0)} ${y(0)} l0.01 0`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) d += ` Q${x(i)} ${y(i)} ${(x(i) + x(i + 1)) / 2} ${(y(i) + y(i + 1)) / 2}`;
  return `${d} L${x(n - 1)} ${y(n - 1)}`;
}

/** The box around a mark's strokes, in page pixels. */
export function inkBox(strokes: readonly Stroke[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (let i = 0; i + 1 < s.points.length; i += 2) {
    const px = s.points[i] ?? 0, py = s.points[i + 1] ?? 0;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/** What a mark looks like it is, from its strokes: a highlight, a strike through, a circle, or a drawing. */
export function markKind(strokes: readonly Stroke[]): "Highlight" | "Strike" | "Circle" | "Drawing" {
  if (strokes.every((s) => s.tool === "highlighter")) return "Highlight";
  const pens = strokes.filter((s) => s.tool === "pen");
  const first = pens[0];
  if (pens.length === 1 && first) {
    const b = inkBox([first]);
    const n = first.points.length;
    const gap = Math.hypot((first.points[0] ?? 0) - (first.points[n - 2] ?? 0), (first.points[1] ?? 0) - (first.points[n - 1] ?? 0));
    if (b.h < 14 && b.w > 3 * Math.max(b.h, 1)) return "Strike";
    if (b.w > 20 && b.h > 12 && gap < Math.max(b.w, b.h) * 0.3) return "Circle";
  }
  return "Drawing";
}

/** The strokes as SVG elements; highlighters under pens, so a pen line drawn over a highlight stays readable. */
export function strokesSvg(strokes: readonly Stroke[]): string {
  const one = (s: Stroke) => `<path d="${strokePath(s.points)}" fill="none" stroke="${attr(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"${s.tool === "highlighter" ? ` stroke-opacity="0.4"` : ""}/>`;
  return [...strokes.filter((s) => s.tool === "highlighter"), ...strokes.filter((s) => s.tool === "pen")].map(one).join("");
}

/** Every open mark on a page as one SVG over it, numbered where each starts: what a screenshot with marks shows. */
export function inkSvg(doc: Doc, page: Id, width: number, height: number): string {
  const marks = marksOn(doc, page);
  if (!marks.length) return "";
  const pins = marks.map((c, i) => {
    const b = inkBox(c.ink?.strokes ?? []);
    return `<g><circle cx="${b.x}" cy="${b.y}" r="11" fill="#c8331f" stroke="#fff" stroke-width="2"/><text x="${b.x}" y="${b.y + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#fff">${i + 1}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;left:0;top:0;pointer-events:none;overflow:visible">${marks.map((c) => strokesSvg(c.ink?.strokes ?? [])).join("")}${pins.join("")}</svg>`;
}

/** The marks as an agent reads them: number, kind, the layer under them, what was typed, and the thread to answer. */
export function marksText(doc: Doc, only?: Id): string {
  const pages = pagesInOrder(doc).filter((p) => (only === undefined || p.id === only) && marksOn(doc, p.id).length);
  const views = only === undefined ? INK_VIEWS.filter((v) => marksOnView(doc, v).length) : [];
  const flows = only === undefined ? Object.values(doc.flows).filter((f) => marksOnFlow(doc, f.id).length) : [];
  const sketches = only === undefined ? sketchesOpen(doc) : [];
  if (!pages.length && !views.length && !flows.length && !sketches.length) return only ? `No open marks on ${doc.pages[only]?.name ?? only}.` : "No open marks.";
  const lines: string[] = [];
  for (const v of views) {
    lines.push(`The architecture's ${v} view:`);
    marksOnView(doc, v).forEach((c, i) => {
      const strokes = c.ink?.strokes ?? [];
      const b = inkBox(strokes);
      lines.push(`  ${i + 1}. ${markKind(strokes)} on ${markTarget(doc, c)} (${c.node}, thread ${c.id}) at ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}${c.ink?.from ? `, from ${c.ink.from}` : ""}: ${c.posts.map((x) => x.body).join(" / ")}`);
    });
  }
  if (sketches.length) {
    lines.push("Sketches of new screens, on the Screens canvas (x, y where they sit on it):");
    sketches.forEach((c, i) => {
      const b = inkBox(c.ink?.strokes ?? []);
      lines.push(`  ${i + 1}. Sketch (thread ${c.id}) at ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}${c.ink?.from ? `, from ${c.ink.from}` : ""}${c.state === "addressed" ? " (built)" : ""}: ${c.posts.map((x) => x.body).join(" / ")}`);
    });
  }
  for (const f of flows) {
    lines.push(`The flow ${f.name} (flow ${f.id}):`);
    marksOnFlow(doc, f.id).forEach((c, i) => {
      const strokes = c.ink?.strokes ?? [];
      lines.push(`  ${i + 1}. ${markKind(strokes)} on the screen ${Object.values(doc.pages).find((p) => p.frame === c.node)?.name ?? c.node} (thread ${c.id})${c.ink?.from ? `, from ${c.ink.from}` : ""}: ${c.posts.map((x) => x.body).join(" / ")}`);
    });
  }
  for (const p of pages) {
    lines.push(`${p.name} (page ${p.id}):`);
    marksOn(doc, p.id).forEach((c, i) => {
      const strokes = c.ink?.strokes ?? [];
      const b = inkBox(strokes);
      const node = doc.nodes[c.node];
      const said = c.posts.map((x) => x.body).join(" / ");
      // A line leaving the page is likely an arrow to another page or a sketch: the canvas shot shows where it goes.
      const width = Number.parseFloat(doc.nodes[p.frame]?.style.width ?? "") || Infinity;
      let out = "";
      if (b.x < -8 || b.y < -8 || b.x + b.w > width + 8) {
        // Where its longest line starts and ends, and which way off the page the end is.
        const line = [...strokes].sort((x, y) => y.points.length - x.points.length)[0]?.points ?? [];
        const [sx, sy, ex, ey] = [line[0] ?? 0, line[1] ?? 0, line[line.length - 2] ?? 0, line[line.length - 1] ?? 0];
        const off = ex > width ? `${Math.round(ex - width)}px past its right edge` : ex < 0 ? `${Math.round(-ex)}px past its left edge` : ey < 0 ? `${Math.round(-ey)}px above it` : "below it";
        out = ` (a line from ${Math.round(sx)},${Math.round(sy)} on the page to ${Math.round(ex)},${Math.round(ey)}, ${off}: an arrow to another page or a sketch? buni shot FILE screens out.png shows where it lands)`;
      }
      lines.push(`  ${i + 1}. ${markKind(strokes)} on "${node?.name ?? c.node}" (node ${c.node}, thread ${c.id}) at ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}${c.ink?.from ? `, from ${c.ink.from}` : ""}${out}: ${said}`);
    });
  }
  if (views.length) lines.push("", "Marks on the architecture are sketches: a box with a name is a part being asked for, an arrow a link, a circle a question. Answer them with a plan (set_plan, then the parts and links it adds, status planned with that plan); the person accepts or discards it. buni arch FILE --level system shows the map they drew on; the handwriting is in the picture on the tablet and in the editor.");
  if (sketches.some((c) => c.state === "open")) lines.push("", "Each sketch is a screen to build; sketches that overlap or sit close together are one screen drawn in several goes. Build each as a page in this design's style, using its tokens and components (create_page, write_html), and fill in what the sketch leaves out: real copy, states, empty and error cases. Move the page to where the sketch is with move_page {page, x, y} (the sketch's x, y), so it lands where it was drawn. An arrow drawn from a page or sketch to another is a link: connect it, and add the page to the flow it continues. Then reply on each sketch's thread with comment {thread, body, addressed: true}, saying how you read it.");
  if (flows.length) lines.push("", "Marks on a flow are about how people move through it: a screen to add, skip or merge, a step that confuses, what happens when something goes wrong. buni call FILE read_flows shows the flow and its journey; the handwriting is in the picture the tablet sent.");
  lines.push("", `Handwriting is in the picture, not the text: look at it with buni shot FILE ${sketches.length ? "screens out.png (the Screens canvas, sketches and arrows where they were drawn) and" : ""} buni shot FILE PAGE out.png --marks (or the screenshot tool with marks).`.replace(/ {2,}/g, " "),
    "When a mark is handled, reply on its thread with comment {thread, body, addressed: true}.");
  return lines.join("\n");
}

const attr = (s: string) => s.replace(/[^#a-zA-Z0-9(),.%\s-]/g, "");
