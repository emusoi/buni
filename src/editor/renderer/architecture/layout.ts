// Where everything sits on the architecture map, at each level: deterministic positions and orthogonal routes, pure
// so the same architecture always draws the same picture (and tests can say so).
import type { Architecture, ArchLink, ArchStatus, Environment, Id, Part, Workload } from "buni/format/doc.ts";
import { workloadName } from "buni/format/doc.ts";
import { cardHeight, edgeCard, partCard, serviceCard, toneOf, workloadCard, workloadsOf, type Card, type Tone } from "./model.ts";

export type Level = "system" | "runtime" | "code";
export interface Rect { x: number; y: number; w: number; h: number }
export type Point = [number, number];

export interface MapBox extends Rect {
  key: string;
  /** What lights it in a flow and what selecting it selects: the first is the thing itself. */
  ids: Id[];
  /** Things it belongs with: touched, it stays shown (not dimmed) without lighting. */
  context?: Id[];
  card: Card;
}
/** A dashed boundary: a group, a cluster, a namespace. */
export interface MapFrame extends Rect {
  key: string;
  ids: Id[];
  title: { lead?: string; bold: string; rest?: string; link?: string };
}
export interface Caption { x: number; y: number; text: string }
export interface MapLink {
  key: string;
  ids: Id[];
  context?: Id[];
  from: string;
  to: string;
  label?: string;
  tone: Tone;
  /** Drops to a row below rather than crossing columns: a link to the outside services under a group. */
  down?: boolean;
}
export interface RoutedLink extends MapLink {
  points: Point[];
  /** Where its label sits (its middle), when it has one. */
  at?: Point;
}
export interface MapLayout {
  boxes: MapBox[];
  frames: MapFrame[];
  captions: Caption[];
  links: RoutedLink[];
  width: number;
  height: number;
}

const M = 24;

// ---- Routing: every link leaves a side of one box and enters the facing side of the other, at right angles. ----

type Side = "right" | "left" | "down" | "up";
function sideOf(a: Rect, b: Rect, down?: boolean): Side {
  // Across the gap between columns, unless the link drops to a row below (or the boxes share a column).
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (dx > 0 && !(down && dy > 0)) return b.x > a.x ? "right" : "left";
  return b.y + b.h / 2 >= a.y + a.h / 2 ? "down" : "up";
}
const OPPOSITE: Record<Side, Side> = { right: "left", left: "right", down: "up", up: "down" };
const horizontal = (s: Side) => s === "right" || s === "left";

/** A point on a box's side, `t` of the way along it (0.5 the middle). */
function port(r: Rect, s: Side, t: number): Point {
  if (s === "right") return [r.x + r.w, Math.round(r.y + r.h * t)];
  if (s === "left") return [r.x, Math.round(r.y + r.h * t)];
  if (s === "down") return [Math.round(r.x + r.w * t), r.y + r.h];
  return [Math.round(r.x + r.w * t), r.y];
}

/** Whether a straight segment passes through a box (its edge grazed doesn't count). */
function crosses([x1, y1]: Point, [x2, y2]: Point, r: Rect): boolean {
  const [lx, hx] = [Math.min(x1, x2), Math.max(x1, x2)];
  const [ly, hy] = [Math.min(y1, y2), Math.max(y1, y2)];
  return hx > r.x + 1 && lx < r.x + r.w - 1 && hy > r.y + 1 && ly < r.y + r.h - 1;
}
const clear = (pts: Point[], obstacles: readonly Rect[]) => pts.every((p, i) => i === 0 || obstacles.every((r) => !crosses(pts[i - 1]!, p, r)));

/** Drops points that don't turn (and repeats), so a route is its corners. */
function corners(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const a = out.at(-2), b = out.at(-1);
    if (b && b[0] === p[0] && b[1] === p[1]) continue;
    if (a && b && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * An orthogonal route from `s` (leaving side `side`) to `t`, turning at `mid` (an x for a sideways link, a y for an
 * up-or-down one). Through a box in the way, it goes round: above or below it (sideways), or beside it (up or down).
 */
export function route(s: Point, t: Point, side: Side, mid: number, obstacles: readonly Rect[]): Point[] {
  const across = horizontal(side);
  const direct = corners(across ? [s, [mid, s[1]], [mid, t[1]], t] : [s, [s[0], mid], [t[0], mid], t]);
  if (clear(direct, obstacles)) return direct;
  const out = side === "right" || side === "down" ? 14 : -14;
  const inside = obstacles.filter((r) => across
    ? r.x < Math.max(s[0], t[0]) && r.x + r.w > Math.min(s[0], t[0])
    : r.y < Math.max(s[1], t[1]) && r.y + r.h > Math.min(s[1], t[1]));
  const lo = Math.min(...inside.map((r) => (across ? r.y : r.x)), across ? Math.min(s[1], t[1]) : Math.min(s[0], t[0])) - 16;
  const hi = Math.max(...inside.map((r) => (across ? r.y + r.h : r.x + r.w)), across ? Math.max(s[1], t[1]) : Math.max(s[0], t[0])) + 16;
  for (const lane of [lo, hi]) {
    const pts = corners(across
      ? [s, [s[0] + out, s[1]], [s[0] + out, lane], [t[0] - out, lane], [t[0] - out, t[1]], t]
      : [s, [s[0], s[1] + out], [lane, s[1] + out], [lane, t[1] - out], [t[0], t[1] - out], t]);
    if (clear(pts, obstacles)) return pts;
  }
  return direct;
}

/** Where a route's label goes: the middle of its longest crossing (sideways, where there is one). */
export function labelAt(pts: readonly Point[]): Point {
  let best: Point = pts[0] ?? [0, 0], len = -1;
  for (let pass = 0; pass < 2 && len < 0; pass++) {
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      const flat = a[1] === b[1];
      if (pass === 0 && !flat) continue;
      const l = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (l > len) { len = l; best = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    }
  }
  return best;
}

/** Routes every link between its boxes: ports spread along each side, turns spread across each gap. */
export function routeLinks(boxes: readonly MapBox[], links: readonly MapLink[]): RoutedLink[] {
  const at = new Map(boxes.map((b) => [b.key, b]));
  const known = links.filter((l) => at.has(l.from) && at.has(l.to) && l.from !== l.to);
  const sides = known.map((l) => sideOf(at.get(l.from)!, at.get(l.to)!, l.down));
  // Each box side's links, ordered by where their other end is, share the side evenly.
  const onSide = new Map<string, { i: number; along: number }[]>();
  known.forEach((l, i) => {
    const [a, b] = [at.get(l.from)!, at.get(l.to)!];
    const s = sides[i]!;
    const across = horizontal(s);
    for (const [box, side, other] of [[a, s, b], [b, OPPOSITE[s], a]] as const) {
      const key = `${box.key} ${side}`;
      const list = onSide.get(key) ?? [];
      list.push({ i, along: across ? other.y + other.h / 2 : other.x + other.w / 2 });
      onSide.set(key, list);
    }
  });
  const share = (box: MapBox, side: Side, i: number): number => {
    const list = [...(onSide.get(`${box.key} ${side}`) ?? [])].sort((p, q) => p.along - q.along || p.i - q.i);
    const n = list.length, k = list.findIndex((p) => p.i === i);
    return n <= 1 ? 0.5 : 0.25 + (0.5 * k) / (n - 1);
  };
  // Links crossing the same gap turn in lanes of their own.
  const gaps = new Map<string, number[]>();
  const gapOf = (i: number): [number, number] => {
    const [a, b] = [at.get(known[i]!.from)!, at.get(known[i]!.to)!];
    const s = sides[i]!;
    return s === "right" ? [a.x + a.w, b.x] : s === "left" ? [b.x + b.w, a.x] : s === "down" ? [a.y + a.h, b.y] : [b.y + b.h, a.y];
  };
  known.forEach((_, i) => {
    const key = `${horizontal(sides[i]!) ? "x" : "y"} ${gapOf(i).join(" ")}`;
    gaps.set(key, [...(gaps.get(key) ?? []), i]);
  });
  const lane = (i: number): number => {
    const [lo, hi] = gapOf(i);
    const list = gaps.get(`${horizontal(sides[i]!) ? "x" : "y"} ${lo} ${hi}`) ?? [i];
    const k = list.indexOf(i);
    return Math.round(lo + ((hi - lo) * (k + 1)) / (list.length + 1));
  };
  return known.map((l, i) => {
    const [a, b] = [at.get(l.from)!, at.get(l.to)!];
    const s = sides[i]!;
    const p0 = port(a, s, share(a, s, i));
    const p1 = port(b, OPPOSITE[s], share(b, OPPOSITE[s], i));
    const points = route(p0, p1, s, lane(i), boxes.filter((x) => x !== a && x !== b));
    return { ...l, points, ...(l.label ? { at: labelAt(points) } : {}) };
  });
}

const bounds = (rects: readonly Rect[]): { width: number; height: number } => ({
  width: Math.max(0, ...rects.map((r) => r.x + r.w)) + M,
  height: Math.max(0, ...rects.map((r) => r.y + r.h)) + M,
});

function finish(boxes: MapBox[], frames: MapFrame[], captions: Caption[], links: MapLink[]): MapLayout {
  return { boxes, frames, captions, links: routeLinks(boxes, links), ...bounds([...boxes, ...frames]) };
}

const linkLabel = (l: ArchLink, carries = true) => (carries && l.carries ? `${l.kind} · ${l.carries}` : l.kind);
const KIND_ORDER: Record<Part["kind"], number> = { client: 0, edge: 1, service: 2, worker: 3, job: 4, queue: 5, cache: 6, store: 7, external: 8 };
const byKind = (a: Part, b: Part) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name);

// ---- System: parts in layered columns by which way their links go, inside their groups; outside services below. ----

const SYS = { w: 170, colGap: 140, rowGap: 44, pad: 20 } as const;

/**
 * Columns for parts, left to right the way data flows: a link's reader after its writer, a subscriber after its
 * queue. Stores and queues sit beside what feeds them and take no column of their own, so a request's path stays short.
 */
export function columnsOf(parts: readonly Part[], links: readonly ArchLink[]): Map<Id, number> {
  const ids = new Set(parts.map((p) => p.id));
  const kind = new Map(parts.map((p) => [p.id, p.kind]));
  const preds = new Map<Id, Id[]>();
  for (const l of links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    const [a, b] = l.kind === "subscribes" ? [l.to, l.from] : [l.from, l.to];
    preds.set(b, [...(preds.get(b) ?? []), a]);
  }
  const col = new Map<Id, number>();
  const visiting = new Set<Id>();
  const of = (id: Id): number => {
    const known = col.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const holds = (p: Id) => kind.get(p) === "store" || kind.get(p) === "queue" || kind.get(p) === "cache";
    const c = Math.max(0, ...(preds.get(id) ?? []).map((p) => of(p) + (holds(p) ? 0 : 1)));
    visiting.delete(id);
    col.set(id, c);
    return c;
  };
  for (const p of parts) of(p.id);
  return col;
}

/** Stacks each column's cards, each as level as it can be with what feeds it. */
function placeColumns(parts: Part[], links: readonly ArchLink[], x0: number, y0: number, card: (p: Part) => Card): MapBox[] {
  const col = columnsOf(parts, links);
  const n = Math.max(-1, ...col.values()) + 1;
  const ys = new Map<Id, number>();
  const boxes: MapBox[] = [];
  for (let c = 0; c < n; c++) {
    const here = parts.filter((p) => col.get(p.id) === c);
    const wants = new Map(here.map((p) => {
      const feeds = links.filter((l) => (l.kind === "subscribes" ? l.from === p.id : l.to === p.id)).map((l) => ys.get(l.kind === "subscribes" ? l.to : l.from)).filter((y): y is number => y !== undefined);
      return [p.id, feeds.length ? feeds.reduce((a, b) => a + b, 0) / feeds.length : y0] as const;
    }));
    // What feeds another in the same column (a queue its subscriber) goes above it; planned things last.
    const feedsHere = (p: Part, q: Part) => links.some((l) => (l.kind === "subscribes" ? l.to === p.id && l.from === q.id : l.from === p.id && l.to === q.id));
    here.sort((a, b) => Number(a.status === "planned") - Number(b.status === "planned") || (feedsHere(a, b) ? -1 : feedsHere(b, a) ? 1 : 0) || wants.get(a.id)! - wants.get(b.id)! || byKind(a, b));
    let next = y0;
    for (const p of here) {
      const c2 = card(p);
      const y = Math.max(next, Math.round(wants.get(p.id)!));
      const h = cardHeight(c2, SYS.w);
      ys.set(p.id, y);
      boxes.push({ key: p.id, ids: [p.id], card: c2, x: x0 + c * (SYS.w + SYS.colGap), y, w: SYS.w, h });
      next = y + h + SYS.rowGap;
    }
  }
  return boxes;
}

/** Puts each card in a row as near as it can to `want`, left to right, without overlap. */
function spreadRow(items: { key: string; want: number; w: number }[], gap: number, from: number): Map<string, number> {
  const out = new Map<string, number>();
  let next = from;
  for (const it of [...items].sort((a, b) => a.want - b.want || a.key.localeCompare(b.key))) {
    const x = Math.max(next, Math.round(it.want - it.w / 2));
    out.set(it.key, x);
    next = x + it.w + gap;
  }
  return out;
}

/** With `plan`, what that plan adds is drawn as added (green) and what it removes as removed (red): its diff. */
export function systemLayout(arch: Architecture, plan?: Id): MapLayout {
  const diff = (x: { plan?: Id; status?: ArchStatus }): Tone => (plan !== undefined && x.plan === plan ? (x.status === "removed" ? "removed" : "added") : toneOf(x.status));
  const card = (p: Part): Card => ({ ...partCard(p), tone: diff(p) });
  const parts = Object.values(arch.parts).sort(byKind);
  const links = Object.values(arch.links);
  const grouped = parts.filter((p) => p.group !== undefined && arch.groups[p.group] && p.kind !== "edge");
  const inGroup = new Set(grouped.map((p) => p.id));
  const linked = (p: Part) => links.some((l) => (l.from === p.id && inGroup.has(l.to)) || (l.to === p.id && inGroup.has(l.from)));
  // Outside: what the system calls out to, and a part of no group that is neither managed nor linked yet (one just added).
  const outside = parts.filter((p) => !inGroup.has(p.id) && p.kind !== "edge" && (p.kind === "external" || linked(p) || p.managed === undefined));
  const boxes: MapBox[] = [];
  const frames: MapFrame[] = [];
  const captions: Caption[] = [];
  let y = M + 10;
  // Each group with parts in it, in a boundary of its own, one under the other.
  const groups = Object.values(arch.groups).filter((g) => grouped.some((p) => p.group === g.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const g of groups) {
    const mine = grouped.filter((p) => p.group === g.id);
    const placed = placeColumns(mine, links, M + SYS.pad, y + SYS.pad + 10, card);
    const right = Math.max(...placed.map((b) => b.x + b.w)) + SYS.pad;
    const bottom = Math.max(...placed.map((b) => b.y + b.h)) + SYS.pad;
    frames.push({ key: g.id, ids: [g.id], x: M, y, w: right - M, h: bottom - y, title: { bold: g.name, rest: ` · ${mine.length} part${mine.length === 1 ? "" : "s"} inside` } });
    boxes.push(...placed);
    y = bottom + 40;
  }
  if (outside.length) {
    const xOf = new Map(boxes.map((b) => [b.key, b.x + b.w / 2]));
    const want = (p: Part) => {
      const xs = links.flatMap((l) => (l.from === p.id ? [xOf.get(l.to)] : l.to === p.id ? [xOf.get(l.from)] : [])).filter((x): x is number => x !== undefined);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : M + SYS.w / 2;
    };
    const top = boxes.length ? y + 34 : y;
    const items = outside.map((p) => ({ key: p.id, want: want(p), w: SYS.w }));
    const at = spreadRow(items, 75, M);
    // The row as a whole centres on what it links to, as far left as the margin allows.
    const middle = items.reduce((a, b) => a + b.want, 0) / items.length;
    const shift = Math.max(M - Math.min(...at.values()), middle - (Math.min(...at.values()) + Math.max(...at.values()) + SYS.w) / 2);
    for (const [k, x] of at) at.set(k, Math.round(x + Math.min(0, shift)));
    const left = Math.min(...at.values());
    if (boxes.length) captions.push({ x: left, y: top - 22, text: outside.every((p) => p.kind === "external") ? "Outside services" : "Outside the system" });
    for (const p of outside) {
      const c = card(p);
      boxes.push({ key: p.id, ids: [p.id], card: c, x: at.get(p.id)!, y: top, w: SYS.w, h: cardHeight(c, SYS.w) });
    }
  }
  const shown = new Set(boxes.map((b) => b.key));
  const outsideIds = new Set(outside.map((p) => p.id));
  const mapLinks = links.filter((l) => shown.has(l.from) && shown.has(l.to)).map((l): MapLink => {
    const [from, to] = l.kind === "subscribes" ? [l.to, l.from] : [l.from, l.to];
    return { key: l.id, ids: [l.id], from, to, label: linkLabel(l), tone: diff(l), ...(outsideIds.has(from) !== outsideIds.has(to) ? { down: true } : {}) };
  });
  return finish(boxes, frames, captions, mapLinks);
}

// ---- Runtime: edge → the cluster's namespaces and workloads → managed services → outside services. ----

/** Beside the cluster, what keeps data comes before what carries it. */
const HOLDS: Record<Part["kind"], number> = { store: 0, cache: 1, queue: 2, client: 3, edge: 3, service: 3, worker: 3, job: 3, external: 4 };
const RT = { edgeW: 160, clusterX: 220, clusterW: 600, sideW: 216, gap: 16 } as const;

/** The box a part is drawn as in an environment: its serving workload, else its own card. */
function primaryKey(arch: Architecture, part: Id, env: Id | undefined, keys: ReadonlySet<string>): string | undefined {
  const w = workloadsOf(arch, part, env).find((x) => !x.before);
  if (w && keys.has(w.id)) return w.id;
  return keys.has(part) ? part : undefined;
}

/** The edge in the order requests pass through it: DNS first, the load balancer last. */
export function edgeChain(arch: Architecture): Part[] {
  const edge = Object.values(arch.parts).filter((p) => p.kind === "edge").sort(byKind);
  const ids = new Set(edge.map((p) => p.id));
  const links = Object.values(arch.links).filter((l) => ids.has(l.from) && ids.has(l.to));
  const col = columnsOf(edge, links);
  return edge.sort((a, b) => col.get(a.id)! - col.get(b.id)! || byKind(a, b));
}

/** `taller`: workloads drawn taller than their card (a release's canary split), at least this high. */
export function runtimeLayout(arch: Architecture, env: Environment | undefined, taller: ReadonlyMap<Id, number> = new Map()): MapLayout {
  const boxes: MapBox[] = [];
  const frames: MapFrame[] = [];
  const captions: Caption[] = [];
  const links: MapLink[] = [];
  const parts = Object.values(arch.parts).sort(byKind);
  // The edge, top to bottom.
  const edge = edgeChain(arch);
  if (edge.length) captions.push({ x: M, y: M, text: "Edge" });
  let ey = M + 26;
  for (const p of edge) {
    const c = edgeCard(p);
    const h = Math.max(64, cardHeight(c, RT.edgeW));
    boxes.push({ key: p.id, ids: [p.id], card: c, x: M, y: ey, w: RT.edgeW, h });
    ey += h + 20;
  }
  // The cluster, its namespaces as rows: one with traffic coming in takes the whole width, the rest go two by two.
  const cluster = env?.cluster ? arch.clusters[env.cluster] : undefined;
  const workloads = Object.values(arch.workloads).filter((w) => w.environment === env?.id);
  const left = RT.clusterX, inner = RT.clusterW - 40;
  let bottom = M;
  if (cluster) {
    const namespaces = Object.values(arch.namespaces).filter((n) => n.cluster === cluster.id);
    const mine = (ns: Id) => workloads.filter((w) => w.namespace === ns).sort((a, b) => (a.status === "planned" ? 1 : 0) - (b.status === "planned" ? 1 : 0) || (a.before ? 1 : 0) - (b.before ? 1 : 0) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const wide = (ns: Id) => mine(ns).some((w) => w.ingress || w.service);
    namespaces.sort((a, b) => Number(wide(b.id)) - Number(wide(a.id)) || a.name.localeCompare(b.name));
    const rows: (typeof namespaces)[] = [];
    for (const ns of namespaces) {
      const last = rows.at(-1);
      if (!wide(ns.id) && last && last.length === 1 && !wide(last[0]!.id)) last.push(ns);
      else rows.push([ns]);
    }
    let y = M + 32;
    for (const row of rows) {
      const w = row.length === 1 && wide(row[0]!.id) ? inner : (inner - RT.gap) / 2;
      let rowBottom = y;
      row.forEach((ns, i) => {
        const x = left + 20 + i * (w + RT.gap);
        let wy = y + 36;
        const list = mine(ns.id);
        // A workload that takes traffic gets its Ingress and Service drawn in front of it.
        const front = list.find((x) => x.ingress || x.service);
        const cardX = front && w === inner ? x + 200 : x + 20;
        const cardW = front && w === inner ? w - 220 : w - 40;
        if (front && w === inner) {
          let fy = y + 36;
          const fronts: [string, Card][] = [
            ...(front.ingress ? [["ingress", { label: "Ingress", name: ns.name, sub: `routes ${front.ingress.path ?? "/"} to :${front.service?.port ?? 80}`, tone: toneOf(front.status) }] as [string, Card]] : []),
            ...(front.service ? [["service", { label: "Service", name: workloadName(arch, front), sub: `ClusterIP :${front.service.port}`, tone: toneOf(front.status) }] as [string, Card]] : []),
          ];
          fronts.forEach(([what, c], k) => {
            boxes.push({ key: `${front.id}#${what}`, ids: [], context: [front.id, front.part], card: c, x: x + 20, y: fy, w: 150, h: 62 });
            if (k > 0) links.push({ key: `${front.id}#${what}-in`, ids: [], context: [front.id], from: `${front.id}#${fronts[k - 1]![0]}`, to: `${front.id}#${what}`, tone: "live" });
            fy += 62 + 36;
          });
          const last = fronts.at(-1);
          if (last) links.push({ key: `${front.id}#to`, ids: [], context: [front.id], from: `${front.id}#${last[0]}`, to: front.id, tone: "live" });
          rowBottom = Math.max(rowBottom, fy - 36 + 20);
        }
        for (const wl of list) {
          const c = workloadCard(arch, wl);
          const h = Math.max(cardHeight(c, cardW), taller.get(wl.id) ?? 0);
          const primary = workloadsOf(arch, wl.part, env?.id).find((x) => !x.before)?.id === wl.id;
          boxes.push({ key: wl.id, ids: primary ? [wl.id, wl.part] : [wl.id], context: [wl.part], card: c, x: cardX, y: wy, w: cardW, h });
          wy += h + 14;
        }
        rowBottom = Math.max(rowBottom, wy - 14 + 20, y + 80);
        frames.push({ key: ns.id, ids: [ns.id], x, y, w, h: 0, title: { lead: "namespace ", bold: ns.name, ...(ns.owners ? { rest: ` · ${ns.owners}` } : {}) } });
      });
      for (const f of frames.slice(-row.length)) f.h = rowBottom - y;
      y = rowBottom + 20;
    }
    bottom = Math.max(y, M + 120);
    const git = cluster.gitops;
    frames.unshift({
      key: cluster.id, ids: [cluster.id], x: left, y: M, w: RT.clusterW, h: bottom - M,
      title: { bold: cluster.name, rest: ` · ${cluster.provider === "eks" || cluster.provider === "gke" || cluster.provider === "aks" ? "Kubernetes" : cluster.provider} ${cluster.version ?? ""}${cluster.zones ? ` · ${cluster.zones} zones` : ""}${git ? ` · ${git.tool === "argocd" ? "Argo CD" : "Flux"} syncs ` : ""}`, ...(git ? { link: `${git.repo}${git.path ? `/${git.path}` : ""}` } : {}) },
    });
  } else if (env) {
    // No cluster here: what is built runs on the environment's provider.
    const built = parts.filter((p) => p.build && !p.managed);
    let y = M + 36;
    for (const p of built) {
      const c = partCard(p);
      const h = cardHeight(c, inner - 40);
      boxes.push({ key: p.id, ids: [p.id], card: c, x: left + 20, y, w: inner - 40, h });
      y += h + 14;
    }
    bottom = y + 6;
    frames.push({ key: `env-${env.id}`, ids: [env.id], x: left, y: M, w: RT.clusterW, h: bottom - M, title: { bold: env.name, rest: env.provider ? ` · runs on ${env.provider}` : "" } });
  }
  // Managed services, then outside ones, in a column beside the cluster.
  const sideX = left + RT.clusterW + 40;
  const degree = (p: Part) => Object.values(arch.links).filter((l) => l.from === p.id || l.to === p.id).length;
  const managed = parts.filter((p) => p.managed !== undefined).sort((a, b) => degree(b) - degree(a) || HOLDS[a.kind] - HOLDS[b.kind] || a.name.localeCompare(b.name));
  const outside = parts.filter((p) => p.kind === "external");
  let sy = M;
  for (const [caption, list, gap] of [[`${env?.provider ?? "Cloud"} managed`, managed, 16], ["Outside services", outside, 14]] as const) {
    if (!list.length) continue;
    captions.push({ x: sideX, y: sy, text: caption });
    sy += 26;
    for (const p of list) {
      const c = serviceCard(arch, p);
      const h = Math.max(56, cardHeight(c, RT.sideW));
      const migrations = Object.values(arch.migrations).filter((m) => m.store === p.id).map((m) => m.id);
      boxes.push({ key: p.id, ids: [p.id, ...migrations], card: c, x: sideX, y: sy, w: RT.sideW, h });
      sy += h + gap;
    }
    sy += 10;
  }
  // Links: the edge's chain, each part link between the boxes its ends are drawn as, and migrations run before a sync.
  const keys = new Set(boxes.map((b) => b.key));
  for (const l of Object.values(arch.links)) {
    const [a, b] = l.kind === "subscribes" ? [l.to, l.from] : [l.from, l.to];
    const from = primaryKey(arch, a, env?.id, keys);
    let to = primaryKey(arch, b, env?.id, keys);
    if (to && keys.has(`${to}#ingress`) && arch.parts[a]?.kind === "edge") to = `${to}#ingress`;
    if (!from || !to) continue;
    const edgeHop = arch.parts[a]?.kind === "edge" && arch.parts[b]?.kind === "edge";
    links.push({ key: l.id, ids: [l.id], from, to, ...(edgeHop ? {} : { label: l.kind === "routes" ? l.carries ?? "routes" : linkLabel(l, false) }), tone: toneOf(l.status) });
  }
  for (const w of workloads.filter((x) => x.before)) {
    const runs = Object.values(arch.releases).filter((r) => r.before?.includes(w.id));
    const stores = new Set(Object.values(arch.migrations).filter((m) => m.release && runs.some((r) => r.id === m.release)).map((m) => m.store));
    for (const s of stores) if (keys.has(s)) links.push({ key: `${w.id}#migrates-${s}`, ids: [w.id], from: w.id, to: s, label: "migrates", tone: "deploy" });
  }
  return finish(boxes, frames, captions, links.filter((l) => keys.has(l.from) && keys.has(l.to)));
}

// ---- Code: each built part as a row, its code → pipeline → what it makes → what that runs as. ----

const CODE = { cols: [24, 300, 590, 850], w: [220, 236, 206, 216], rowGap: 24 } as const;

export function codeLayout(arch: Architecture, env: Environment | undefined): MapLayout {
  const boxes: MapBox[] = [];
  const links: MapLink[] = [];
  const captions: Caption[] = ["Code", "Pipeline", "Makes", `Runs as${env ? ` in ${env.name}` : ""}`].map((text, i) => ({ x: CODE.cols[i]!, y: M, text }));
  let y = M + 26;
  for (const p of Object.values(arch.parts).filter((x) => x.build).sort(byKind)) {
    const b = p.build!;
    const repo = b.repo.replace(/^https?:\/\//, "");
    const cards: Card[] = [
      { label: p.owners ? `Code · ${p.owners}` : "Code", name: p.name, sub: `${repo}${b.path ? ` · ${b.path}` : ""}`, tone: toneOf(p.status) },
      { label: "Pipeline", name: b.dockerfile ?? "Build", ...(b.steps?.length ? { chips: [b.steps] } : {}), tone: toneOf(p.status) },
      { label: b.registry ? `Image · ${b.registry}` : "Bundle", name: b.artifact ?? "build output", ...(b.registry ? { sub: `pushed to ${b.registry}` } : {}), tone: toneOf(p.status) },
      ...workloadsOf(arch, p.id, env?.id).map((w: Workload): Card => ({
        label: `${w.kind}${w.before ? " · before each sync" : ""}`, name: workloadName(arch, w),
        sub: [w.replicas ? `×${w.replicas.min}${w.replicas.max && w.replicas.max > w.replicas.min ? `–${w.replicas.max}` : ""}` : undefined, w.image].filter(Boolean).join(" · ") || "—",
        tone: w.before ? "deploy" : toneOf(w.status),
      })),
    ];
    const keys = cards.map((_, i) => (i === 0 ? p.id : `${p.id}#${i}`));
    let rowBottom = y;
    let runY = y;
    cards.forEach((c, i) => {
      const col = Math.min(i, 3);
      const w = CODE.w[col]!;
      const h = cardHeight(c, w);
      const at = i >= 3 ? runY : y;
      boxes.push({ key: keys[i]!, ids: i === 0 ? [p.id] : [], context: [p.id], card: c, x: CODE.cols[col]!, y: at, w, h });
      if (i >= 3) runY += h + 10;
      rowBottom = Math.max(rowBottom, at + h);
      if (i > 0) links.push({ key: `${keys[Math.min(i - 1, 2)]}>${keys[i]}`, ids: [], context: [p.id], from: keys[Math.min(i - 1, 2)]!, to: keys[i]!, tone: c.tone });
    });
    y = rowBottom + CODE.rowGap;
  }
  return finish(boxes, [], captions, links);
}

export function layoutFor(arch: Architecture, level: Level, env: Environment | undefined, taller?: ReadonlyMap<Id, number>): MapLayout {
  return level === "system" ? systemLayout(arch) : level === "runtime" ? runtimeLayout(arch, env, taller) : codeLayout(arch, env);
}

// ---- Keyboard: the order Tab reads the map in, and where an arrow goes from a card. ----

export type MapStop = { frame: MapFrame } | { box: MapBox };
const inside = (a: Rect, b: Rect) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
/** The map reads in columns, as its links run: left to right, then down a column (a column's edges within 16px). */
const reading = (a: Rect, b: Rect) => (Math.abs(a.x - b.x) < 16 ? a.y - b.y : a.x - b.x);

/** Frames and cards in reading order, each frame followed by what is inside it: a title, its cards, the next title. */
export function tabOrder(layout: Pick<MapLayout, "frames" | "boxes">): MapStop[] {
  const area = (r: Rect) => r.w * r.h;
  const parentOf = (r: Rect) => layout.frames.filter((f) => inside(r, f)).sort((a, b) => area(a) - area(b))[0];
  const stops: { rect: Rect; stop: MapStop; parent: MapFrame | undefined }[] = [
    ...layout.frames.map((f) => ({ rect: f, stop: { frame: f }, parent: parentOf(f) })),
    ...layout.boxes.map((b) => ({ rect: b, stop: { box: b }, parent: parentOf(b) })),
  ];
  const out: MapStop[] = [];
  const walk = (parent: MapFrame | undefined) => {
    for (const s of stops.filter((x) => x.parent === parent).sort((a, b) => reading(a.rect, b.rect))) {
      out.push(s.stop);
      if ("frame" in s.stop) walk(s.stop.frame);
    }
  };
  walk(undefined);
  return out;
}

export type Direction = "left" | "right" | "up" | "down";
/** The card an arrow key moves to from `from`: the nearest one that way, a step aside costing twice a step ahead. */
export function nearestBox(boxes: readonly MapBox[], from: MapBox, dir: Direction): MapBox | undefined {
  const mid = (r: Rect): Point => [r.x + r.w / 2, r.y + r.h / 2];
  const [fx, fy] = mid(from);
  let best: { box: MapBox; cost: number } | undefined;
  for (const b of boxes) {
    if (b === from) continue;
    const [x, y] = mid(b);
    const [ahead, aside] = dir === "right" ? [x - fx, y - fy] : dir === "left" ? [fx - x, y - fy] : dir === "down" ? [y - fy, x - fx] : [fy - y, x - fx];
    if (ahead <= 0) continue;
    const cost = ahead + 2 * Math.abs(aside);
    if (!best || cost < best.cost) best = { box: b, cost };
  }
  return best?.box;
}

/** How far to pan, on one axis, so a span at `start` (`len` long) shows in a view `size` long with `pad` to spare. */
export function revealBy(start: number, len: number, size: number, pad = 24): number {
  if (start < pad || len > size - 2 * pad) return pad - start;
  if (start + len > size - pad) return size - pad - (start + len);
  return 0;
}
