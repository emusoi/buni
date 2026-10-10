// The conversation on a layer, in the Inspector: open threads with their replies, a way to answer, resolve or
// reopen, and a new comment. Agents read the same threads in their briefs and mark them addressed.
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { Doc, Node } from "buni/format/doc.ts";

export function Comments({ doc, node, onError }: { doc: Doc; node: Node; onError: (m: string | undefined) => void }) {
  const threads = Object.values(doc.comments).filter((c) => c.node === node.id);
  const live = threads.filter((t) => t.state !== "resolved");
  const done = threads.filter((t) => t.state === "resolved");
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const run = async (args: Record<string, unknown>) => {
    const r = await window.buni.edit("comment", args);
    onError(r.ok ? undefined : r.reply);
    return r.ok;
  };
  return (
    <section className="group comments" aria-label="Comments">
      <div className="group-title"><MessageSquare size={12} /> Comments{live.length > 0 && <span className="count">{live.length}</span>}</div>
      {[...live, ...(showDone ? done : [])].map((t) => (
        <div key={t.id} className={`sys-thread${t.state === "resolved" ? " resolved" : ""}`}>
          {t.posts.map((p, i) => <p key={i}><b>{p.author}</b> {p.body}</p>)}
          {t.state === "addressed" && <span className="sys-addressed">Addressed · resolve it if it's done</span>}
          {t.state === "resolved" ? (
            <button type="button" className="link-btn" onClick={() => void run({ thread: t.id, resolve: false })}>Resolved · reopen</button>
          ) : (
            <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); const b = reply[t.id]?.trim(); if (b) void run({ thread: t.id, body: b }).then((ok) => ok && setReply({ ...reply, [t.id]: "" })); }}>
              <input className="field" placeholder="Reply…" aria-label="Reply" value={reply[t.id] ?? ""} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} />
              <button type="button" className="link-btn" onClick={() => void run({ thread: t.id, resolve: true })}>Resolve</button>
            </form>
          )}
        </div>
      ))}
      {done.length > 0 && <button type="button" className="link-btn" onClick={() => setShowDone((s) => !s)}>{showDone ? "Hide" : "Show"} {done.length} resolved</button>}
      <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void run({ node: node.id, body: draft.trim() }).then((ok) => ok && setDraft("")); }}>
        <input className="field" placeholder={`Comment on ${node.name}…`} aria-label="New comment" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="link-btn" disabled={!draft.trim()}>Post</button>
      </form>
    </section>
  );
}
