import { captureHtml } from "./captureHtml.ts";

export interface CaptureOptions {
  selector?: string;
  url?: string;
  file?: string;
  symbol?: string;
  /** Draw what can't be read from the page (frames, embedded PDFs, cross-origin pixels) from the screen. */
  shots?: boolean;
}
export interface CapturedImage { id: string; base64: string; mime: string }
export interface Shot { id: string; x: number; y: number; width: number; height: number }
export interface CapturedHtml { html: string; count: number; warnings: string[]; images: CapturedImage[]; shots: Shot[] }

declare global {
  interface Window { buniCaptureHtml(options: CaptureOptions): Promise<string> }
}

window.buniCaptureHtml = async (options) => {
  try {
    const matches = options.selector ? document.querySelectorAll(options.selector) : [document.body];
    if (matches.length !== 1) throw new Error(`Choose a selector matching exactly one element; found ${matches.length}.`);
    const selected = matches[0];
    if (!selected) throw new Error("No HTML body was found.");
    const images: CapturedImage[] = [];
    const shots: Shot[] = [];
    const { shots: drawn, ...rest } = options;
    const result = await captureHtml(selected, { ...rest, upload: async (_name, base64, mime) => {
      const id = `buni-import-image-${images.length + 1}-asset`;
      images.push({ id, base64, mime });
      return id;
    }, ...(drawn ? { shot: (box: Omit<Shot, "id">) => {
      const id = `buni-import-shot-${shots.length + 1}-asset`;
      shots.push({ id, ...box });
      return id;
    } } : {}) });
    return JSON.stringify({ ...result, images, shots } satisfies CapturedHtml);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
};
