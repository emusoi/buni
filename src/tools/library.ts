import { childrenOf, type Doc, type Id, type Node, type SharedSection } from "../format/doc.ts";

/** Layers of a component in a fixed order, so two components with the same shape pair up layer by layer. */
export function layersOf(doc: Doc, root: Id): Node[] {
  const out: Node[] = [];
  const walk = (id: Id) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push(n);
    for (const c of childrenOf(doc, id)) walk(c.id);
  };
  walk(root);
  return out;
}

/** Same kinds and tags in the same tree: overrides and links can move from one to the other. */
export function shapeOf(doc: Doc, root: Id): string {
  return layersOf(doc, root)
    .map((n) => `${n.kind}:${n.tag ?? ""}:${childrenOf(doc, n.id).length}`)
    .join("|");
}

/** Style differences between two same-shaped components, as short "property value" notes. */
export function differences(doc: Doc, keep: SharedSection, other: SharedSection): string[] {
  const a = layersOf(doc, keep.root);
  const b = layersOf(doc, other.root);
  const out: string[] = [];
  a.forEach((x, i) => {
    const y = b[i];
    if (!y) return;
    for (const k of new Set([...Object.keys(x.style), ...Object.keys(y.style)])) {
      if (x.style[k] !== y.style[k]) out.push(`${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${y.style[k] ?? "unset"}`);
    }
  });
  return out;
}

export interface DuplicateGroup {
  /** The one to keep: the most used, else the grouped one. */
  keep: Id;
  others: { id: Id; differences: string[] }[];
}

export interface LibraryReport {
  unused: Id[];
  duplicates: DuplicateGroup[];
  /** Components with no "Group / " in their name. */
  ungrouped: Id[];
}

/** Style differences at or under this count make two same-shaped components near-duplicates. */
const NEAR = 4;

export function usesOf(doc: Doc, shared: Id): number {
  return Object.values(doc.nodes).filter((n) => n.kind === "instance" && n.shared === shared).length;
}

/** What a big library needs attention on: unused components, near-duplicates to merge, and ones without a group. */
export function libraryReport(doc: Doc): LibraryReport {
  const all = Object.values(doc.shared).sort((a, b) => (a.id < b.id ? -1 : 1));
  const byShape = new Map<string, SharedSection[]>();
  for (const s of all) byShape.set(shapeOf(doc, s.root), [...(byShape.get(shapeOf(doc, s.root)) ?? []), s]);
  const duplicates: DuplicateGroup[] = [];
  for (const all of byShape.values()) {
    // Variants with properties look alike on purpose; they are a set, not duplicates.
    const group = all.filter((x) => !x.variant);
    if (group.length < 2) continue;
    // Keep the most used; on a tie, the one already filed under a group.
    const grouped = (x: SharedSection) => (x.name.includes("/") ? 0 : 1);
    const sorted = [...group].sort((a, b) => usesOf(doc, b.id) - usesOf(doc, a.id) || grouped(a) - grouped(b) || (a.id < b.id ? -1 : 1));
    const [keep, ...rest] = sorted;
    if (!keep) continue;
    const others = rest.map((s) => ({ id: s.id, differences: differences(doc, keep, s) })).filter((o) => o.differences.length <= NEAR);
    if (others.length) duplicates.push({ keep: keep.id, others });
  }
  return {
    unused: all.filter((s) => usesOf(doc, s.id) === 0).map((s) => s.id),
    duplicates,
    ungrouped: all.filter((s) => !s.name.includes("/")).map((s) => s.id),
  };
}

/** Layers copied around the design: one shape, several places, none of them a component's use yet. */
export interface RepeatGroup {
  /** The copies' outermost layers, in page order. */
  nodes: Id[];
  /** Layers in each copy. */
  layers: number;
  /** Pages the copies are on. */
  pages: Id[];
  /** A component with the same shape, which the copies could be uses of. */
  component?: Id;
}

/** Below this many layers a repeat is a detail (a list item, a label), not something to make a component of. */
export const REPEAT_MIN = 8;

/** Every layer that sits on a page, outside any component's source, with the page it is on. */
function pageLayers(doc: Doc): Map<Id, Id> {
  const on = new Map<Id, Id>();
  for (const p of Object.values(doc.pages)) {
    const walk = (id: Id) => {
      on.set(id, p.id);
      for (const c of childrenOf(doc, id)) walk(c.id);
    };
    walk(p.frame);
  }
  return on;
}

/**
 * Copies worth a component: the same shape of at least `min` layers in two or more places, outermost first, with
 * none inside another copy. A screen's state copies (twins) don't count: make_component turns those into uses itself.
 */
export function findRepeats(doc: Doc, min = REPEAT_MIN): RepeatGroup[] {
  const on = pageLayers(doc);
  const frames = new Set(Object.values(doc.pages).map((p) => p.frame));
  const size = new Map<Id, number>();
  const count = (id: Id): number => {
    const known = size.get(id);
    if (known !== undefined) return known;
    const n = 1 + childrenOf(doc, id).reduce((s, c) => s + count(c.id), 0);
    size.set(id, n);
    return n;
  };
  const byShape = new Map<string, Id[]>();
  for (const id of on.keys()) {
    const n = doc.nodes[id];
    if (!n || frames.has(id) || n.twin !== undefined || count(id) < min) continue;
    if (layersOf(doc, id).some((x) => x.kind === "instance")) continue;
    const shape = shapeOf(doc, id);
    byShape.set(shape, [...(byShape.get(shape) ?? []), id]);
  }
  const components = new Map(Object.values(doc.shared).map((s) => [shapeOf(doc, s.root), s.id]));
  const groups = [...byShape.entries()]
    .filter(([shape, ids]) => ids.length >= 2 || components.has(shape))
    .map(([shape, ids]) => ({ shape, ids }))
    .sort((a, b) => count(b.ids[0] ?? "") - count(a.ids[0] ?? ""));
  // Outermost only: a group whose copies all sit inside bigger copies is already covered by them.
  const taken = new Set<Id>();
  const out: RepeatGroup[] = [];
  for (const g of groups) {
    const free = g.ids.filter((id) => !taken.has(id));
    const component = components.get(g.shape);
    if (free.length < 2 && !(component && free.length >= 1)) continue;
    for (const id of free) for (const n of layersOf(doc, id)) taken.add(n.id);
    const pageOrder = Object.values(doc.pages).sort((a, b) => (a.index < b.index ? -1 : 1)).map((p) => p.id);
    const nodes = free.sort((a, b) => pageOrder.indexOf(on.get(a) ?? "") - pageOrder.indexOf(on.get(b) ?? ""));
    out.push({ nodes, layers: count(free[0] ?? ""), pages: [...new Set(nodes.map((id) => on.get(id) ?? ""))], ...(component ? { component } : {}) });
  }
  return out;
}

/** What an edit just copied: the written layers that match a component or a copy elsewhere, as hints for its author. */
export function copyHints(doc: Doc, written: readonly Id[]): string[] {
  const mine = new Set(written);
  const name = (id: Id) => doc.pages[id]?.name ?? id;
  return findRepeats(doc).flatMap((g) => {
    const fresh = g.nodes.filter((id) => mine.has(id));
    if (!fresh.length) return [];
    const component = g.component ? doc.shared[g.component] : undefined;
    if (component) return [`${fresh.join(", ")} has the shape of the component "${component.name}" (${component.id}): place_component it instead, or componentize to make every copy a use.`];
    const others = g.nodes.filter((id) => !mine.has(id));
    if (!others.length) return [];
    return [`${fresh.join(", ")} copies ${g.layers} layers that are also on ${g.pages.map(name).join(", ")}: componentize {"nodes": ${JSON.stringify(g.nodes)}, "name": "Group / Name"} makes them one component, so a change is made once.`];
  });
}
