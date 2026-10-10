import { useEffect, type RefObject } from "react";

/** Closes an open menu on Escape anywhere, or a press outside `ref`; a menu that only closes on hover strands keyboard users. */
export function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) close();
    };
    window.addEventListener("keydown", onKey);
    // Capture: the canvas handles presses itself and stops them before they'd reach the window.
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close, ref]);
}
