// The components view of buni open: every component drawn, its variants and where it is used, and the layers copied
// around the design that are not components yet. Drawn after designs/viewer.buni ("Viewer · Components").
import { pagesInOrder, setOf, variantProperties, type Doc, type Id, type SharedSection } from "../format/doc.ts";
import { fontFaces, renderComponent } from "../tools/html.ts";
import { findRepeats, layersOf } from "../tools/library.ts";
import { esc, goRow, head, icon, note, pageOfNode, section, type SystemSnapshot, type SystemView } from "./system.ts";

/** Where each component is used: the page and the instance layer, so the canvas can outline it. */
export type Uses = Record<Id, { page: Id; node: Id }[]>;

const group = (s: SharedSection) => (s.name.lastIndexOf("/") > 0 ? s.name.slice(0, s.name.lastIndexOf("/")).trim() : "");
const short = (s: SharedSection) => (s.name.lastIndexOf("/") > 0 ? s.name.slice(s.name.lastIndexOf("/") + 1).trim() : s.name);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A component as a document for a preview frame; the browser measures it and scales it to fit its card. */
function previewDoc(doc: Doc, id: Id): string {
  const { html, css } = renderComponent(doc, id);
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
  const pagesOf = (id: Id) => [...new Set((uses[id] ?? []).map((u) => u.page))].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const cards = comps.map((s) => {
    const n = uses[s.id]?.length ?? 0;
    const variants = s.variant ? Object.values(s.variant) : [];
    const where = n ? `On ${plural(pagesOf(s.id).length, "page")} · ${plural(n, "place")}` : "Not used yet";
    return `<div class="comp" data-ref="component:${esc(s.id)}">${preview(doc, s.id)}<div class="cname">${group(s) ? `<span>${esc(group(s))}</span>` : ""}<b>${esc(short(s))}</b><small>${where}</small></div>${variants.length ? `<div class="tags left">${variants.map((v) => `<span class="tag">${esc(v)}</span>`).join("")}</div>` : ""}</div>`;
  });
  const rows = repeats.map((g, i) => {
    const first = doc.nodes[g.nodes[0] ?? ""];
    const like = g.component ? ` · same shape as ${esc(doc.shared[g.component]?.name ?? "")}` : "";
    return `<div class="repeat" data-ref="repeat:${i}"><div class="rmain"><b>${esc(first?.name ?? "Layers")} · ${g.layers} layers</b><small>${plural(g.nodes.length, "copy", "copies")} · ${esc(g.pages.map(pageName).join(", "))}${like}</small></div><code>ask your agent to componentize it</code></div>`;
  });
  const total = Object.values(uses).reduce((n, u) => n + u.length, 0);
  const html = `<div class="sheetview"><div class="vhead"><h1>Components</h1><span>${comps.length} · placed ${plural(total, "time")} across ${plural(new Set(Object.values(uses).flat().map((u) => u.page)).size, "page")}</span></div>`
    + (cards.length ? `<div class="comps">${cards.join("")}</div>` : `<p class="dnote">No components yet.</p>`)
    + (rows.length ? `<div class="vhead sub"><h2>Repeated, not components yet</h2><span>the same layers copied across pages; one change has to be made in every copy</span></div>${rows.join("")}` : "")
    + `</div>`;
  snapshot.views.push({ id: "components", name: "Components", group: "screens", icon: icon("component"), count: comps.length, canvas: false, html } satisfies SystemView);

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
      + section("Used on", per.join("") || note("Nothing uses it yet."), per.length)
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
