// The Mac's side of pen review: the marks on the open page, as they arrive, and one button that hands them to the agent.
import { Tablet, X } from "lucide-react";
import type { Doc, Id } from "buni/format/doc.ts";
import { marksOn, markKind } from "buni/tools/ink.ts";

/** Sends a page's marks to the coding agent: the server puts the request on this Mac's clipboard, else this tab does. */
export async function sendMarks(page: Id, onToast: (text: string) => void): Promise<void> {
  const r = await window.buni.sendMarks?.(page);
  if (!r?.count) return onToast("No marks on this page yet");
  if (!r.copied) await navigator.clipboard.writeText(r.request);
  onToast(`Copied ${r.count} mark${r.count === 1 ? "" : "s"} for Claude; paste into Claude Code or Codex`);
}

export function MarksPanel({ doc, page, lit, onLight, onShow, onToast }: {
  doc: Doc;
  page: Id;
  lit: Id | undefined;
  onLight: (thread: Id | undefined) => void;
  onShow: (node: Id) => void;
  onToast: (text: string) => void;
}) {
  const marks = marksOn(doc, page);
  const from = [...new Set(marks.map((c) => c.ink?.from).filter(Boolean))];
  if (!marks.length) {
    return <div className="marks-empty">No marks on {doc.pages[page]?.name ?? "this page"}. Open it on your tablet (the tablet button above) and draw with your pen.</div>;
  }
  return (
    <div className="marks-panel">
      <div className="marks-from"><Tablet size={16} /><span><b>{from.join(", ") || "Someone"}</b> drew {marks.length === 1 ? "this" : "these"}</span></div>
      <ol className="marks-list">
        {marks.map((c, i) => (
          <li key={c.id} className={lit === c.id ? "lit" : undefined} onPointerEnter={() => onLight(c.id)} onPointerLeave={() => onLight(undefined)}>
            <span className="marks-n">{i + 1}</span>
            <button type="button" className="marks-text" onClick={() => onShow(c.node)}>
              <span>{c.posts.at(-1)?.body}</span>
              <span className="marks-where">{markKind(c.ink?.strokes ?? [])} on <b>{doc.nodes[c.node]?.name ?? c.node}</b>{c.state === "addressed" ? " · handled" : ""}</span>
            </button>
            <button type="button" className="icon-btn marks-erase" title="Erase mark" aria-label={`Erase mark ${i + 1}`} onClick={() => void window.buni.edit("mark", { remove: c.id })}><X size={14} /></button>
          </li>
        ))}
      </ol>
      <div className="marks-foot">
        <span>Claude gets each mark with a picture of it and the layer it points at.</span>
        <div className="marks-actions">
          <button type="button" className="bar-btn dark" onClick={() => void sendMarks(page, onToast)}>Send {marks.length} mark{marks.length === 1 ? "" : "s"} to Claude</button>
          <button type="button" className="bar-btn" title="Resolve every mark on this page" onClick={() => void Promise.all(marks.map((c) => window.buni.edit("comment", { thread: c.id, resolve: true })))}>Clear</button>
        </div>
      </div>
    </div>
  );
}
