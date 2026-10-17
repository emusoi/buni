// An agent waiting on you: its question, the answers it offers, and room to say something else.
import { useState } from "react";
import { ArrowUp, Crosshair, X } from "lucide-react";
import type { Asking } from "buni/tools/protocol.ts";
import { agentColor, agentInitials } from "./Connect.tsx";

export function AskCard({ q, more, layer, onShow }: {
  q: Asking;
  /** How many more questions wait behind this one. */
  more: number;
  /** The layer it's about, by name, when it names one. */
  layer: string | undefined;
  onShow: () => void;
}) {
  const [text, setText] = useState("");
  const answer = (a: string | undefined) => void window.buni.answer?.(q.id, a);
  return (
    <div className="ask-card" role="dialog" aria-label={`${q.author} asks`}>
      <div className="ask-head">
        <span className="presence-dot" style={{ background: agentColor(q.author) }}>{agentInitials(q.author)}</span>
        <b style={{ color: agentColor(q.author) }}>{q.author} asks</b>
        {layer && <button type="button" className="ask-layer" onClick={onShow} title="Show the layer it's about"><Crosshair size={12} /> {layer}</button>}
        {more > 0 && <span className="ask-more">+{more} more</span>}
        <button type="button" className="icon-btn small" aria-label="Dismiss" title="Dismiss: the agent carries on with its best guess" onClick={() => answer(undefined)}><X size={13} /></button>
      </div>
      <p className="ask-question">{q.question}</p>
      {q.options.length > 0 && (
        <div className="ask-options">
          {q.options.map((o, i) => <button type="button" key={o} className={`btn${i === 0 ? " primary" : ""}`} onClick={() => answer(o)}>{o}</button>)}
        </div>
      )}
      <form className="ask-reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) answer(text); }}>
        <input className="field" placeholder={`Tell ${q.author} something else…`} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="icon-btn small" aria-label="Send" disabled={!text.trim()}><ArrowUp size={14} /></button>
      </form>
    </div>
  );
}
