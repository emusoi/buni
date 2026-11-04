// The why on the canvas: a page's options hang off it on dashed lines, and the page that won says why, beside what it
// was chosen over. Pure, from the boards' boxes.
import type { Doc, Id } from "buni/format/doc.ts";
import type { BoardRect } from "./Canvas.tsx";

export interface Branch {
  from: Id;
  to: Id;
  /** From the parent's right edge, mid-height, to the option's left edge, mid-height; or down when the option sits below. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Why {
  page: Id;
  x: number;
  y: number;
  why: string;
  /** The names of what it was chosen over, those still here. */
  over: string[];
}

export function lineage(doc: Doc, boxes: ReadonlyMap<Id, BoardRect>): { branches: Branch[]; whys: Why[] } {
  const branches: Branch[] = [];
  const whys: Why[] = [];
  for (const p of Object.values(doc.pages)) {
    const box = boxes.get(p.id);
    if (!box) continue;
    if (p.option) {
      const parent = boxes.get(p.option.of);
      if (parent) {
        const below = box.y > parent.y + parent.height / 2;
        branches.push(below
          ? { from: p.option.of, to: p.id, x1: parent.x + parent.width / 2, y1: parent.y + parent.height, x2: box.x + box.width / 2, y2: box.y }
          : { from: p.option.of, to: p.id, x1: parent.x + parent.width, y1: parent.y + parent.height / 2, x2: box.x, y2: box.y + box.height / 2 });
      }
    }
    if (p.picked) whys.push({ page: p.id, x: box.x, y: box.y, why: p.picked.why, over: p.picked.over.map((id) => doc.pages[id]?.name).filter((n): n is string => n !== undefined) });
  }
  return { branches, whys };
}

/** A gentle S from one point to the other: horizontal when the ends are side by side, vertical when stacked. */
export function branchPath(b: Branch): string {
  const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
  return Math.abs(dx) >= Math.abs(dy)
    ? `M${b.x1} ${b.y1}C${b.x1 + dx / 2} ${b.y1} ${b.x2 - dx / 2} ${b.y2} ${b.x2} ${b.y2}`
    : `M${b.x1} ${b.y1}C${b.x1} ${b.y1 + dy / 2} ${b.x2} ${b.y2 - dy / 2} ${b.x2} ${b.y2}`;
}
