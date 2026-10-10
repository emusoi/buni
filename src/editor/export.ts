// Exports on the web, made in the browser: the desktop app renders in a hidden Electron window, the web
// in the page itself. PNGs are drawn through SVG onto a canvas; PDFs go through the browser's print dialog.
import { Buffer } from "node:buffer";
import type { Doc, Id } from "buni/format/doc.ts";
import { fontFaces, renderPage } from "buni/tools/html.ts";
import { ICON_SIZES, icnsFile, icoFile } from "./icons.ts";

/** Hands the person a file, as the browser's own download. */
export function download(name: string, blob: Blob): void {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A .zip of the files, stored uncompressed: every OS opens it, and it takes a few dozen lines. */
export function zip(files: ReadonlyMap<string, string | Uint8Array>): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of files) {
    const data = typeof body === "string" ? new TextEncoder().encode(body) : body;
    const path = new TextEncoder().encode(name);
    const crc = crc32(data);
    // Version, UTF-8 names, stored, no date, crc, sizes, name length.
    const fields = (h: DataView, at: number) => {
      h.setUint16(at, 20, true);
      h.setUint16(at + 2, 0x0800, true);
      h.setUint32(at + 10, crc, true);
      h.setUint32(at + 14, data.length, true);
      h.setUint32(at + 18, data.length, true);
      h.setUint16(at + 22, path.length, true);
    };
    const local = new Uint8Array(30 + path.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    fields(l, 4);
    local.set(path, 30);
    const entry = new Uint8Array(46 + path.length);
    const e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    fields(e, 6);
    e.setUint32(42, offset, true);
    entry.set(path, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, files.size, true);
  d.setUint16(10, files.size, true);
  d.setUint32(12, size, true);
  d.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end].map((p) => p.slice().buffer), { type: "application/zip" });
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Shows HTML in a hidden frame that runs no scripts, and waits until its fonts and images are in. */
async function frame(html: string, width: number): Promise<HTMLIFrameElement> {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-same-origin allow-modals");
  f.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:900px;border:0;visibility:hidden`;
  const loaded = new Promise((r) => f.addEventListener("load", r, { once: true }));
  f.srcdoc = html;
  document.body.append(f);
  await loaded;
  const d = f.contentDocument;
  if (!d) throw new Error("the page could not be laid out");
  await d.fonts.ready;
  await Promise.all([...d.images].map((i) => i.decode().catch(() => undefined)));
  return f;
}

/** One page as a standalone document, its images inlined so nothing outside it is needed to draw it. */
async function standalone(doc: Doc, pageId: Id, base: string, extraCss = ""): Promise<{ html: Document; width: number }> {
  const { html, css } = renderPage(doc, pageId);
  const width = Number.parseInt(doc.nodes[doc.pages[pageId]?.frame ?? ""]?.style.width ?? "", 10) || 1440;
  const d = new DOMParser().parseFromString(`<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><style>html,body{margin:0;overflow:hidden}${fontFaces(doc, (await import("buni/tools/fontdata.ts")).embeddedFont)}${css}${extraCss}</style></head><body>${html}</body></html>`, "text/html");
  await Promise.all(
    [...d.images].map(async (img) => {
      const res = await fetch(img.src).catch(() => undefined);
      if (res?.ok) img.src = await dataUrl(await res.blob());
    }),
  );
  d.querySelector("base")?.remove();
  return { html: d, width };
}

/** The page's own height when laid out at its width, as the desktop app measures it. */
async function measure(html: Document, width: number): Promise<number> {
  const f = await frame(`<!doctype html>${html.documentElement.outerHTML}`, width);
  try {
    return Math.min(Math.max(f.contentDocument?.body.scrollHeight ?? 900, 1), 8000);
  } finally {
    f.remove();
  }
}

/** A page as a PNG at `scale`: drawn by the browser itself, through an SVG, onto a canvas. */
export async function pagePng(doc: Doc, pageId: Id, base: string, scale: number): Promise<Blob> {
  const { html, width } = await standalone(doc, pageId, base);
  const height = await measure(html, width);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(html.documentElement)}</foreignObject></svg>`;
  // An SVG image drawn before its embedded fonts are decoded leaves their text out, and it doesn't wait for
  // them. Loading the same fonts in this page first has them decoded by the time the image draws.
  const faces = (html.querySelector("style")?.textContent ?? "").matchAll(/@font-face\{font-family:"([^"]+)";src:url\(([^)]+)\)/g);
  await Promise.all([...faces].map(([, family = "", url = ""]) => new FontFace(family, `url(${url})`, { weight: "100 900" }).load()));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(width * scale), height: Math.round(height * scale) });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser can't draw the page");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the page could not be drawn"))), "image/png"));
}

/** Opens the browser's print dialog on HTML; Save as PDF there writes the file. */
export async function print(html: string, width = 1400): Promise<void> {
  const f = await frame(html, width);
  const w = f.contentWindow;
  if (!w) throw new Error("the page could not be printed");
  w.addEventListener("afterprint", () => f.remove(), { once: true });
  w.print();
}

/** A page through the print dialog, on a sheet exactly its size. */
export async function printPage(doc: Doc, pageId: Id, base: string): Promise<void> {
  const page = await standalone(doc, pageId, base, "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}");
  const height = await measure(page.html, page.width);
  const sheet = page.html.createElement("style");
  sheet.textContent = `@page{size:${page.width}px ${height}px;margin:0}`;
  page.html.head.append(sheet);
  await print(`<!doctype html>${page.html.documentElement.outerHTML}`, page.width);
}

/** An app icon set from a square page, zipped: PNGs at every size, favicon.ico and AppIcon.icns. */
export async function iconSet(doc: Doc, pageId: Id, base: string): Promise<Blob> {
  const style = doc.nodes[doc.pages[pageId]?.frame ?? ""]?.style ?? {};
  const width = Number.parseInt(style.width ?? "", 10);
  if (!(width > 0) || style.height !== style.width) throw new Error("an app icon is a square graphic: give the page equal width and height");
  const big = await createImageBitmap(await pagePng(doc, pageId, base, 1024 / width));
  const pngs = new Map<number, Buffer>();
  for (const s of ICON_SIZES) {
    const canvas = Object.assign(document.createElement("canvas"), { width: s, height: s });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser can't draw the icon");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, s, s);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("the icon could not be drawn");
    pngs.set(s, Buffer.from(await blob.arrayBuffer()));
  }
  const files = new Map<string, Uint8Array>([...pngs].map(([s, png]) => [s === 180 ? "apple-touch-icon.png" : `icon-${s}.png`, png]));
  files.set("favicon.ico", icoFile(pngs));
  files.set("AppIcon.icns", icnsFile(pngs));
  return zip(files);
}
