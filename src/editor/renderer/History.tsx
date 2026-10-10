// Named versions of the design: save one before a big change, go back to any of them. Going back is one edit, so
// ⌘Z returns to where you were.
import { useCallback, useEffect, useRef, useState } from "react";
import { History as HistoryIcon, RotateCcw } from "lucide-react";
import type { VersionInfo } from "../api.ts";
import { useDismiss } from "./useDismiss.ts";

const when = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function History({ onToast }: { onToast: (m: string) => void }) {
  const { versions, saveVersion, restoreVersion } = window.buni;
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<VersionInfo[]>();
  const [name, setName] = useState("");
  const anchor = useRef<HTMLSpanElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), anchor);
  useEffect(() => {
    if (!open || !versions) return;
    let live = true;
    void versions().then((v) => { if (live) setList(v); }, (e: unknown) => onToast(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [open, versions, onToast]);
  if (!versions || !saveVersion || !restoreVersion) return null;
  const save = async () => {
    const v = await saveVersion(name);
    setName("");
    setList((l) => [v, ...(l ?? [])]);
    onToast(`Saved ${v.name ? `"${v.name}"` : "this version"}.`);
  };
  const restore = async (v: VersionInfo) => {
    const r = await restoreVersion(v.id);
    onToast(r.ok ? `${r.reply} ⌘Z goes back.` : r.reply);
    if (r.ok) setOpen(false);
  };
  return (
    <span className="export-anchor" ref={anchor}>
      <button type="button" className="icon-btn" aria-label="Versions" aria-expanded={open} title="Versions: save one, or go back to one" onClick={() => setOpen((o) => !o)}>
        <HistoryIcon size={16} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="agent-menu export-menu history-menu" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="menu-label">Save this version</div>
          <form className="history-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input className="field" autoFocus placeholder="Name (optional)" aria-label="Version name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn primary">Save</button>
          </form>
          <div className="menu-rule" />
          <div className="menu-label">Go back to</div>
          {list === undefined && <p className="hint">Loading…</p>}
          {list?.length === 0 && <p className="hint">No versions yet. Save one before a big change; you can come back to it.</p>}
          {list?.map((v) => (
            <div key={v.id} className="history-row">
              <span className="menu-name">{v.name || when(v.at)}</span>
              <span className="menu-state">{v.name ? when(v.at) : v.by}</span>
              <button type="button" className="link-btn" title="Make the design match this version; ⌘Z undoes it" onClick={() => void restore(v)}><RotateCcw size={12} /> Restore</button>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
