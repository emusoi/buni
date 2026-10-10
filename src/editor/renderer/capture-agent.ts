import { captureHtml } from "./captureHtml.ts";

export interface CaptureOptions {
  selector?: string;
  url?: string;
  file?: string;
  symbol?: string;
}
export interface CapturedImage { id: string; base64: string; mime: string }
export interface CapturedHtml { html: string; count: number; warnings: string[]; images: CapturedImage[] }

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
    const result = await captureHtml(selected, { ...options, upload: async (_name, base64, mime) => {
      const id = `buni-import-image-${images.length + 1}-asset`;
      images.push({ id, base64, mime });
      return id;
    } });
    return JSON.stringify({ ...result, images } satisfies CapturedHtml);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
};
