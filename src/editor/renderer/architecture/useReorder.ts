// Reordering a list by hand: lanes on the paths, a play's steps in the inspector.
import { useRef, useState } from "react";
import { insertionAt } from "./edit.ts";

/** One item of a list being dragged into a new place: the handle's events, and how the item shows meanwhile. */
export interface Reorderable {
  handle: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void; onClickCapture: (e: React.MouseEvent) => void };
  /** " dragging", " drop-before" or " drop-after", for its class. */
  mark: string;
}

/**
 * Drag to reorder a list: pressing an item's handle and moving it along `axis` lands it before the sibling whose
 * middle it passes (the items are the container's `[data-reorder]` elements); Alt and an arrow moves it one place.
 */
export function useReorder(axis: "x" | "y", count: number, onDrop: (from: number, to: number) => void): { container: React.RefObject<HTMLDivElement | null>; item: (i: number) => Reorderable } {
  const container = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number }>();
  const dragged = useRef(false);
  const item = (i: number): Reorderable => ({
    handle: {
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        dragged.current = false;
        const start = axis === "x" ? e.clientX : e.clientY;
        let to: number | undefined;
        const move = (m: PointerEvent) => {
          const pos = axis === "x" ? m.clientX : m.clientY;
          if (to === undefined && Math.abs(pos - start) < 4) return;
          const mids = [...(container.current?.querySelectorAll("[data-reorder]") ?? [])].map((el) => {
            const r = el.getBoundingClientRect();
            return axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
          });
          to = insertionAt(mids, pos);
          setDrag({ from: i, to });
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          setDrag(undefined);
          if (to === undefined) return;
          dragged.current = true;
          if (to !== i && to !== i + 1) onDrop(i, to);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
      onKeyDown: (e) => {
        const back = axis === "x" ? "ArrowLeft" : "ArrowUp", on = axis === "x" ? "ArrowRight" : "ArrowDown";
        if (!e.altKey || (e.key !== back && e.key !== on)) return;
        e.preventDefault();
        if (e.key === back && i > 0) onDrop(i, i - 1);
        if (e.key === on && i < count - 1) onDrop(i, i + 2);
      },
      // The click that ends a drag isn't a pick.
      onClickCapture: (e) => { if (dragged.current) { dragged.current = false; e.stopPropagation(); } },
    },
    mark: !drag ? "" : drag.from === i ? " dragging" : drag.to === i ? " drop-before" : drag.to === count && i === count - 1 ? " drop-after" : "",
  });
  return { container, item };
}
