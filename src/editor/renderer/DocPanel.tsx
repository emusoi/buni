// The design doc, as buni-web's 21 · Inspector · Agents and Doc draws it: a card up top saying what it's for, then
// each section as a card with its first line while closed; one opens at a time, and Edit turns it into a box.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import type { SkillInfo } from "../api.ts";
import { Prose } from "./Prose.tsx";
import { Guides } from "./Guides.tsx";

function byIndex<T extends { index: string; id: Id }>(a: T, b: T): number {
  return a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1;
}

/** A section's first line, for its card while closed. */
const firstLine = (body: string) => body.split(/\n+/).map((l) => l.replace(/^#+\s*|[*_`]/g, "").trim()).find(Boolean) ?? "Nothing written yet";

/** One section: a row while closed; open, read as formatted text, or edited in a box; saves when focus leaves. */
function Section({ id, heading, body, open, onOpen, onError }: { id: Id; heading: string; body: string; open: boolean; onOpen: (open: boolean) => void; onError: (m: string) => void }) {
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
  const [editing, setEditing] = useState(false);
  useEffect(() => setH(heading), [heading]);
  useEffect(() => setB(body), [body]);
  useEffect(() => { if (!open) setEditing(false); }, [open]);
  const save = async () => {
    if ((h.trim() === heading && b === body) || !h.trim()) return;
    const r = await window.buni.edit("write_section", { section: id, heading: h.trim(), body: b });
    if (!r.ok) onError(r.reply);
  };
  return (
    <section className={`doc-section${open ? " open" : ""}`}>
      <div className="doc-section-head">
        <button type="button" className="group-title fold" aria-expanded={open} onClick={() => onOpen(!open)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open && editing ? <input className="doc-heading" value={h} autoFocus={!b.trim()} onClick={(e) => e.stopPropagation()} onChange={(e) => setH(e.target.value)} onBlur={() => void save()} aria-label="Section heading" /> : <span className="group-name">{heading}</span>}
        </button>
        {open && !editing && <button type="button" className="link-btn" onClick={() => setEditing(true)}>Edit</button>}
        {open && editing && <button type="button" className="icon-btn small" aria-label="Remove section" title="Remove this section" onClick={() => void window.buni.edit("delete_section", { section: id })}><X size={12} /></button>}
      </div>
      {!open && <p className="doc-first">{firstLine(body)}</p>}
      {open && (editing || !b.trim() ? (
        <textarea className="doc-body" autoFocus={editing && Boolean(b.trim())} value={b} onChange={(e) => setB(e.target.value)} onBlur={() => { setEditing(false); void save(); }} onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()} placeholder="A few plain sentences…" />
      ) : (
        <div className="doc-read" role="button" tabIndex={0} title="Click to edit" onClick={() => setEditing(true)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setEditing(true))}>
          <Prose text={b} />
        </div>
      ))}
    </section>
  );
}

/** The design doc: what the product is, for whom, its principles and direction; every agent reads it first. */
export function DocPanel({ doc, fileName, onToast }: { doc: Doc; fileName: string; onToast?: (t: string) => void }) {
  const [notice, setNotice] = useState<string>();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [reading, setReading] = useState(false);
  const sections = Object.values(doc.sections).sort(byIndex);
  const [open, setOpen] = useState<Id | undefined>(sections[0]?.id);
  useEffect(() => {
    void window.buni.skills().then(setSkills);
  }, []);
  const add = () => void window.buni.edit("write_section", { heading: "New section", body: "" }).then((r) => {
    const id = r.reply.match(/\b([0-9a-f]{8})\b/)?.[1];
    if (!r.ok) setNotice(r.reply); else if (id) setOpen(id);
  });
  const copy = () => {
    const text = sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}`).join("\n\n");
    void navigator.clipboard.writeText(`# ${fileName.replace(/\.buni$/, "")} · design doc\n\n${text}\n`).then(() => onToast?.("Copied the doc, as markdown."));
  };
  const yours = skills.filter((s) => s.source === "yours").length;
  return (
    <div className="doc-panel">
      <section className="doc-head">
        <div className="group-title comments-title"><span className="group-name">Design doc</span><span className="group-summary">{sections.length ? `${sections.length} section${sections.length === 1 ? "" : "s"}` : "Empty"}</span></div>
        <p className="hint small">Every agent reads this before it starts. Agents write it; you can too.</p>
        <div className="doc-actions">
          <button type="button" className="btn small" onClick={add}><Plus size={12} /> Add a section</button>
          {sections.length > 0 && <button type="button" className="btn small" onClick={copy}>Copy for an agent</button>}
        </div>
      </section>
      {notice && <div className="notice">{notice}</div>}
      {sections.length === 0 && <p className="hint small doc-empty">No doc yet. Add who this is for and a few principles, or ask your coding agent to draft one.</p>}
      {sections.map((s) => (
        <Section key={s.id} id={s.id} heading={s.heading} body={s.body} open={open === s.id} onOpen={(o) => setOpen(o ? s.id : undefined)} onError={setNotice} />
      ))}
      <section className="doc-skills">
        <div className="group-title comments-title">
          <span className="group-name">{skills.length} guide{skills.length === 1 ? "" : "s"} agents follow</span>
          <button type="button" className="group-summary as-btn" onClick={() => setReading(true)}>Read</button>
        </div>
        <p className="hint small">{yours ? `${yours} of them yours. ` : ""}Add your own as ~/.buni/skills/NAME.md.</p>
        {reading && <Guides onClose={() => setReading(false)} />}
      </section>
    </div>
  );
}
