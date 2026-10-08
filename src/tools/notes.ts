// What deserves a look before building: gaps the checks allow but a reviewer would ask about.
import { pieceName, reviewOf, type Doc, type Id } from "../format/doc.ts";
import { allCalls, callName, stalenessGrid } from "./calls.ts";
import { terminalNotes } from "./terminal.ts";
import { topologyNotes } from "./topology.ts";

/** Everything a person should look at, one sentence each, most important kinds first: the system's, then the plan's. */
export function designNotes(doc: Doc): string[] {
  return [...new Set([...systemNotes(doc), ...planNotes(doc)])];
}

/** The plan's gaps: requirements due now that nothing serves, musts in no phase, questions still open. */
export function planNotes(doc: Doc): string[] {
  const notes: string[] = [];
  const phases = Object.keys(doc.phases).length > 0;
  // The phase being built now; a later phase's should or could isn't a gap until its turn.
  const now = Object.values(doc.phases).sort((a, b) => (a.index < b.index ? -1 : 1))[0]?.id;
  for (const q of Object.values(doc.requirements)) {
    const due = !q.phase || q.phase === now || q.priority === "must";
    if (q.servedBy.length === 0 && due) notes.push(`Nothing serves the requirement “${q.title}” yet.`);
    if (phases && q.priority === "must" && !q.phase) notes.push(`“${q.title}” is a must but isn't in a phase.`);
  }
  // An approval that no longer covers the piece: it changed after it was approved.
  const stale = Object.keys(doc.reviews).filter((id) => reviewOf(doc, id)?.changed);
  if (stale.length) notes.push(`${stale.length === 1 ? "1 piece was" : `${stale.length} pieces were`} approved, then changed; review ${stale.length === 1 ? "it" : "them"} again: ${stale.slice(0, 3).map((id) => pieceName(doc, id)).join(", ")}${stale.length > 3 ? "…" : ""}.`);
  const open = Object.values(doc.questions).filter((q) => q.kind === "question" && q.status === "open");
  if (open.length) notes.push(`${open.length} open question${open.length === 1 ? "" : "s"}: ${open.slice(0, 3).map((q) => q.text).join(" · ")}${open.length > 3 ? "…" : ""}`);
  return notes;
}

/** The system's gaps: parts on their own, access, failure, caching, sensitive data, where it runs, terminal screens. */
export function systemNotes(doc: Doc): string[] {
  const name = (id: Id) => doc.parts[id]?.name ?? id;
  const calls = allCalls(doc);
  const { reads, writes, cell } = stalenessGrid(doc);
  const notes: string[] = [];
  for (const p of Object.values(doc.parts)) {
    if (!Object.values(doc.links).some((l) => l.from === p.id || l.to === p.id)) notes.push(`${p.name} isn't linked to anything.`);
  }

  // Calls nothing uses: once there are pages or traces to use them, a call none of them (or any requirement)
  // touches is unfinished or unneeded, and someone should say which.
  if (Object.keys(doc.pages).length || Object.keys(doc.traces).length) {
    const used = new Set<Id>([
      ...Object.values(doc.connections).flatMap((c) => (c.endpoint ? [c.endpoint] : [])),
      ...Object.values(doc.nodes).flatMap((n) => (n.bind ? [n.bind.endpoint] : [])),
      ...Object.values(doc.traces).flatMap((t) => t.steps.flatMap((st) => (st.via ? [st.via] : []))),
      ...Object.values(doc.requirements).flatMap((q) => q.servedBy),
    ]);
    const unused = calls.filter((c) => !used.has(c.value.id));
    if (unused.length) notes.push(`${unused.slice(0, 3).map(callName).join(", ")}${unused.length > 3 ? ` and ${unused.length - 3} more` : ""}: no page, trace or requirement uses ${unused.length === 1 ? "it" : "them"} yet.`);
  }

  // Access: who may call what.
  const hasRoles = Object.keys(doc.roles).length > 0;
  const noAccess = calls.filter((c) => !c.value.access);
  if (hasRoles && noAccess.length) notes.push(`${noAccess.length} call${noAccess.length === 1 ? " doesn't" : "s don't"} say who may call ${noAccess.length === 1 ? "it" : "them"}: ${noAccess.slice(0, 4).map(callName).join(", ")}${noAccess.length > 4 ? "…" : ""}.`);
  for (const c of calls) {
    const writesData = c.value.writes.length > 0;
    // A public write is fine once its rule says what stops abuse (a rate limit, a captcha, a confirmation).
    if (c.value.access?.who === "public" && writesData && !c.value.access.rule?.trim()) notes.push(`${callName(c)} is public and writes ${c.value.writes.map((t) => doc.tables[t]?.name ?? t).join(", ")}; say how abuse is stopped.`);
  }

  // Failure: request-path hops without a timeout, retries that may repeat writes, parts nobody planned to lose.
  const requestPath = new Set<string>();
  for (const t of Object.values(doc.traces)) for (const s of t.steps) if (!s.async) requestPath.add(`${s.from}>${s.to}`);
  for (const l of Object.values(doc.links)) {
    if (l.kind !== "calls") continue;
    if (requestPath.has(`${l.from}>${l.to}`) && l.failure?.timeoutMs === undefined) notes.push(`${name(l.from)} → ${name(l.to)} is on a request path with no timeout.`);
    if ((l.failure?.retries ?? 0) > 0 && !l.failure?.idempotencyKey) notes.push(`${name(l.from)} → ${name(l.to)} retries without an idempotency key; a retried write can happen twice.`);
  }
  for (const p of Object.values(doc.parts)) {
    if ((p.kind === "store" || p.kind === "queue" || p.kind === "external") && !p.ifDown) notes.push(`What happens when ${p.name} is down isn't written down.`);
  }

  // Cache.
  for (const r of reads) {
    const ws = writes.filter((w) => cell(w, r) === "missing");
    if (ws.length) notes.push(`${callName(r)} can serve stale data: ${ws.map(callName).join(", ")} change it without saying so.`);
  }

  // Data that must be handled with care.
  for (const t of Object.values(doc.tables)) {
    for (const c of t.columns) {
      if (c.classification !== "personal") continue;
      const cached = calls.filter((x) => x.value.cache && x.value.reads.includes(t.id) && !/\{(viewer|user|workspace)/i.test(x.value.cache.key));
      for (const x of cached) notes.push(`${callName(x)} caches ${t.name}, which holds personal data (${c.name}), without the viewer in its key.`);
    }
  }

  notes.push(...topologyNotes(doc));
  notes.push(...terminalNotes(doc));
  notes.push(...Object.values(doc.links).filter((l) => l.kind === "calls" && !(l.carries ?? []).length).map((l) => `${name(l.from)} → ${name(l.to)} doesn't say what it carries.`));
  return [...new Set(notes)];
}
