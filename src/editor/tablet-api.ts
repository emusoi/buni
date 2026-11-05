// What the tablet app draws, as docs/tablet-api.md says: the architecture laid out exactly as the editor lays it out,
// the API view, the pages, the pen marks and the plans waiting on the person. Pure, so it is tested without a server.
import { ARCH_COLLECTIONS, architectureOf, pagesInOrder, childrenOf, walkFlow, type Architecture, type Comment, type Doc, type Flow, type Id, type Node, type Stroke } from "buni/format/doc.ts";
import { inkBox, markKind, markTarget } from "buni/tools/ink.ts";
import { subtree } from "buni/tools/kit.ts";
import { apiLayout, CALLER_W, ROW } from "./renderer/architecture/apiLayout.ts";
import { layoutFor, type MapLayout } from "./renderer/architecture/layout.ts";
import { placement, rowTitles, widthOf } from "./renderer/layout.ts";
import { linkLabel, routeAll, type Arrow } from "./renderer/links.ts";

export interface TabletMap {
  width: number;
  height: number;
  boxes: { key: string; ids: Id[]; x: number; y: number; w: number; h: number; label: string; name: string; sub?: string; tone: string }[];
  frames: { key: string; x: number; y: number; w: number; h: number; title: string }[];
  links: { key: string; ids: Id[]; from: string; to: string; label?: string; tone: string; points: [number, number][]; at?: [number, number] }[];
}

export interface TabletMark {
  id: Id;
  view: "context" | "system" | "api" | "page" | "flow" | "sketch";
  page: Id | null;
  flow: Id | null;
  /** On a flow, the page of the screen under the mark: where it shows on the Screens canvas. */
  screen: Id | null;
  on: Id;
  onName: string;
  kind: string;
  said: string;
  from: string | null;
  state: Comment["state"];
  strokes: Stroke[];
}

export interface TabletPlan {
  id: Id;
  name: string;
  issue: string | null;
  about: string | null;
  changes: { id: Id; change: "add" | "remove"; title: string; detail: string }[];
}

/** A flow laid out for the tablet: its usual path left to right, the screens a condition reaches under the step they leave. */
export interface TabletFlow {
  id: Id;
  name: string;
  width: number;
  height: number;
  /**
   * `step` numbers the usual path; the others carry `when` (the condition that sends people there) and `back` (the
   * step they lead back to, if any). `card` is where a step's journey sits, under it.
   */
  screens: { page: Id; name: string; x: number; y: number; w: number; h: number; step: number | null; when: string | null; back: string | null; card: [number, number, number, number] | null }[];
  links: { from: Id; to: Id; label: string; when: boolean; points: [number, number][]; at: [number, number] }[];
  /** Every way on from every screen of the flow, drawn or not: what walking it offers. */
  moves: { from: Id; to: Id; label: string; when: string | null }[];
  lanes: string[];
  journey: { page: Id; confidence: number | null; cells: Record<string, string> }[];
}

export interface TabletDesign {
  file: string;
  name: string;
  version: number;
  levels: { context: TabletMap; system: TabletMap };
  api: ReturnType<typeof apiJson>;
  pages: { id: Id; name: string; route: string | null; width: number; marks: number }[];
  flows: TabletFlow[];
  marks: TabletMark[];
  plans: TabletPlan[];
}

function mapJson(l: MapLayout): TabletMap {
  return {
    width: l.width, height: l.height,
    boxes: l.boxes.map((b) => ({ key: b.key, ids: b.ids, x: b.x, y: b.y, w: b.w, h: b.h, label: b.card.label, name: b.card.name, ...(b.card.sub ? { sub: b.card.sub } : {}), tone: b.card.tone })),
    frames: l.frames.map((f) => ({ key: f.key, x: f.x, y: f.y, w: f.w, h: f.h, title: [f.title.lead, f.title.bold, f.title.rest].filter(Boolean).join(" ") })),
    links: l.links.map((k) => ({ key: k.key, ids: k.ids, from: k.from, to: k.to, ...(k.label ? { label: k.label } : {}), tone: k.tone, points: k.points, ...(k.at ? { at: k.at } : {}) })),
  };
}

function apiJson(arch: Architecture) {
  const l = apiLayout(arch);
  return {
    width: l.width, height: l.height,
    callers: l.callers.map((c) => ({ id: c.part.id, name: c.part.name, label: c.part.tech ?? c.part.kind, ...(c.part.about ? { sub: c.part.about } : {}), x: c.x, y: c.y, w: CALLER_W, h: 80, to: c.to })),
    cards: l.cards.map((c) => ({
      part: c.part.id, name: c.part.name, kind: c.part.api?.kind ?? "rest", spec: c.part.api?.spec ?? (c.part.api?.kind === "graphql" ? "schema.graphql" : "openapi.yaml"),
      x: c.x, y: c.y, w: c.w, h: c.h, sections: c.sections,
      rows: c.rows.map((r) => ({
        op: r.op.id, y: r.y, h: ROW, method: r.op.method ?? null, path: r.op.path ?? null, field: r.op.field ?? null, returns: r.op.returns ?? null,
        note: r.op.responses?.[0]?.split(/\s/)[0] ?? null, about: r.op.about ?? null, request: r.op.request ?? null, responses: r.op.responses ?? [],
      })),
    })),
    resolves: l.cards.flatMap((c) => c.rows.flatMap((r) => (r.op.resolves ? [{ from: r.op.id, to: r.op.resolves }] : []))),
  };
}

function markJson(doc: Doc, c: Comment): TabletMark {
  const strokes = c.ink?.strokes ?? [];
  return {
    id: c.id, view: c.ink?.view ?? (c.ink?.flow ? "flow" : c.ink?.sketch ? "sketch" : "page"), page: c.ink?.page ?? null, flow: c.ink?.flow ?? null,
    screen: c.ink?.flow ? Object.values(doc.pages).find((p) => p.frame === c.node)?.id ?? null : null, on: c.node,
    // On a flow, the screen under it by its page's name: its frame's name doesn't say which state it is.
    onName: c.ink?.view ? markTarget(doc, c) : c.ink?.sketch ? "New screen sketch" : (c.ink?.flow && Object.values(doc.pages).find((p) => p.frame === c.node)?.name) || (doc.nodes[c.node]?.name ?? c.node),
    kind: markKind(strokes), said: c.posts.at(-1)?.body ?? "", from: c.ink?.from ?? null, state: c.state, strokes,
  };
}

const GAP = 150, PAD = 40, TOP = 48, DROP = 120, SMALL = 0.62, CARD_W = 176, CARD_H = 92;

/** A screen's box: phone-sized pages tall, wider ones short. Pages are measured only when drawn, so this is their shape, not their height. */
function screenBox(doc: Doc, page: Id, scale = 1): { w: number; h: number } {
  const wide = widthOf(doc, page) > 600;
  const w = (wide ? 320 : 150) * scale;
  return { w, h: w * (wide ? 0.625 : 2.16) };
}

/** What a tapped layer says: its own text or the first text inside it ("Find my order"), else its name. */
function words(doc: Doc, id: Id): string {
  const text = (n: Node): string | undefined => (n.kind === "text" ? n.text : childrenOf(doc, n.id).map(text).find(Boolean));
  const n = doc.nodes[id];
  return n ? text(n) ?? n.name : "";
}

function flowJson(doc: Doc, f: Flow): TabletFlow {
  const { pages, links, alternatives } = walkFlow(doc, f.start);
  const main = pages.filter((p) => !alternatives.includes(p));
  const into = (p: Id) => links.find((c) => c.to === p);
  // Each other screen hangs under the step it leaves from, following other screens back to one.
  const anchor = (p: Id, seen = new Set<Id>()): Id => {
    const from = into(p)?.page ?? f.start;
    return main.includes(from) || seen.has(from) ? from : anchor(from, seen.add(p));
  };
  const under = new Map(main.map((m) => [m, alternatives.filter((a) => anchor(a) === m)]));
  const mainH = Math.max(0, ...main.map((m) => screenBox(doc, m).h));
  const j = Object.values(doc.journeys).find((x) => x.flow === f.id);
  const told = (p: Id) => j?.steps.some((s) => s.page === p && (s.confidence !== undefined || Object.keys(s.cells).length > 0)) ?? false;
  // Room under the steps for their journeys, when the flow has one.
  const low = TOP + mainH + (main.some(told) ? 12 + CARD_H : 0) + DROP;
  const screens: TabletFlow["screens"] = [], out: TabletFlow["links"] = [];
  const name = (p: Id) => doc.pages[p]?.name ?? p;
  let x = PAD, lowH = 0;
  main.forEach((m, i) => {
    const box = screenBox(doc, m);
    // The others are cropped short: a state differs near its top, where its message is.
    const alts = (under.get(m) ?? []).map((a) => { const b = screenBox(doc, a, SMALL); return { a, w: b.w, h: Math.min(b.h, b.w * 1.25) }; });
    const altsW = alts.reduce((n, b) => n + b.w, 0) + Math.max(0, alts.length - 1) * 16;
    const col = Math.max(box.w, altsW);
    const mx = x + (col - box.w) / 2;
    const card: [number, number, number, number] | null = told(m) ? [mx + box.w / 2 - CARD_W / 2, TOP + box.h + 12, CARD_W, CARD_H] : null;
    screens.push({ page: m, name: name(m), x: mx, y: TOP, w: box.w, h: box.h, step: i + 1, when: null, back: null, card });
    const from = card ? card[1] + CARD_H : TOP + box.h;
    let bx = x + (col - altsW) / 2;
    for (const b of alts) {
      // Under its step, a state reads by its own name: "Not found", not "Find your order, not found".
      const c = into(b.a);
      const back = links.find((l) => l.page === b.a && main.includes(l.to));
      screens.push({ page: b.a, name: doc.pages[b.a]?.state ?? name(b.a), x: bx, y: low, w: b.w, h: b.h, step: null, when: c?.condition ?? null, back: back ? name(back.to) : null, card: null });
      const cx = mx + box.w / 2, bc = bx + b.w / 2, elbow = from + 14;
      out.push({ from: c?.page ?? m, to: b.a, label: c?.condition ?? words(doc, c?.node ?? ""), when: !!c?.condition, points: [[cx, from], [cx, elbow], [bc, elbow], [bc, low - 50]], at: [bc, low - 30] });
      lowH = Math.max(lowH, b.h);
      bx += b.w + 16;
    }
    x += col + GAP;
  });
  // The usual path's arrows, from each step to the next, named by what the person taps.
  for (let i = 0; i + 1 < main.length; i++) {
    const a = screens.find((s) => s.page === main[i]), b = screens.find((s) => s.page === main[i + 1]);
    const c = links.find((l) => l.page === main[i] && l.to === main[i + 1] && !l.condition);
    if (!a || !b || !c) continue;
    const y = TOP + 64;
    out.push({ from: a.page, to: b.page, label: words(doc, c.node), when: false, points: [[a.x + a.w, y], [b.x, y]], at: [(a.x + a.w + b.x) / 2, y - 22] });
  }
  return {
    // The ways back sit under the other screens: 24 more.
    id: f.id, name: f.name, width: x - GAP + PAD, height: (lowH ? low + lowH + 24 : TOP + mainH) + PAD, screens, links: out,
    moves: links.map((l) => ({ from: l.page, to: l.to, label: words(doc, l.node), when: l.condition ?? null })),
    lanes: j?.lanes ?? [], journey: (j?.steps ?? []).map((s) => ({ page: s.page, confidence: s.confidence ?? null, cells: s.cells })),
  };
}

/** A plan's changes as a person reads them: what it adds or removes, by name. */
function planJson(arch: Architecture, id: Id): TabletPlan {
  const plan = arch.plans[id];
  const changes: TabletPlan["changes"] = [];
  const name = (x: Id) => arch.parts[x]?.name ?? x;
  for (const c of ARCH_COLLECTIONS) {
    for (const x of Object.values(arch[c]) as { id: Id; plan?: Id; status?: string; name?: string; about?: string }[]) {
      if (x.plan !== id || c === "plans") continue;
      const change = x.status === "removed" ? "remove" : "add";
      if (c === "parts") {
        const p = arch.parts[x.id];
        changes.push({ id: x.id, change, title: `${p?.name ?? x.id}, a ${p?.kind ?? "part"}`, detail: p?.about ?? p?.tech ?? "" });
      } else if (c === "links") {
        const k = arch.links[x.id];
        changes.push({ id: x.id, change, title: k ? `${name(k.from)} ${k.kind} ${name(k.to)}` : x.id, detail: k?.carries ?? "" });
      } else {
        changes.push({ id: x.id, change, title: x.name ?? x.id, detail: x.about ?? c.replace(/s$/, "") });
      }
    }
  }
  return { id, name: plan?.name ?? id, issue: plan?.issue ?? null, about: plan?.about ?? null, changes };
}

export function tabletDesign(doc: Doc, file: string): TabletDesign {
  const arch = architectureOf(doc);
  const marks = Object.values(doc.comments).filter((c) => c.ink && c.state !== "resolved")
    .sort((a, b) => (a.posts[0]?.at ?? "").localeCompare(b.posts[0]?.at ?? "") || a.id.localeCompare(b.id));
  const body = {
    file,
    name: file.split("/").pop()?.replace(/\.buni$/, "") ?? file,
    levels: { context: mapJson(layoutFor(arch, "context", undefined)), system: mapJson(layoutFor(arch, "system", undefined)) },
    api: apiJson(arch),
    pages: pagesInOrder(doc).filter((p) => p.state === undefined && !p.terminal).map((p) => ({
      id: p.id, name: p.name, route: p.route ?? null, width: widthOf(doc, p.id), marks: marks.filter((c) => c.ink?.page === p.id).length,
    })),
    flows: Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1)).map((f) => flowJson(doc, f)),
    marks: marks.map((c) => markJson(doc, c)),
    plans: Object.keys(arch.plans).map((id) => planJson(arch, id)),
  };
  // The same design gives the same number, so the tablet can skip redrawing what hasn't moved.
  return { ...body, version: Number(BigInt(Bun.hash(JSON.stringify(body))) % 2_000_000_000n) };
}

/**
 * A page's drawing's ETag: what the page draws from, hashed. That is the design less its comments (pen marks), its
 * architecture and plans, its links and flows, and the other pages' layers, so drawing a mark, merging a plan or
 * editing another screen doesn't redraw this one. Components, tokens and the rest are kept: the page may use them.
 */
export function pageTag(doc: Doc, page: Id): string {
  const others = new Set<Id>();
  for (const p of Object.values(doc.pages)) if (p.id !== page) for (const n of subtree(doc, p.frame)) others.add(n.id);
  const { comments: _c, architecture: _a, pages: _p, nodes, connections: _k, flows: _f, journeys: _j, ...rest } = doc;
  const look = { ...rest, page: doc.pages[page], nodes: Object.values(nodes).filter((n) => !others.has(n.id)) };
  return `"${BigInt(Bun.hash(JSON.stringify(look))).toString(36)}-${page}"`;
}

/** Every page the tablet shows a picture of, in the order it's seen: Home's four, the flows' screens, the rest (states too: the canvas shows them). */
export function tabletPages(doc: Doc, d: TabletDesign): Id[] {
  const pages = d.pages.map((p) => p.id);
  return [...new Set([...pages.slice(0, 4), ...d.flows.flatMap((f) => f.screens.map((s) => s.page)), ...pagesInOrder(doc).map((p) => p.id)])];
}

/** The Screens canvas, laid out as the editor lays it out: every page in its row, the rows' titles, and the links. */
export interface TabletCanvas {
  width: number;
  height: number;
  /** Where the editor's canvas 0, 0 is in these units: a sketch's points (the editor's) plus this. */
  origin: [number, number];
  boards: { page: Id; name: string; x: number; y: number; w: number; h: number }[];
  titles: { x: number; y: number; name: string; pages: number }[];
  /** `d` is an SVG path (M, V, H, Q); `dot` is where it leaves the tapped layer; `at` is where its label sits. */
  links: { id: Id; from: Id; to: Id; label: string; d: string; dot: [number, number]; at: [number, number] }[];
}

/** Room left of the rows for their titles, and above them for the links' lanes. */
const MARGIN = 280;

/** What a page drawing tells the layout: how tall the page came out, and where each layer sits on it. */
export interface PageShot { height: number; targets: { id: Id; x: number; y: number; width: number; height: number }[] }

export function tabletCanvas(doc: Doc, shots: ReadonlyMap<Id, PageShot>): TabletCanvas {
  const heights = new Map([...shots].map(([id, s]) => [id, s.height]));
  const at = placement(doc, heights);
  const pages = pagesInOrder(doc).filter((p) => at.has(p.id));
  // Sketches of new screens sit on the canvas too: room for them as for pages.
  const sketched = Object.values(doc.comments).filter((c) => c.ink?.sketch && c.state !== "resolved").map((c) => inkBox(c.ink?.strokes ?? []));
  const xs = [...pages.map((p) => at.get(p.id)?.x ?? 0), ...sketched.map((b) => b.x)], ys = [...pages.map((p) => at.get(p.id)?.y ?? 0), ...sketched.map((b) => b.y)];
  // Moved so the canvas starts at 0, 0 with room for titles and lanes: the tablet's units start there.
  const dx = MARGIN - Math.min(0, ...xs), dy = MARGIN - Math.min(0, ...ys);
  const boards = pages.map((p) => {
    const pt = at.get(p.id) ?? { x: 0, y: 0 };
    return { page: p.id, name: p.name, x: pt.x + dx, y: pt.y + dy, w: widthOf(doc, p.id), h: heights.get(p.id) ?? 900 };
  });
  const box = new Map(boards.map((b) => [b.page, b]));
  const arrows: Arrow[] = [];
  for (const c of Object.values(doc.connections)) {
    const from = box.get(c.page), to = box.get(c.to);
    if (!from || !to || c.page === c.to) continue;
    const t = shots.get(c.page)?.targets.find((x) => x.id === c.node);
    arrows.push({ id: c.id, from: c.page, to: c.to, label: linkLabel(doc, c), x: from.x + (t ? t.x + t.width / 2 : from.w / 2), y: from.y + (t?.y ?? 0),
      ex: from.x + (t ? t.x + t.width : from.w / 2), ey: from.y + (t ? t.y + t.height / 2 : 24), sy: from.y, sb: from.y + from.h, sr: from.x + from.w, tx: to.x, ty: to.y });
  }
  return {
    width: Math.max(0, ...boards.map((b) => b.x + b.w), ...sketched.map((b) => b.x + b.w + dx)) + MARGIN / 2,
    height: Math.max(0, ...boards.map((b) => b.y + b.h), ...sketched.map((b) => b.y + b.h + dy)) + MARGIN / 2,
    origin: [dx, dy],
    boards,
    titles: rowTitles(doc, at).map((t) => ({ x: t.x + dx, y: t.y + dy, name: t.name, pages: t.pages })),
    links: routeAll(arrows, 1).map((r) => ({ id: r.a.id, from: r.a.from, to: r.a.to, label: r.a.label, d: r.d, dot: [r.a.ex, r.a.ey], at: [r.lx, r.ly] })),
  };
}
