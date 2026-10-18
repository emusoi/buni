// buni's design guides (the skills agents read), searchable and read in place: what the agents follow, the person
// can read too.
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { SkillInfo } from "../api.ts";
import { Prose } from "./Prose.tsx";

export function Guides({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<SkillInfo[]>([]);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [body, setBody] = useState<string>();
  useEffect(() => void window.buni.skills().then(setAll), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    // A guide named for the search first, then those that only mention it.
    const named = all.filter((s) => s.name.toLowerCase().includes(q));
    return [...named, ...all.filter((s) => !named.includes(s) && s.description.toLowerCase().includes(q))];
  }, [all, query]);
  const current = shown[Math.min(at, shown.length - 1)];
  useEffect(() => {
    setBody(undefined);
    if (current) void window.buni.skill?.(current.name).then(setBody);
  }, [current?.name]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="guides" role="dialog" aria-label="Guides" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, shown.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
      }}>
        <aside className="guides-list">
          <label className="guides-search"><Search size={14} /><input autoFocus placeholder="Search guides" value={query} onChange={(e) => { setQuery(e.target.value); setAt(0); }} /></label>
          {shown.map((s, i) => (
            <button type="button" key={s.name} className={`guides-row${s === current ? " on" : ""}`} onClick={() => setAt(i)}>
              <b>{s.name}</b>{s.source === "yours" && <em>yours</em>}
            </button>
          ))}
          {shown.length === 0 && <p className="hint">No guide matches.</p>}
        </aside>
        <article className="guides-body">
          <button type="button" className="icon-btn guides-close" aria-label="Close" onClick={onClose}><X size={15} /></button>
          {current && <p className="guides-about">{current.description}</p>}
          {body === undefined ? <p className="hint">{current ? "Loading…" : ""}</p> : <Prose text={body} />}
        </article>
      </div>
    </div>
  );
}
