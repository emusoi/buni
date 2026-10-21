import { pagesInOrder, type Doc, type Id } from "buni/format/doc.ts";

export type Hit =
  | { kind: "page"; id: Id; title: string; detail: string }
  | { kind: "flow"; id: Id; title: string; detail: string }
  | { kind: "component"; id: Id; title: string; detail: string }
  | { kind: "layer"; id: Id; page: Id; title: string; detail: string };

/** The page a node is drawn on, if any; shared section sources belong to none. */
export function pageOfNode(doc: Doc, id: Id): Id | undefined {
  let n = doc.nodes[id];
  for (let guard = 0; n?.parent !== undefined && guard < 1000; guard++) n = doc.nodes[n.parent];
  return n && Object.values(doc.pages).find((p) => p.frame === n?.id)?.id;
}

/** 2 for a word that starts with the query, 1 for anywhere, 0 for no match. */
function score(text: string, q: string): number {
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i < 0) return 0;
  return i === 0 || /\W/.test(t[i - 1] ?? "") ? 2 : 1;
}

/** Pages, flows, components and layers matching the query, best first; an empty query lists pages, flows and components. */
export function search(doc: Doc, query: string, limit = 40): Hit[] {
  const q = query.trim().toLowerCase();
  const scored: { hit: Hit; s: number }[] = [];
  for (const p of pagesInOrder(doc)) {
    const s = q ? Math.max(score(p.name, q), score(p.route ?? "", q)) : 1;
    if (s) scored.push({ hit: { kind: "page", id: p.id, title: p.name, detail: p.route ?? "graphic" }, s: s + 0.2 });
  }
  for (const f of Object.values(doc.flows)) {
    const s = q ? score(f.name, q) : 1;
    if (s) scored.push({ hit: { kind: "flow", id: f.id, title: f.name, detail: "flow" }, s: s + 0.1 });
  }
  for (const c of Object.values(doc.shared)) {
    const s = q ? score(c.name, q) : 1;
    if (s) scored.push({ hit: { kind: "component", id: c.id, title: c.name, detail: "component" }, s: s + 0.15 });
  }
  if (q) {
    for (const n of Object.values(doc.nodes)) {
      const page = pageOfNode(doc, n.id);
      if (!page || doc.pages[page]?.frame === n.id) continue;
      const text = n.kind === "text" ? n.text : "";
      const s = Math.max(score(n.name, q), score(text, q));
      if (!s) continue;
      const detail = `${doc.pages[page]?.name ?? ""}${text && text !== n.name ? ` · ${text.length > 60 ? `${text.slice(0, 60)}…` : text}` : ""}`;
      scored.push({ hit: { kind: "layer", id: n.id, page, title: n.name, detail }, s });
    }
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.hit);
}
