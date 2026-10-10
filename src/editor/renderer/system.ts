import { bodyTypes, type Cluster, type Doc, type Endpoint, type Id, type LinkKind, type Operation, type Part, type PartKind, type Placement, type Shape, type Trace } from "buni/format/doc.ts";

export const CARD_W = 196;
export const CARD_H = 78;
const COL_GAP = 110;
const ROW_GAP = 24;
const TOP = 0;

/** Left to right in the order a request travels: clients, services, queues, stores. */
const COLUMN: Record<PartKind, number> = { client: 0, service: 1, external: 1, queue: 2, cache: 3, store: 3 };

export interface Placed {
  part: Part;
  x: number;
  y: number;
}

/** Cards in columns by kind, empty columns dropped, each column in index order. */
export function systemLayout(doc: Doc): { cards: Map<Id, Placed>; width: number; height: number } {
  const parts = Object.values(doc.parts).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
  const used = [...new Set(parts.map((p) => COLUMN[p.kind]))].sort((a, b) => a - b);
  const rows = new Map<number, number>();
  const cards = new Map<Id, Placed>();
  for (const p of parts) {
    const col = used.indexOf(COLUMN[p.kind]);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    cards.set(p.id, { part: p, x: col * (CARD_W + COL_GAP), y: TOP + row * (CARD_H + ROW_GAP) });
  }
  const tallest = Math.max(0, ...rows.values());
  return { cards, width: Math.max(0, used.length * (CARD_W + COL_GAP) - COL_GAP), height: TOP + Math.max(0, tallest * (CARD_H + ROW_GAP) - ROW_GAP) };
}

/** The link a drag from one part to another most likely means; the link editor changes it. */
export function linkKindFor(from: Part, to: Part): LinkKind | undefined {
  if (from.kind === "store" || from.kind === "cache" || from.kind === "queue" || from.id === to.id) return undefined;
  if (to.kind === "service" || to.kind === "external") return "calls";
  if (to.kind === "store" || to.kind === "cache") return "writes";
  if (to.kind === "queue") return "publishes";
  return undefined;
}

/** Where a part sits: where someone put it, else its column slot. */
export function positionOf(part: Part, auto: ReadonlyMap<Id, Placed>): { x: number; y: number } {
  if (part.x !== undefined && part.y !== undefined) return { x: part.x, y: part.y };
  const p = auto.get(part.id);
  return { x: p?.x ?? 0, y: p?.y ?? 0 };
}

/** The screens of the System area, in sidebar order. */
export const SYSTEM_VIEWS = ["map", "api", "data", "shapes", "cache", "traces", "topology", "brief", "requirements", "questions", "access", "review"] as const;
export type SystemView = (typeof SYSTEM_VIEWS)[number];
/** The views that make up Plan; the rest are System. */
export const PLAN_VIEWS: readonly SystemView[] = ["requirements", "questions", "access", "review"];

/** What the system inspector is showing: one thing, or a new one being added. */
export type SystemSelection =
  | { kind: "part" | "link" | "endpoint" | "operation" | "table" | "event" | "shape" | "trace" | "environment" | "cluster" | "placement" | "phase" | "requirement" | "question" | "role" | "page"; id: Id }
  | { kind: "new"; what: "link" | "endpoint" | "operation" | "table" | "event" | "shape" | "trace" | "environment" | "phase" | "requirement" | "question" | "role"; parent?: Id }
  | { kind: "new"; what: "cluster"; environment: Id }
  | { kind: "new"; what: "placement"; part: Id; environment: Id };

export { allCalls, callArgs, callName, callOf, stalenessGrid, type Call, type Staleness } from "buni/tools/calls.ts";
import { allCalls, callOf, stalenessGrid, type Call } from "buni/tools/calls.ts";

export const TABLE_W = 220;
export const TABLE_HEAD = 34;
export const TABLE_ROW = 26;

/** Tables of one store in columns: a table sits right of every table its foreign keys point at. */
export function erLayout(doc: Doc, store: Id): Map<Id, { x: number; y: number }> {
  const tables = Object.values(doc.tables).filter((t) => t.store === store).sort((a, b) => (a.index < b.index ? -1 : 1));
  const depth = new Map<Id, number>();
  const visit = (id: Id, seen: Set<Id>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0; // a cycle of foreign keys: stop here
    seen.add(id);
    const refs = (doc.tables[id]?.columns ?? []).flatMap((c) => (c.ref && c.ref.table !== id && doc.tables[c.ref.table]?.store === store ? [c.ref.table] : []));
    const d = refs.length ? Math.max(...refs.map((r) => visit(r, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  const out = new Map<Id, { x: number; y: number }>();
  const colY = new Map<number, number>();
  for (const t of tables) {
    const d = visit(t.id, new Set());
    const y = colY.get(d) ?? 24;
    out.set(t.id, { x: 24 + d * (TABLE_W + 80), y });
    colY.set(d, y + TABLE_HEAD + t.columns.length * TABLE_ROW + 36);
  }
  return out;
}

/** The parts a trace touches, in the order it first reaches them: its lanes. */
export function traceLanes(trace: Trace): Id[] {
  const lanes: Id[] = [];
  for (const s of trace.steps) for (const p of [s.from, s.to]) if (!lanes.includes(p)) lanes.push(p);
  return lanes;
}

/** One environment laid out for the Topology view: per region, its clusters (with namespaces) and everything else. */
export function topologyLayout(doc: Doc, environment: Id): {
  regions: { region: string; clusters: { cluster: Cluster; namespaces: { namespace: string; placements: Placement[] }[] }[]; other: Placement[] }[];
  unplaced: Part[];
} {
  const env = doc.environments[environment];
  const placements = Object.values(doc.placements).filter((p) => p.environment === environment);
  const regions = (env?.regions ?? []).map((region) => {
    const clusters = Object.values(doc.clusters).filter((c) => c.environment === environment && c.region === region).sort((a, b) => (a.name < b.name ? -1 : 1)).map((cluster) => {
      const inside = placements.filter((p) => p.cluster === cluster.id);
      const names = [...new Set(inside.map((p) => p.namespace ?? "default"))].sort();
      return { cluster, namespaces: names.map((namespace) => ({ namespace, placements: inside.filter((p) => (p.namespace ?? "default") === namespace) })) };
    });
    // A placement outside any cluster shows in its first region.
    const other = placements.filter((p) => !p.cluster && p.regions[0] === region);
    return { region, clusters, other };
  });
  const partOrder = (id: Id) => doc.parts[id]?.index ?? "";
  for (const r of regions) r.other.sort((a, b) => (partOrder(a.part) < partOrder(b.part) ? -1 : 1));
  const unplaced = Object.values(doc.parts).filter((p) => p.kind !== "external" && !placements.some((pl) => pl.part === p.id)).sort((a, b) => (a.index < b.index ? -1 : 1));
  return { regions, unplaced };
}

// Canvas layouts: where things start before anyone drags them. Pure, so they are tested.

export type GraphNodeKind = "call" | "shape" | "table" | "event" | "lane";
export interface GraphNode { id: Id; kind: GraphNodeKind; x: number; y: number; label?: string }

const COL = 300;
const ROW = 62;
/** Long lanes wrap into several columns, so a big API reads wide instead of one endless strip. */
const PER_COLUMN = 14;

/** One service's API: a column per kind of call, then the shapes, tables and events those calls use. */
export function apiGraph(doc: Doc, service: Id): GraphNode[] {
  const calls = allCalls(doc).filter((c) => c.value.service === service);
  const groups: [string, Call[]][] = calls.some((c) => !c.rest)
    ? [["Query", calls.filter((c) => !c.rest && c.value.kind === "query")], ["Mutation", calls.filter((c) => !c.rest && c.value.kind === "mutation")], ["Subscription", calls.filter((c) => !c.rest && c.value.kind === "subscription")]]
    : [["Reads", calls.filter((c) => c.rest && c.value.method === "GET")], ["Writes", calls.filter((c) => c.rest && c.value.method !== "GET")]];
  const out: GraphNode[] = [];
  let col = 0;
  for (const [label, cs] of groups) {
    if (cs.length === 0) continue;
    out.push({ id: `lane:${label}`, kind: "lane", x: col * COL, y: 0, label: `${label} · ${cs.length}` });
    cs.forEach((c, i) => out.push({ id: c.value.id, kind: "call", x: (col + Math.floor(i / PER_COLUMN)) * COL, y: 40 + (i % PER_COLUMN) * ROW }));
    col += Math.ceil(cs.length / PER_COLUMN);
  }
  const byName = new Map(Object.values(doc.shapes).map((s) => [s.name, s]));
  const shapeIds: Id[] = [];
  for (const c of calls) for (const f of typesOfCall(doc, c)) {
    const s = byName.get(f.replace(/\[\]$/, ""));
    if (s && !shapeIds.includes(s.id)) shapeIds.push(s.id);
  }
  const tables = [...new Set(calls.flatMap((c) => [...c.value.reads, ...c.value.writes]))].filter((t) => doc.tables[t]);
  const events = [...new Set(calls.flatMap((c) => c.value.emits))].filter((e) => doc.events[e]);
  for (const [label, ids, kind] of [["Types", shapeIds, "shape"], ["Data", tables, "table"], ["Events", events, "event"]] as const) {
    if (ids.length === 0) continue;
    const per = PER_COLUMN + 4;
    const colW = 230;
    const x0 = col * COL + 60;
    out.push({ id: `lane:${label}`, kind: "lane", x: x0, y: 0, label: `${label} · ${ids.length}` });
    ids.forEach((id, i) => out.push({ id, kind, x: x0 + Math.floor(i / per) * colW, y: 40 + (i % per) * 50 }));
    col += Math.ceil((Math.ceil(ids.length / per) * colW) / COL);
  }
  return out;
}

/** The type names a call uses: REST request and response fields, GraphQL arguments and result. */
export function typesOfCall(doc: Doc, c: Call): string[] {
  return c.rest ? [...bodyTypes(doc, c.value, "request"), ...bodyTypes(doc, c.value, "response")].map((f) => f.type) : [...c.value.args.map((a) => a.type), c.value.returns];
}

export type CallWire = { to: Id; kind: "returns" | "takes" | "reads" | "writes" | "emits" | "invalidates" };

/** What one call is wired to on the API canvas. */
export function callWires(doc: Doc, c: Call): CallWire[] {
  const byName = new Map(Object.values(doc.shapes).map((s) => [s.name, s.id]));
  const shape = (t: string) => byName.get(t.replace(/\[\]$/, ""));
  const out: CallWire[] = [];
  const add = (w: CallWire | undefined) => { if (w && !out.some((x) => x.to === w.to && x.kind === w.kind)) out.push(w); };
  const outTypes = c.rest ? bodyTypes(doc, c.value, "response").map((f) => f.type) : [c.value.returns];
  const inTypes = c.rest ? bodyTypes(doc, c.value, "request").map((f) => f.type) : c.value.args.map((a) => a.type);
  for (const t of outTypes) { const id = shape(t); if (id) add({ to: id, kind: "returns" }); }
  for (const t of inTypes) { const id = shape(t); if (id) add({ to: id, kind: "takes" }); }
  for (const t of c.value.reads) add({ to: t, kind: "reads" });
  for (const t of c.value.writes) add({ to: t, kind: "writes" });
  for (const e of c.value.emits) add({ to: e, kind: "emits" });
  for (const i of c.value.invalidates ?? []) add({ to: i, kind: "invalidates" });
  return out;
}

/** Shapes in columns: a shape sits right of the shapes its fields use. */
export function shapesGraph(doc: Doc): GraphNode[] {
  const shapes = Object.values(doc.shapes).sort((a, b) => (a.index < b.index ? -1 : 1));
  const byName = new Map(shapes.map((s) => [s.name, s]));
  const depth = new Map<Id, number>();
  const visit = (s: Shape, seen: Set<Id>): number => {
    const known = depth.get(s.id);
    if (known !== undefined) return known;
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    const uses = s.fields.flatMap((f) => { const u = byName.get(f.type.replace(/\[\]$/, "")); return u && u.id !== s.id ? [u] : []; });
    const d = uses.length ? Math.max(...uses.map((u) => visit(u, seen) + 1)) : 0;
    depth.set(s.id, d);
    return d;
  };
  // Each level of use is a band of columns; a column wraps once it gets tall, so hundreds of shapes read as a wall, not a strip.
  const MAX_H = 1400;
  const levels = new Map<number, Shape[]>();
  for (const s of shapes) {
    const d = visit(s, new Set());
    levels.set(d, [...(levels.get(d) ?? []), s]);
  }
  const out: GraphNode[] = [];
  let x = 0;
  for (const d of [...levels.keys()].sort((a, b) => a - b)) {
    let y = 0;
    for (const s of levels.get(d) ?? []) {
      const h = 34 + Math.max(1, s.values?.length ?? s.fields.length) * 24 + 26;
      if (y > 0 && y + h > MAX_H) {
        x += 260;
        y = 0;
      }
      out.push({ id: s.id, kind: "shape", x, y });
      y += h;
    }
    x += 320;
  }
  return out;
}

/** Cache: writes on the left, cached reads on the right. */
export function cacheGraph(doc: Doc): GraphNode[] {
  const { reads, writes } = stalenessGrid(doc);
  return [
    { id: "lane:writes", kind: "lane", x: 0, y: 0, label: "Changes data" },
    ...writes.map((w, i): GraphNode => ({ id: w.value.id, kind: "call", x: 0, y: 40 + i * 70 })),
    { id: "lane:reads", kind: "lane", x: 460, y: 0, label: "Cached" },
    ...reads.map((r, i): GraphNode => ({ id: r.value.id, kind: "call", x: 460, y: 40 + i * 110 })),
  ];
}
