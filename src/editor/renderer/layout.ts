import { pagesInOrder, walkFlow, type Doc, type Id } from "buni/format/doc.ts";

export interface Point {
  x: number;
  y: number;
}

/** Horizontal space between pages, and extra vertical space between rows for labels and arrows. */
export const GAP = 160;
const ROW_GAP = 240;

export function widthOf(doc: Doc, pageId: Id): number {
  return Number.parseInt(doc.nodes[doc.pages[pageId]?.frame ?? ""]?.style.width ?? "", 10) || 1440;
}

/** Components without a saved position end this far above the pages, in rows by set. */
const COMPONENTS_ABOVE = 600;
/** Room above each row of component boards for its set's frame and label. */
const LABEL_ROOM = 60;
/** Extra room between one component set and the next, for their frames. */
const SET_GAP = 160;

/** A component board's width: its own, else its maximum, else small for a control (a button, a link), else wide. */
export function componentWidth(doc: Doc, sharedId: Id): number {
  const root = doc.nodes[doc.shared[sharedId]?.root ?? ""];
  const small = root?.kind === "text" || ["button", "a", "span", "input", "label"].includes(root?.tag ?? "");
  return px(root?.style.width) ?? px(root?.style.maxWidth) ?? (small ? 320 : 1200);
}

const px = (v: string | undefined) => Number.parseInt(v ?? "", 10) || undefined;
const pageHeight = (doc: Doc, pageId: Id) => {
  const style = doc.nodes[doc.pages[pageId]?.frame ?? ""]?.style;
  return px(style?.height) ?? px(style?.minHeight) ?? 900;
};

/** Keep automatic page rows below the saved component library, including measured board heights. */
function pageStart(doc: Doc, heights: ReadonlyMap<Id, number>): number {
  return Math.max(0, ...Object.values(doc.shared).flatMap((s) => {
    if (s.x === undefined || s.y === undefined) return [];
    const style = doc.nodes[s.root]?.style;
    const h = heights.get(s.id) ?? px(style?.height) ?? px(style?.minHeight) ?? 400;
    return [s.y + h + COMPONENTS_ABOVE];
  }));
}

interface Box extends Point {
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first slot from x along a row that no saved board sits on: past each one in the way, with a gap. */
function freeSlot(x: number, y: number, w: number, h: number, saved: readonly Box[]): number {
  for (let hit = saved.find((b) => overlaps({ x, y, w, h }, b)); hit; hit = saved.find((b) => overlaps({ x, y, w, h }, b))) x = hit.x + hit.w + GAP;
  return x;
}

/** About four desktop pages: a longer row wraps, so a big design reads as rows instead of one endless line. */
const WRAP = 4 * (1440 + GAP);

/** Pages in rows: one per flow, in click order (a screen's states right after it), then the pages in no flow. */
export function pageRows(doc: Doc): Id[][] {
  const rows: Id[][] = [];
  const seen = new Set<Id>();
  const statesOf = (p: Id) => {
    const page = doc.pages[p];
    return page?.state !== undefined || page?.route === undefined ? [] : pagesInOrder(doc).filter((x) => x.route === page.route && x.state !== undefined).map((x) => x.id);
  };
  for (const f of Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1))) {
    const row: Id[] = [];
    for (const p of walkFlow(doc, f.start).pages) {
      for (const q of [p, ...statesOf(p)]) if (doc.pages[q] && !seen.has(q)) { seen.add(q); row.push(q); }
    }
    if (row.length) rows.push(row);
  }
  const rest = pagesInOrder(doc).map((p) => p.id).filter((p) => !seen.has(p));
  if (rest.length) rows.push(rest);
  return rows;
}

/**
 * Where each page and component board sits: its saved position, else a slot the layout gives it. Pages without one go
 * in rows (a row per flow, wrapping when long) below any placed by hand; components without one go in rows by set
 * above the pages. `heights` are the boards' measured heights, once drawn: rows are spaced by them, so a tall page or
 * component never reaches into the row next to it.
 */
export function placement(doc: Doc, heights: ReadonlyMap<Id, number> = new Map()): Map<Id, Point> {
  const out = new Map<Id, Point>();
  const boardHeight = (root: Id) => px(doc.nodes[root]?.style.height) ?? px(doc.nodes[root]?.style.minHeight) ?? 400;
  const heightOf = (id: Id) => heights.get(id) ?? (doc.pages[id] ? pageHeight(doc, id) : boardHeight(doc.shared[id]?.root ?? ""));
  const savedPages: Box[] = pagesInOrder(doc).flatMap((p) => (p.x !== undefined && p.y !== undefined ? [{ x: p.x, y: p.y, w: widthOf(doc, p.id), h: heightOf(p.id) }] : []));
  for (const p of pagesInOrder(doc)) if (p.x !== undefined && p.y !== undefined) out.set(p.id, { x: p.x, y: p.y });

  // Pages: in rows. A page placed by hand keeps its slot in its row too, so moving one never shifts another, and a
  // slot a placed page sits on is stepped over.
  let y = pageStart(doc, heights);
  for (const row of pageRows(doc)) {
    let x = 0, tallest = 0;
    for (const id of row) {
      const w = widthOf(doc, id);
      if (x > 0 && x + w > WRAP) { y += tallest + ROW_GAP; x = 0; tallest = 0; }
      if (!out.has(id)) {
        x = freeSlot(x, y, w, heightOf(id), savedPages);
        out.set(id, { x, y });
        tallest = Math.max(tallest, heightOf(id));
      }
      x += w + GAP;
    }
    y += tallest + ROW_GAP;
  }

  // Components: a row per set (one group), wrapping, stacked so the last ends a gap above the topmost page.
  const savedBoards: Box[] = Object.values(doc.shared).flatMap((s) => (s.x !== undefined && s.y !== undefined ? [{ x: s.x, y: s.y, w: componentWidth(doc, s.id), h: heightOf(s.id) }] : []));
  for (const s of Object.values(doc.shared)) if (s.x !== undefined && s.y !== undefined) out.set(s.id, { x: s.x, y: s.y });
  const group = (name: string) => (name.lastIndexOf("/") > 0 ? name.slice(0, name.lastIndexOf("/")).trim() : name);
  const sets = new Map<string, Id[]>();
  for (const s of Object.values(doc.shared).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.has(s.id)) continue;
    sets.set(group(s.name), [...(sets.get(group(s.name)) ?? []), s.id]);
  }
  const lines: { ids: Id[]; h: number }[] = [];
  for (const ids of sets.values()) {
    let line: Id[] = [], x = 0;
    for (const id of ids) {
      const w = componentWidth(doc, id);
      if (line.length && x + w > WRAP) { lines.push({ ids: line, h: Math.max(...line.map(heightOf)) }); line = []; x = 0; }
      line.push(id);
      x += w + GAP;
    }
    if (line.length) lines.push({ ids: line, h: Math.max(...line.map(heightOf)) });
  }
  const pageTop = Math.min(0, ...savedPages.map((b) => b.y));
  // The last row ends COMPONENTS_ABOVE over the pages; rows above it leave room for their sets' frames.
  let top = pageTop - COMPONENTS_ABOVE - lines.reduce((n, l) => n + l.h, 0) - Math.max(0, lines.length - 1) * (SET_GAP + LABEL_ROOM);
  for (const line of lines) {
    let x = 0;
    for (const id of line.ids) {
      const w = componentWidth(doc, id);
      x = freeSlot(x, top, w, heightOf(id), [...savedBoards, ...savedPages]);
      out.set(id, { x, y: top });
      x += w + GAP;
    }
    top += line.h + SET_GAP + LABEL_ROOM;
  }
  return out;
}

/** One row per flow in click order, then a row of pages in no flow; rows are as tall as their tallest page. */
export function tidy(doc: Doc, heights: ReadonlyMap<Id, number>): Map<Id, Point> {
  const rows = pageRows(doc);
  const out = new Map<Id, Point>();
  let y = pageStart(doc, heights);
  for (const row of rows) {
    let x = 0;
    for (const p of row) {
      out.set(p, { x, y });
      x += widthOf(doc, p) + GAP;
    }
    y += Math.max(...row.map((p) => heights.get(p) ?? 900)) + ROW_GAP;
  }
  return out;
}

/** A row of pages on the canvas, named for the flow most of its pages are in. */
export interface RowTitle {
  x: number;
  y: number;
  name: string;
  pages: number;
}

/**
 * Pages sharing a top edge form a row; a row is titled with the flow that covers at least half of
 * it, so the canvas reads as sections. A flow names only the row it covers most. Rows no flow
 * mostly covers, and single pages, stay untitled.
 */
export function rowTitles(doc: Doc, at: ReadonlyMap<Id, Point>): RowTitle[] {
  const rows = new Map<number, { x: number; pages: Id[] }>();
  for (const p of pagesInOrder(doc)) {
    const pt = at.get(p.id);
    if (!pt) continue;
    const row = rows.get(pt.y);
    if (row) {
      row.pages.push(p.id);
      row.x = Math.min(row.x, pt.x);
    } else rows.set(pt.y, { x: pt.x, pages: [p.id] });
  }
  const flows = Object.values(doc.flows)
    .sort((a, b) => (a.index < b.index ? -1 : 1))
    .map((f) => ({ name: f.name, pages: new Set(walkFlow(doc, f.start).pages) }));
  const named = new Map<string, RowTitle & { covers: number }>();
  for (const [y, row] of rows) {
    if (row.pages.length < 2) continue;
    let best: { name: string; covers: number } | undefined;
    for (const f of flows) {
      const covers = row.pages.filter((id) => f.pages.has(id)).length;
      if (covers > (best?.covers ?? 0)) best = { name: f.name, covers };
    }
    if (!best || best.covers * 2 < row.pages.length) continue;
    const had = named.get(best.name);
    if (!had || best.covers > had.covers) named.set(best.name, { x: row.x, y, name: best.name, pages: row.pages.length, covers: best.covers });
  }
  return [...named.values()].map(({ covers: _, ...t }) => t).sort((a, b) => a.y - b.y);
}
