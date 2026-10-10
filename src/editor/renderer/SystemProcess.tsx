// The design process as canvases: requirements in phase lanes, questions by status, calls by who may
// call them, pieces by review state. Dragging a card into a lane is the edit.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Change } from "buni/tools/changes.ts";
import { Panel, type Node as FlowNode, type NodeProps, type NodeTypes } from "@xyflow/react";
import { AlertTriangle, CircleHelp, KeyRound, ListChecks, MessageSquare, Milestone, Plus } from "lucide-react";
import { pageLabel, pagesInOrder, reviewOf, statesOf, type Access, type Doc, type Id, type Question, type ReviewState } from "buni/format/doc.ts";
import type { EditTool } from "../api.ts";
import { Canvas } from "./SystemCanvas.tsx";
import { Checks, Segments } from "./SystemEdit.tsx";
import { allCalls, callName, type SystemSelection } from "./system.ts";

type Select = (s: SystemSelection | undefined) => void;
type Toast = (m: string) => void;
type AnyNode = FlowNode<Record<string, unknown>>;

async function edit(tool: EditTool, args: Record<string, unknown>, onToast: Toast) {
  const r = await window.buni.edit(tool, args);
  if (!r.ok) onToast(r.reply);
  return r;
}

const byIndex = <T extends { index: string }>(xs: T[]): T[] => xs.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));

// ---------------------------------------------------------------------------------------------
// A board: lanes of cards; a lane that fills wraps into another column.

const CARD_W = 232;
const CARD_H = 62;
const GAP = 10;
const HEAD = 44;
const ROWS = 12;

type Tone = "warn" | "good" | "dim" | undefined;
export type Card = { id: Id; lane: string; title: string; sub?: string; badge?: string; tone?: Tone; threads?: number };
export interface Lane { id: string; label: string; hint?: string }

type CardData = Card & { on: boolean };
function CardNode({ data }: NodeProps<FlowNode<CardData>>) {
  return (
    <div className={`sys-board-card${data.on ? " on" : ""}${data.tone ? ` tone-${data.tone}` : ""}`} style={{ width: CARD_W, height: CARD_H }}>
      <span className="sys-board-top">{data.badge && <span className="sys-board-badge">{data.badge}</span>}<b>{data.title}</b></span>
      <span className="sys-board-sub">{data.tone === "warn" && <AlertTriangle size={11} />}{data.sub}{data.threads ? <span className="sys-board-threads"><MessageSquare size={11} /> {data.threads}</span> : null}</span>
    </div>
  );
}

function LaneBox({ data }: NodeProps<FlowNode<{ label: string; hint?: string; count: number; w: number; h: number; on: boolean }>>) {
  return (
    <div className={`sys-board-lane${data.on ? " on" : ""}`} style={{ width: data.w, height: data.h }}>
      <span className="sys-board-lane-head"><b>{data.label}</b> <span className="dim">{data.count}</span>{data.hint && <span className="sys-board-lane-hint">{data.hint}</span>}</span>
    </div>
  );
}

const BOARD_TYPES: NodeTypes = { card: CardNode, lane: LaneBox };

function Board({ doc, lanes, cards, selected, onCard, onLane, onMove, onToast, children }: {
  doc: Doc; lanes: Lane[]; cards: Card[]; selected: Id | undefined;
  onCard: (id: Id) => void; onLane?: (lane: string) => void; onMove: (id: Id, from: string, to: string) => void; onToast: Toast; children?: ReactNode;
}) {
  const { nodes, spans } = useMemo(() => {
    const out: AnyNode[] = [];
    const spans: { lane: string; x: number; w: number }[] = [];
    // A long lane wraps into at most three columns and grows down, so every lane stays in view.
    const rowsOf = (n: number) => Math.max(ROWS, Math.ceil(n / 3));
    const tallest = Math.max(1, ...lanes.map((l) => { const n = cards.filter((c) => c.lane === l.id).length; return Math.min(rowsOf(n), n); }));
    const h = HEAD + tallest * (CARD_H + GAP) + GAP;
    let x = 0;
    for (const l of lanes) {
      const mine = cards.filter((c) => c.lane === l.id);
      const rows = rowsOf(mine.length);
      const cols = Math.max(1, Math.ceil(mine.length / rows));
      const w = cols * (CARD_W + GAP) + GAP;
      spans.push({ lane: l.id, x, w });
      out.push({ id: `lane:${l.id}`, type: "lane", position: { x, y: 0 }, data: { label: l.label, hint: l.hint, count: mine.length, w, h, on: l.id === `role:${selected}` || l.id === selected }, draggable: false, zIndex: -1 });
      mine.forEach((c, i) => out.push({ id: `${l.id}::${c.id}`, type: "card", position: { x: x + GAP + Math.floor(i / rows) * (CARD_W + GAP), y: HEAD + (i % rows) * (CARD_H + GAP) }, data: { ...c, on: c.id === selected } }));
      x += w + 18;
    }
    return { nodes: out, spans };
  }, [lanes, cards, selected]);
  const split = (nodeId: string) => { const i = nodeId.indexOf("::"); return { lane: nodeId.slice(0, i), id: nodeId.slice(i + 2) }; };
  return (
    <Canvas
      doc={doc} nodes={nodes} edges={[]} nodeTypes={BOARD_TYPES} alignTop
      search={cards.map((c) => ({ id: `${c.lane}::${c.id}`, label: c.title }))}
      onNodeClick={(nid) => {
        if (nid.startsWith("lane:")) return onLane?.(nid.slice(5));
        onCard(split(nid).id);
      }}
      onPaneClick={() => undefined}
      onDrop={(n) => {
        if (n.id.startsWith("lane:")) return;
        const { lane: from, id } = split(n.id);
        const cx = n.position.x + CARD_W / 2;
        const to = spans.find((s) => cx >= s.x && cx <= s.x + s.w)?.lane;
        if (!to) return onToast("Drop it into a lane.");
        if (to !== from) onMove(id, from, to);
        else onCard(id);
      }}
      onToast={onToast}
    >
      {children}
    </Canvas>
  );
}

const threadCount = (doc: Doc, id: Id) => Object.values(doc.threads).filter((t) => t.target === id && t.state !== "resolved").length;

/** Any system piece's name. */
export function pieceName(doc: Doc, id: Id): string {
  const c = allCalls(doc).find((x) => x.value.id === id);
  if (c) return callName(c);
  return (doc.parts[id] ?? doc.tables[id] ?? doc.events[id] ?? doc.shapes[id] ?? doc.traces[id] ?? doc.pages[id] ?? doc.flows[id])?.name ?? doc.requirements[id]?.title ?? doc.questions[id]?.text ?? id;
}

/** The selection that opens a piece in the inspector. */
export function selectionFor(doc: Doc, id: Id): SystemSelection | undefined {
  if (doc.parts[id]) return { kind: "part", id };
  if (doc.endpoints[id]) return { kind: "endpoint", id };
  if (doc.operations[id]) return { kind: "operation", id };
  if (doc.tables[id]) return { kind: "table", id };
  if (doc.events[id]) return { kind: "event", id };
  if (doc.shapes[id]) return { kind: "shape", id };
  if (doc.traces[id]) return { kind: "trace", id };
  if (doc.links[id]) return { kind: "link", id };
  if (doc.requirements[id]) return { kind: "requirement", id };
  if (doc.questions[id]) return { kind: "question", id };
  if (doc.pages[id]) return { kind: "page", id };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Requirements: phases as lanes.

export function RequirementsCanvas({ doc, selection, onSelect, onToast }: { doc: Doc; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const phases = byIndex(Object.values(doc.phases));
  const lanes: Lane[] = [...phases.map((p) => ({ id: p.id, label: p.name, ...(p.goal ? { hint: p.goal } : {}) })), { id: "", label: "No phase yet" }];
  const cards: Card[] = byIndex(Object.values(doc.requirements)).map((q) => ({
    id: q.id, lane: q.phase ?? "", title: q.title, badge: q.priority,
    sub: q.servedBy.length ? `served by ${q.servedBy.slice(0, 2).map((id) => pieceName(doc, id)).join(", ")}${q.servedBy.length > 2 ? ` +${q.servedBy.length - 2}` : ""}` : "nothing serves it yet",
    tone: q.servedBy.length ? undefined : "warn", threads: threadCount(doc, q.id),
  }));
  return (
    <Board doc={doc} lanes={lanes} cards={cards} selected={selected} onToast={onToast}
      onCard={(id) => onSelect({ kind: "requirement", id })}
      onLane={(id) => onSelect(id ? { kind: "phase", id } : undefined)}
      onMove={(id, _from, to) => {
        const q = doc.requirements[id];
        if (!q) return;
        const { phase: _, id: _id, index: _i, ...rest } = q;
        void edit("set_requirement", { requirement: id, ...rest, ...(to ? { phase: to } : {}) }, onToast);
      }}>
      <Panel position="top-left" className="sys-add">
        <button type="button" onClick={() => onSelect({ kind: "new", what: "requirement" })}><ListChecks size={13} /> Requirement</button>
        <button type="button" onClick={() => onSelect({ kind: "new", what: "phase" })}><Milestone size={13} /> Phase</button>
      </Panel>
      <Panel position="bottom-left" className="sys-hint-panel">Drag a requirement into the phase it ships in · click a phase to rename it</Panel>
    </Board>
  );
}

// ---------------------------------------------------------------------------------------------
// Questions: open, taken as given, decided.

const questionLane = (q: Question) => (q.status === "decided" ? "decided" : q.kind === "assumption" ? "assumption" : "open");

export function QuestionsCanvas({ doc, selection, onSelect, onToast }: { doc: Doc; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const lanes: Lane[] = [{ id: "open", label: "Open", hint: "agents ask, not guess" }, { id: "assumption", label: "Taken as given" }, { id: "decided", label: "Decided" }];
  const cards: Card[] = byIndex(Object.values(doc.questions)).map((q) => ({
    id: q.id, lane: questionLane(q), title: q.text,
    ...(q.status === "decided" && q.chosen ? { badge: q.chosen } : {}),
    sub: [q.kind === "question" && q.status === "open" && `${q.options.length} option${q.options.length === 1 ? "" : "s"}`, q.about.length && `about ${q.about.slice(0, 2).map((id) => pieceName(doc, id)).join(", ")}`].filter(Boolean).join(" · "),
    tone: q.status === "open" && q.kind === "question" ? "warn" : q.status === "decided" ? "good" : undefined,
    threads: threadCount(doc, q.id),
  }));
  const move = (id: Id, from: string, to: string) => {
    const q = doc.questions[id];
    if (!q) return;
    if (to === "decided") {
      if (q.kind === "assumption") return void edit("decide_question", { question: id }, onToast);
      onSelect({ kind: "question", id });
      return onToast("Pick the option it settles on, on the right.");
    }
    const kind = to === "assumption" ? "assumption" : "question";
    const reopen = from === "decided" ? edit("decide_question", { question: id, reopen: true }, onToast) : Promise.resolve({ ok: true });
    void reopen.then((r) => { if (r.ok && q.kind !== kind) void edit("set_question", { question: id, kind, text: q.text, options: q.options, about: q.about }, onToast); });
  };
  return (
    <Board doc={doc} lanes={lanes} cards={cards} selected={selected} onToast={onToast} onCard={(id) => onSelect({ kind: "question", id })} onMove={move}>
      <Panel position="top-left" className="sys-add">
        <button type="button" onClick={() => onSelect({ kind: "new", what: "question" })}><CircleHelp size={13} /> Question</button>
        <button type="button" onClick={() => onSelect({ kind: "new", what: "question", parent: "assumption" })}><Plus size={13} /> Assumption</button>
      </Panel>
      <Panel position="bottom-left" className="sys-hint-panel">Drag an assumption to Decided to confirm it, a question to decide it · back to Open to reopen</Panel>
    </Board>
  );
}

// ---------------------------------------------------------------------------------------------
// Access: calls by who may call them; a role is a lane.

export function AccessCanvas({ doc, service, selection, onSelect, onToast }: { doc: Doc; service?: Id; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const roles = byIndex(Object.values(doc.roles));
  const lanes: Lane[] = [
    { id: "public", label: "Public", hint: "anyone" }, { id: "signed-in", label: "Signed in" },
    ...roles.map((r) => ({ id: `role:${r.id}`, label: r.name, ...(r.description ? { hint: r.description } : {}) })),
    // Last, so a long list of calls nobody has decided on doesn't push the roles off screen.
    { id: "none", label: "Not said" },
  ];
  const calls = allCalls(doc).filter((c) => !service || c.value.service === service);
  const cards: Card[] = calls.flatMap((c) => {
    const a = c.value.access;
    const base = { id: c.value.id, title: callName(c), sub: a?.rule ?? doc.parts[c.value.service]?.name ?? "", threads: threadCount(doc, c.value.id) };
    const write = c.rest ? c.value.method !== "GET" : c.value.kind === "mutation";
    if (!a) return [{ ...base, lane: "none", tone: "dim" as const }];
    if (a.who !== "roles") return [{ ...base, lane: a.who, ...(a.who === "public" && write && !a.rule ? { tone: "warn" as const, sub: "public write with no rule" } : {}) }];
    return (a.roles ?? []).map((r) => ({ ...base, lane: `role:${r}` }));
  });
  const move = (id: Id, from: string, to: string) => {
    const c = calls.find((x) => x.value.id === id);
    if (!c) return;
    const a = c.value.access;
    const rule = a?.rule ? { rule: a.rule } : {};
    if (to === "none") return void edit("set_access", { call: id }, onToast);
    if (!to.startsWith("role:")) return void edit("set_access", { call: id, who: to, ...rule }, onToast);
    const role = to.slice(5);
    // Role to role moves it; anywhere else to a role starts the list with that role.
    const kept = a?.who === "roles" ? (a.roles ?? []).filter((r) => `role:${r}` !== from) : [];
    const access: Access = { who: "roles", roles: [...new Set([...kept, role])], ...rule };
    void edit("set_access", { call: id, ...access }, onToast);
  };
  return (
    <Board doc={doc} lanes={lanes} cards={cards} selected={selected} onToast={onToast}
      onCard={(id) => onSelect({ kind: doc.endpoints[id] ? "endpoint" : "operation", id })}
      onLane={(l) => { if (l.startsWith("role:")) onSelect({ kind: "role", id: l.slice(5) }); }}
      onMove={move}>
      <Panel position="top-left" className="sys-add">
        <button type="button" onClick={() => onSelect({ kind: "new", what: "role" })}><KeyRound size={13} /> Role</button>
      </Panel>
      <Panel position="bottom-left" className="sys-hint-panel">Drag a call to who may call it · a call can sit under several roles; its rule says which rows</Panel>
    </Board>
  );
}

// ---------------------------------------------------------------------------------------------
// Review: pieces by review state.

export const REVIEW_STATES: [ReviewState, string][] = [["draft", "Draft"], ["proposed", "Proposed"], ["changes", "Changes asked"], ["approved", "Approved"]];
export type ReviewKind = "screens" | "parts" | "calls" | "tables" | "traces" | "requirements";
export const REVIEW_KINDS: readonly ReviewKind[] = ["screens", "parts", "calls", "tables", "traces", "requirements"];

const withStates = (n: number, label: string) => (n ? `${label} · ${n} state${n === 1 ? "" : "s"}` : label);

/** A board's pieces: id, name, and what to show under the name. */
export function reviewItems(doc: Doc, kind: ReviewKind): [Id, string, string][] {
  // A state is reviewed with its screen, so only screens get cards.
  return kind === "screens" ? pagesInOrder(doc).filter((p) => p.state === undefined).map((p) => [p.id, p.name, withStates(statesOf(doc, p).length, pageLabel(doc, p))])
    : kind === "parts" ? byIndex(Object.values(doc.parts)).map((p) => [p.id, p.name, p.kind])
    : kind === "calls" ? allCalls(doc).map((c) => [c.value.id, callName(c), doc.parts[c.value.service]?.name ?? ""])
    : kind === "tables" ? byIndex(Object.values(doc.tables)).map((t) => [t.id, t.name, doc.parts[t.store]?.name ?? ""])
    : kind === "traces" ? byIndex(Object.values(doc.traces)).map((t) => [t.id, t.name, `${t.steps.length} hops`])
    : byIndex(Object.values(doc.requirements)).map((q) => [q.id, q.title, q.priority]);
}

/** Waiting on someone: proposed, changes asked, or changed since it was approved. */
export function waitingOn(doc: Doc, id: Id): boolean {
  const r = reviewOf(doc, id);
  return !!r && (r.state === "proposed" || r.state === "changes" || r.changed);
}

export function ReviewCanvas({ doc, kind, selection, onSelect, onToast }: { doc: Doc; kind: ReviewKind; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const items = reviewItems(doc, kind);
  const cards: Card[] = items.map(([id, title, sub]) => {
    const r = reviewOf(doc, id);
    // Approved, then changed: the approval doesn't cover it any more, so it waits on a reviewer again.
    if (r?.changed) return { id, title, lane: "proposed", sub: `${sub} · changed since ${r.by} approved it`, threads: threadCount(doc, id), tone: "warn" as const };
    return { id, title, lane: r?.state ?? "draft", sub: r ? `${sub} · ${r.by}` : sub, threads: threadCount(doc, id), ...(r?.state === "changes" ? { tone: "warn" as const } : r?.state === "approved" ? { tone: "good" as const } : {}) };
  });
  return (
    <Board doc={doc} lanes={REVIEW_STATES.map(([id, label]) => ({ id, label }))} cards={cards} selected={selected} onToast={onToast}
      onCard={(id) => { const s = selectionFor(doc, id); if (s) onSelect(s); }}
      onMove={(id, _from, to) => {
        void edit("review", { id, state: to }, onToast);
        // Asking for changes is only half done until someone says which; the panel asks.
        const s = selectionFor(doc, id);
        if (to === "changes" && s) onSelect(s);
      }}>
      <Panel position="bottom-left" className="sys-hint-panel">Drag a piece to where it stands · click one to discuss it</Panel>
    </Board>
  );
}

// ---------------------------------------------------------------------------------------------
// Under any piece's form: its review state, the requirements it serves, what is open about it, and the discussion.

/** Every board's pieces that wait on someone, board by board. */
export function waitingInOrder(doc: Doc): Id[] {
  return REVIEW_KINDS.flatMap((k) => reviewItems(doc, k).map(([id]) => id)).filter((id) => waitingOn(doc, id));
}

export function ProcessPanel({ doc, id, onSelect, onToast, reviewing }: { doc: Doc; id: Id; onSelect: Select; onToast: Toast; reviewing?: boolean }) {
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<Record<Id, string>>({});
  // The thread being resolved, and what was decided in it.
  const [closing, setClosing] = useState<{ thread: Id; decision: string }>();
  // Asking for changes: what should change, which the builder reads in the discussion.
  const [asking, setAsking] = useState<string>();
  const review = reviewOf(doc, id);
  const reqs = byIndex(Object.values(doc.requirements));
  const serves = reqs.filter((q) => q.servedBy.includes(id)).map((q) => q.id);
  const open = Object.values(doc.questions).filter((q) => q.about.includes(id) && q.status === "open");
  const threads = Object.values(doc.threads).filter((t) => t.target === id);
  // Changes asked with nothing open saying which: the builder has nothing to go on, so ask.
  const unexplained = review?.state === "changes" && !threads.some((t) => t.state !== "resolved");
  const isProcess = !!doc.requirements[id] || !!doc.questions[id];
  // The next piece after this one that waits on a reviewer, wrapping round; none when this is the last.
  const queue = waitingInOrder(doc);
  const next = queue.find((q, i) => q !== id && i > queue.indexOf(id)) ?? queue.find((q) => q !== id);
  return (
    <div className="sys-contracts sys-process">
      <div className="sys-group">
        <div className="sys-row-label">Review{review && <span className="sys-row-hint"> · {review.by}, {review.at.slice(0, 10)}</span>}</div>
        {(review?.changed || (review?.state !== "approved" && review?.approved)) && (
          <div className="sys-stale">
            <p>{review.changed
              ? `Changed since ${review.by} approved it. Approve it again as it stands, or ask for changes.`
              : `${review.approved?.by} approved an earlier version on ${review.approved?.at.slice(0, 10)}.${review.changes.length ? " Since then:" : ""}`}</p>
            {review.changes.length > 0 && (
              <dl>
                {review.changes.map((c) => (
                  <div key={c.field}><dt>{c.field}</dt><dd><del>{c.was}</del><ins>{c.now}</ins></dd></div>
                ))}
              </dl>
            )}
          </div>
        )}
        <Segments value={review?.changed ? "proposed" : review?.state ?? "draft"} options={REVIEW_STATES.map(([v, l]): [ReviewState, string] => [v, v === "changes" ? "Changes" : l])} onChange={(state) => (state === "changes" ? setAsking("") : void edit("review", { id, state }, onToast))} />
        {(asking !== undefined || unexplained) && (
          <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); const note = asking?.trim(); if (note) void edit("review", { id, state: "changes", note }, onToast).then(() => setAsking(undefined)); }}>
            <input className="field" autoFocus placeholder="What should change?" aria-label="What should change" value={asking ?? ""}
              onChange={(e) => setAsking(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAsking(undefined)} />
            <button type="submit" className="link-btn" disabled={!asking?.trim()}>Ask</button>
          </form>
        )}
        {reviewing && next && <button type="button" className="link-btn sys-next" onClick={() => { const s = selectionFor(doc, next); if (s) onSelect(s); }}>Next waiting: {pieceName(doc, next)} →</button>}
      </div>
      {!isProcess && (
        <div className="sys-group">
          <div className="sys-row-label">Serves</div>
          <Checks options={reqs.map((q) => [q.id, q.title])} value={serves} empty="No requirements yet; add them in Requirements."
            onChange={(next) => {
              const added = next.find((q) => !serves.includes(q));
              const removed = serves.find((q) => !next.includes(q));
              if (added) void edit("serve", { requirement: added, id }, onToast);
              if (removed) void edit("serve", { requirement: removed, id, remove: true }, onToast);
            }} />
        </div>
      )}
      {open.length > 0 && (
        <div className="sys-group">
          <div className="sys-row-label">Open about it</div>
          {open.map((q) => <button key={q.id} type="button" className="sys-mini" onClick={() => onSelect({ kind: "question", id: q.id })}><span><CircleHelp size={12} className="amber" /> {q.text}</span></button>)}
        </div>
      )}
      <div className="sys-group">
        <div className="sys-row-label">Discussion</div>
        {threads.map((t) => (
          <div key={t.id} className={`sys-thread${t.state === "resolved" ? " resolved" : ""}`}>
            {t.posts.map((p, i) => <p key={i}><b>{p.author}</b> {p.body}</p>)}
            {t.state === "addressed" && <span className="sys-addressed">Addressed · resolve it if it's done</span>}
            {t.state === "resolved" ? null : closing?.thread === t.id ? (
              <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); const d = closing.decision.trim(); void edit("discuss", { thread: t.id, state: "resolved", ...(d ? { decision: d } : {}) }, onToast).then(() => setClosing(undefined)); }}>
                <input className="field" autoFocus placeholder="What was decided? Goes in the doc" aria-label="What was decided" value={closing.decision}
                  onChange={(e) => setClosing({ thread: t.id, decision: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setClosing(undefined)} />
                <button type="submit" className="link-btn">{closing.decision.trim() ? "Decide" : "Resolve"}</button>
              </form>
            ) : (
              <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); const b = reply[t.id]?.trim(); if (b) void edit("discuss", { thread: t.id, body: b }, onToast).then(() => setReply({ ...reply, [t.id]: "" })); }}>
                <input className="field" placeholder="Reply…" aria-label="Reply" value={reply[t.id] ?? ""} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} />
                <button type="button" className="link-btn" onClick={() => setClosing({ thread: t.id, decision: "" })}>Resolve</button>
              </form>
            )}
            {t.state !== "resolved" ? null : <button type="button" className="link-btn" onClick={() => void edit("discuss", { thread: t.id, state: "open" }, onToast)}>Resolved · reopen</button>}
          </div>
        ))}
        <form className="sys-grid-row" onSubmit={(e) => { e.preventDefault(); if (body.trim()) void edit("discuss", { target: id, body: body.trim() }, onToast).then(() => setBody("")); }}>
          <input className="field" placeholder="Start a discussion…" aria-label="Start a discussion" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="submit" className="link-btn"><MessageSquare size={12} /> Post</button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Since the last commit: what a reviewer should read.

const CHANGE_LANES: Lane[] = [{ id: "added", label: "Added" }, { id: "changed", label: "Changed" }, { id: "removed", label: "Removed" }];

export function ChangesCanvas({ doc, selection, onSelect, onToast }: { doc: Doc; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const [state, setState] = useState<{ changes: Change[] } | { error: string }>();
  const [saved, setSaved] = useState(0);
  // Asked again whenever the design changes, so the board follows the edits.
  useEffect(() => {
    let live = true;
    void window.buni.systemChanges().then((r) => { if (live) setState(r); }, (e: unknown) => { if (live) setState({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [doc, saved]);
  // Where files aren't in git (the web), the person saves the version to compare with themselves.
  const { saveVersion } = window.buni;
  const base = saveVersion ? "the saved version" : "the last commit";
  const save = saveVersion && (
    <button type="button" className="bar-btn" onClick={() => void saveVersion().then(() => { setSaved((n) => n + 1); onToast("Saved this version; changes are counted from here."); }, (e: unknown) => onToast(e instanceof Error ? e.message : String(e)))}>Save this version</button>
  );
  if (!state) return <p className="hint sys-pad">Comparing with {base}…</p>;
  if ("error" in state) return <div className="hint sys-pad">{state.error} {save}</div>;
  if (!state.changes.length) return <p className="hint sys-pad">The system design is as it was at {base}.</p>;
  const cards: Card[] = state.changes.map((c) => ({
    id: c.id, lane: c.what, title: c.name, sub: c.collection.replace(/s$/, ""), threads: threadCount(doc, c.id),
    ...(c.what === "removed" ? { tone: "dim" as const } : c.what === "added" ? { tone: "good" as const } : {}),
  }));
  return (
    <Board doc={doc} lanes={CHANGE_LANES} cards={cards} selected={selected} onToast={onToast}
      onCard={(id) => { const s = selectionFor(doc, id); if (s) onSelect(s); else onToast(`That was removed; it's in ${base}.`); }}
      onMove={() => onToast("This board shows what changed; move pieces in the other tabs.")}>
      <Panel position="bottom-left" className="sys-hint-panel">What changed in the system design since {saveVersion ? "the saved version" : "the last git commit"} · click one to review and discuss it {save}</Panel>
    </Board>
  );
}
