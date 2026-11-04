// What the person asked for, in their words: queued until an agent takes it, working beside its name, done with a note.
import { useState } from "react";
import { Check, Circle, Plus, Trash2 } from "lucide-react";
import type { Doc, Id, Task } from "buni/format/doc.ts";
import { tasksInOrder } from "buni/tools/areas/tasks.ts";
import { agentColor, agentInitials } from "./Connect.tsx";
import { ago } from "./Home.tsx";

export function Tasks({ doc, page, now, onShowPage, onToast }: { doc: Doc; page: Id | undefined; now: number; onShowPage: (page: Id) => void; onToast: (t: string) => void }) {
  const [title, setTitle] = useState("");
  const [forPage, setForPage] = useState(true);
  const all = tasksInOrder(doc);
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    const r = await window.buni.edit("add_task", { title: t, ...(forPage && page ? { page } : {}) });
    if (r.ok) setTitle("");
    else onToast(r.reply);
  };
  const remove = async (task: Task) => {
    const r = await window.buni.edit("delete_task", { task: task.id });
    if (!r.ok) onToast(r.reply);
  };
  const pageName = page ? doc.pages[page]?.name : undefined;
  return (
    <section className="tasks" aria-label="Tasks">
      <h3>Tasks{all.length ? <small> · {all.filter((t) => t.state !== "done").length} open</small> : null}</h3>
      <form className="task-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="field" placeholder="Ask for something, in your words" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" className="icon-btn small" aria-label="Add task" disabled={!title.trim()}><Plus size={14} /></button>
      </form>
      {pageName && (
        <label className="switch-label task-page">
          <input type="checkbox" checked={forPage} onChange={(e) => setForPage(e.target.checked)} />
          About {pageName}
        </label>
      )}
      {all.length === 0 && <p className="hint">An agent hears of a task on its next call, takes it, and finishes it with a note here.</p>}
      <ol className="task-list">
        {all.map((t) => (
          <li key={t.id} className={`task ${t.state}`}>
            <span className="task-state" title={t.state}>
              {t.state === "done" ? <Check size={13} /> : t.state === "working" ? <span className="task-working" /> : <Circle size={11} />}
            </span>
            <div className="task-body">
              <span className="task-title">{t.title}</span>
              <span className="task-meta">
                {t.by && <span className="agent-mini" style={{ background: agentColor(t.by) }} title={t.by}>{agentInitials(t.by)}</span>}
                {t.state === "queued" ? `asked ${ago(t.at, now)}` : t.state === "working" ? `${t.by} is on it · ${ago(t.taken ?? t.at, now)}` : `done ${ago(t.done ?? t.at, now)}`}
                {t.page && doc.pages[t.page] && <button type="button" className="link-btn" onClick={() => onShowPage(t.page!)}>{doc.pages[t.page]?.name}</button>}
              </span>
              {t.note && <span className="task-note">{t.note}</span>}
            </div>
            <button type="button" className="icon-btn small task-remove" aria-label="Remove task" onClick={() => void remove(t)}><Trash2 size={12} /></button>
          </li>
        ))}
      </ol>
    </section>
  );
}
