// REST endpoints and GraphQL operations as one kind of thing: a call.
import type { Doc, Endpoint, Id, Operation } from "../format/doc.ts";

/** A REST endpoint or a GraphQL operation, whichever the id names. */
export type Call = { rest: true; value: Endpoint } | { rest: false; value: Operation };

export function callOf(doc: Doc, id: Id): Call | undefined {
  const e = doc.endpoints[id];
  if (e) return { rest: true, value: e };
  const o = doc.operations[id];
  return o ? { rest: false, value: o } : undefined;
}

export function callName(c: Call): string {
  return c.rest ? `${c.value.method} ${c.value.path}` : `${c.value.kind} ${c.value.name}`;
}

/** Every call, REST first, each group in index order. */
export function allCalls(doc: Doc): Call[] {
  const order = <T extends { index: string; id: Id }>(xs: T[]) => xs.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
  return [...order(Object.values(doc.endpoints)).map((value): Call => ({ rest: true, value })), ...order(Object.values(doc.operations)).map((value): Call => ({ rest: false, value }))];
}

/** A call as the arguments that save it again, with `patch` applied: how a view changes one field without a form. */
export function callArgs(c: Call, patch: { invalidates?: Id[] } = {}): { tool: "set_endpoint" | "set_operation"; args: Record<string, unknown> } {
  const v = c.value;
  const common = { service: v.service, summary: v.summary, reads: v.reads, writes: v.writes, emits: v.emits, ...(v.cache ? { cache: v.cache } : {}), invalidates: patch.invalidates ?? v.invalidates ?? [], ...(v.errors ? { errors: v.errors } : {}), ...(v.access ? { access: v.access } : {}) };
  if (c.rest) return { tool: "set_endpoint", args: { endpoint: c.value.id, method: c.value.method, path: c.value.path, request: c.value.requestShape ?? c.value.request, response: c.value.responseShape ?? c.value.response, ...common } };
  return { tool: "set_operation", args: { operation: c.value.id, kind: c.value.kind, name: c.value.name, args: c.value.args, returns: c.value.returns, ...(c.value.nullable ? { nullable: true } : {}), ...common } };
}

export type Staleness = "set" | "missing" | "none";

/**
 * Which writes make which cached reads stale. A cell is "set" when the write lists the read in
 * invalidates, "missing" when it writes a table the read reads but doesn't say so: stale data waiting to happen.
 */
export function stalenessGrid(doc: Doc): { reads: Call[]; writes: Call[]; cell: (write: Call, read: Call) => Staleness } {
  const calls = allCalls(doc);
  const reads = calls.filter((c) => c.value.cache);
  const writes = calls.filter((c) => (c.rest ? c.value.method !== "GET" : c.value.kind === "mutation"));
  const cell = (write: Call, read: Call): Staleness => {
    if (write.value.invalidates?.includes(read.value.id)) return "set";
    return write.value.writes.some((t) => read.value.reads.includes(t)) ? "missing" : "none";
  };
  return { reads, writes, cell };
}

