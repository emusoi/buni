// A page as one of its versions had it: the design with that page's layers swapped for the version's, to draw it.
import { childrenOf, type Doc, type Id, type Node, type PageVersion } from "buni/format/doc.ts";

/** `doc` with `v`'s page drawn as it was then: the page's layers now are set aside, the version's take their place. */
export function docAtVersion(doc: Doc, v: PageVersion): Doc {
  const frame = doc.pages[v.page]?.frame;
  const gone = new Set<Id>();
  const walk = (id: Id) => { gone.add(id); for (const c of childrenOf(doc, id)) walk(c.id); };
  if (frame) walk(frame);
  const nodes = { ...Object.fromEntries(Object.entries(doc.nodes).filter(([id]) => !gone.has(id))), ...v.nodes };
  return { ...doc, nodes };
}

export interface VersionDiff {
  /** On the page now, not in the version. */
  added: Node[];
  /** In the version, gone from the page. */
  removed: Node[];
  /** In both, different: what differs, in a word or two. */
  changed: { node: Node; what: string }[];
}

/** What is different between the page now and one of its versions, layer by layer. */
export function diffVersion(doc: Doc, v: PageVersion): VersionDiff {
  const frame = doc.pages[v.page]?.frame;
  const now = new Map<Id, Node>();
  const walk = (id: Id) => { const n = doc.nodes[id]; if (!n) return; now.set(id, n); for (const c of childrenOf(doc, id)) walk(c.id); };
  if (frame) walk(frame);
  const added = [...now.values()].filter((n) => !v.nodes[n.id]);
  const removed = Object.values(v.nodes).filter((n) => !now.has(n.id));
  const changed: { node: Node; what: string }[] = [];
  for (const then of Object.values(v.nodes)) {
    const n = now.get(then.id);
    if (!n) continue;
    const what: string[] = [];
    if (n.kind === "text" && then.kind === "text" && n.text !== then.text) what.push("text");
    if (n.name !== then.name) what.push("name");
    if (n.parent !== then.parent || n.index !== then.index) what.push("moved");
    const keys = new Set([...Object.keys(n.style), ...Object.keys(then.style)]);
    const styles = [...keys].filter((k) => n.style[k] !== then.style[k]);
    if (styles.length) what.push(styles.slice(0, 3).join(", ") + (styles.length > 3 ? "…" : ""));
    if (JSON.stringify({ ...n, style: 0, text: 0, name: 0, parent: 0, index: 0 }) !== JSON.stringify({ ...then, style: 0, text: 0, name: 0, parent: 0, index: 0 })) what.push("more");
    if (what.length) changed.push({ node: n, what: what.join(" · ") });
  }
  return { added, removed, changed };
}

/** Outlines for a board: on the version, what is gone or different since; on the page, what is new or different. */
export function diffCss(d: VersionDiff, side: "then" | "now"): string {
  const ids = side === "then" ? [...d.removed, ...d.changed.map((c) => c.node)] : [...d.added, ...d.changed.map((c) => c.node)];
  return ids.map((n) => `.b-${n.id}{outline:2px solid #3346d3;outline-offset:2px}`).join("");
}
