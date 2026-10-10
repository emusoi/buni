import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import type { SkillInfo } from "../api.ts";
import { Prose } from "./Prose.tsx";

function byIndex<T extends { index: string; id: Id }>(a: T, b: T): number {
  return a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1;
}

/** One section: read as formatted text, edited in place on a click; saves when focus leaves. */
function SectionEditor({ id, heading, body, onError }: { id: Id; heading: string; body: string; onError: (m: string) => void }) {
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
  const [editing, setEditing] = useState(false);
  useEffect(() => setH(heading), [heading]);
  useEffect(() => setB(body), [body]);
  const save = async () => {
    if ((h.trim() === heading && b === body) || !h.trim()) return;
    const r = await window.buni.edit("write_section", { section: id, heading: h.trim(), body: b });
    if (!r.ok) onError(r.reply);
  };
  return (
    <section className="doc-section">
      <div className="doc-section-head">
        <input className="doc-heading" value={h} onChange={(e) => setH(e.target.value)} onBlur={() => void save()} aria-label="Section heading" />
        <button type="button" className="icon-btn small" aria-label="Remove section" onClick={() => void window.buni.edit("delete_section", { section: id })}>
          <X size={12} />
        </button>
      </div>
      {/* Read as formatted text; a click (or Enter) edits the markdown, and leaving saves it. */}
      {editing || !b.trim() ? (
        <textarea className="doc-body" autoFocus={editing} value={b} onChange={(e) => setB(e.target.value)} onBlur={() => { setEditing(false); void save(); }} onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()} placeholder="A few plain sentences…" />
      ) : (
        <div className="doc-read" role="button" tabIndex={0} title="Click to edit" onClick={() => setEditing(true)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setEditing(true))}>
          <Prose text={b} />
        </div>
      )}
    </section>
  );
}

/** The design doc: what the product is, for whom, its principles and the decisions made; every agent reads it first. */
export function DocPanel({ doc, fileName }: { doc: Doc; fileName: string }) {
  const [decision, setDecision] = useState("");
  const [notice, setNotice] = useState<string>();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  useEffect(() => {
    void window.buni.skills().then(setSkills);
  }, []);
  const sections = Object.values(doc.sections).sort(byIndex);
  const decisions = Object.values(doc.decisions).sort((a, b) => (a.at < b.at ? -1 : 1));
  const empty = sections.length === 0 && decisions.length === 0;

  return (
    <div className="doc-panel">
      <div className="doc-head">
        <div className="sub-label">Design doc · {fileName.replace(/\.buni$/, "")}</div>
        <p className="hint">Every agent reads this before it starts.</p>
      </div>
      {notice && <div className="notice">{notice}</div>}
      {empty && (
        <p className="hint doc-empty">No doc yet. Add who this is for and a few principles, or ask your coding agent to draft one.</p>
      )}
      {sections.map((s) => (
        <SectionEditor key={s.id} id={s.id} heading={s.heading} body={s.body} onError={setNotice} />
      ))}
      <button type="button" className="link-btn doc-add" onClick={() => void window.buni.edit("write_section", { heading: "New section", body: "" })}>
        <Plus size={12} /> Add section
      </button>

      <section className="doc-decisions">
        <div className="group-title">Decisions</div>
        {decisions.map((d) => (
          <div key={d.id} className="decision">
            <span className="decision-date">{d.at.slice(5, 10).replace("-", "/")}</span>
            <span className="decision-text">{d.text}</span>
            <span className="decision-by">{d.by}</span>
            <button type="button" className="icon-btn small" aria-label="Drop decision" onClick={() => void window.buni.edit("drop_decision", { decision: d.id })}>
              <X size={11} />
            </button>
          </div>
        ))}
        <input
          className="field decision-input"
          placeholder="Record a decision, e.g. 8px spacing grid"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && decision.trim()) {
              void window.buni.edit("decide", { text: decision.trim() });
              setDecision("");
            }
          }}
        />
      </section>

      <section className="doc-skills">
        <div className="group-title">Skills agents follow</div>
        {skills.map((s) => (
          <div key={s.name} className="skill" title={s.description}>
            <span className="skill-name">{s.name}</span>
            {s.source === "yours" && <span className="skill-mine">yours</span>}
            <span className="skill-desc">{s.description}</span>
          </div>
        ))}
        <p className="hint">Add your own as ~/.buni/skills/NAME.md; agents read them like these.</p>
      </section>
    </div>
  );
}
