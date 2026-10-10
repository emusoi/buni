// A layer as HTML with inline styles, written by hand: the same model as the Design tab, another way into it.
// ⌘Enter applies (replace_html, or write_html for new markup), Escape goes back to what is saved. A draft is never
// overwritten by someone else's edit; it says so instead.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Maximize2 } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import { layerHtml, layerJsx } from "buni/tools/html.ts";

/** Tags, attribute names, strings and comments, as spans for the highlight under the textarea. */
function highlight(code: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return code.replace(/(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w-]*)|([\w-]+)(=)("[^"]*")|([<>/]+)|([^<>="\w-]+|[\w-]+|.)/g,
    (_m, comment: string | undefined, open: string | undefined, tag: string | undefined, attr: string | undefined, eq: string | undefined, str: string | undefined, punct: string | undefined, rest: string | undefined) => {
      if (comment) return `<span class="c-comment">${esc(comment)}</span>`;
      if (tag) return `<span class="c-punct">${esc(open ?? "")}</span><span class="c-tag">${tag}</span>`;
      if (attr) return `<span class="c-attr">${attr}</span>${eq}<span class="c-str">${esc(str ?? "")}</span>`;
      if (punct) return `<span class="c-punct">${esc(punct)}</span>`;
      return esc(rest ?? "");
    }) + "\n";
}

export type CodeTarget =
  | { kind: "layer"; node: Id }
  | { kind: "insert"; parent: Id; after?: Id };

export function CodeView({ doc, target, onApplied, onWiden }: {
  doc: Doc;
  target: CodeTarget;
  /** After an insert, the first new layer, to select it. */
  onApplied?: (created: Id | undefined, reply: string) => void;
  onWiden?: () => void;
}) {
  const saved = useMemo(() => (target.kind === "layer" ? layerHtml(doc, target.node) : ""), [doc, target]);
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const area = useRef<HTMLTextAreaElement>(null);
  const shade = useRef<HTMLPreElement>(null);
  const dirty = draft !== base;
  // A change from elsewhere replaces a clean editor; a dirty one keeps the draft and says what happened.
  const stale = dirty && saved !== base;
  useEffect(() => {
    if (!dirty) { setDraft(saved); setBase(saved); }
  }, [saved]); // only when what is saved changes; `dirty` is read as it stands then
  // A different layer starts over.
  const key = target.kind === "layer" ? target.node : `${target.parent}:${target.after ?? ""}`;
  useEffect(() => { setDraft(saved); setBase(saved); setStatus(undefined); }, [key]); // only on a new target

  const apply = async () => {
    if (!draft.trim() && target.kind === "insert") return;
    const r = target.kind === "layer"
      ? await window.buni.edit("replace_html", { node: target.node, html: draft })
      : await window.buni.edit("write_html", { parent: target.parent, html: draft, ...(target.after ? { after: target.after } : {}) });
    setStatus({ ok: r.ok, text: r.reply });
    if (!r.ok) return;
    if (target.kind === "insert") { setDraft(""); onApplied?.(r.reply.match(/Created \d+ nodes?: ([^,.\s]+)/)?.[1], r.reply); }
    else setBase(draft);
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void apply(); }
    else if (e.key === "Escape") { e.preventDefault(); setDraft(saved); setBase(saved); setStatus(undefined); }
    else if (e.key === "Tab") {
      // Tab indents instead of leaving the editor.
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      setDraft(draft.slice(0, a) + "  " + draft.slice(b));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
    }
  };
  return (
    <div className="code-view">
      <div className="code-bar">
        <span className="hint">{target.kind === "insert" ? "New HTML, written into the page" : "HTML with inline styles"}</span>
        {target.kind === "layer" && (
          <button type="button" className="link-btn" title="Copy this layer as React JSX, with style objects" onClick={() => void navigator.clipboard.writeText(layerJsx(doc, target.node)).then(() => setStatus({ ok: true, text: "Copied as JSX." }))}>Copy JSX</button>
        )}
        {onWiden && <button type="button" className="icon-btn small" title="Make the panel wider" aria-label="Make the panel wider" onClick={onWiden}><Maximize2 size={12} /></button>}
      </div>
      <div className="code-edit">
        <pre ref={shade} className="code-shade" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlight(draft) }} />
        <textarea
          ref={area}
          className="code-area"
          value={draft}
          spellCheck={false}
          autoCapitalize="off"
          aria-label={target.kind === "insert" ? "HTML to add" : "This layer as HTML"}
          placeholder={'<section style="display: flex; gap: 12px; padding: 24px">\n  <h2 style="margin: 0">Title</h2>\n</section>'}
          onChange={(e) => { setDraft(e.target.value); setStatus(undefined); }}
          onKeyDown={keys}
          onScroll={(e) => { if (shade.current) { shade.current.scrollTop = e.currentTarget.scrollTop; shade.current.scrollLeft = e.currentTarget.scrollLeft; } }}
        />
      </div>
      {stale && <div className="notice">Someone changed this layer while you were editing. Applying replaces their change; Escape takes theirs.</div>}
      {status && <div className={`notice${status.ok ? " code-ok" : ""}`}>{status.text}</div>}
      <div className="code-actions">
        <span className="hint">{dirty ? "⌘↵ to apply · Esc to discard" : target.kind === "insert" ? "Write HTML, then ⌘↵" : "Saved"}</span>
        <button type="button" className="btn primary" disabled={!dirty} onClick={() => void apply()}>{target.kind === "insert" ? "Add" : "Apply"}</button>
      </div>
    </div>
  );
}
