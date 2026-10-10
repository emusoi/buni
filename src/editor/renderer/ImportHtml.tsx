import { useEffect, useRef, useState } from "react";
import { Code2, FolderOpen, Globe, X } from "lucide-react";
import { captureHtml, sourceSelector } from "./captureHtml.ts";
import { prepareHtml, resourceText, type ResourceLoader } from "./html-preview.ts";
import type { Id } from "buni/format/doc.ts";

const STARTER = '<!doctype html>\n<style>\n  body { margin: 0; font-family: system-ui; background: #f5f5f2; padding: 48px; }\n  .card { background: white; padding: 32px; border-radius: 16px; max-width: 560px; }\n  h1 { margin: 0 0 12px; }\n</style>\n<section class="card">\n  <h1>Your HTML, ready to edit</h1>\n  <p>Replace this with a page or section, preview it, then click the part you want.</p>\n</section>';
const fileBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
};

/** Open HTML here, pick the part you want, and keep editable layers and source context. */
export function ImportHtml({ at, onClose, onImported }: { at?: { parent: Id; after?: Id }; onClose: () => void; onImported: (page: Id | undefined, node: Id | undefined, message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const pickedFiles = useRef<File[]>([]);
  const [mode, setMode] = useState<"html" | "url">("html");
  const [html, setHtml] = useState(STARTER);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState("");
  const [symbol, setSymbol] = useState("");
  const [width, setWidth] = useState(1280);
  const [available, setAvailable] = useState(700);
  const [destination, setDestination] = useState(at ? "current" : "new");
  const [name, setName] = useState("Imported page");
  const [route, setRoute] = useState("");
  const [preview, setPreview] = useState<{ html: string; url?: string; input: string; mode: "html" | "url" }>();
  const [selected, setSelected] = useState<Element>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    dialog.current?.showModal();
    const observer = new ResizeObserver(([entry]) => entry && setAvailable(entry.contentRect.width));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const previewIsCurrent = preview?.mode === mode && preview.input === (mode === "url" ? url : html);
  const scale = Math.min(1, Math.max(0.15, (available - 24) / width));
  const previewPage = async () => {
    setBusy("Preparing preview…"); setError(undefined); setSelected(undefined);
    try {
      let text = html;
      let base: string | undefined;
      let sourceUrl: string | undefined;
      let load: ResourceLoader | undefined;
      if (mode === "url") {
        const remote = window.buni.readImportResource;
        if (!remote) throw new Error("This host does not support importing URLs.");
        base = new URL(url).href;
        const main = await remote(base, base);
        if (!/^text\/(html|plain)$|^application\/xhtml\+xml$/.test(main.mime)) throw new Error("That URL did not return an HTML page.");
        text = resourceText(main); sourceUrl = main.url; base = main.url;
        load = (resource) => remote(resource, main.url);
      } else if (pickedFiles.current.length) {
        base = `https://buni-upload.invalid/${encodeURIComponent(pickedFiles.current.find((f) => /\.html?$/i.test(f.name))?.name ?? "page.html")}`;
        load = async (resource) => {
          const path = decodeURIComponent(new URL(resource).pathname).replace(/^\//, "");
          const matches = pickedFiles.current.filter((f) => (f.webkitRelativePath || f.name) === path || f.name === path.split("/").pop());
          if (matches.length !== 1) throw new Error(`Pick the file ${path} alongside the HTML.`);
          const file = matches[0]!;
          if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is over 8 MB.`);
          return { url: resource, mime: file.type || (/\.css$/i.test(file.name) ? "text/css" : "application/octet-stream"), base64: await fileBase64(file) };
        };
      }
      const result = await prepareHtml(text, base, load);
      setWarnings(result.warnings); setPreview({ html: result.html, input: mode === "url" ? url : html, mode, ...(sourceUrl ? { url: sourceUrl } : {}) });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(undefined); }
  };
  const select = (element: Element) => {
    frame.current?.contentDocument?.querySelectorAll("[data-buni-picked]").forEach((el) => el.removeAttribute("data-buni-picked"));
    element.setAttribute("data-buni-picked", ""); setSelected(element);
  };
  const loaded = async () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body || !preview) return;
    await doc.fonts.ready;
    const style = doc.createElement("style");
    style.textContent = "*{cursor:crosshair!important}[data-buni-hover]{outline:1px dashed #4779f4!important;outline-offset:-1px}[data-buni-picked]{outline:2px solid #4779f4!important;outline-offset:-2px}";
    doc.head.append(style);
    const elementOf = (event: Event): Element | undefined => {
      const target = event.target;
      if (!target || !("nodeType" in target) || target.nodeType !== 1) return undefined;
      const el = target as Element;
      return el.closest("svg") ?? el;
    };
    doc.addEventListener("mouseover", (event) => {
      doc.querySelector("[data-buni-hover]")?.removeAttribute("data-buni-hover");
      elementOf(event)?.setAttribute("data-buni-hover", "");
    });
    doc.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); const el = elementOf(event); if (el) select(el); }, true);
    doc.addEventListener("submit", (event) => event.preventDefault(), true);
    select(doc.body);
  };
  const importSelection = async () => {
    if (!selected) return;
    const upload = window.buni.uploadImage;
    if (!upload) { setError("This host needs image upload support to import HTML."); return; }
    setBusy("Converting selected elements…"); setError(undefined);
    try {
      const captured = await captureHtml(selected, { ...(preview?.url ? { url: preview.url } : {}), ...(file.trim() ? { file: file.trim() } : {}), ...(symbol.trim() ? { symbol: symbol.trim() } : {}), upload });
      const result = await window.buni.edit("import_html", { html: captured.html, ...(destination === "current" && at ? at : { page: { name: name.trim() || "Imported page", width, ...(route.trim() ? { route: route.trim() } : {}) } }) });
      if (!result.ok) throw new Error(result.reply);
      const page = result.reply.match(/Created page ([^.\s]+)/)?.[1];
      const node = result.reply.match(/Created \d+ nodes: ([^,.\s]+)/)?.[1];
      const issues = [...warnings, ...captured.warnings, ...(result.reply.match(/Warning: .+/g) ?? [])];
      onImported(page, node, `Imported ${captured.count} elements.${issues.length ? ` ${issues.join(" ")}` : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(undefined); }
  };
  const ancestors: Element[] = [];
  for (let el = selected; el && el.localName !== "html"; el = el.parentElement ?? undefined) ancestors.unshift(el);
  return <dialog className="html-import" ref={dialog} aria-label="Import HTML" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} onKeyDown={(e) => e.stopPropagation()}>
    <header><div><h2>Import HTML</h2><p>Open a page, click a section, then bring it into your design as editable layers.</p></div><button type="button" className="icon-btn" aria-label="Close HTML import" disabled={Boolean(busy)} onClick={onClose}><X size={18} /></button></header>
    <div className="html-import-body">
      <section className="html-import-options">
        <div className="mode-tabs" role="tablist" aria-label="HTML source"><button type="button" role="tab" aria-selected={mode === "html"} className={mode === "html" ? "on" : ""} onClick={() => setMode("html")}><Code2 size={13} /> HTML or file</button><button type="button" role="tab" aria-selected={mode === "url"} className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}><Globe size={13} /> Page URL</button></div>
        {mode === "html" ? <>
          <textarea aria-label="HTML source" value={html} spellCheck={false} onChange={(e) => setHtml(e.target.value)} />
          <input ref={files} type="file" multiple hidden onChange={async (e) => { const picked = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; const main = picked.find((f) => /\.html?$/i.test(f.name)); if (!main) { setError("Choose an HTML file, with its CSS and images if needed."); return; } if (main.size > 8 * 1024 * 1024) { setError("HTML must be under 8 MB."); return; } pickedFiles.current = picked; setHtml(await main.text()); setFile(main.name); setName(main.name.replace(/\.html?$/i, "")); setError(undefined); }} />
          <button type="button" className="btn" onClick={() => files.current?.click()}><FolderOpen size={13} /> Choose HTML and assets…</button>
        </> : <label>Page URL<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com or http://localhost:3000" /><small>Public HTML or a local development page. Your browser cookies are not sent.</small></label>}
        <label>Preview width<input type="number" min={240} max={3840} step={1} value={width} onChange={(e) => { const value = Number(e.target.value); if (value >= 240 && value <= 3840) setWidth(value); }} /></label>
        <button type="button" className="btn primary" disabled={Boolean(busy) || (mode === "url" ? !url.trim() : !html.trim())} onClick={() => void previewPage()}>Preview HTML</button>
        <div className="html-import-source"><b>Connect to code</b><label>Source file <small>optional, any language</small><input value={file} onChange={(e) => setFile(e.target.value)} placeholder="src/components/Orders.tsx" /></label><label>Symbol or component<input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Orders" /></label></div>
        <label>Import into<select value={destination} onChange={(e) => setDestination(e.target.value)}>{at && <option value="current">Current frame or page</option>}<option value="new">New page or graphic</option></select></label>
        {destination === "new" && <><label>Page name<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>Route <small>optional</small><input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="/orders" /><small>Give web pages a route. Leave empty for a standalone graphic.</small></label></>}
      </section>
      <section className="html-import-preview"><div className="html-import-preview-head"><b>Pick from the preview</b><span>Click an element, or use its parents below.</span></div><div ref={viewport} className="html-import-viewport">
        {preview ? <div style={{ width: width * scale, height: 900 * scale }}><iframe ref={frame} title="HTML import preview" sandbox="allow-same-origin" srcDoc={preview.html} onLoad={() => void loaded()} style={{ width, height: 900, transform: `scale(${scale})`, transformOrigin: "top left" }} /></div> : <div className="html-import-empty"><Code2 size={30} /><p>Paste HTML or open a URL, then preview it here.</p></div>}
      </div><nav className="html-import-crumbs" aria-label="Selected HTML element">{ancestors.map((el, i) => <button key={i} type="button" title={sourceSelector(el)} aria-pressed={el === selected} onClick={() => select(el)}>{el.localName === "body" ? "Whole page" : el.localName + (el.id ? `#${el.id}` : "")}</button>)}</nav>
      {warnings.length > 0 && <details className="html-import-notes"><summary>Preview notes ({warnings.length})</summary>{warnings.map((w) => <p key={w}>{w}</p>)}</details>}
      </section>
    </div>
    <footer><div>{error ? <p role="alert" className="notice">{error}</p> : <p role="status">{busy ?? (preview && !previewIsCurrent ? "The source changed. Preview it again before importing." : selected ? `${selected.querySelectorAll("*").length + 1} elements selected · styles at ${width}px · editable text and layout` : "Choose a page or section to import.")}</p>}</div><button type="button" className="btn" disabled={Boolean(busy)} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!selected || !previewIsCurrent || Boolean(busy)} onClick={() => void importSelection()}>{selected?.localName === "body" ? "Import whole page" : "Import selection"}</button></footer>
  </dialog>;
}
