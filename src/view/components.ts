// The components view of buni open: every component drawn, its variants and where it is used, and the layers copied
// around the design that are not components yet. Drawn after designs/viewer.buni ("Viewer · Components").
import { pagesInOrder, setOf, variantProperties, type Doc, type Id, type SharedSection } from "../format/doc.ts";
import { fontFaces, renderComponent, renderLayer } from "../tools/html.ts";
import { findRepeats, layersOf } from "../tools/library.ts";
import { esc, goRow, head, icon, note, pageOfNode, section, type SystemSnapshot, type SystemView } from "./system.ts";

/** Where each component is used: the page and the instance layer, so the canvas can outline it. */
export type Uses = Record<Id, { page: Id; node: Id }[]>;

const group = (s: SharedSection) => (s.name.lastIndexOf("/") > 0 ? s.name.slice(0, s.name.lastIndexOf("/")).trim() : "");
const short = (s: SharedSection) => (s.name.lastIndexOf("/") > 0 ? s.name.slice(s.name.lastIndexOf("/") + 1).trim() : s.name);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A component, or a copied layer, as a document for a frame; the browser measures it to size its board. */
function previewDoc(doc: Doc, id: Id, layer?: { page: Id; node: Id }): string {
  const { html, css } = layer ? renderLayer(doc, layer.page, layer.node) : renderComponent(doc, id);
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{display:inline-block;max-width:1280px}${fontFaces(doc, (f) => `/fonts/${encodeURIComponent(f)}`)}${css}</style></head><body>${html}</body></html>`;
}
const preview = (doc: Doc, id: Id, big = false) =>
  `<div class="cprev${big ? " big" : ""}"><iframe sandbox="allow-same-origin" tabindex="-1" srcdoc="${esc(previewDoc(doc, id))}"></iframe></div>`;

export function usesOfAll(doc: Doc): Uses {
  const pageOf = pageOfNode(doc);
  const out: Uses = {};
  for (const n of Object.values(doc.nodes)) {
    if (n.kind !== "instance") continue;
    const page = pageOf(n.id);
    if (page) (out[n.shared] ??= []).push({ page, node: n.id });
  }
  return out;
}

/** The Components view and the details it opens; nothing when the design has no components and copies nothing. */
export function componentsOf(doc: Doc): { snapshot: SystemSnapshot; uses: Uses } {
  const uses = usesOfAll(doc);
  const comps = Object.values(doc.shared).sort((a, b) => a.name.localeCompare(b.name));
  const repeats = findRepeats(doc);
  const snapshot: SystemSnapshot = { views: [], details: {}, where: {}, names: {} };
  if (!comps.length && !repeats.length) return { snapshot, uses };
  const pageName = (id: Id) => doc.pages[id]?.name ?? id;
  const order = pagesInOrder(doc).map((p) => p.id);
  // Components used inside other components, by the component they sit in.
  const roots = new Map(comps.map((c) => [c.root, c.id]));
  const inside = new Map<Id, Set<Id>>();
  for (const n of Object.values(doc.nodes)) {
    if (n.kind !== "instance") continue;
    let top: Id = n.id;
    for (let i = 0, up = n.parent; up !== undefined && i < 256; i++) {
      top = up;
      up = doc.nodes[up]?.parent;
    }
    const outer = roots.get(top);
    if (outer) inside.set(n.shared, (inside.get(n.shared) ?? new Set()).add(outer));
  }
  const pagesOf = (id: Id) => [...new Set((uses[id] ?? []).map((u) => u.page))].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  // On a canvas like the pages: each component at its own size, in a row per group; the copies in a row of their own.
  const board = (ref: string, title: string, meta: string, frame: string, copy = false) =>
    `<div class="cboard${copy ? " copy" : ""}" data-ref="${esc(ref)}"><div class="clabel"><b>${esc(title)}</b><span>${esc(meta)}</span></div><div class="csheet"><iframe sandbox="allow-same-origin" tabindex="-1" srcdoc="${esc(frame)}"></iframe></div></div>`;
  const groups = new Map<string, SharedSection[]>();
  for (const s of comps) groups.set(group(s) || "Components", [...(groups.get(group(s) || "Components") ?? []), s]);
  const rowsHtml = [...groups].map(([g, list]) => `<section class="crow" data-title="${esc(g)}">${list.map((s) => {
    const n = uses[s.id]?.length ?? 0;
    const holders = inside.get(s.id)?.size ?? 0;
    const meta = [n ? `${plural(pagesOf(s.id).length, "page")} · ${plural(n, "place")}` : "", holders ? `in ${plural(holders, "component")}` : ""].filter(Boolean).join(" · ") || "not used";
    return board(`component:${s.id}`, s.variant ? `${short(s)} · ${Object.values(s.variant).join(", ")}` : short(s), meta, previewDoc(doc, s.id));
  }).join("")}</section>`);
  const pageOfCopy = pageOfNode(doc);
  const copiesHtml = repeats.length
    ? `<section class="crow" data-title="Copied, not components yet">${repeats.map((g, i) => {
      const first = g.nodes[0] ?? "";
      const page = pageOfCopy(first) ?? "";
      return board(`repeat:${i}`, `${doc.nodes[first]?.name ?? "Layers"} · ${g.layers} layers`, `${plural(g.nodes.length, "copy", "copies")} · ${g.pages.map(pageName).join(", ")}`, previewDoc(doc, "", { page, node: first }), true);
    }).join("")}</section>`
    : "";
  const html = `<div class="pan"><div class="world cworld" data-w="1200" data-h="800">${rowsHtml.join("")}${copiesHtml}</div></div>`;
  snapshot.views.push({ id: "components", name: "Components", group: "screens", icon: icon("component"), count: comps.length, canvas: true, html } satisfies SystemView);

  for (const s of comps) {
    const ref = `component:${s.id}`;
    const set = setOf(doc, s.id);
    const props = variantProperties(set);
    const per = pagesOf(s.id).map((p) => {
      const k = (uses[s.id] ?? []).filter((u) => u.page === p).length;
      return goRow(`page:${p}`, esc(pageName(p)), plural(k, "place"));
    });
    // What the uses change, layer by layer: "Title: words on 3 uses".
    const changed = new Map<Id, { words: number; looks: number; icon: number }>();
    for (const u of uses[s.id] ?? []) {
      const inst = doc.nodes[u.node];
      if (inst?.kind !== "instance") continue;
      for (const [layer, o] of Object.entries(inst.overrides)) {
        const c = changed.get(layer) ?? { words: 0, looks: 0, icon: 0 };
        if (o.text !== undefined) c.words++;
        if (o.style || o.at) c.looks++;
        if (o.markup !== undefined) c.icon++;
        changed.set(layer, c);
      }
    }
    const changes = [...changed].map(([layer, c]) => {
      const what = [c.words ? `words on ${plural(c.words, "use")}` : "", c.looks ? `looks on ${plural(c.looks, "use")}` : "", c.icon ? `icon on ${plural(c.icon, "use")}` : ""].filter(Boolean).join(", ");
      return `<div class="drow"><span class="l">${esc(doc.nodes[layer]?.name ?? layer)}</span><span class="r">${esc(what)}</span></div>`;
    });
    // A group of components isn't a set of variants unless they say which variant each is.
    const variants = s.variant && set.filter((v) => v.variant).length > 1 ? set.filter((v) => v.variant).map((v) => goRow(`component:${v.id}`, esc(short(v)), v.variant ? esc(Object.entries(v.variant).map(([k, x]) => `${k} ${x}`).join(", ")) : "")) : [];
    const tag = `<span class="kind" style="color:var(--ink-2)">${icon("component", 13)}component${group(s) ? ` · ${esc(group(s))}` : ""}</span>`;
    snapshot.details[ref] = head(tag, short(s), `${plural(layersOf(doc, s.root).length, "layer")}${props.length ? ` · ${props.map(([k, vs]) => `${k}: ${vs.join(", ")}`).join("; ")}` : ""}`)
      + `<div class="dprev">${preview(doc, s.id, true)}</div>`
      + section("Variants", variants.join(""), variants.length || undefined)
      + section("Used on", per.join("") || note(inside.has(s.id) ? "No page uses it directly." : "Nothing uses it yet."), per.length)
      + section("Inside", [...(inside.get(s.id) ?? [])].map((o) => goRow(`component:${o}`, esc(doc.shared[o]?.name ?? o), "component")).join(""), inside.get(s.id)?.size)
      + section("Changed per use", changes.join(""), changes.length || undefined)
      + ((uses[s.id] ?? []).length ? section("Show on the pages", goRow(`uses:${s.id}`, "Outline every place it is used")) : "");
    snapshot.where[ref] = "components";
    snapshot.names[ref] = s.name;
  }
  repeats.forEach((g, i) => {
    const ref = `repeat:${i}`;
    const first = doc.nodes[g.nodes[0] ?? ""];
    const pageOf = pageOfNode(doc);
    const ask = g.component
      ? `componentize {"nodes": ${JSON.stringify(g.nodes)}, "component": "${g.component}"}`
      : `componentize {"nodes": ${JSON.stringify(g.nodes)}, "name": "Group / Name"}`;
    snapshot.details[ref] = head(`<span class="kind" style="color:#b45309">${icon("copy", 13)}copied ${plural(g.nodes.length, "time")}</span>`, first?.name ?? "Layers", plural(g.layers, "layer"), "The same layers in several places. As a component, a change to it would change every one.")
      + section("Copies", g.nodes.map((id) => goRow(`page:${pageOf(id) ?? ""}`, esc(pageName(pageOf(id) ?? "")), esc(id))).join(""), g.nodes.length)
      + (g.component ? section("Same shape as", goRow(`component:${g.component}`, esc(doc.shared[g.component]?.name ?? g.component), "component")) : "")
      + section("Ask your agent", `<pre class="ask">${esc(ask)}</pre>${note("buni call FILE " + ask.replace(" {", " '{") + "'")}`);
    snapshot.where[ref] = "components";
    snapshot.names[ref] = `${first?.name ?? "Layers"} copies`;
  });
  return { snapshot, uses };
}
