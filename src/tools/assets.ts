// An image a person adds, checked and named before it is kept in the design's assets/ folder.
import { basename } from "node:path";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif" };
const MAX = 10 * 1024 * 1024;

/** The bytes and a safe stem and extension, or why the image can't be kept. */
export function checkImage(name: unknown, base64: unknown, mime: unknown): { bytes: Uint8Array; stem: string; ext: string } | { error: string } {
  const ext = typeof mime === "string" ? EXT[mime] : undefined;
  if (!ext) return { error: "Only PNG, JPEG, GIF, WebP, AVIF or SVG images" };
  if (typeof base64 !== "string") return { error: "No image data" };
  // Checked before decoding, so an oversized upload costs nothing.
  if (base64.length > Math.ceil((MAX * 4) / 3) + 4) return { error: "Images up to 10 MB" };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length > MAX) return { error: "Images up to 10 MB" };
  const stem = (typeof name === "string" ? basename(name).replace(/\.[^.]*$/, "") : "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
  return { bytes, stem, ext };
}
