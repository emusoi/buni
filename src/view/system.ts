// The system behind the pages, as buni open shows it: one view per area (Map, API, Data, …) and a detail for each
// thing in it, drawn here as HTML so the browser only swaps it in. Every clickable thing carries data-ref="kind:id";
// data-go="kind:id" jumps to another. Drawn after designs/viewer.buni.
import { bodyFields, type Doc, type Endpoint, type Field, type Id, type Link, type Operation, type Part, type PartKind, type Shape, type Table } from "../format/doc.ts";
import { accessText } from "../tools/context.ts";
import { iconSvg } from "../tools/icons.ts";

export type ViewId = "map" | "api" | "data" | "events" | "traces" | "places" | "requirements" | "questions" | "doc";

export interface SystemView {
  id: ViewId;
  name: string;
  group: "system" | "plan";
  /** The rail's icon, as SVG. */
  icon: string;
  count: number;
  /** A canvas the person pans and zooms (its HTML holds a .world), or a page that scrolls. */
  canvas: boolean;
  html: string;
}

export interface SystemSnapshot {
  /** Only the views with something in them, in rail order. */
  views: SystemView[];
  /** Each thing's detail for the drawer, by ref. */
  details: Record<string, string>;
  /** Which view shows each ref. */
  where: Record<string, ViewId>;
  /** Each ref's name, for saying what changed. */
  names: Record<string, string>;
}

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const icon = (name: string, size = 15): string => iconSvg(name, size, 1.75) ?? "";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byIndex = <T extends { index: string }>(xs: Record<string, T>): T[] => Object.values(xs).sort((a, b) => (a.index < b.index ? -1 : 1));

export const KIND: Record<PartKind, { color: string; icon: string }> = {
  client: { color: "#3346d3", icon: "monitor" },
  service: { color: "#448361", icon: "server" },
  store: { color: "#c2410c", icon: "database" },
  cache: { color: "#b45309", icon: "zap" },
  queue: { color: "#7c3aed", icon: "layers" },
  external: { color: "#787774", icon: "globe" },
};
export const kindChip = (kind: PartKind): string => `<span class="kind" style="color:${KIND[kind].color}">${icon(KIND[kind].icon, 13)}${kind}</span>`;

/** A row in the drawer that goes to what it names. */
export const goRow = (ref: string | undefined, left: string, right = ""): string =>
  `<div class="drow${ref ? " go" : ""}"${ref ? ` data-go="${esc(ref)}"` : ""}><span class="l">${left}</span><span class="r">${right}</span>${ref ? icon("chevron-right", 13) : ""}</div>`;
export const section = (title: string, body: string, count?: number): string =>
  body ? `<section class="dsec"><h4>${esc(title)}${count !== undefined ? ` <span>${count}</span>` : ""}</h4>${body}</section>` : "";
export const head = (tag: string, name: string, sub: string, about = ""): string =>
  `<div class="dhead"><div class="dtop">${tag}<button class="dclose" aria-label="Close">${icon("x", 15)}</button></div><h3>${esc(name)}</h3>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}${about ? `<p class="about">${esc(about)}</p>` : ""}</div>`;
export const note = (text: string): string => `<p class="dnote">${esc(text)}</p>`;

/** The page each node sits on, through its parents up to a page's frame. */
function pageOfNode(doc: Doc): (node: Id) => Id | undefined {
  const byFrame = new Map(Object.values(doc.pages).map((p) => [p.frame, p.id]));
  return (node) => {
    let at = doc.nodes[node];
    for (let i = 0; at && i < 200; i++) {
      const page = byFrame.get(at.id);
      if (page) return page;
      at = at.parent ? doc.nodes[at.parent] : undefined;
    }
    return undefined;
  };
}

/** Who refers to what: the cross-links every detail lists. */
export interface Index {
  /** Pages that call an endpoint or operation, by its id. */
  pagesCalling: Map<Id, Set<Id>>;
  /** Requirements each thing serves, by its id. */
  serves: Map<Id, Id[]>;
  /** Traces each part, call or event takes part in. */
  inTraces: Map<Id, Set<Id>>;
}

function indexOf(doc: Doc): Index {
  const pagesCalling = new Map<Id, Set<Id>>();
  const add = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => m.set(k, (m.get(k) ?? new Set<V>()).add(v));
  const pageOf = pageOfNode(doc);
  for (const n of Object.values(doc.nodes)) {
    const p = n.bind ? pageOf(n.id) : undefined;
    if (n.bind && p) add(pagesCalling, n.bind.endpoint, p);
  }
  for (const c of Object.values(doc.connections)) if (c.endpoint) add(pagesCalling, c.endpoint, c.page);
  for (const t of Object.values(doc.traces)) if (t.page) for (const s of t.steps) if (s.via) add(pagesCalling, s.via, t.page);
  const serves = new Map<Id, Id[]>();
  for (const r of byIndex(doc.requirements)) for (const s of r.servedBy) serves.set(s, [...(serves.get(s) ?? []), r.id]);
  const inTraces = new Map<Id, Set<Id>>();
  for (const t of Object.values(doc.traces)) for (const s of t.steps) for (const id of [s.from, s.to, s.via]) if (id) add(inTraces, id, t.id);
  return { pagesCalling, serves, inTraces };
}

/** The ref of anything by id, for links between views. */
export function refOf(doc: Doc, id: Id): string | undefined {
  if (doc.parts[id]) return `part:${id}`;
  if (doc.endpoints[id] || doc.operations[id]) return `call:${id}`;
  if (doc.tables[id]) return `table:${id}`;
  if (doc.shapes[id]) return `shape:${id}`;
  if (doc.events[id]) return `event:${id}`;
  if (doc.traces[id]) return `trace:${id}`;
  if (doc.placements[id]) return `placement:${id}`;
  if (doc.requirements[id]) return `req:${id}`;
  if (doc.questions[id]) return `question:${id}`;
  if (doc.pages[id]) return `page:${id}`;
  return undefined;
}

/** A thing's name, however it is named. */
export function nameOf(doc: Doc, id: Id): string {
  const e = doc.endpoints[id];
  if (e) return `${e.method} ${e.path}`;
  return doc.parts[id]?.name ?? doc.operations[id]?.name ?? doc.tables[id]?.name ?? doc.shapes[id]?.name ?? doc.events[id]?.name ?? doc.traces[id]?.name
    ?? doc.pages[id]?.name ?? doc.requirements[id]?.title ?? id;
}

/** What uses a thing: pages, traces and the requirements it serves. */
export function usedBy(doc: Doc, ix: Index, id: Id): string {
  const rows = [
    ...[...(ix.pagesCalling.get(id) ?? [])].map((p) => goRow(`page:${p}`, esc(doc.pages[p]?.name ?? p), "page")),
    ...[...(ix.inTraces.get(id) ?? [])].map((t) => goRow(`trace:${t}`, esc(doc.traces[t]?.name ?? t), "trace")),
    ...(ix.serves.get(id) ?? []).map((r) => goRow(`req:${r}`, esc(doc.requirements[r]?.title ?? r), doc.requirements[r]?.priority ?? "")),
  ];
  return section("Used by", rows.join(""), rows.length);
}

// ── Map ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CARD = { w: 220, h: 112 };
const COLUMN: Record<PartKind, number> = { client: 0, service: 1, store: 2, cache: 2, queue: 2, external: 3 };
const ASYNC = new Set<Link["kind"]>(["publishes", "subscribes"]);

/** Where each part sits: where it was put, else in columns from clients to stores, in order. */
function mapLayout(parts: Part[]): { at: Map<Id, { x: number; y: number }>; columns: boolean } {
  const at = new Map<Id, { x: number; y: number }>();
  const rows = [0, 0, 0, 0];
  const columns = parts.some((p) => p.x === undefined || p.y === undefined);
  for (const p of parts) {
    if (p.x !== undefined && p.y !== undefined && !columns) {
      at.set(p.id, { x: p.x, y: p.y });
      continue;
    }
    const c = COLUMN[p.kind];
    at.set(p.id, { x: c * 300, y: 40 + (rows[c] ?? 0) * 150 });
    rows[c] = (rows[c] ?? 0) + 1;
  }
  return { at, columns };
}

function mapView(doc: Doc): string {
  const parts = byIndex(doc.parts);
  const { at, columns } = mapLayout(parts);
  const cards = parts.map((p) => {
    const a = at.get(p.id) ?? { x: 0, y: 0 };
    const tech = [p.tech, p.api && p.api !== "rest" && p.api !== "none" ? p.api : ""].filter(Boolean).join(" · ");
    return `<div class="part" data-ref="part:${esc(p.id)}" style="left:${a.x}px;top:${a.y}px;width:${CARD.w}px;height:${CARD.h}px"><div class="ptop">${kindChip(p.kind)}<span class="tech">${esc(tech)}</span></div><b>${esc(p.name)}</b><p>${esc(p.purpose)}</p></div>`;
  });
  const lines = Object.values(doc.links).flatMap((l) => {
    // A subscriber is drawn as the queue handing it work.
    const [fromId, toId] = l.kind === "subscribes" ? [l.to, l.from] : [l.from, l.to];
    const a = at.get(fromId), b = at.get(toId);
    if (!a || !b) return [];
    let x1: number, y1: number, x2: number, y2: number, d: string;
    if (Math.abs(a.x - b.x) < CARD.w) {
      // Same column: bottom to top.
      const down = b.y > a.y;
      x1 = a.x + CARD.w / 2; y1 = down ? a.y + CARD.h : a.y; x2 = b.x + CARD.w / 2; y2 = down ? b.y : b.y + CARD.h;
      const my = (y1 + y2) / 2;
      d = `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
    } else {
      const right = b.x > a.x;
      x1 = right ? a.x + CARD.w : a.x; y1 = a.y + CARD.h / 2; x2 = right ? b.x : b.x + CARD.w; y2 = b.y + CARD.h / 2;
      const mx = (x1 + x2) / 2;
      d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    }
    const lx = x1 * 0.35 + x2 * 0.65, ly = y1 * 0.35 + y2 * 0.65 - 6;
    return [`<g class="link${ASYNC.has(l.kind) ? " async" : ""}" data-a="${esc(l.from)}" data-b="${esc(l.to)}"><path d="${d}"/><text x="${lx}" y="${ly}">${esc(l.kind)}</text></g>`];
  });
  const xs = [...at.values()];
  const w = Math.max(0, ...xs.map((p) => p.x + CARD.w)) + 40, h = Math.max(0, ...xs.map((p) => p.y + CARD.h)) + 40;
  const heads = columns
    ? [["CLIENTS", 0], ["SERVICES", 1], ["STORES, CACHES, QUEUES", 2], ["OUTSIDE", 3]]
      .filter(([, c]) => parts.some((p) => COLUMN[p.kind] === c))
      .map(([t, c]) => `<p class="colhead" style="left:${Number(c) * 300}px">${t}</p>`).join("")
    : "";
  const svg = `<svg class="links" width="${w}" height="${h}"><defs><marker id="m-off" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#cfcecb"/></marker><marker id="m-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#37352f"/></marker></defs>${lines.join("")}</svg>`;
  const legend = `<div class="legend"><span><i></i>waits for it</span><span><i class="dash"></i>async</span></div>`;
  return `<div class="pan"><div class="world" data-w="${w}" data-h="${h}">${heads}${svg}${cards.join("")}</div></div>${legend}`;
}

function partDetail(doc: Doc, ix: Index, p: Part): string {
  const calls = [
    ...byIndex(doc.endpoints).filter((e) => e.service === p.id).map((e) => goRow(`call:${e.id}`, `<b class="m-${e.method}">${e.method}</b> <code>${esc(e.path)}</code>`)),
    ...byIndex(doc.operations).filter((o) => o.service === p.id).map((o) => goRow(`call:${o.id}`, `<b class="m-${o.kind}">${o.kind}</b> <code>${esc(o.name)}</code>`)),
  ];
  const tables = byIndex(doc.tables).filter((t) => t.store === p.id).map((t) => goRow(`table:${t.id}`, `<code>${esc(t.name)}</code>`, plural(t.columns.length, "column")));
  const events = byIndex(doc.events).filter((e) => e.queue === p.id).map((e) => goRow(`event:${e.id}`, `<code>${esc(e.name)}</code>`, plural(e.payload.length, "field")));
  const links = Object.values(doc.links);
  const out = links.filter((l) => l.from === p.id).map((l) => goRow(`part:${l.to}`, esc(nameOf(doc, l.to)), esc(l.kind + (ASYNC.has(l.kind) ? " · async" : ""))));
  const into = links.filter((l) => l.to === p.id).map((l) => {
    const f = l.failure;
    const policy = [f?.timeoutMs !== undefined ? `${f.timeoutMs >= 1000 ? `${f.timeoutMs / 1000}s` : `${f.timeoutMs}ms`} timeout` : "", f?.retries !== undefined ? plural(f.retries, "retry", "retries") : ""].filter(Boolean).join(" · ");
    return goRow(`part:${l.from}`, esc(nameOf(doc, l.from)), esc(policy || l.kind)) + (f?.fallback ? note(`If it fails: ${f.fallback}`) : "");
  });
  const runs = Object.values(doc.placements).filter((pl) => pl.part === p.id).map((pl) => {
    const env = doc.environments[pl.environment]?.name ?? pl.environment;
    const where = [pl.cluster ? doc.clusters[pl.cluster]?.name ?? pl.cluster : pl.service, pl.scale ? `${pl.scale.min}–${pl.scale.max} pods` : pl.replicas !== undefined ? plural(pl.replicas, "replica") : ""].filter(Boolean).join(" · ");
    return goRow(`placement:${pl.id}`, esc(env), esc(where || pl.runtime));
  });
  const tech = [p.tech, p.api && p.api !== "none" ? p.api.toUpperCase() : ""].filter(Boolean).join(" · ");
  return head(kindChip(p.kind), p.name, tech, p.purpose)
    + (p.ifDown ? section("If it's down", note(p.ifDown)) : "")
    + section("Serves", calls.join(""), calls.length)
    + section("Tables", tables.join(""), tables.length)
    + section("Events", events.join(""), events.length)
    + section("Talks to", out.join(""), out.length)
    + section("Called by", into.join(""), into.length)
    + section("Runs in", runs.join(""), runs.length)
    + usedBy(doc, ix, p.id);
}


// ── API ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const tag = (text: string, tone = ""): string => `<span class="tag${tone ? ` ${tone}` : ""}">${esc(text)}</span>`;
const minutes = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
type Call = (Endpoint & { rest: true }) | (Operation & { rest: false });

function callsOf(doc: Doc): Call[] {
  return [...byIndex(doc.endpoints).map((e): Call => ({ ...e, rest: true })), ...byIndex(doc.operations).map((o): Call => ({ ...o, rest: false }))];
}
const verb = (c: Call) => (c.rest ? c.method : c.kind);
const callName = (c: Call) => (c.rest ? c.path : c.name);

function callTags(doc: Doc, c: Call): string {
  return [
    ...c.reads.map((t) => tag(`reads ${nameOf(doc, t)}`)),
    ...c.writes.map((t) => tag(`writes ${nameOf(doc, t)}`)),
    ...c.emits.map((e) => tag(`emits ${nameOf(doc, e)}`, "violet")),
    ...(c.cache ? [tag(`cached ${minutes(c.cache.ttlSeconds)}`, "amber")] : []),
    ...(c.invalidates?.length ? [tag(`clears ${plural(c.invalidates.length, "cache")}`, "amber")] : []),
  ].join("");
}

function apiView(doc: Doc): string {
  const calls = callsOf(doc);
  const services = [...new Set(calls.map((c) => c.service))];
  const groups = services.map((sid) => {
    const p = doc.parts[sid];
    const style = calls.find((c) => c.service === sid)?.rest ? "REST" : "GraphQL";
    const host = Object.values(doc.placements).find((pl) => pl.part === sid && pl.ingress);
    const rows = calls.filter((c) => c.service === sid).map((c) =>
      `<div class="call" data-ref="call:${esc(c.id)}"><span class="verb m-${verb(c)}">${verb(c)}</span><div class="cmain"><code>${esc(callName(c))}</code><span>${esc(c.summary)}</span></div><div class="tags">${callTags(doc, c)}</div></div>`);
    const sub = [style, host?.ingress ? `${host.ingress.host}${host.ingress.path}` : ""].filter(Boolean).join(" · ");
    return `<section class="group"><div class="ghead">${p ? kindChip(p.kind) : ""}<b>${esc(p?.name ?? sid)}</b><code>${esc(sub)}</code></div>${rows.join("")}</section>`;
  });
  return `<div class="sheetview"><div class="vhead"><h1>API</h1><span>${plural(calls.length, "call")} on ${plural(services.length, "service")}</span></div>${groups.join("")}</div>`;
}

const fieldRows = (fields: readonly Field[]): string =>
  fields.map((f) => `<div class="field"><code>${esc(f.name)}${f.optional ? "?" : ""}</code><span>${esc(f.type)}</span></div>`).join("");

function callDetail(doc: Doc, ix: Index, c: Call): string {
  const service = doc.parts[c.service];
  const tagLine = `<span class="verb m-${verb(c)}">${verb(c)} · ${esc(service?.name ?? c.service)}</span>`;
  const req = c.rest ? bodyFields(doc, c, "request") : c.args;
  const res = c.rest ? bodyFields(doc, c, "response") : [];
  const reqName = c.rest && c.requestShape ? ` · ${doc.shapes[c.requestShape]?.name ?? ""}` : "";
  const resName = c.rest && c.responseShape ? ` · ${doc.shapes[c.responseShape]?.name ?? ""}` : "";
  const touches = [
    ...c.reads.map((t) => goRow(refOf(doc, t), `<code>${esc(nameOf(doc, t))}</code>`, "reads")),
    ...c.writes.map((t) => goRow(refOf(doc, t), `<code>${esc(nameOf(doc, t))}</code>`, "writes")),
    ...c.emits.map((e) => goRow(refOf(doc, e), `<code>${esc(nameOf(doc, e))}</code>`, "emits")),
  ];
  const cache = c.cache ? goRow(refOf(doc, c.cache.part), esc(nameOf(doc, c.cache.part)), `${minutes(c.cache.ttlSeconds)} · key ${esc(c.cache.key)}`) : "";
  const clears = (c.invalidates ?? []).map((id) => goRow(refOf(doc, id), esc(nameOf(doc, id)), "cleared"));
  return head(tagLine, callName(c), c.id, c.summary)
    + section(c.rest ? `Request${reqName}` : "Arguments", fieldRows(req), req.length)
    + (c.rest ? section(`Response${resName}`, fieldRows(res), res.length) : section("Returns", `<div class="field"><code>${esc(c.returns)}${c.nullable ? " or nothing" : ""}</code></div>`))
    + section("Errors", (c.errors ?? []).map((e) => `<div class="drow"><span class="l"><b>${esc(e.code)}</b> ${esc(e.when)}</span></div>`).join(""), c.errors?.length)
    + section("Who may call it", c.access ? note(accessText(doc, c.access)) : "")
    + section("Touches", touches.join(""), touches.length)
    + section("Cache", cache)
    + section("Clears", clears.join(""), clears.length)
    + section("Served by", goRow(`part:${c.service}`, esc(service?.name ?? c.service), service?.tech ?? ""))
    + usedBy(doc, ix, c.id);
}

// ── Data ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TABLE = { w: 260, head: 38, row: 29 };
const tableHeight = (t: Table) => TABLE.head + t.columns.length * TABLE.row;

/** Where each table sits: where it was put, else side by side in its store, one store under the other. */
function dataLayout(doc: Doc, tables: Table[]): Map<Id, { x: number; y: number }> {
  const at = new Map<Id, { x: number; y: number }>();
  if (tables.every((t) => t.x !== undefined && t.y !== undefined)) {
    for (const t of tables) at.set(t.id, { x: t.x ?? 0, y: t.y ?? 0 });
    return at;
  }
  let y = 40;
  for (const store of [...new Set(tables.map((t) => t.store))]) {
    const mine = tables.filter((t) => t.store === store);
    mine.forEach((t, i) => at.set(t.id, { x: 32 + i * (TABLE.w + 64), y: y + 32 }));
    y += Math.max(...mine.map(tableHeight)) + 32 + 32 + 56;
  }
  return at;
}

function dataView(doc: Doc): string {
  const tables = byIndex(doc.tables);
  const at = dataLayout(doc, tables);
  const stores = [...new Set(tables.map((t) => t.store))].map((sid) => {
    const mine = tables.filter((t) => t.store === sid);
    const x0 = Math.min(...mine.map((t) => at.get(t.id)?.x ?? 0)) - 24, y0 = Math.min(...mine.map((t) => at.get(t.id)?.y ?? 0)) - 24;
    const x1 = Math.max(...mine.map((t) => (at.get(t.id)?.x ?? 0) + TABLE.w)) + 24, y1 = Math.max(...mine.map((t) => (at.get(t.id)?.y ?? 0) + tableHeight(t))) + 24;
    const p = doc.parts[sid];
    return `<div class="store" data-ref="part:${esc(sid)}" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px"><div class="slabel">${p ? kindChip(p.kind) : ""}<b>${esc(p?.name ?? sid)}</b><code>${esc(p?.tech ?? "")}</code></div></div>`;
  });
  const cards = tables.map((t) => {
    const a = at.get(t.id) ?? { x: 0, y: 0 };
    const cols = t.columns.map((c) => {
      const marks = [c.primary ? `<i class="pk">PK</i>` : "", c.unique ? "<i>UNIQUE</i>" : "", c.ref ? `<i class="fk">→ ${esc(doc.tables[c.ref.table]?.name ?? c.ref.table)}</i>` : "", c.classification ? `<i class="pk">${c.classification.toUpperCase()}</i>` : "", c.nullable ? "<i>NULL</i>" : ""].join("");
      return `<div class="col"><code>${esc(c.name)}</code>${marks}<span>${esc(c.type)}</span></div>`;
    });
    return `<div class="table" data-ref="table:${esc(t.id)}" style="left:${a.x}px;top:${a.y}px;width:${TABLE.w}px">${`<div class="thead">${icon("table-2", 14)}<b>${esc(t.name)}</b></div>`}${cols.join("")}</div>`;
  });
  // Foreign keys, from the column to the table it points at.
  const keys = tables.flatMap((t) => t.columns.flatMap((c, i) => {
    const a = at.get(t.id), target = c.ref ? doc.tables[c.ref.table] : undefined, b = target ? at.get(target.id) : undefined;
    if (!a || !b || !target || !c.ref) return [];
    const j = Math.max(0, target.columns.findIndex((x) => x.name === c.ref?.column));
    const y1 = a.y + TABLE.head + i * TABLE.row + TABLE.row / 2, y2 = b.y + TABLE.head + j * TABLE.row + TABLE.row / 2;
    const left = b.x + TABLE.w <= a.x;
    const x1 = left ? a.x : a.x + TABLE.w, x2 = left ? b.x + TABLE.w : b.x;
    const bend = left ? -40 : 40;
    return [`<path d="M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}"/>`];
  }));
  const bottom = Math.max(40, ...tables.map((t) => (at.get(t.id)?.y ?? 0) + tableHeight(t))) + 70;
  const shapes = byIndex(doc.shapes).map((sh, i) => {
    const lines = sh.values?.length ? [sh.values.join(" · ")] : sh.fields.map((f) => `${f.name} ${f.type}`);
    return `<div class="shape" data-ref="shape:${esc(sh.id)}" style="left:${8 + (i % 4) * 200}px;top:${bottom + 30 + Math.floor(i / 4) * 130}px"><div class="shead"><b>${esc(sh.name)}</b><i>${sh.values?.length ? "ENUM" : "SHAPE"}</i></div>${lines.slice(0, 5).map((l) => `<code>${esc(l)}</code>`).join("")}</div>`;
  });
  const shapesHead = shapes.length ? `<p class="colhead" style="left:8px;top:${bottom}px">SHAPES · WHAT THE API AND EVENTS CARRY</p>` : "";
  const w = Math.max(820, ...tables.map((t) => (at.get(t.id)?.x ?? 0) + TABLE.w + 40));
  const h = bottom + 30 + Math.ceil(shapes.length / 4) * 130;
  const svg = `<svg class="keys" width="${w}" height="${h}"><defs><marker id="m-key" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#3346d3"/></marker></defs>${keys.join("")}</svg>`;
  return `<div class="pan"><div class="world" data-w="${w}" data-h="${h}">${stores.join("")}${svg}${cards.join("")}${shapesHead}${shapes.join("")}</div></div>`;
}

const callRef = (doc: Doc, id: Id) => {
  const e = doc.endpoints[id], o = doc.operations[id];
  return e ? `<b class="m-${e.method}">${e.method}</b> <code>${esc(e.path)}</code>` : o ? `<b class="m-${o.kind}">${o.kind}</b> <code>${esc(o.name)}</code>` : esc(id);
};

function tableDetail(doc: Doc, ix: Index, t: Table): string {
  const store = doc.parts[t.store];
  const calls = callsOf(doc);
  const personal = t.columns.filter((c) => c.classification);
  const out = t.columns.flatMap((c) => (c.ref ? [goRow(`table:${c.ref.table}`, `<code>${esc(c.name)} → ${esc(nameOf(doc, c.ref.table))}.${esc(c.ref.column)}</code>`)] : []));
  const into = Object.values(doc.tables).flatMap((o) => o.columns.flatMap((c) => (c.ref?.table === t.id ? [goRow(`table:${o.id}`, `<code>${esc(o.name)}.${esc(c.name)} → ${esc(c.ref.column)}</code>`)] : [])));
  const writers = calls.filter((c) => c.writes.includes(t.id)).map((c) => goRow(`call:${c.id}`, callRef(doc, c.id), esc(nameOf(doc, c.service))));
  const readers = calls.filter((c) => c.reads.includes(t.id)).map((c) => goRow(`call:${c.id}`, callRef(doc, c.id), esc(nameOf(doc, c.service))));
  const lives = Object.values(doc.placements).filter((pl) => pl.part === t.store).map((pl) => goRow(`placement:${pl.id}`, esc(doc.environments[pl.environment]?.name ?? pl.environment), esc([pl.service ?? pl.runtime, pl.regions.join(", ")].filter(Boolean).join(" · "))));
  const tagLine = `<span class="kind" style="color:${KIND.store.color}">${icon("table-2", 13)}table · ${esc(store?.name ?? t.store)}</span>`;
  return head(tagLine, t.name, plural(t.columns.length, "column"))
    + section("Personal data", personal.map((c) => note(`${c.name} is ${c.classification}.`)).join(""), personal.length)
    + section("Columns", t.columns.map((c) => `<div class="field"><code>${esc(c.name)}</code><span>${esc(c.type)}${c.primary ? " · key" : ""}${c.nullable ? " · may be empty" : ""}</span></div>`).join(""), t.columns.length)
    + section("Points at", out.join(""), out.length)
    + section("Pointed at by", into.join(""), into.length)
    + section("Written by", writers.join("") || note("Nothing writes it yet."), writers.length)
    + section("Read by", readers.join("") || note("Nothing reads it yet."), readers.length)
    + section("Lives in", lives.join(""), lives.length)
    + usedBy(doc, ix, t.id);
}

function shapeDetail(doc: Doc, ix: Index, sh: Shape): string {
  const named = (fields: readonly Field[]) => fields.some((f) => f.type.replace(/\[\]$/, "") === sh.name);
  const calls = callsOf(doc).filter((c) => (c.rest ? c.requestShape === sh.id || c.responseShape === sh.id || named(c.request) || named(c.response) : named(c.args) || c.returns.replace(/[[\]!]/g, "") === sh.name));
  const events = byIndex(doc.events).filter((e) => named(e.payload));
  const links = Object.values(doc.links).filter((l) => l.carries?.includes(sh.id));
  const shapes = byIndex(doc.shapes).filter((o) => o.id !== sh.id && named(o.fields));
  const kind = sh.values?.length ? "enum" : "shape";
  return head(`<span class="kind" style="color:var(--ink-2)">${icon("shapes", 13)}${kind}</span>`, sh.name, sh.values?.length ? plural(sh.values.length, "value") : plural(sh.fields.length, "field"), sh.note ?? "")
    + section("Values", (sh.values ?? []).map((v) => `<div class="field"><code>${esc(v)}</code></div>`).join(""), sh.values?.length)
    + section("Fields", fieldRows(sh.fields), sh.fields.length)
    + section("Carried by calls", calls.map((c) => goRow(`call:${c.id}`, callRef(doc, c.id))).join(""), calls.length)
    + section("In events", events.map((e) => goRow(`event:${e.id}`, `<code>${esc(e.name)}</code>`)).join(""), events.length)
    + section("Over links", links.map((l) => goRow(`part:${l.from}`, `${esc(nameOf(doc, l.from))} → ${esc(nameOf(doc, l.to))}`, l.kind)).join(""), links.length)
    + section("Inside", shapes.map((o) => goRow(`shape:${o.id}`, esc(o.name))).join(""), shapes.length)
    + usedBy(doc, ix, sh.id);
}

/** Every view with something in it, and every thing's detail. */
export function systemOf(doc: Doc): SystemSnapshot {
  const ix = indexOf(doc);
  const views: SystemView[] = [];
  const details: Record<string, string> = {};
  const where: Record<string, ViewId> = {};
  const names: Record<string, string> = {};
  const put = (view: ViewId, ref: string, name: string, html: string) => {
    details[ref] = html;
    where[ref] = view;
    names[ref] = name;
  };
  const parts = byIndex(doc.parts);
  if (parts.length) {
    views.push({ id: "map", name: "Map", group: "system", icon: icon("network"), count: parts.length, canvas: true, html: mapView(doc) });
    for (const p of parts) put("map", `part:${p.id}`, p.name, partDetail(doc, ix, p));
  }
  const calls = callsOf(doc);
  if (calls.length) {
    views.push({ id: "api", name: "API", group: "system", icon: icon("braces"), count: calls.length, canvas: false, html: apiView(doc) });
    for (const c of calls) put("api", `call:${c.id}`, `${verb(c)} ${callName(c)}`, callDetail(doc, ix, c));
  }
  const tables = byIndex(doc.tables), shapes = byIndex(doc.shapes);
  if (tables.length || shapes.length) {
    views.push({ id: "data", name: "Data", group: "system", icon: icon("database"), count: tables.length + shapes.length, canvas: true, html: dataView(doc) });
    for (const t of tables) put("data", `table:${t.id}`, t.name, tableDetail(doc, ix, t));
    for (const sh of shapes) put("data", `shape:${sh.id}`, sh.name, shapeDetail(doc, ix, sh));
  }
  return { views, details, where, names };
}
