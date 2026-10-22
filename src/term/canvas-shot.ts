// The Screens canvas drawn for an agent as the tablet shows it: every page in its row, the links between them, and
// what the pen left there, marks on pages (arrows reaching out of them too) and sketches of new screens, where they
// were drawn. How an agent reads a doodle it wasn't sent a picture of.
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { pagesInOrder, type Id } from "../format/doc.ts";
import { tabletCanvas, type PageShot } from "../editor/tablet-api.ts";
import { inkBox, marksOn, sketchesOpen, strokesSvg } from "../tools/ink.ts";
import { Workspace } from "../tools/workspace.ts";
import { captureDocument, captureShot } from "./capture.ts";
import { drawWithBrowser, findBrowser, keepBrowserWarm } from "./chrome.ts";

/** Wider than this, the picture is drawn smaller: handwriting stays readable and the file stays small. */
const MAX_WIDTH = 2400;
/** Around the sketches, this much of the canvas is kept, so the pages they're drawn beside show. */
const AROUND = 700;

/**
 * Draws the canvas to `out` (PNG). With open sketches, cropped to them and what's around them; `all` draws it whole.
 * Returns what it drew, in words.
 */
export async function canvasShot(file: string, out: string, all = false): Promise<string> {
  const path = resolve(file);
  const view = (await Workspace.open(path)).view();
  const pages = pagesInOrder(view);
  const first = pages[0];
  if (!first) throw new Error("This design has no pages to draw.");
  const browser = findBrowser();
  if (!browser) throw new Error("Drawing the canvas needs Chrome, Chromium or Edge; set BUNI_CHROME to its executable.");
  // Every page drawn as the tablet draws it: their heights place the rows, so sketches line up with them. One browser
  // for them all: a fresh one for each page takes a second or two apiece.
  keepBrowserWarm(2000);
  const snap = await captureDocument(path, first.id);
  const shots = new Map<Id, PageShot & { png: Uint8Array }>();
  for (const p of pages) shots.set(p.id, await captureShot({ ...snap, page: p.id }));
  const c = tabletCanvas(view, shots);
  const [ox, oy] = c.origin;

  const sketches = sketchesOpen(view).filter((s) => s.state === "open");
  // Whole pixels: the browser takes a page width as a whole number.
  let crop = { x: 0, y: 0, w: Math.ceil(c.width), h: Math.ceil(c.height) };
  if (sketches.length && !all) {
    // The sketches, in this canvas's units, and every line drawn out of a page (an arrow from it, likely to them).
    const boxes = [
      ...sketches.map((s) => { const b = inkBox(s.ink?.strokes ?? []); return { ...b, x: b.x + ox, y: b.y + oy }; }),
      ...c.boards.flatMap((pb) => marksOn(view, pb.page).map((m) => inkBox(m.ink?.strokes ?? []))
        .filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > pb.w || b.y + b.h > pb.h).map((b) => ({ ...b, x: b.x + pb.x, y: b.y + pb.y }))),
    ];
    const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - AROUND), y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - AROUND);
    const x1 = Math.min(c.width, Math.max(...boxes.map((b) => b.x + b.w)) + AROUND), y1 = Math.min(c.height, Math.max(...boxes.map((b) => b.y + b.h)) + AROUND);
    crop = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
  }
  // Drawn smaller with CSS when wide, so the browser's page is the picture's own size: a very wide page drawn at a
  // fraction comes out cut.
  const scale = Math.min(1, MAX_WIDTH / crop.w);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const pins = (n: string, x: number, y: number, fill: string) =>
    `<g><rect x="${x}" y="${y - 22}" width="${n.length * 9 + 16}" height="22" rx="11" fill="${fill}"/><text x="${x + 8}" y="${y - 6}" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#fff">${esc(n)}</text></g>`;

  const boards = c.boards.map((b) => {
    const png = shots.get(b.page)?.png;
    const img = png ? `<img src="data:image/png;base64,${Buffer.from(png).toString("base64")}" style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">` : "";
    return `<div style="position:absolute;left:${b.x}px;top:${b.y - 24}px;font:500 15px system-ui,sans-serif;color:#636366;white-space:nowrap">${esc(b.name)}</div>${img}<div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;box-shadow:0 0 0 1px rgba(60,60,67,.25)"></div>`;
  }).join("");
  const titles = c.titles.map((t) => `<div style="position:absolute;left:${t.x - 240}px;top:${t.y}px;width:216px;font:700 20px system-ui,sans-serif;color:#1c1c1e">${esc(t.name)}<div style="font:400 14px system-ui,sans-serif;color:#636366;margin-top:4px">${t.pages} pages</div></div>`).join("");
  // The design's own links are left out: drawn here they'd read as the person's arrows (read_flows lists them).
  // Marks on pages, numbered per page as read_marks numbers them; sketches as Sketch 1, 2… in its order.
  const marks = c.boards.flatMap((b) => marksOn(view, b.page).map((m, i) => {
    const box = inkBox(m.ink?.strokes ?? []);
    return `<g transform="translate(${b.x} ${b.y})">${strokesSvg(m.ink?.strokes ?? [])}${pins(`${i + 1}`, box.x, box.y, "#d70015")}</g>`;
  })).join("");
  const drawn = sketches.map((s, i) => {
    const box = inkBox(s.ink?.strokes ?? []);
    return `<g transform="translate(${ox} ${oy})">${strokesSvg(s.ink?.strokes ?? [])}${pins(`Sketch ${i + 1}`, box.x, box.y - 6, "#0071e3")}</g>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f2f2f7}</style></head><body>
<div style="position:relative;width:${Math.ceil(crop.w * scale)}px;height:${Math.ceil(crop.h * scale)}px;overflow:hidden"><div style="position:absolute;left:0;top:0;transform:scale(${scale});transform-origin:0 0"><div style="position:absolute;left:${-crop.x}px;top:${-crop.y}px;width:${c.width}px;height:${c.height}px">
${titles}${boards}<svg width="${c.width}" height="${c.height}" style="position:absolute;left:0;top:0;overflow:visible" fill="none">${marks}${drawn}</svg>
</div></div></div></body></html>`;
  await writeFile(out, await drawWithBrowser(browser, { html, dir: dirname(path), width: Math.ceil(crop.w * scale), format: "png" }));
  const marked = c.boards.filter((b) => marksOn(view, b.page).length).length;
  return `Saved ${out}: the Screens canvas${sketches.length && !all ? ", around the sketches" : ""}, with ${sketches.length} sketch${sketches.length === 1 ? "" : "es"} and marks on ${marked} page${marked === 1 ? "" : "s"}.`;
}
