import type { Doc, Id } from "../format/doc.ts";
import { validateDoc, type FormatError } from "../format/parse.ts";

export type Collection =
  | "pages" | "nodes" | "shared" | "connections" | "flows"
  | "journeys" | "comments" | "sections" | "decisions" | "rules" | "attachments"
  | "parts" | "links" | "tables" | "endpoints" | "events" | "shapes" | "operations" | "traces"
  | "environments" | "clusters" | "placements" | "positions"
  | "phases" | "requirements" | "questions" | "roles" | "reviews" | "threads" | "agents" | "evals";

export type EntityOf<C extends Collection> = Doc[C][Id];

/** The only ways a document changes. Richer edits are built from these by the tool layer. */
export type Op =
  | { [C in Collection]: { kind: "put"; collection: C; value: EntityOf<C> } }[Collection]
  | { [C in Collection]: { kind: "delete"; collection: C; id: Id } }[Collection]
  | { kind: "token"; name: string; value?: string }
  | { kind: "imports"; value: string[] };

/** One reviewable step, e.g. one tool call: "Heading size". */
export interface Change {
  id: Id;
  label: string;
  ops: Op[];
}

/** A session of work by one author, reviewed and settled as a unit. */
export interface ChangeSet {
  id: Id;
  author: string;
  prompt?: string;
  changes: Change[];
}

/** The committed document plus the work waiting for review. */
export interface Session {
  base: Doc;
  pending: ChangeSet[];
  /** The system of the files this one imports: changes may point into it, and are checked against it. */
  context?: Doc;
}

export interface Rejected {
  set: Id;
  change: Id;
  errors: FormatError[];
}

type Bags = { [C in Collection]: Record<Id, EntityOf<C>> };

function put<C extends Collection>(doc: Doc, collection: C, value: EntityOf<C>): void {
  const bags: Bags = doc;
  const bag: Record<Id, EntityOf<C>> = bags[collection];
  bag[value.id] = value;
}

function applyOp(doc: Doc, op: Op): void {
  switch (op.kind) {
    case "put":
      return put(doc, op.collection, op.value);
    case "delete":
      delete doc[op.collection][op.id];
      return;
    case "token":
      if (op.value === undefined) delete doc.tokens[op.name];
      else doc.tokens[op.name] = op.value;
      return;
    case "imports":
      if (op.value.length === 0) delete doc.imports;
      else doc.imports = op.value;
      return;
  }
}

export type ApplyResult = { ok: true; doc: Doc } | { ok: false; errors: FormatError[] };

/**
 * A copy of `doc` that `ops` can be applied to: only the collections they touch are copied, and
 * shallowly. Documents are never edited in place once read, so untouched entities are shared.
 */
function copyFor(doc: Doc, ops: readonly Op[]): Doc {
  const next: Doc = { ...doc, tokens: ops.some((op) => op.kind === "token") ? { ...doc.tokens } : doc.tokens };
  const touched = new Set(ops.flatMap((op) => (op.kind === "put" || op.kind === "delete" ? [op.collection] : [])));
  for (const c of touched) copyBag(next, doc, c);
  return next;
}

function copyBag<C extends Collection>(next: Bags, doc: Bags, c: C): void {
  next[c] = { ...doc[c] };
}

/** Applies a change to a copy of the document; the result must still be a valid document. */
export function applyChange(doc: Doc, change: Change, context?: Doc): ApplyResult {
  // Revalidates the whole doc per change; fine for thousands of nodes, validate only touched refs if it gets slow
  const next = copyFor(doc, change.ops);
  for (const op of change.ops) applyOp(next, op);
  const errors = validateDoc(next, context);
  return errors.length === 0 ? { ok: true, doc: next } : { ok: false, errors };
}

function replay(doc: Doc, sets: readonly ChangeSet[], context?: Doc): { doc: Doc; rejected: Rejected[] } {
  const rejected: Rejected[] = [];
  let cur = doc;
  for (const set of sets) {
    for (const change of set.changes) {
      const r = applyChange(cur, change, context);
      if (r.ok) cur = r.doc;
      else rejected.push({ set: set.id, change: change.id, errors: r.errors });
    }
  }
  return { doc: cur, rejected };
}

/**
 * What the canvas shows: the base with every pending change replayed in order.
 * A change that stopped making sense (its target was reverted) is left out and reported.
 */
export function view(session: Session): { doc: Doc; rejected: Rejected[] } {
  return replay(session.base, session.pending, session.context);
}

export type ProposeResult = { ok: true; session: Session } | { ok: false; rejected: Rejected[] };

/** Adds a change set; every change in it must apply cleanly on top of the current view. */
export function propose(session: Session, set: ChangeSet): ProposeResult {
  const clash = (errors: string): ProposeResult => ({
    ok: false,
    rejected: [{ set: set.id, change: "", errors: [{ path: "", message: errors }] }],
  });
  if (session.pending.some((s) => s.id === set.id)) return clash(`change set "${set.id}" is already pending`);
  if (new Set(set.changes.map((c) => c.id)).size !== set.changes.length) return clash("change ids must be unique within a set");

  const { rejected } = replay(view(session).doc, [set], session.context);
  if (rejected.length > 0) return { ok: false, rejected };
  return { ok: true, session: { ...session, pending: [...session.pending, set] } };
}

/**
 * Adds one change to a pending set, opening the set on first use. This is how
 * tool calls accumulate into a reviewable session: one call, one change.
 */
export function append(session: Session, set: Omit<ChangeSet, "changes">, change: Change): ProposeResult {
  const open = session.pending.find((s) => s.id === set.id);
  if (!open) return propose(session, { ...set, changes: [change] });
  if (open.changes.some((c) => c.id === change.id)) {
    return { ok: false, rejected: [{ set: set.id, change: change.id, errors: [{ path: "", message: `change "${change.id}" already exists` }] }] };
  }
  const { rejected } = replay(view(session).doc, [{ ...open, changes: [change] }], session.context);
  if (rejected.length > 0) return { ok: false, rejected };
  const extended: ChangeSet = { ...open, changes: [...open.changes, change] };
  return { ok: true, session: { ...session, pending: session.pending.map((s) => (s.id === set.id ? extended : s)) } };
}

export interface Settled {
  /** The new committed document, ready to write to disk. */
  base: Doc;
  session: Session;
  /** Kept changes that could not apply without work that is still pending or was dropped. */
  dropped: Rejected[];
}

/**
 * Review outcome for one change set: the kept changes are applied to the base in their
 * original order, everything else in the set is discarded. Other pending sets stay pending
 * and replay on top of the new base; settle sets in the order they depend on each other.
 */
export function settle(session: Session, setId: Id, keep: readonly Id[]): Settled {
  const set = session.pending.find((s) => s.id === setId);
  if (!set) throw new Error(`change set "${setId}" is not pending`);
  const kept: ChangeSet = { ...set, changes: set.changes.filter((c) => keep.includes(c.id)) };
  const { doc, rejected } = replay(session.base, [kept], session.context);
  return {
    base: doc,
    session: { ...session, base: doc, pending: session.pending.filter((s) => s.id !== setId) },
    dropped: rejected,
  };
}

/** The op that puts back whatever `doc` holds at `collection`/`id`, or removes it if nothing. */
function restore(doc: Doc, collection: Collection, id: Id): Op {
  switch (collection) {
    case "pages": {
      const v = doc.pages[id];
      return v ? { kind: "put", collection: "pages", value: v } : { kind: "delete", collection: "pages", id };
    }
    case "nodes": {
      const v = doc.nodes[id];
      return v ? { kind: "put", collection: "nodes", value: v } : { kind: "delete", collection: "nodes", id };
    }
    case "shared": {
      const v = doc.shared[id];
      return v ? { kind: "put", collection: "shared", value: v } : { kind: "delete", collection: "shared", id };
    }
    case "connections": {
      const v = doc.connections[id];
      return v ? { kind: "put", collection: "connections", value: v } : { kind: "delete", collection: "connections", id };
    }
    case "flows": {
      const v = doc.flows[id];
      return v ? { kind: "put", collection: "flows", value: v } : { kind: "delete", collection: "flows", id };
    }
    case "journeys": {
      const v = doc.journeys[id];
      return v ? { kind: "put", collection: "journeys", value: v } : { kind: "delete", collection: "journeys", id };
    }
    case "sections": {
      const v = doc.sections[id];
      return v ? { kind: "put", collection: "sections", value: v } : { kind: "delete", collection: "sections", id };
    }
    case "decisions": {
      const v = doc.decisions[id];
      return v ? { kind: "put", collection: "decisions", value: v } : { kind: "delete", collection: "decisions", id };
    }
    case "comments": {
      const v = doc.comments[id];
      return v ? { kind: "put", collection: "comments", value: v } : { kind: "delete", collection: "comments", id };
    }
    case "rules": {
      const v = doc.rules[id];
      return v ? { kind: "put", collection: "rules", value: v } : { kind: "delete", collection: "rules", id };
    }
    case "attachments": {
      const v = doc.attachments[id];
      return v ? { kind: "put", collection: "attachments", value: v } : { kind: "delete", collection: "attachments", id };
    }
    case "parts": {
      const v = doc.parts[id];
      return v ? { kind: "put", collection: "parts", value: v } : { kind: "delete", collection: "parts", id };
    }
    case "links": {
      const v = doc.links[id];
      return v ? { kind: "put", collection: "links", value: v } : { kind: "delete", collection: "links", id };
    }
    case "tables": {
      const v = doc.tables[id];
      return v ? { kind: "put", collection: "tables", value: v } : { kind: "delete", collection: "tables", id };
    }
    case "endpoints": {
      const v = doc.endpoints[id];
      return v ? { kind: "put", collection: "endpoints", value: v } : { kind: "delete", collection: "endpoints", id };
    }
    case "events": {
      const v = doc.events[id];
      return v ? { kind: "put", collection: "events", value: v } : { kind: "delete", collection: "events", id };
    }
    case "shapes": {
      const v = doc.shapes[id];
      return v ? { kind: "put", collection: "shapes", value: v } : { kind: "delete", collection: "shapes", id };
    }
    case "operations": {
      const v = doc.operations[id];
      return v ? { kind: "put", collection: "operations", value: v } : { kind: "delete", collection: "operations", id };
    }
    case "traces": {
      const v = doc.traces[id];
      return v ? { kind: "put", collection: "traces", value: v } : { kind: "delete", collection: "traces", id };
    }
    case "environments": {
      const v = doc.environments[id];
      return v ? { kind: "put", collection: "environments", value: v } : { kind: "delete", collection: "environments", id };
    }
    case "clusters": {
      const v = doc.clusters[id];
      return v ? { kind: "put", collection: "clusters", value: v } : { kind: "delete", collection: "clusters", id };
    }
    case "phases": {
      const v = doc.phases[id];
      return v ? { kind: "put", collection: "phases", value: v } : { kind: "delete", collection: "phases", id };
    }
    case "requirements": {
      const v = doc.requirements[id];
      return v ? { kind: "put", collection: "requirements", value: v } : { kind: "delete", collection: "requirements", id };
    }
    case "questions": {
      const v = doc.questions[id];
      return v ? { kind: "put", collection: "questions", value: v } : { kind: "delete", collection: "questions", id };
    }
    case "roles": {
      const v = doc.roles[id];
      return v ? { kind: "put", collection: "roles", value: v } : { kind: "delete", collection: "roles", id };
    }
    case "reviews": {
      const v = doc.reviews[id];
      return v ? { kind: "put", collection: "reviews", value: v } : { kind: "delete", collection: "reviews", id };
    }
    case "threads": {
      const v = doc.threads[id];
      return v ? { kind: "put", collection: "threads", value: v } : { kind: "delete", collection: "threads", id };
    }
    case "agents": {
      const v = doc.agents[id];
      return v ? { kind: "put", collection: "agents", value: v } : { kind: "delete", collection: "agents", id };
    }
    case "evals": {
      const v = doc.evals[id];
      return v ? { kind: "put", collection: "evals", value: v } : { kind: "delete", collection: "evals", id };
    }
    case "positions": {
      const v = doc.positions[id];
      return v ? { kind: "put", collection: "positions", value: v } : { kind: "delete", collection: "positions", id };
    }
    case "placements": {
      const v = doc.placements[id];
      return v ? { kind: "put", collection: "placements", value: v } : { kind: "delete", collection: "placements", id };
    }
  }
}

/** Ops that put back what `ops` would overwrite in `doc`, in undo order. */
export function invert(doc: Doc, ops: readonly Op[]): Op[] {
  return ops
    .map((op): Op => {
      if (op.kind === "imports") return { kind: "imports", value: doc.imports ?? [] };
      if (op.kind !== "token") return restore(doc, op.collection, op.kind === "put" ? op.value.id : op.id);
      const prev = doc.tokens[op.name];
      return prev === undefined ? { kind: "token", name: op.name } : { kind: "token", name: op.name, value: prev };
    })
    .reverse();
}

const COLLECTIONS: readonly Collection[] = [
  "pages", "nodes", "shared", "connections", "flows", "journeys", "comments", "sections", "decisions", "rules", "attachments",
  "parts", "links", "tables", "endpoints", "events", "shapes", "operations", "traces",
  "environments", "clusters", "placements", "positions", "phases", "requirements", "questions", "roles", "reviews", "threads", "agents", "evals",
];

// The casts below: TypeScript can't tie a generic collection to its own value inside the Op union, though they match.
function bagDiff<C extends Collection>(c: C, from: Bags, to: Bags, out: Op[]): void {
  const a: Record<Id, EntityOf<C>> = from[c];
  const b: Record<Id, EntityOf<C>> = to[c];
  for (const id of Object.keys(a)) if (!(id in b)) out.push({ kind: "delete", collection: c, id } as Op);
  for (const [id, value] of Object.entries(b)) if (JSON.stringify(a[id]) !== JSON.stringify(value)) out.push({ kind: "put", collection: c, value } as Op);
}

/** The ops that turn one document into another: what restoring a saved version applies, so it can be undone. */
export function diffOps(from: Doc, to: Doc): Op[] {
  const out: Op[] = [];
  for (const c of COLLECTIONS) bagDiff(c, from, to, out);
  for (const name of Object.keys(from.tokens)) if (!(name in to.tokens)) out.push({ kind: "token", name });
  for (const [name, value] of Object.entries(to.tokens)) if (from.tokens[name] !== value) out.push({ kind: "token", name, value });
  if (JSON.stringify(from.imports ?? []) !== JSON.stringify(to.imports ?? [])) out.push({ kind: "imports", value: to.imports ?? [] });
  return out;
}
