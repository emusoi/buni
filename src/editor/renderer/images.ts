// Placing an image a person picked or pasted: kept in the design's folder, then written in as an <img> layer.
import type { Id } from "buni/format/doc.ts";

async function base64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out = "";
  // In chunks: String.fromCharCode with a whole photo's bytes overflows the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Uploads an image and adds it at `at`; resolves to the new layer's id, or to an error to show. */
export async function placeImage(file: File, at: { parent: Id; after?: Id }): Promise<{ id: Id } | { error: string }> {
  const upload = window.buni.uploadImage;
  if (!upload) return { error: "Images can't be added here yet; ask an agent to attach one." };
  try {
    const asset = await upload(file.name || "pasted", await base64(file), file.type);
    const name = (file.name || "Image").replace(/\.[^.]*$/, "").replace(/"/g, "");
    const r = await window.buni.edit("write_html", { ...at, html: `<img src="asset:${asset}" alt="${name}" layer-name="${name}" style="display: block; max-width: 100%; height: auto">` });
    const id = r.reply.match(/Created \d+ nodes?: ([^,.\s]+)/)?.[1];
    return r.ok && id ? { id } : { error: r.reply };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
