// The system behind the pages, as buni open shows it: one view per area (Map, API, Data, …) and a detail for each
// thing in it, drawn here as HTML so the browser only swaps it in. Every clickable thing carries data-ref="kind:id";
// data-go="kind:id" jumps to another. Drawn after designs/viewer.buni.
import type { Doc, Id, Link, Part, PartKind } from "../format/doc.ts";
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
  return { views, details, where, names };
}
