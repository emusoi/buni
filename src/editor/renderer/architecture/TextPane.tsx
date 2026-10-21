// The architecture as text beside the views: the YAML read_architecture_text gives, edited in a plain monospace
// editor and applied whole with write_architecture_text (one edit, one undo). It follows changes made elsewhere
// until you start typing; then it says so and waits for Revert.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** A refusal's lines, each with the line of the text it names ("line 4 · parts.web.kind: …"), when it names one. */
export function refusalLines(reply: string): { line?: number; text: string }[] {
  return reply.split("\n").filter((l) => l.trim()).map((text) => {
    const n = Number(/\bline (\d+)\b/.exec(text)?.[1]);
    return Number.isInteger(n) && n > 0 ? { line: n, text } : { text };
  });
}

/** Where line `n` (from 1) starts and ends in `text`. */
export function lineRange(text: string, n: number): [number, number] {
  let start = 0;
  for (let i = 1; i < n; i++) {
    const nl = text.indexOf("\n", start);
    if (nl < 0) return [text.length, text.length];
    start = nl + 1;
  }
  const end = text.indexOf("\n", start);
  return [start, end < 0 ? text.length : end];
}

export function TextPane({ version, onClose, onToast }: {
  /** Changes whenever the architecture does, here or elsewhere. */
  version: unknown;
  onClose: () => void;
  onToast: (text: string) => void;
}) {
  // What was last loaded, and what is being written over it.
  const [base, setBase] = useState<string>();
  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<{ line?: number; text: string }[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const dirty = base !== undefined && draft !== base;
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;

  const load = async () => {
    const r = await window.buni.edit("read_architecture_text", {});
    if (!r.ok) return setErrors(refusalLines(r.reply));
    setBase(r.reply);
    setDraft(r.reply);
    setErrors([]);
    setStale(false);
  };
  // First open, and every change made elsewhere unless there is typing to keep.
  useEffect(() => {
    if (dirtyNow.current) setStale(true);
    else void load();
  }, [version]);

  const apply = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    const r = await window.buni.edit("write_architecture_text", { text: draft });
    setBusy(false);
    if (!r.ok) return setErrors(refusalLines(r.reply));
    setErrors([]);
    onToast(r.reply);
    // Read it back as the tools write it; the change elsewhere this makes reloads it too.
    setBase(draft);
    void load();
  };
  const goTo = (line: number) => {
    const el = area.current;
    if (!el) return;
    const [a, b] = lineRange(draft, line);
    el.focus();
    el.setSelectionRange(a, b);
    // About where the line is: 18px a line.
    el.scrollTop = Math.max(0, (line - 4) * 18);
  };
  const bad = new Set(errors.flatMap((e) => (e.line ? [e.line] : [])));
  const lines = draft.split("\n").length;

  return (
    <aside className="arch-text" aria-label="Architecture as text">
      <div className="arch-text-head">
        <b>Text</b>
        <span className="arch-sub">{stale ? "changed elsewhere — Revert to load" : dirty ? "unsaved" : "YAML · keyed by id"}</span>
        <span className="grow" />
        <button type="button" className="arch-btn" disabled={!dirty && !stale} onClick={() => void load()} title="Load the architecture as it is now, dropping your edits">Revert</button>
        <button type="button" className="arch-btn primary" disabled={!dirty || busy} onClick={() => void apply()} title="Apply (⌘S)">Apply</button>
        <button type="button" className="arch-icon-btn" aria-label="Close the text" onClick={onClose}><X size={13} /></button>
      </div>
      {errors.length > 0 && (
        <div className="arch-text-errors" role="alert">
          {errors.map((e, i) => e.line
            ? <button key={i} type="button" onClick={() => goTo(e.line!)}>{e.text}</button>
            : <span key={i}>{e.text}</span>)}
        </div>
      )}
      <div className="arch-text-editor">
        <div className="arch-text-gutter" ref={gutter} aria-hidden>
          {Array.from({ length: lines }, (_, i) => <span key={i} className={bad.has(i + 1) ? "bad" : undefined}>{i + 1}</span>)}
        </div>
        <textarea
          ref={area}
          aria-label="Architecture YAML"
          spellCheck={false}
          wrap="off"
          value={base === undefined ? "Loading…" : draft}
          readOnly={base === undefined}
          onChange={(e) => setDraft(e.target.value)}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void apply(); }
            else if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              // Two spaces, as YAML wants; Escape and then Tab leaves the editor.
              e.preventDefault();
              document.execCommand("insertText", false, "  ");
            } else if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      </div>
    </aside>
  );
}
