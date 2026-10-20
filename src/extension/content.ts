// Runs in the page being snapped: buni's own capture, on the whole page or on one element the person picks.
import { captureHtml } from "../editor/renderer/captureHtml.ts";
import type { CapturedImage, Shot } from "../editor/renderer/capture-agent.ts";

/** What the page sends back: the capture, plus boxes the extension draws from the screen and where the page sat. */
export interface Snapped {
  html: string; count: number; warnings: string[]; images: CapturedImage[]; shots: Shot[];
  url: string; title: string; width: number; height: number; scrollX: number; scrollY: number;
}

declare global {
  interface Window { buniSnap?: (mode: "page" | "pick") => Promise<Snapped | undefined> }
}

/** Lets the person point at one element: outlined on hover, taken on click, Escape gives up. */
function pick(): Promise<Element | undefined> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4069e6;background:rgba(64,105,230,.08);border-radius:3px;transition:all 60ms";
    const tip = document.createElement("div");
    tip.textContent = "Click a part to capture it · ↑ for the part around it, ↓ back · Enter captures · Esc cancels";
    tip.style.cssText = "position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:#18181b;color:#ededef;font:600 13px system-ui,sans-serif;pointer-events:none";
    document.documentElement.append(box, tip);
    let target: Element | undefined;
    // What the pointer is on, then each step out the person took with ↑ (↓ steps back in).
    let trail: Element[] = [];
    const outline = () => {
      const r = target?.getBoundingClientRect();
      if (r) Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const move = (e: MouseEvent) => {
      const under = document.elementFromPoint(e.clientX, e.clientY) ?? undefined;
      if (under && trail[0] !== under) { trail = [under]; target = under; outline(); }
    };
    const done = (el: Element | undefined) => {
      removeEventListener("mousemove", move, true); removeEventListener("click", click, true); removeEventListener("keydown", key, true);
      // A beat later: the press that ended the pick still has its mouseup and click to come.
      setTimeout(() => { for (const type of quiet) removeEventListener(type, swallow, true); }, 300);
      box.remove(); tip.remove();
      resolve(el);
    };
    // The page mustn't act on the pick: its own pointer and mouse handlers (a link, a menu that opens on press) see none of it.
    const swallow = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const click = (e: MouseEvent) => { swallow(e); done(target); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { swallow(e); done(undefined); }
      else if (e.key === "Enter" && target) { swallow(e); done(target); }
      else if (e.key === "ArrowUp" && target?.parentElement && target.parentElement !== document.documentElement) { swallow(e); trail.push(target.parentElement); target = target.parentElement; outline(); }
      else if (e.key === "ArrowDown" && trail.length > 1) { swallow(e); trail.pop(); target = trail.at(-1); outline(); }
    };
    const quiet = ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick", "dblclick", "contextmenu"];
    addEventListener("mousemove", move, true); addEventListener("click", click, true); addEventListener("keydown", key, true);
    for (const type of quiet) addEventListener(type, swallow, true);
  });
}

window.buniSnap = async (mode) => {
  const selected = mode === "pick" ? await pick() : document.body;
  if (!selected) return undefined;
  const images: CapturedImage[] = [];
  const shots: Shot[] = [];
  const result = await captureHtml(selected, {
    url: location.href,
    upload: async (_name, base64, mime) => {
      const id = `buni-import-image-${images.length + 1}-asset`;
      images.push({ id, base64, mime });
      return id;
    },
    shot: (box) => {
      const id = `buni-import-shot-${shots.length + 1}-asset`;
      shots.push({ id, ...box });
      return id;
    },
  });
  return { ...result, images, shots, url: location.href, title: document.title, width: innerWidth, height: innerHeight, scrollX, scrollY };
};
