import { pagesInOrder, type Doc, type Id } from "buni/format/doc.ts";
import type { SystemSelection, SystemView } from "./system.ts";

export type Hit =
  | { kind: "page"; id: Id; title: string; detail: string }
  | { kind: "flow"; id: Id; title: string; detail: string }
  | { kind: "component"; id: Id; title: string; detail: string }
  | { kind: "layer"; id: Id; page: Id; title: string; detail: string }
  /** Something in the system or the plan: opens the view that shows it, with it selected. */
  | { kind: "system"; id: Id; select: SystemSelection; view: SystemView; icon: "part" | "call" | "table" | "requirement" | "question"; title: string; detail: string };

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

/** Pages, flows, layers and (given the system) parts, calls, tables, requirements and questions matching the query, best first; an empty query lists pages and flows. */
export function search(doc: Doc, query: string, limit = 40, system?: Doc): Hit[] {
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
  if (q && system) {
    const add = (hit: Hit, ...texts: string[]) => {
      const s = Math.max(...texts.map((t) => score(t, q)));
      if (s) scored.push({ hit, s: s + 0.15 });
    };
    for (const p of Object.values(system.parts)) add({ kind: "system", id: p.id, select: { kind: "part", id: p.id }, view: "map", icon: "part", title: p.name, detail: `${p.kind}${p.tech ? ` · ${p.tech}` : ""}` }, p.name, p.tech ?? "");
    for (const e of Object.values(system.endpoints)) add({ kind: "system", id: e.id, select: { kind: "endpoint", id: e.id }, view: "api", icon: "call", title: `${e.method} ${e.path}`, detail: e.summary }, e.path, e.summary);
    for (const o of Object.values(system.operations)) add({ kind: "system", id: o.id, select: { kind: "operation", id: o.id }, view: "api", icon: "call", title: `${o.kind} ${o.name}`, detail: o.summary }, o.name, o.summary);
    for (const t of Object.values(system.tables)) add({ kind: "system", id: t.id, select: { kind: "table", id: t.id }, view: "data", icon: "table", title: t.name, detail: `table in ${system.parts[t.store]?.name ?? t.store}` }, t.name);
    for (const r of Object.values(system.requirements)) add({ kind: "system", id: r.id, select: { kind: "requirement", id: r.id }, view: "requirements", icon: "requirement", title: r.title, detail: `requirement · ${r.priority}` }, r.title);
    for (const x of Object.values(system.questions)) add({ kind: "system", id: x.id, select: { kind: "question", id: x.id }, view: "questions", icon: "question", title: x.text, detail: x.kind === "assumption" ? "assumption" : x.status === "open" ? "open question" : "decided" }, x.text);
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.hit);
}
