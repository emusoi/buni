// Runs in the page being snapped: buni's own capture, on the whole page or on one element the person picks.
import { captureHtml } from "../editor/renderer/captureHtml.ts";
import type { CapturedImage, Shot } from "../editor/renderer/capture-agent.ts";

/** What the page sends back: the capture, plus boxes the extension draws from the screen and where the page sat. */
export interface Snapped {
  html: string; count: number; warnings: string[]; images: CapturedImage[]; shots: Shot[];
  url: string; title: string; width: number; scrollX: number; scrollY: number;
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
    tip.textContent = "Click a part of the page to snap it · Esc to cancel";
    tip.style.cssText = "position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:#18181b;color:#ededef;font:600 13px system-ui,sans-serif;pointer-events:none";
    document.documentElement.append(box, tip);
    let target: Element | undefined;
    const move = (e: MouseEvent) => {
      target = document.elementFromPoint(e.clientX, e.clientY) ?? undefined;
      const r = target?.getBoundingClientRect();
      if (r) Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const done = (el: Element | undefined) => {
      removeEventListener("mousemove", move, true); removeEventListener("click", click, true); removeEventListener("keydown", key, true);
      box.remove(); tip.remove();
      resolve(el);
    };
    const click = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); done(target); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") done(undefined); };
    addEventListener("mousemove", move, true); addEventListener("click", click, true); addEventListener("keydown", key, true);
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
  return { ...result, images, shots, url: location.href, title: document.title, width: innerWidth, scrollX, scrollY };
};
