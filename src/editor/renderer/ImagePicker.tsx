// An image layer's picture: which file it shows, how big that is, its alt text, and a picker over the design's
// images (or a new one) to swap it, keeping the layer, its styles and its links.
import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import type { Attachment, Doc, ImageNode } from "buni/format/doc.ts";
import { layerHtml } from "buni/tools/html.ts";

/** Where the window fetches a file that sits beside the design, as the canvas does. */
const assetUrl = (dir: string, path: string) => `${window.buni.assetBase ?? "file://"}${dir.split("/").map(encodeURIComponent).join("/")}/${path}`;
const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Its pixel size and file size, measured once it loads. */
function useFacts(url: string): string {
  const [facts, setFacts] = useState("");
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      const dims = `${img.naturalWidth} × ${img.naturalHeight}`;
      if (live) setFacts(dims);
      // The file itself (the image just loaded it, so it comes from cache): its size, whatever the server says to HEAD.
      void fetch(url).then((r) => (r.ok ? r.blob() : undefined)).then((b) => {
        if (live && b) setFacts(`${dims} · ${kb(b.size)}`);
      }, () => undefined);
    };
    img.src = url;
    return () => { live = false; };
  }, [url]);
  return facts;
}

function Choice({ a, dir, on, onPick }: { a: Attachment; dir: string; on: boolean; onPick: () => void }) {
  const url = assetUrl(dir, a.path);
  const facts = useFacts(url);
  return (
    <button type="button" className={`image-choice${on ? " on" : ""}`} onClick={onPick} title={a.path}>
      <img src={url} alt="" />
      <span className="image-choice-name">{a.path.split("/").at(-1)}</span>
      <span className="image-choice-facts">{facts}</span>
    </button>
  );
}

export function ImagePicker({ doc, node, dir, onError }: { doc: Doc; node: ImageNode; dir: string; onError: (m: string | undefined) => void }) {
  const [picking, setPicking] = useState(false);
  const current = doc.attachments[node.asset];
  const url = current ? assetUrl(dir, current.path) : "";
  const facts = useFacts(url);
  const images = Object.values(doc.attachments).filter((a) => a.mime.startsWith("image/"));
  // The layer rewritten with one attribute changed: same id, styles and links.
  const rewrite = async (attr: "src" | "alt", value: string) => {
    const html = layerHtml(doc, node.id);
    const next = html.replace(new RegExp(`${attr}="[^"]*"`), `${attr}="${value.replace(/"/g, "&quot;")}"`);
    const r = await window.buni.edit("replace_html", { node: node.id, html: next });
    onError(r.ok ? undefined : r.reply);
  };
  const upload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      void window.buni.uploadImage?.(file.name, base64, file.type).then((id) => rewrite("src", `asset:${id}`), (e: Error) => onError(e.message));
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="image-picker">
      {current && (
        <button type="button" className="image-current" onClick={() => setPicking((p) => !p)} title="Choose another image">
          <img src={url} alt="" />
          <span><b>{current.path.split("/").at(-1)}</b><span>{facts}</span></span>
        </button>
      )}
      <label className="image-alt">
        <span>Alt</span>
        <input key={node.alt} defaultValue={node.alt} placeholder="What it shows, for people who can't see it" onBlur={(e) => e.target.value !== node.alt && void rewrite("alt", e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </label>
      {picking && (
        <div className="image-grid">
          {images.map((a) => <Choice key={a.id} a={a} dir={dir} on={a.id === node.asset} onPick={() => { setPicking(false); if (a.id !== node.asset) void rewrite("src", `asset:${a.id}`); }} />)}
          {window.buni.uploadImage && (
            <label className="image-choice upload">
              <Upload size={16} /><span className="image-choice-name">Upload…</span>
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPicking(false); upload(f); } }} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
