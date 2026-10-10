import { sourceRefs } from "../../format/sources.ts";
// Pages and layers: creating pages, writing HTML into them, styles, text, motion, tokens, comments and the canvas. One
// area of buni's design tools (agent/areas.ts); tools.ts gathers them.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { EASINGS, ENTRANCES, MOTION_TRIGGERS, RESPONSES, entersOn, type Motion, childrenOf, statesOf, type TerminalScreen, pagesInOrder, type Id, type Link, type Node, type Page, type Post, type Thread, type Style } from "../../format/doc.ts";
import type { Op } from "../../oplog/oplog.ts";
import { layerHtml, parseHtml, renderPage, snippet, type Draft } from "../html.ts";
import { findIcons } from "../icons.ts";
import { Ids, type Tool, ToolError, body, deleted, draftOps, forget, indexAt, nextIndex, node, page, onTerminal, rootOf, screenStyle, styleValues, subtree, terminalScreen, tool } from "../kit.ts";

export const pagesTools = {
  create_page: tool({
    description:
      "Add a page with an empty root frame. Routes start with / and are unique, except that a screen's states (empty, loading, error, a slow path) " +
      "are pages with the same route and a state name; site export leaves states out. " +
      "Give a height for a fixed-size design such as a logo (512×512), a social post (1080×1080) or a slide (1920×1080); leave it out for a web page that grows with its content. " +
      "Leave out the route for a graphic (a logo, an icon, a post): it is a board of its own, not part of the site, and site export skips it.",
    input: {
      name: z.string(),
      sources: sourceRefs.optional(),
      route: z.string().optional(),
      state: z.string().min(1).optional().describe('A state of the screen at this route: "Empty", "Error", "Label pending"'),
      width: z.number().int().positive().default(1440),
      height: z.number().int().positive().optional(),
      client: z.string().optional().describe("Client part the page belongs to"),
      terminal: terminalScreen.optional().describe("Make it a terminal screen of a terminal client, sized in cells; width and height are then ignored. Read the terminal skill first"),
    },
    run: async (doc, a, ctx) => {
      const ids = new Ids(doc, ctx);
      const pageId = ids.next();
      const frameId = ids.next();
      const last = pagesInOrder(doc).at(-1)?.index ?? null;
      const style: Style = a.terminal
        ? screenStyle(a.terminal)
        : { width: `${a.width}px`, ...(a.height ? { height: `${a.height}px`, overflow: "hidden" } : {}) };
      return {
        label: `Create ${a.terminal ? "screen" : "page"} ${a.name}`,
        ops: [
          { kind: "put", collection: "nodes", value: { id: frameId, kind: "frame", index: "a0", name: a.name, style } },
          {
            kind: "put", collection: "pages",
            value: {
              id: pageId, name: a.name, ...(a.sources?.length ? { sources: a.sources } : {}), ...(a.route !== undefined ? { route: a.route } : {}), ...(a.state !== undefined ? { state: a.state } : {}), frame: frameId, index: generateKeyBetween(last, null),
              ...(a.client !== undefined ? { client: a.client } : {}), ...(a.terminal ? { terminal: a.terminal } : {}),
            },
          },
        ],
        reply: `Created page ${pageId} with root frame ${frameId}.`,
      };
    },
  }),

  duplicate_page: tool({
    description:
      "Copy a page with its layers and links, right after it. Give state to make a state of the same screen (\"Error\", \"Refund retrying\"), " +
      "then change what differs; or give a new route or name for a page of its own.",
    input: {
      page: z.string(),
      name: z.string().min(1).optional().describe('Defaults to the page\'s name, plus the state when there is one'),
      route: z.string().optional().describe("Defaults to the page's route; must differ unless state is given"),
      state: z.string().min(1).optional().describe('A state of the screen: "Empty", "Error", "Refund retrying"'),
    },
    run: async (doc, a, ctx) => {
      const from = page(doc, a.page);
      const ids = new Ids(doc, ctx);
      // Every layer gets a new id; parents follow, so the copy is its own tree.
      const nodes = subtree(doc, from.frame);
      const fresh = new Map(nodes.map((n) => [n.id, ids.next()]));
      const id = (old: Id) => fresh.get(old) ?? old;
      // A state's layers remember the screen's layer they copy, so style changes there reach them; a new page is its own.
      const ops: Op[] = nodes.map((n) => {
        const { twin, ...copy } = structuredClone(n);
        return { kind: "put", collection: "nodes", value: { ...copy, id: id(n.id), ...(n.parent !== undefined ? { parent: id(n.parent) } : {}), ...(a.state ? { twin: twin ?? n.id } : {}) } };
      });
      const pageId = ids.next();
      const next = pagesInOrder(doc)[pagesInOrder(doc).findIndex((p) => p.id === from.id) + 1];
      const name = a.name ?? (a.state ? `${from.name}, ${a.state.charAt(0).toLowerCase()}${a.state.slice(1)}` : `${from.name} copy`);
      const { x: _x, y: _y, state: _s, ...rest } = from;
      ops.push({
        kind: "put", collection: "pages",
        value: { ...rest, id: pageId, name, frame: id(from.frame), index: generateKeyBetween(from.index, next?.index ?? null), ...(a.route !== undefined ? { route: a.route } : {}), ...(a.state ? { state: a.state } : {}) },
      });
      // Its links go where the original's go, from the copied layers.
      for (const c of Object.values(doc.connections)) {
        if (c.page !== from.id || !fresh.has(c.node)) continue;
        ops.push({ kind: "put", collection: "connections", value: { ...c, id: ids.next(), page: pageId, node: id(c.node) } });
      }
      return { label: `Duplicate ${from.name}`, ops, reply: `Created page ${pageId} (${name}) with root frame ${id(from.frame)}; ${nodes.length} layers copied.` };
    },
  }),

  write_html: tool({
    description:
      "Add HTML as nodes under a frame. Inline style=\"\" only; layer-name=\"\" names a layer; " +
      '<img src="asset:ID"> uses an attachment; <buni-instance shared="ID"> places a shared section; ' +
      '<buni-icon name="search" size="16" stroke-width="2" style="color:…"> draws a Lucide icon (find_icons lists names).',
    input: {
      parent: z.string().describe("Frame to insert into"),
      html: z.string(),
      sources: sourceRefs.optional().describe("Source links for the top-level layers being added"),
      after: z.string().optional().describe('Sibling to insert after; "" puts it first; omit to append'),
    },
    run: async (doc, a, ctx) => {
      if (node(doc, a.parent).kind !== "frame") throw new ToolError(`"${a.parent}" is not a frame`);
      const { drafts, warnings } = parseHtml(a.html, { keepSpaces: onTerminal(doc, a.parent) });
      if (drafts.length === 0) throw new ToolError("the HTML produced no nodes");
      if (a.sources?.length) for (const draft of drafts) draft.sources = a.sources;
      const created: Id[] = [];
      const ops = draftOps(new Ids(doc, ctx), drafts, a.parent, indexAt(doc, a.parent, a.after), created, nextIndex(doc, a.parent, a.after));
      const reply = [`Created ${created.length} nodes: ${created.join(", ")}.`, ...warnings.map((w) => `Warning: ${w}`)].join("\n");
      return { label: `Write into ${node(doc, a.parent).name}`, ops, reply };
    },
  }),

  import_html: tool({
    description: "Import prepared, inline-styled HTML as editable layers, either into a parent frame or onto a new page, in one undoable edit. Images use asset: attachment ids; per-element data-buni-sources retains implementation context.",
    input: {
      html: z.string().min(1), parent: z.string().optional(), after: z.string().optional(),
      page: z.object({ name: z.string().min(1), width: z.number().int().positive().default(1440), route: z.string().optional() }).optional(),
    },
    run: async (doc, a, ctx) => {
      if (Boolean(a.parent) === Boolean(a.page)) throw new ToolError("Choose a parent frame or a new page.");
      const { drafts, warnings } = parseHtml(a.html);
      if (!drafts.length) throw new ToolError("No editable elements were found in this selection.");
      const ids = new Ids(doc, ctx);
      const ops: Op[] = [];
      let parent = a.parent;
      let madePage: string | undefined;
      if (a.page) {
        parent = ids.next(); madePage = ids.next();
        ops.push({ kind: "put", collection: "nodes", value: { id: parent, kind: "frame", name: a.page.name, index: "a0", style: { width: `${a.page.width}px` } } });
        ops.push({ kind: "put", collection: "pages", value: { id: madePage, name: a.page.name, frame: parent, index: generateKeyBetween(pagesInOrder(doc).at(-1)?.index ?? null, null), ...(a.page.route !== undefined ? { route: a.page.route } : {}), ...(drafts[0]?.sources ? { sources: drafts[0].sources } : {}) } });
      } else if (!parent || node(doc, parent).kind !== "frame") throw new ToolError("Import into a frame or a new page.");
      if (!parent) throw new ToolError("No destination frame.");
      const created: Id[] = [];
      ops.push(...draftOps(ids, drafts, parent, madePage ? "a0" : indexAt(doc, parent, a.after), created, madePage ? null : nextIndex(doc, parent, a.after)));
      return { label: "Import HTML", ops, reply: `${madePage ? `Created page ${madePage}.\n` : ""}Created ${created.length} nodes: ${created.join(", ")}.\n${warnings.map((w) => `Warning: ${w}`).join("\n")}` };
    },
  }),

  replace_html: tool({
    description:
      "Rewrite a layer as HTML, in the form write_html reads (layer_html gives it). The layer becomes what the HTML " +
      "describes, in the same place; for a page's or component's root frame, the HTML is what goes inside it. Layers " +
      "keep their ids, and so their links, data and comments, when the HTML has one top element (for the layer itself) " +
      "or a layer-name that names one inner layer.",
    input: { node: z.string(), html: z.string() },
    run: async (doc, a, ctx) => {
      const old = node(doc, a.node);
      const isRoot = Object.values(doc.pages).some((p) => p.frame === old.id) || Object.values(doc.shared).some((x) => x.root === old.id);
      const { drafts, warnings } = parseHtml(a.html, { keepSpaces: onTerminal(doc, old.id) });
      if (drafts.length === 0 && !isRoot) throw new ToolError("the HTML produced no layers; use delete_nodes to remove one");
      const before = isRoot ? childrenOf(doc, old.id).flatMap((c) => subtree(doc, c.id)) : subtree(doc, old.id);
      // Each new layer keeps the id of the old layer in its place: walked level by level, matched by kind and tag
      // (a name match first), looking a few layers ahead so an inserted one doesn't shift the rest.
      const match = new Map<Draft, Id>();
      const align = (ds: readonly Draft[], olds: readonly Node[]) => {
        let from = 0;
        for (const d of ds) {
          const same = (o: Node) => o.kind === d.kind && (o.kind === "text" || o.kind === "frame" ? (o.tag ?? (o.kind === "text" ? "p" : "div")) === ("tag" in d ? d.tag ?? (d.kind === "text" ? "p" : "div") : "") : true);
          const window = olds.slice(from, from + 4);
          const hit = window.find((o) => same(o) && o.name === d.name) ?? window.find(same);
          if (!hit) continue;
          match.set(d, hit.id);
          from = olds.indexOf(hit) + 1;
          if (d.kind === "frame") align(d.children, childrenOf(doc, hit.id));
        }
      };
      if (isRoot) align(drafts, childrenOf(doc, old.id));
      else if (drafts.length === 1 && drafts[0]) { match.set(drafts[0], old.id); const d = drafts[0]; if (d.kind === "frame") align(d.children, childrenOf(doc, old.id)); }
      else align(drafts, [old]);
      // What didn't line up keeps an id by a name only one old layer had.
      const byName = new Map<string, Id | null>();
      for (const n of before) if (n.id !== old.id) byName.set(n.name, byName.has(n.name) ? null : n.id);
      const kept = new Set<Id>();
      const idFor = (d: Draft): Id | undefined => {
        const id = match.get(d) ?? byName.get(d.name) ?? undefined;
        if (id === undefined || kept.has(id)) return undefined;
        kept.add(id);
        return id;
      };
      const parent = isRoot ? old.id : old.parent;
      if (parent === undefined) throw new ToolError(`"${a.node}" has no parent`);
      const siblings = childrenOf(doc, parent);
      const at = siblings.findIndex((x) => x.id === old.id);
      const first = isRoot ? generateKeyBetween(null, null) : old.index;
      const hi = isRoot ? null : siblings[at + 1]?.index ?? null;
      const created: Id[] = [];
      const puts = draftOps(new Ids(doc, ctx), drafts, parent, first, created, hi, idFor, (id) => doc.nodes[id]?.index);
      // What a kept layer had beyond its HTML: its data binding, and a component use's overrides.
      for (const op of puts) {
        if (op.kind !== "put" || op.collection !== "nodes") continue;
        const was = doc.nodes[op.value.id];
        if (!was) continue;
        if (was.sources && !op.value.sources) op.value = { ...op.value, sources: was.sources };
        if (was.bind && !op.value.bind) op.value = { ...op.value, bind: was.bind };
        if (was.hidden) op.value = { ...op.value, hidden: true };
        if (was.locked) op.value = { ...op.value, locked: true };
        if (was.at) op.value = { ...op.value, at: was.at };
        if (was.twin) op.value = { ...op.value, twin: was.twin };
        if (was.kind === "instance" && op.value.kind === "instance" && op.value.shared === was.shared) op.value = { ...op.value, overrides: was.overrides };
        // Markup that only changed by being written out again (<path/> as <path></path>) stays as it was.
        if (was.kind === "svg" && op.value.kind === "svg" && parseHtml(was.markup).drafts[0]?.kind === "svg") {
          const again = parseHtml(was.markup).drafts[0];
          if (again?.kind === "svg" && again.markup === op.value.markup) op.value = { ...op.value, markup: was.markup };
        }
      }
      const gone = new Set(before.map((n) => n.id).filter((id) => !kept.has(id)));
      const ops: Op[] = [
        ...[...gone].map((id): Op => ({ kind: "delete", collection: "nodes", id })),
        ...Object.values(doc.connections).filter((c) => gone.has(c.node)).map((c): Op => ({ kind: "delete", collection: "connections", id: c.id })),
        ...Object.values(doc.comments).filter((c) => gone.has(c.node)).map((c): Op => ({ kind: "delete", collection: "comments", id: c.id })),
        ...puts,
      ];
      ops.push(...forget(doc, ops));
      const lost = Object.values(doc.connections).filter((c) => gone.has(c.node)).length;
      const reply = [
        `Rewrote ${old.name}: ${created.length} layers, ${kept.size} kept their ids.${lost ? ` ${lost} link${lost === 1 ? "" : "s"} went with removed layers.` : ""}`,
        ...warnings.map((w) => `Warning: ${w}`),
      ].join("\n");
      return { label: `Rewrite ${old.name} as HTML`, ops, reply };
    },
  }),

  layer_html: tool({
    description: "A layer and everything in it as HTML with inline styles: the form write_html and replace_html read.",
    input: { node: z.string() },
    run: async (doc, a) => ({ label: "Read HTML", ops: [], reply: layerHtml(doc, node(doc, a.node).id) }),
  }),

  update_styles: tool({
    description:
      "Merge CSS properties into one or more nodes. With width, only at that one of the page's widths (set_widths): " +
      "below the page's own width the change holds at that width and narrower, above it at that width and wider.",
    input: {
      nodes: z.array(z.string()).min(1),
      style: styleValues,
      width: z.number().int().optional().describe("One of the page's widths, in px; omit (or the page's own width) for every width"),
    },
    run: async (doc, a) => {
      const patch = Object.entries(a.style).map(([k, v]) => [k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v] as const);
      const merge = (from: Style): Style => {
        const style: Style = { ...from };
        for (const [k, v] of patch) {
          if (v === "") delete style[k];
          else style[k] = v;
        }
        return style;
      };
      // A screen's layer carries its twins in the screen's states along, unless they are being changed already.
      const twins = Object.values(doc.nodes).filter((n) => n.twin !== undefined && a.nodes.includes(n.twin) && !a.nodes.includes(n.id)).map((n) => n.id);
      const ops: Op[] = [...a.nodes, ...twins].map((id) => {
        const n = node(doc, id);
        if (a.width === undefined) return { kind: "put", collection: "nodes", value: { ...n, style: merge(n.style) } };
        const page = Object.values(doc.pages).find((p) => p.frame === rootOf(doc, id));
        if (!page) throw new ToolError(`"${n.name}" is not on a page; styles by width belong to page layers`);
        const own = Number.parseInt(doc.nodes[page.frame]?.style.width ?? "", 10) || 1440;
        if (a.width === own) return { kind: "put", collection: "nodes", value: { ...n, style: merge(n.style) } };
        if (!page.widths?.includes(a.width)) throw new ToolError(`${page.name} doesn't have a ${a.width} px width; add it with set_widths (it has ${[own, ...(page.widths ?? [])].join(", ")})`);
        const key = String(a.width);
        const { [key]: was, ...others } = n.at ?? {};
        const style = merge(was ?? {});
        const at = Object.keys(style).length ? { ...others, [key]: style } : others;
        const { at: _old, ...rest } = n;
        return { kind: "put", collection: "nodes", value: Object.keys(at).length ? { ...rest, at } : rest };
      });
      const who = a.nodes.length === 1 ? node(doc, a.nodes[0] ?? "").name : `${a.nodes.length} nodes`;
      return { label: `Restyle ${who}${a.width === undefined ? "" : ` at ${a.width} px`}`, ops, reply: twins.length ? `Styles updated, and on ${twins.length} layer${twins.length === 1 ? "" : "s"} in its states.` : "Styles updated." };
    },
  }),

  link_states: tool({
    description:
      "Link a screen's states to it, layer by layer (matched by place, kind and tag), so a style change on the screen reaches the same layer in " +
      "every state. States made with duplicate_page are linked already; this is for ones made otherwise.",
    input: { page: z.string().describe("The screen, or any of its states") },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      const screen = p.state === undefined ? p : Object.values(doc.pages).find((x) => x.route === p.route && x.state === undefined);
      if (!screen) throw new ToolError(`${p.name} has no screen to link to`);
      const states = statesOf(doc, screen);
      if (!states.length) throw new ToolError(`${screen.name} has no states`);
      const ops: Op[] = [];
      const same = (x: Node, y: Node) => x.kind === y.kind && (x.tag ?? "") === (y.tag ?? "");
      const walk = (from: Node, to: Node) => {
        if (to.twin !== from.id) ops.push({ kind: "put", collection: "nodes", value: { ...to, twin: from.id } });
        const theirs = childrenOf(doc, to.id);
        let at = 0;
        for (const kid of childrenOf(doc, from.id)) {
          const window = theirs.slice(at, at + 4);
          const hit = window.find((t) => same(kid, t) && t.name === kid.name) ?? window.find((t) => same(kid, t));
          if (!hit) continue;
          at = theirs.indexOf(hit) + 1;
          walk(kid, hit);
        }
      };
      for (const st of states) walk(node(doc, screen.frame), node(doc, st.frame));
      return { label: `Link the states of ${screen.name}`, ops, reply: `Linked ${ops.length} layers in ${states.length} state${states.length === 1 ? "" : "s"} of ${screen.name}.` };
    },
  }),

  set_widths: tool({
    description:
      "The other widths a page must work at, in px (e.g. [390, 768]); [] for none. With any, the page fills the window, " +
      "the canvas can show it at each, and update_styles with width changes a layer at one. A width taken away takes its styles with it.",
    input: { page: z.string(), widths: z.array(z.number().int().min(240).max(3840)) },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      if (p.terminal) throw new ToolError("a terminal screen is measured in columns, not px widths");
      const own = Number.parseInt(doc.nodes[p.frame]?.style.width ?? "", 10) || 1440;
      const widths = [...new Set(a.widths.filter((w) => w !== own))].sort((x, y) => x - y);
      // A screen and its states are one screen, so they share their widths.
      const screen = p.state === undefined ? p : Object.values(doc.pages).find((x) => x.route === p.route && x.state === undefined) ?? p;
      const family = [screen, ...statesOf(doc, screen)];
      const ops: Op[] = [];
      const keep = new Set(widths.map(String));
      for (const member of family) {
        const { widths: _w, ...bare } = member;
        ops.push({ kind: "put", collection: "pages", value: widths.length ? { ...bare, widths } : bare });
        // Styles kept for a width the page no longer has would never show; they go with it.
        for (const n of subtree(doc, member.frame)) {
          if (!n.at || Object.keys(n.at).every((k) => keep.has(k))) continue;
          const at = Object.fromEntries(Object.entries(n.at).filter(([k]) => keep.has(k)));
          const { at: _a, ...rest } = n;
          ops.push({ kind: "put", collection: "nodes", value: Object.keys(at).length ? { ...rest, at } : rest });
        }
      }
      return { label: `Widths of ${p.name}`, ops, reply: widths.length ? `${p.name} works at ${[own, ...widths].sort((x, y) => x - y).join(", ")} px.` : `${p.name} has only its own width.` };
    },
  }),

  set_text: tool({
    description: "Replace the text of a text node.",
    input: { node: z.string(), text: z.string() },
    run: async (doc, a) => {
      const n = node(doc, a.node);
      if (n.kind !== "text") throw new ToolError(`"${a.node}" is a ${n.kind}, not text`);
      // A name that was only the start of the old text follows the new text; a name someone gave stays.
      const name = n.name === snippet(n.text) ? snippet(a.text) : n.name;
      return { label: `Edit text of ${n.name}`, ops: [{ kind: "put", collection: "nodes", value: { ...n, text: a.text, name } }], reply: "Text updated." };
    },
  }),

  rename_layer: tool({
    description: "Rename a layer, so the layers list and briefs say what it is (\"Not found notice\", not \"div\").",
    input: { node: z.string(), name: z.string().min(1) },
    run: async (doc, a) => {
      const n = node(doc, a.node);
      return { label: `Rename ${n.name} to ${a.name}`, ops: [{ kind: "put", collection: "nodes", value: { ...n, name: a.name } }], reply: "Renamed." };
    },
  }),

  set_svg: tool({
    description: "Replace the markup of an svg node in place: the layer keeps its name, styles and place. Pass one <svg> element.",
    input: { node: z.string(), markup: z.string() },
    run: async (doc, a) => {
      const n = node(doc, a.node);
      if (n.kind !== "svg") throw new ToolError(`"${a.node}" is a ${n.kind}, not an svg`);
      const { drafts } = parseHtml(a.markup);
      const d = drafts[0];
      if (drafts.length !== 1 || d?.kind !== "svg") throw new ToolError("markup must be exactly one <svg> element");
      return { label: `Edit ${n.name}`, ops: [{ kind: "put", collection: "nodes", value: { ...n, markup: d.markup } }], reply: "SVG updated." };
    },
  }),

  move_nodes: tool({
    description: "Move nodes (with their children) under a frame, in the given order.",
    input: { nodes: z.array(z.string()).min(1), parent: z.string(), after: z.string().optional().describe('Sibling to go after; "" puts them first; omit to append') },
    run: async (doc, a) => {
      if (node(doc, a.parent).kind !== "frame") throw new ToolError(`"${a.parent}" is not a frame`);
      if (a.after !== undefined && a.nodes.includes(a.after)) throw new ToolError("cannot move a node after itself");
      // Detach first, so indexes are computed among the siblings that stay.
      const scratch = structuredClone(doc);
      for (const id of a.nodes) delete scratch.nodes[node(doc, id).id];
      const siblings = childrenOf(scratch, a.parent);
      const i = a.after === undefined ? siblings.length - 1 : a.after === "" ? -1 : siblings.findIndex((s) => s.id === a.after);
      if (a.after !== undefined && a.after !== "" && i < 0) throw new ToolError(`"${a.after}" is not a child of "${a.parent}"`);
      let lo = i >= 0 ? siblings[i]?.index ?? null : null;
      const hi = siblings[i + 1]?.index ?? null;
      const ops: Op[] = a.nodes.map((id) => {
        const index = generateKeyBetween(lo, hi);
        lo = index;
        return { kind: "put", collection: "nodes", value: { ...node(doc, id), parent: a.parent, index } };
      });
      return { label: `Move ${a.nodes.length} node${a.nodes.length === 1 ? "" : "s"}`, ops, reply: "Moved." };
    },
  }),

  set_motion: tool({
    description:
      "Set how a layer moves in Play and on the exported site (the canvas and images stay still); the list replaces what it had, and [] removes it. " +
      "One motion per trigger: load (as the page opens) and scroll (as it comes into view) take an entrance: fade, rise, scale, slide-left, slide-right or blur; " +
      "hover and press take a response: lift, grow, shrink or dim. Easing: out for entrances and responses, in-out for movement between places, dramatic for one hero reveal. " +
      "staggerMs (load and scroll) has the layer's children enter one after another instead of the layer as one. Scroll entrances follow the scroll, so their duration is how far it reads, not a time. " +
      "Read the motion skill first: one orchestrated moment beats motion on everything, and everything respects reduced motion on its own.",
    input: {
      node: z.string(),
      motion: z.array(z.object({
        trigger: z.enum(MOTION_TRIGGERS),
        effect: z.enum([...ENTRANCES, ...RESPONSES]),
        durationMs: z.number().int().min(0).max(10_000),
        delayMs: z.number().int().min(0).max(10_000).optional(),
        easing: z.enum(EASINGS).default("out"),
        staggerMs: z.number().int().min(0).max(10_000).optional(),
      })).max(4),
    },
    run: async (doc, a) => {
      const n = node(doc, a.node);
      const list: Motion[] = a.motion.map((m) => ({ trigger: m.trigger, effect: m.effect, durationMs: m.durationMs, easing: m.easing, ...(m.delayMs !== undefined ? { delayMs: m.delayMs } : {}), ...(m.staggerMs !== undefined ? { staggerMs: m.staggerMs } : {}) }));
      for (const m of list) {
        const fits: readonly string[] = entersOn(m.trigger) ? ENTRANCES : RESPONSES;
        if (!fits.includes(m.effect)) throw new ToolError(`${m.trigger} takes ${entersOn(m.trigger) ? "an entrance" : "a response"}: ${fits.join(", ")}`);
        if (m.staggerMs !== undefined && !entersOn(m.trigger)) throw new ToolError("only load and scroll stagger their children");
      }
      if (new Set(list.map((m) => m.trigger)).size !== list.length) throw new ToolError("one motion per trigger");
      const { motion: _was, ...rest } = n;
      const next = list.length ? { ...rest, motion: list } : rest;
      return { label: list.length ? `Motion on ${n.name}` : `No motion on ${n.name}`, ops: [{ kind: "put", collection: "nodes", value: next }], reply: list.length ? `${n.name} moves: ${list.map((m) => `${m.trigger} ${m.effect}`).join(", ")}.` : `${n.name} is still.` };
    },
  }),

  set_layer: tool({
    description: "Hide or show layers (hidden layers stay in the file but leave the canvas and every export), and lock or unlock them (locked ones can't be picked on the canvas).",
    input: { nodes: z.array(z.string()).min(1), hidden: z.boolean().optional(), locked: z.boolean().optional() },
    run: async (doc, a) => {
      if (a.hidden === undefined && a.locked === undefined) throw new ToolError("say hidden or locked");
      const ops: Op[] = a.nodes.map((id) => {
        const { hidden: _h, locked: _l, ...rest } = node(doc, id);
        const was = node(doc, id);
        const hidden = a.hidden ?? was.hidden === true;
        const locked = a.locked ?? was.locked === true;
        return { kind: "put", collection: "nodes", value: { ...rest, ...(hidden ? { hidden: true as const } : {}), ...(locked ? { locked: true as const } : {}) } };
      });
      const what = [a.hidden === undefined ? "" : a.hidden ? "Hide" : "Show", a.locked === undefined ? "" : a.locked ? "lock" : "unlock"].filter(Boolean).join(" and ");
      return { label: `${what.charAt(0).toUpperCase()}${what.slice(1)} ${a.nodes.length === 1 ? node(doc, a.nodes[0] ?? "").name : `${a.nodes.length} layers`}`, ops, reply: "Done." };
    },
  }),

  duplicate_nodes: tool({
    description:
      "Copy layers with their children: right after the originals, or under another frame (parent, after). " +
      "The copies keep their styles, bindings and links on that page. Replies with the new ids.",
    input: {
      nodes: z.array(z.string()).min(1),
      parent: z.string().optional().describe("Frame to copy into; omit for the originals' own parent"),
      after: z.string().optional().describe('Sibling to go after; "" puts them first; omit for right after the last original (or the end of parent)'),
    },
    run: async (doc, a, ctx) => {
      const roots = a.nodes.map((id) => node(doc, id));
      const parent = a.parent ?? roots[0]?.parent;
      if (parent === undefined) throw new ToolError("a page or component root cannot be copied this way; use duplicate_page");
      if (node(doc, parent).kind !== "frame") throw new ToolError(`"${parent}" is not a frame`);
      // Right after the last original when they share the parent; otherwise at the end.
      const siblings = childrenOf(doc, parent);
      const lastOriginal = [...siblings].reverse().find((s) => a.nodes.includes(s.id));
      const after = a.after ?? (a.parent === undefined ? lastOriginal?.id : undefined);
      const i = after === undefined ? siblings.length - 1 : after === "" ? -1 : siblings.findIndex((s) => s.id === after);
      if (after !== undefined && after !== "" && i < 0) throw new ToolError(`"${after}" is not a child of "${parent}"`);
      let lo = i >= 0 ? siblings[i]?.index ?? null : null;
      const hi = siblings[i + 1]?.index ?? null;
      const ids = new Ids(doc, ctx);
      const ops: Op[] = [];
      const made: Id[] = [];
      const fresh = new Map<Id, Id>();
      for (const root of roots) {
        const tree = subtree(doc, root.id);
        for (const n of tree) fresh.set(n.id, ids.next());
        for (const n of tree) {
          const id = fresh.get(n.id) ?? n.id;
          const top = n.id === root.id;
          const index = top ? generateKeyBetween(lo, hi) : n.index;
          if (top) { lo = index; made.push(id); }
          ops.push({ kind: "put", collection: "nodes", value: { ...structuredClone(n), id, index, ...(top ? { parent } : n.parent !== undefined ? { parent: fresh.get(n.parent) ?? n.parent } : {}) } });
        }
      }
      // Links ride along on the page the copies land on.
      const page = Object.values(doc.pages).find((p) => p.frame === rootOf(doc, parent));
      for (const c of Object.values(doc.connections)) {
        const to = fresh.get(c.node);
        if (to && page && c.page === page.id) ops.push({ kind: "put", collection: "connections", value: { ...c, id: ids.next(), node: to } });
      }
      return { label: `Duplicate ${roots.length === 1 ? roots[0]?.name : `${roots.length} layers`}`, ops, reply: `Copied: ${made.join(", ")}.` };
    },
  }),

  wrap_nodes: tool({
    description: "Put sibling layers inside a new frame, in their order, where the first one was; it lays them out the way their parent did. Replies with the frame's id.",
    input: { nodes: z.array(z.string()).min(1), name: z.string().min(1).optional() },
    run: async (doc, a, ctx) => {
      const picked = a.nodes.map((id) => node(doc, id));
      const parent = picked[0]?.parent;
      if (parent === undefined || picked.some((n) => n.parent !== parent)) throw new ToolError("wrap layers that share a parent");
      const order = childrenOf(doc, parent).filter((c) => a.nodes.includes(c.id));
      const first = order[0];
      if (!first) throw new ToolError("nothing to wrap");
      const outer = node(doc, parent).style;
      const frame: Node = {
        id: new Ids(doc, ctx).next(), kind: "frame", parent, index: first.index, name: a.name ?? "Group",
        style: { display: "flex", flexDirection: outer.flexDirection === "row" ? "row" : "column", ...(outer.gap ? { gap: outer.gap } : {}) },
      };
      const ops: Op[] = [{ kind: "put", collection: "nodes", value: frame }];
      let lo: string | null = null;
      for (const n of order) { const index = generateKeyBetween(lo, null); lo = index; ops.push({ kind: "put", collection: "nodes", value: { ...n, parent: frame.id, index } }); }
      return { label: `Wrap ${order.length} layer${order.length === 1 ? "" : "s"} in a frame`, ops, reply: `Frame ${frame.id} holds them.` };
    },
  }),

  delete_nodes: tool({
    description: "Delete nodes with their subtrees, and the connections and comments attached to them.",
    input: { nodes: z.array(z.string()).min(1) },
    run: async (doc, a) => {
      const gone = new Set(a.nodes.flatMap((id) => subtree(doc, id).map((n) => n.id)));
      const roots = new Set([...Object.values(doc.pages).map((p) => p.frame), ...Object.values(doc.shared).map((s) => s.root)]);
      for (const id of gone) if (roots.has(id)) throw new ToolError(`"${id}" is a page or shared section root; use delete_page or delete_component`);
      const ops: Op[] = [...gone].map((id) => ({ kind: "delete", collection: "nodes", id }));
      // Links on a component's layers live only while the page still uses that component.
      const rootOfNode = (id: Id): Id => {
        let n = doc.nodes[id];
        while (n?.parent !== undefined) n = doc.nodes[n.parent];
        return n?.id ?? id;
      };
      const stillUsed = (sharedRoot: Id, pageFrame: Id) =>
        Object.values(doc.nodes).some((n) => n.kind === "instance" && !gone.has(n.id) && doc.shared[n.shared]?.root === sharedRoot && rootOfNode(n.id) === pageFrame);
      for (const c of Object.values(doc.connections)) {
        const root = rootOfNode(c.node);
        const inComponent = Object.values(doc.shared).some((s) => s.root === root);
        const frame = doc.pages[c.page]?.frame ?? "";
        if (gone.has(c.node) || (inComponent && !stillUsed(root, frame))) ops.push({ kind: "delete", collection: "connections", id: c.id });
      }
      ops.push(...forget(doc, ops));
      return { label: `Delete ${gone.size} node${gone.size === 1 ? "" : "s"}`, ops, reply: `Deleted ${gone.size} nodes.` };
    },
  }),

  delete_page: tool({
    description: "Delete a page with its layers, the links to and from it, the flows that start on it and its steps in other journeys.",
    input: { page: z.string() },
    run: async (doc, a) => {
      const page = doc.pages[a.page];
      if (!page) throw new ToolError(`page "${a.page}" does not exist`);
      const gone = new Set(subtree(doc, page.frame).map((n) => n.id));
      const flows = new Set(Object.values(doc.flows).filter((f) => f.start === page.id).map((f) => f.id));
      const ops: Op[] = [
        { kind: "delete", collection: "pages", id: page.id },
        ...[...gone].map((id): Op => ({ kind: "delete", collection: "nodes", id })),
        ...Object.values(doc.connections)
          .filter((c) => c.page === page.id || c.to === page.id || gone.has(c.node))
          .map((c): Op => ({ kind: "delete", collection: "connections", id: c.id })),
        ...Object.values(doc.comments).filter((c) => gone.has(c.node)).map((c): Op => ({ kind: "delete", collection: "comments", id: c.id })),
        ...[...flows].map((id): Op => ({ kind: "delete", collection: "flows", id })),
      ];
      for (const j of Object.values(doc.journeys)) {
        if (flows.has(j.flow)) ops.push({ kind: "delete", collection: "journeys", id: j.id });
        else if (j.steps.some((s) => s.page === page.id)) ops.push({ kind: "put", collection: "journeys", value: { ...j, steps: j.steps.filter((s) => s.page !== page.id) } });
      }
      // A trace keeps its steps through the system; it just no longer starts on a page.
      for (const t of Object.values(doc.traces)) {
        if (t.page !== page.id) continue;
        const { page: _, ...rest } = t;
        ops.push({ kind: "put", collection: "traces", value: rest });
      }
      ops.push(...forget(doc, ops));
      return { label: `Delete page ${page.name}`, ops, reply: `Deleted page ${page.name}${flows.size ? ` and ${flows.size} flow${flows.size === 1 ? "" : "s"} starting there` : ""}.` };
    },
  }),

  tokens: tool({
    description: "Read design tokens, or set them (CSS custom properties; empty string removes).",
    input: { set: z.record(z.string(), z.string()).optional() },
    run: async (doc, a) => {
      if (!a.set) return { label: "Read tokens", ops: [], reply: JSON.stringify(doc.tokens, null, 2) };
      const ops: Op[] = Object.entries(a.set).map(([name, value]) => (value === "" ? { kind: "token", name } : { kind: "token", name, value }));
      return { label: `Set ${ops.length} token${ops.length === 1 ? "" : "s"}`, ops, reply: "Tokens updated." };
    },
  }),

  comment: tool({
    description: "Start a comment thread on a node, or reply to one. Agents may mark a thread addressed; the person who asked resolves it (resolve), or reopens it.",
    input: {
      node: z.string().optional().describe("Node for a new thread"),
      thread: z.string().optional().describe("Thread id to reply to"),
      body: z.string().min(1).optional().describe("The comment; optional when only resolving or reopening"),
      addressed: z.boolean().optional().describe("Mark the thread addressed"),
      resolve: z.boolean().optional().describe("true resolves the thread, false reopens it"),
    },
    run: async (doc, a, ctx) => {
      const post: Post[] = a.body ? [{ author: ctx.author, body: a.body, at: ctx.now() }] : [];
      if (a.thread !== undefined) {
        const t = doc.comments[a.thread];
        if (!t) throw new ToolError(`thread "${a.thread}" does not exist`);
        if (!a.body && a.resolve === undefined) throw new ToolError("reply with a body, or resolve the thread");
        const state = a.resolve === true ? "resolved" : a.resolve === false ? "open" : a.addressed && t.state === "open" ? "addressed" : t.state;
        const label = a.resolve === true ? "Resolve comment" : a.resolve === false ? "Reopen comment" : "Reply to comment";
        return { label, ops: [{ kind: "put", collection: "comments", value: { ...t, state, posts: [...t.posts, ...post] } }], reply: a.resolve === true ? "Resolved." : a.resolve === false ? "Reopened." : "Replied." };
      }
      if (!a.body) throw new ToolError("a new thread needs a body");
      if (a.node === undefined) throw new ToolError("give a node for a new thread, or a thread to reply to");
      node(doc, a.node);
      const id = new Ids(doc, ctx).next();
      return {
        label: "Comment",
        ops: [{ kind: "put", collection: "comments", value: { id, node: a.node, state: a.addressed ? "addressed" : "open", posts: post } }],
        reply: `Started thread ${id}.`,
      };
    },
  }),

  move_page: tool({
    description: "Place a page on the canvas at x, y (top-left, in canvas pixels). Use it to lay out flows: rows for steps, a new row for each branch.",
    input: { page: z.string(), x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      return { label: `Move ${p.name}`, ops: [{ kind: "put", collection: "pages", value: { ...p, x: a.x, y: a.y } }], reply: `Moved ${p.name} to ${a.x}, ${a.y}.` };
    },
  }),

  reorder_page: tool({
    description: "Change the sitemap order: put a page right after another, or first when after is omitted.",
    input: { page: z.string(), after: z.string().optional().describe("Page to follow; omit to make it the first page") },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      if (a.after === a.page) throw new ToolError("a page cannot follow itself");
      const rest = pagesInOrder(doc).filter((x) => x.id !== p.id);
      const i = a.after === undefined ? -1 : rest.findIndex((x) => x.id === page(doc, a.after ?? "").id);
      const index = generateKeyBetween(rest[i]?.index ?? null, rest[i + 1]?.index ?? null);
      const where = a.after === undefined ? "first" : `after ${rest[i]?.name}`;
      return { label: `Reorder ${p.name}`, ops: [{ kind: "put", collection: "pages", value: { ...p, index } }], reply: `${p.name} is now ${where}.` };
    },
  }),

  find_icons: tool({
    description: "Search the Lucide icon set by name, e.g. \"arrow\", \"file text\" or \"settings\". Use the names with <buni-icon name=\"…\"> in write_html.",
    input: { query: z.string().min(1) },
    run: async (_doc, a) => {
      const names = findIcons(a.query);
      return { label: "Find icons", ops: [], reply: names.length ? names.join(", ") : `No icon matches "${a.query}"; try a simpler word.` };
    },
  }),

  set_screen: tool({
    description:
      "Make a page a terminal screen, or change one: its surface (app, inline output, tmux status/layout/popup/menu, zellij plugin, Neovim float/split, prompt, picker), " +
      "its size in columns and rows, and its colour depth. Resizes the page's frame to the grid. Its client must run in a terminal (set_part terminal). Read the terminal skill first.",
    input: { page: z.string(), ...terminalScreen.shape },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      const frame = node(doc, p.frame);
      const terminal: TerminalScreen = { surface: a.surface, cols: a.cols, ...(a.rows !== undefined ? { rows: a.rows } : {}), colors: a.colors };
      return {
        label: `Make ${p.name} a ${a.surface} screen`,
        ops: [
          { kind: "put", collection: "pages", value: { ...p, terminal } },
          { kind: "put", collection: "nodes", value: { ...frame, style: screenStyle(terminal, frame.style) } },
        ],
        reply: `${p.name} is a ${a.cols}${a.rows !== undefined ? `×${a.rows}` : "-column"} ${a.surface} screen.`,
      };
    },
  }),

  place_page: tool({
    description: "Say which client part (web app, mobile app) a page belongs to; omit client to clear it.",
    input: { page: z.string(), client: z.string().optional() },
    run: async (doc, a) => {
      const { client: _, ...p } = page(doc, a.page);
      const value: Page = a.client === undefined ? p : { ...p, client: a.client };
      return { label: `Put ${p.name} in ${a.client ?? "no client"}`, ops: [{ kind: "put", collection: "pages", value }], reply: "Saved." };
    },
  }),

  export_html: tool({
    description: "One page as plain HTML and CSS, with tokens as CSS custom properties.",
    input: { page: z.string() },
    run: async (doc, a) => {
      if (!doc.pages[a.page]) throw new ToolError(`page "${a.page}" does not exist`);
      const { html, css } = renderPage(doc, a.page);
      return { label: "Export HTML", ops: [], reply: `${html}\n<style>\n${css}</style>` };
    },
  }),

  add_attachment: tool({
    description: "Record a file that sits in the design's folder (an image, a PDF, notes) so layers can use it: <img src=\"asset:ID\">. Replies with its id.",
    input: { path: z.string().min(1).describe('Relative to the .buni file, e.g. "assets/logo.png"'), mime: z.string().min(3).describe('e.g. "image/png"') },
    run: async (doc, a, ctx) => {
      if (a.path.startsWith("/") || a.path.split("/").includes("..")) throw new ToolError("give a path inside the design's folder");
      const same = Object.values(doc.attachments).find((x) => x.path === a.path);
      if (same) return { label: "Attach file", ops: [], reply: `Attachment ${same.id} is ${a.path}.` };
      const id = new Ids(doc, ctx).next();
      return { label: `Attach ${a.path}`, ops: [{ kind: "put", collection: "attachments", value: { id, path: a.path, mime: a.mime } }], reply: `Attachment ${id} is ${a.path}.` };
    },
  }),
} satisfies Record<string, Tool>;
