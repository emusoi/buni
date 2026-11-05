// How the canvas draws a link between two pages (buni-web, 19 · Canvas · Links and focus): out of the side of what's
// tapped, then only through the gaps between pages, never across a page, its name row or its Picked line, and into
// the left edge of the page it opens. Pure, so the editor and the tablet (src/editor/tablet-api.ts) route links alike.
import type { Connection, Doc, Id } from "buni/format/doc.ts";

export interface Arrow {
  id: Id;
  from: Id;
  to: Id;
  /** What the link reads as: the page it opens, or its condition. */
  label: string;
  /** Top centre of the triggering element, where the link's dot sits. */
  x: number;
  y: number;
  /** Right edge and middle of the triggering element: the line leaves it there. */
  ex: number;
  ey: number;
  /** Top, bottom and right edges of the page the link leaves from. */
  sy: number;
  sb: number;
  sr: number;
  /** Left edge and top of the target page's frame. */
  tx: number;
  ty: number;
}

/** Above a page: its name row (28) and the 12 under it. Below: its Picked line. Lanes keep 24 clear of both. */
const HEAD = 40, FOOT = 26, CLEAR = 24;

/**
 * Right from the element to the gutter beside its page; then, to a page in the same row, straight along to it; to a
 * row below, down to one lane in the middle of the gap between the rows; else up to a lane over both rows' names.
 * Along the lane to the gutter left of the target, down to beside its top, and into its left edge.
 */
export function route(a: Arrow, lane: number, slot: number, zoom: number): { d: string; lx: number; ly: number; end: readonly [number, number] } {
  // Spacing is in screen pixels so lanes stay apart at any zoom.
  const px = 1 / zoom;
  const gx = a.sr + (CLEAR + lane * 8) * px;
  const into = a.ty + (CLEAR + slot * 16) * px;
  // Same row, to the right: the gutter between the two pages carries it, and its label.
  if (a.tx > a.sr && into > a.sy && into < a.sb) {
    const mid = Math.min(gx, (a.sr + a.tx) / 2);
    return { d: `M ${a.ex} ${a.ey} H ${mid} V ${into} H ${a.tx - 1 * px}`, lx: (a.sr + a.tx) / 2, ly: into, end: [a.tx, into] };
  }
  const tgx = a.tx - (CLEAR + slot * 8) * px;
  const below = a.ty - HEAD * px - (a.sb + FOOT * px) > 2 * CLEAR * px;
  // Down: the middle of the gap between this page's Picked line and the target's name row; lanes stack apart in it.
  const y = below
    ? Math.min(a.ty - (HEAD + CLEAR) * px, Math.max(a.sb + (FOOT + CLEAR) * px, (a.sb + FOOT * px + a.ty - HEAD * px) / 2 + lane * 10 * px))
    : Math.min(a.sy, a.ty) - (HEAD + CLEAR + lane * 10) * px;
  return { d: `M ${a.ex} ${a.ey} H ${gx} V ${y} H ${tgx} V ${into} H ${a.tx - 1 * px}`, lx: (gx + tgx) / 2, ly: y, end: [a.tx, into] };
}

/** What a link reads as: its condition when it has one, else the page it opens, without its number. */
export function linkLabel(doc: Doc, c: Connection): string {
  if (c.condition) return `if ${c.condition.charAt(0).toLowerCase()}${c.condition.slice(1)}`;
  return (doc.pages[c.to]?.name ?? "").replace(/^\s*\d+\s*·\s*/, "");
}

/** Lanes and slots for a set of links: each its own lane out of its page, each a slot along the page it enters. */
export function routeAll<A extends Arrow>(links: readonly A[], zoom: number): { a: A; d: string; lx: number; ly: number; end: readonly [number, number] }[] {
  const slots = new Map<Id, number>(), lanes = new Map<Id, number>();
  return links.map((a) => {
    const lane = lanes.get(a.from) ?? 0;
    lanes.set(a.from, lane + 1);
    const slot = slots.get(a.to) ?? 0;
    slots.set(a.to, slot + 1);
    return { a, ...route(a, lane, slot, zoom) };
  });
}
