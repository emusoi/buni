// How the canvas draws a link between two pages: up from what's tapped to a lane, across, and down into the page it
// opens. Pure, so the editor and the tablet (src/editor/tablet-api.ts) route links the same way.
import type { Connection, Doc, Id } from "buni/format/doc.ts";

export interface Arrow {
  id: Id;
  from: Id;
  to: Id;
  /** What triggers the link, shown along it. */
  label: string;
  /** Top centre of the triggering element, where the link's dot sits. */
  x: number;
  y: number;
  /** Top and bottom edges of the page the link leaves from: the line starts at one, not across the page's content. */
  sy: number;
  sb: number;
  /** Left edge and top of the target page's frame. */
  tx: number;
  ty: number;
  /** Highest top of the two pages; lanes run above it. */
  top: number;
}

/** Up from the top of the page, above the element, to a lane above both pages, across, and down into the target's top edge, with rounded corners. */
export function route(a: Arrow, lane: number, slot: number, zoom: number): { d: string; lx: number; ly: number } {
  // Spacing is in screen pixels so lanes stay apart at any zoom.
  const px = 1 / zoom;
  const x2 = a.tx + (40 + slot * 24) * px;
  const r = Math.min(10 * px, Math.abs(x2 - a.x) / 2);
  const dir = x2 >= a.x ? 1 : -1;
  // A page in a row below: down from the source's bottom edge to a lane in the gap just above the
  // target's row, so the line never crosses the boards in between. Lanes squeeze to fit the gap.
  if (goesDown(a, zoom)) {
    const below = Math.max(a.sb + 16 * px, a.ty - (28 + lane * 22) * px);
    const d = `M ${a.x} ${a.sb} V ${below - r} Q ${a.x} ${below} ${a.x + r * dir} ${below} H ${x2 - r * dir} Q ${x2} ${below} ${x2} ${below + r} V ${a.ty - 6}`;
    return { d, lx: a.x + (x2 >= a.x ? 6 : -6) * px, ly: below - 5 * px };
  }
  const y = a.top - (28 + lane * 22) * px;
  const d = `M ${a.x} ${a.sy} V ${y + r} Q ${a.x} ${y} ${a.x + r * dir} ${y} H ${x2 - r * dir} Q ${x2} ${y} ${x2} ${y + r} V ${a.ty - 6}`;
  return { d, lx: a.x + (x2 >= a.x ? 6 : -6) * px, ly: y - 5 * px };
}

/** The link goes to a row below its page, with room for a lane between them. */
export function goesDown(a: Arrow, zoom: number): boolean {
  return a.ty - 28 / zoom > a.sb + 16 / zoom;
}

/** What a link reads as: its condition when it has one, else its key, else the layer that triggers it. */
export function linkLabel(doc: Doc, c: Connection): string {
  return c.condition ? `if ${c.condition.charAt(0).toLowerCase()}${c.condition.slice(1)}` : c.trigger === "key" ? `${c.key ?? ""}` : doc.nodes[c.node]?.name ?? "";
}

/** Lanes and slots for a set of links, as the canvas gives them: each its own lane, each a slot along the page it enters. */
export function routeAll<A extends Arrow>(links: readonly A[], zoom: number): { a: A; d: string; lx: number; ly: number; endX: number }[] {
  const slots = new Map<Id, number>(), lanes = { up: 0, down: 0 };
  return links.map((a) => {
    const lane = goesDown(a, zoom) ? lanes.down++ : lanes.up++;
    const slot = slots.get(a.to) ?? 0;
    slots.set(a.to, slot + 1);
    return { a, ...route(a, lane, slot, zoom), endX: a.tx + (40 + slot * 24) / zoom };
  });
}
