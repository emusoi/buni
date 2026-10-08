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
