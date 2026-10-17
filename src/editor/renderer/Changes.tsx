// The design folder's git branch and what changed in it, beside the title; committing it without leaving buni.
import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import type { GitStatus } from "../api.ts";
import { useDismiss } from "./useDismiss.ts";

const MARK: Record<GitStatus["changes"][number]["state"], string> = { modified: "M", added: "A", deleted: "D", renamed: "R", new: "N" };

export function Changes({ version, onToast }: {
  /** Changes whenever the design does, so the count follows edits. */
  version: unknown;
  onToast: (text: string) => void;
}) {
  const [status, setStatus] = useState<GitStatus>();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), anchor);
  const read = useCallback(() => void window.buni.changes?.().then(setStatus, () => setStatus(undefined)), []);
  // A moment after the last edit, not on every keystroke of one.
  useEffect(() => {
    const t = setTimeout(read, 800);
    return () => clearTimeout(t);
  }, [version, read]);
  if (!window.buni.changes || !status) return null;
  const n = status.changes.length;
  const commit = (push: boolean) => {
    setBusy(true);
    void window.buni.commit?.(message, push).then((r) => {
      onToast(r.reply);
      if (r.ok) { setMessage(""); setOpen(false); }
      read();
    }).finally(() => setBusy(false));
  };
  return (
    <span className="export-anchor changes" ref={anchor}>
      <button type="button" className="changes-btn" aria-expanded={open} title={n ? `${n} changed since the last commit` : "Everything is committed"} onClick={() => setOpen((o) => !o)}>
        <GitBranch size={12} /> {status.branch}{n > 0 && <span className="changes-n">{n}</span>}
      </button>
      {open && (
        <div className="agent-menu export-menu changes-menu" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="menu-label">{n ? `${n} ${n === 1 ? "change" : "changes"} on ${status.branch}` : `Nothing to commit on ${status.branch}`}</div>
          {status.changes.slice(0, 12).map((c) => (
            <div key={c.path} className="changes-row" title={c.state}><span className={`changes-mark ${c.state}`}>{MARK[c.state]}</span>{c.path}</div>
          ))}
          {n > 12 && <div className="changes-row dim">and {n - 12} more</div>}
          {n > 0 && (
            <form className="changes-form" onSubmit={(e) => { e.preventDefault(); commit(false); }}>
              <input className="field" autoFocus placeholder="What changed" value={message} onChange={(e) => setMessage(e.target.value)} />
              <div className="changes-actions">
                <button type="button" className="btn" disabled={busy || !message.trim()} onClick={() => commit(true)}>Commit and push</button>
                <button type="submit" className="btn primary" disabled={busy || !message.trim()}>Commit</button>
              </div>
            </form>
          )}
        </div>
      )}
    </span>
  );
}
