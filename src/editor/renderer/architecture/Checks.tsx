// The check, on the architecture: a count in the bar, the worst of it on each card, and the repair in the inspector
// when one tool call is the whole of it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Architecture, Id } from "buni/format/doc.ts";
import type { Finding } from "buni/tools/arch-check.ts";
import { EDIT_TOOLS } from "../../api.ts";
import { labelOf } from "./edit.ts";
import { worst } from "./checks.ts";
import { useDismiss } from "../useDismiss.ts";

/** The findings, worst first, each one opening the thing it is on. */
export function CheckMenu({ arch, findings, onSelect }: { arch: Architecture; findings: readonly Finding[]; onSelect: (id: Id) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  useEffect(() => { if (open) menu.current?.querySelector("button")?.focus(); }, [open]);
  const severity = worst(findings);
  return (
    <div className="arch-add" ref={ref}>
      <button type="button" className={`arch-btn arch-check-btn${severity ? ` ${severity}` : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`arch-notice-pip ${severity ?? "p3"}`} />
        {findings.length === 1 ? "1 issue" : `${findings.length} issues`}
      </button>
      {open && (
        <div className="arch-menu arch-check-menu" role="menu" aria-label="Issues" ref={menu} onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
          const at = all.indexOf(document.activeElement as HTMLButtonElement);
          all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
        }}>
          {findings.map((f, i) => (
            <button key={i} type="button" role="menuitem" onClick={() => { setOpen(false); onSelect(f.id); }}>
              <span className={`arch-sev ${f.severity}`}>{f.severity.toUpperCase()}</span>
              <span className="arch-check-text"><b>{labelOf(arch, f.id)}</b><span className="arch-sub">{f.message}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What is wrong with the selection, and Fix where one call repairs it. The finding goes when the file does. */
export function CheckNotes({ findings, onFix }: { findings: readonly Finding[]; onFix: (f: Finding) => Promise<void> }) {
  const [busy, setBusy] = useState<number>();
  if (!findings.length) return null;
  return (
    <section className="arch-section arch-look">
      <span className="arch-section-title">Issues</span>
      {findings.map((f, i) => (
        <div key={i} className={`arch-finding ${f.severity}`}>
          <p>{f.message}</p>
          {f.apply && EDIT_TOOLS.some((t) => t === f.apply!.tool)
            ? <button type="button" className="arch-btn" disabled={busy === i} onClick={() => { setBusy(i); void onFix(f).finally(() => setBusy((b) => (b === i ? undefined : b))); }}>{busy === i ? "Fixing…" : "Fix"}</button>
            : <p className="arch-fix">{f.fix}</p>}
        </div>
      ))}
    </section>
  );
}
