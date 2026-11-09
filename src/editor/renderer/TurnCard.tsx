// An agent's turn, summed up on the canvas as it works: what it changed, then Show, Undo turn or Keep. A turn is the
// agent's edits since the person last did something or kept its work; undoing takes back only those, not others'.
import type { Doc, Id } from "buni/format/doc.ts";
import type { Edit } from "buni/tools/workspace.ts";
import { pageOfNode } from "./search.ts";

export interface Turn {
  author: string;
  edits: Edit[];
}

/** The latest agent's turn: its edits after the person's last one and after its last kept turn. */
export function currentTurn(edits: readonly Edit[], kept: Readonly<Record<string, string>>): Turn | undefined {
  const author = edits.findLast((e) => e.author !== "you")?.author;
  if (!author) return undefined;
  const since = [edits.findLast((e) => e.author === "you")?.at ?? "", kept[author] ?? ""].sort().at(-1) ?? "";
  const mine = edits.filter((e) => e.author === author && e.at > since);
  return mine.length ? { author, edits: mine } : undefined;
}

export function TurnCard({ doc, turn, color, onShow, onUndo, onKeep }: {
  doc: Doc;
  turn: Turn;
  color: string;
  onShow: (page: Id, node: Id | undefined) => void;
  onUndo: () => void;
  onKeep: () => void;
}) {
  const nodes = [...new Set(turn.edits.flatMap((e) => e.nodes))].filter((id) => doc.nodes[id]);
  const pages = [...new Set(nodes.map((id) => pageOfNode(doc, id)).filter((p): p is Id => !!p && !!doc.pages[p]))];
  const where = pages.length === 1 ? doc.pages[pages[0]!]?.name : pages.length ? `${pages.length} pages` : "the design";
  const labels = [...new Set(turn.edits.map((e) => e.label))];
  const first = pages[0];
  return (
    <div className="turn-card" role="status" aria-label={`${turn.author}'s changes`}>
      <span className="turn-dot" style={{ background: color }} />
      <div className="turn-what">
        <b>{turn.author} changed {nodes.length || turn.edits.length} {nodes.length === 1 ? "layer" : "layers"} on {where}</b>
        <span className="hint">{labels.slice(-3).join(" · ")}{labels.length > 3 ? ` · ${labels.length - 3} more` : ""}</span>
      </div>
      {first && <button type="button" className="btn small ghost" onClick={() => onShow(first, nodes.find((n) => pageOfNode(doc, n) === first))}>Show</button>}
      <button type="button" className="btn small" title={`Take back everything ${turn.author} did in this turn; your edits and others' stay`} onClick={onUndo}>Undo turn</button>
      <button type="button" className="btn small primary" onClick={onKeep}>Keep</button>
    </div>
  );
}

/** The design's history as turns: runs of edits by one author, newest first. */
export function turnsOf(edits: readonly Edit[]): Turn[] {
  const out: Turn[] = [];
  for (const e of edits) {
    const last = out.at(-1);
    if (last?.author === e.author) last.edits.push(e);
    else out.push({ author: e.author, edits: [e] });
  }
  return out.reverse();
}
