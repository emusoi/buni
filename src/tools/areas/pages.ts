import { captureHtmlPage, htmlPageInput } from "../import-page.ts";
import { pinTag, reviewPage, reviewText } from "../review.ts";
import { findNodes, replaceIn } from "../find.ts";
import { allPatterns, patternFor, personalLibrary, searchPatterns, shortPath, writePattern } from "../inspiration.ts";
import { readFile } from "node:fs/promises";
import type { ToolContext, ToolOutput } from "../kit.ts";
import type { CapturedHtml } from "../../editor/renderer/capture-agent.ts";
import { sourceRefs } from "../../format/sources.ts";
// Pages and layers: creating pages, writing HTML into them, styles, text, motion, tokens, comments and the canvas. One
// area of buni's design tools (agent/areas.ts); tools.ts gathers them.
import { parseFragment, serialize, type DefaultTreeAdapterTypes as P } from "parse5";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { EASINGS, ENTRANCES, LIBRARY_HOSTS, MOTION_TRIGGERS, RESPONSES, entersOn, isUseLink, optionsOf, type Doc, type LivePage, type Motion, INK_TOOLS, INK_VIEWS, type InkView, ARCHITECTURE_ANCHOR, SCREENS_ANCHOR, architectureOf, archCollectionOf, childrenOf, statesOf, type TerminalScreen, pagesInOrder, type Id, type Node, type Page, type PageOption, type Post, type Style } from "../../format/doc.ts";
import { applyOps as applied, type Op } from "../../oplog/oplog.ts";
import { fontFaces, layerHtml, parseHtml, renderLayer, renderPage, snippet, type Draft } from "../html.ts";
import { embeddedFont } from "../fontdata.ts";
import { findIcons } from "../icons.ts";
import { marksText } from "../ink.ts";
import { Ids, type Tool, ToolError, pageOf, deleted, draftOps, forget, indexAt, nextIndex, node, page, onTerminal, rootOf, screenStyle, styleValues, subtree, terminalScreen, tool } from "../kit.ts";

/** The page a take belongs under: the one named, or the page it is itself a take of. */
function takeOf(doc: Doc, id: string): Page {
  const p = page(doc, id);
  return p.option ? page(doc, p.option.of) : p;
}

/**
 * A copy of a page as a new page: every layer with a new id, and its links from the copied layers. `twins` keeps each
 * layer pointing at the one it copies (a state, which follows its screen's styles); otherwise the copy is its own.
 */
function copyPage(doc: Doc, from: Page, ids: Ids, as: { name: string; index: string; twins: boolean; route?: string; state?: string; option?: PageOption }): { ops: Op[]; page: Id; frame: Id; layers: number } {
  const nodes = subtree(doc, from.frame);
  const fresh = new Map(nodes.map((n) => [n.id, ids.next()]));
  const id = (old: Id) => fresh.get(old) ?? old;
  const ops: Op[] = nodes.map((n) => {
    const { twin, ...copy } = structuredClone(n);
    return { kind: "put", collection: "nodes", value: { ...copy, id: id(n.id), ...(n.parent !== undefined ? { parent: id(n.parent) } : {}), ...(as.twins ? { twin: twin ?? n.id } : {}) } };
  });
  const pageId = ids.next();
  const { x: _x, y: _y, state: _s, route: _r, option: _o, ...rest } = from;
  ops.push({
    kind: "put", collection: "pages",
    value: { ...rest, id: pageId, name: as.name, frame: id(from.frame), index: as.index, ...(as.option ? { option: as.option } : as.route !== undefined ? { route: as.route } : from.route !== undefined ? { route: from.route } : {}), ...(as.state ? { state: as.state } : {}) },
  });
  // Its links go where the original's go, from the copied layers.
  for (const c of Object.values(doc.connections)) {
    if (c.page !== from.id || !fresh.has(c.node) || isUseLink(c.id)) continue;
    ops.push({ kind: "put", collection: "connections", value: { ...c, id: ids.next(), page: pageId, node: id(c.node) } });
  }
  return { ops, page: pageId, frame: id(from.frame), layers: nodes.length };
}

/** Where an import goes, checked: a new page or a frame, and the width it is captured at. */
function placeFor(doc: Doc, a: { parent?: string | undefined; after?: string | undefined; width?: number | undefined; page?: { width?: number | undefined } | undefined }): number {
  if (Boolean(a.parent) === Boolean(a.page)) throw new ToolError("Choose a parent frame or a new page.");
  if (a.parent && node(doc, a.parent).kind !== "frame") throw new ToolError("Import into a frame.");
  if (a.parent && a.after !== undefined) indexAt(doc, a.parent, a.after);
  return a.width ?? a.page?.width ?? 1440;
}

/** A captured page as layers: its images become attachments, then its HTML is imported where `a` says. */
async function importCaptured(doc: Doc, result: CapturedHtml, width: number, a: { parent?: string | undefined; after?: string | undefined; page?: { name: string; route?: string | undefined; take_of?: string | undefined } | undefined }, ctx: ToolContext): Promise<ToolOutput> {
  const ids = new Ids(doc, ctx);
  const attachments = { ...doc.attachments };
  const ops: Op[] = [];
  const replacements = new Map<string, string>();
  for (const image of result.images) {
    const path = await ctx.saveImportImage(image.base64, image.mime);
    let attachment = Object.values(attachments).find((item) => item.path === path);
    if (!attachment) {
      attachment = { id: ids.next(), path, mime: image.mime };
      attachments[attachment.id] = attachment;
      ops.push({ kind: "put", collection: "attachments", value: attachment });
    }
    replacements.set(image.id, attachment.id);
  }
  const tree = parseFragment(result.html);
  let missing = 0;
  const resolveImages = (parent: P.ParentNode) => {
    for (const child of parent.childNodes) if ("tagName" in child) {
      // A picture the capture couldn't draw (a frame out of reach) stays as the empty box it took up.
      const src = child.attrs.find((at) => at.name === "src")?.value ?? "";
      if (child.tagName === "img" && /^asset:buni-import-(image|shot)-\d+-asset$/.test(src) && !replacements.has(src.slice(6))) {
        child.tagName = "div"; child.nodeName = "div";
        child.attrs = child.attrs.filter((at) => at.name !== "src" && at.name !== "alt");
        missing++;
      }
      for (const attr of child.attrs) {
        if (attr.name === "src" && replacements.has(attr.value.slice(6))) attr.value = `asset:${replacements.get(attr.value.slice(6))}`;
        if (attr.name === "style") attr.value = attr.value.replace(/url\(asset:(buni-import-image-\d+-asset)\)/g,
          (all, id: string) => replacements.has(id) ? `url(asset:${replacements.get(id)})` : all);
      }
      resolveImages(child);
    }
  };
  resolveImages(tree);
  const html = serialize(tree);
  const imported = await pagesTools.import_html.run({ ...doc, attachments }, { html,
    ...(a.page ? { page: { ...a.page, width } } : { parent: a.parent, after: a.after }) }, ctx);
  return { ...imported, ops: [...ops, ...imported.ops], reply: [imported.reply, `Captured ${result.count} elements at ${width}px.`,
    ...result.warnings.map((warning) => `Warning: ${warning}`), ...(missing ? [`Warning: ${missing} picture${missing === 1 ? "" : "s"} couldn't be drawn and stay as empty boxes.`] : [])].join("\n") };
}

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
      terminal: terminalScreen.optional().describe("Make it a terminal screen, sized in cells; width and height are then ignored. Read the terminal skill first"),
      take_of: z.string().optional().describe("The page this is another version of: the new page is a take of it (an option), beside it under one card, not a page of its own. Use it whenever the screen is already in the design"),
    },
    run: async (doc, a, ctx) => {
      const ids = new Ids(doc, ctx);
      const pageId = ids.next();
      const frameId = ids.next();
      const last = pagesInOrder(doc).at(-1)?.index ?? null;
      const of = a.take_of === undefined ? undefined : takeOf(doc, a.take_of);
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
              id: pageId, name: a.name, ...(a.sources?.length ? { sources: a.sources } : {}), ...(of ? { option: { of: of.id, idea: `${a.name}: another take` } } : a.route !== undefined ? { route: a.route } : {}), ...(a.state !== undefined && !of ? { state: a.state } : {}), frame: frameId, index: generateKeyBetween(last, null),
              ...(a.terminal ? { terminal: a.terminal } : {}),
            },
          },
        ],
        reply: `Created page ${pageId} with root frame ${frameId}.`,
      };
    },
  }),

  rename_page: tool({
    description: "Rename a page, or move it to another route. A screen's states move with it, keeping its route.",
    input: { page: z.string(), name: z.string().min(1).optional(), route: z.string().optional().describe('Starts with /; "" makes it a graphic, off the site') },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      if (a.name === undefined && a.route === undefined) throw new ToolError("give a new name, a route, or both");
      const route = a.route === undefined ? p.route : a.route || undefined;
      const value: Page = { ...p, ...(a.name !== undefined ? { name: a.name } : {}) };
      if (route === undefined) delete value.route;
      else value.route = route;
      const ops: Op[] = [{ kind: "put", collection: "pages", value }];
      // The root frame is named for its page; one renamed by hand keeps its own name.
      const frame = doc.nodes[p.frame];
      if (a.name !== undefined && frame && frame.name === p.name) ops.push({ kind: "put", collection: "nodes", value: { ...frame, name: a.name } });
      // A screen's states share its route, so they move with it.
      if (p.state === undefined && route !== p.route && p.route !== undefined) {
        for (const s of Object.values(doc.pages)) if (s.id !== p.id && s.state !== undefined && s.route === p.route) ops.push({ kind: "put", collection: "pages", value: route === undefined ? (({ route: _, ...rest }) => rest)(s) : { ...s, route } });
      }
      return { label: `Rename page ${p.name}${a.name !== undefined && a.name !== p.name ? ` to ${a.name}` : ""}`, ops, reply: `Page ${p.id} is ${value.name}${value.route ? ` at ${value.route}` : ", a graphic"}.` };
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
      const next = pagesInOrder(doc)[pagesInOrder(doc).findIndex((p) => p.id === from.id) + 1];
      const name = a.name ?? (a.state ? `${from.name}, ${a.state.charAt(0).toLowerCase()}${a.state.slice(1)}` : `${from.name} copy`);
      const copy = copyPage(doc, from, new Ids(doc, ctx), {
        name, index: generateKeyBetween(from.index, next?.index ?? null), twins: a.state !== undefined,
        ...(a.route !== undefined ? { route: a.route } : {}), ...(a.state ? { state: a.state } : {}),
      });
      return { label: `Duplicate ${from.name}`, ops: copy.ops, reply: `Created page ${copy.page} (${name}) with root frame ${copy.frame}; ${copy.layers} layers copied.` };
    },
  }),

  explore_page: tool({
    description:
      "Try other takes on a page: each option is a copy of it, not linked to it, to change on its own (layout, what comes first, density). " +
      "Name each and say in one line what it bets on (idea). Options have no route while they are options, so Play and export keep showing the page. " +
      "Then compare_options reviews them side by side and pick_option makes one live. Read the critique skill's explore lens first.",
    input: {
      page: z.string(),
      options: z.array(z.object({ name: z.string().min(1), idea: z.string().min(1) })).min(1).max(6),
    },
    run: async (doc, a, ctx) => {
      const from = page(doc, a.page);
      if (from.option) throw new ToolError(`"${from.name}" is itself an option of ${doc.pages[from.option.of]?.name ?? from.option.of}; explore that page instead`);
      if (from.state) throw new ToolError(`"${from.name}" is a state; explore the screen it is a state of`);
      const ids = new Ids(doc, ctx);
      const order = pagesInOrder(doc);
      // After the page and the options it already has.
      const last = [from, ...optionsOf(doc, from.id)].at(-1)!;
      const hi = order[order.findIndex((p) => p.id === last.id) + 1]?.index ?? null;
      let lo = last.index;
      const ops: Op[] = [];
      const made: string[] = [];
      for (const o of a.options) {
        const index = generateKeyBetween(lo, hi);
        lo = index;
        const copy = copyPage(doc, from, ids, { name: `${from.name} · ${o.name}`, index, twins: false, option: { of: from.id, idea: o.idea } });
        ops.push(...copy.ops);
        made.push(`${from.name} · ${o.name}: page ${copy.page}, root frame ${copy.frame}`);
      }
      return { label: `Explore ${a.options.length} option${a.options.length === 1 ? "" : "s"} of ${from.name}`, ops, reply: `Options of ${from.name}, each a copy to change:\n${made.join("\n")}` };
    },
  }),

  compare_options: tool({
    description: "Review a page and its options side by side as they render: each one's idea, score out of 100 and issues, best first. Give the page or any of its options.",
    input: { page: z.string() },
    run: async (doc, a) => {
      const given = page(doc, a.page);
      const live = given.option ? page(doc, given.option.of) : given;
      const all = [live, ...optionsOf(doc, live.id)];
      if (all.length === 1) throw new ToolError(`${live.name} has no options yet; explore_page makes some`);
      let reviews;
      try { reviews = await Promise.all(all.map(async (p) => ({ p, r: await reviewPage(doc, p.id) }))); } catch (e) { throw new ToolError(e instanceof Error ? e.message : String(e)); }
      const lines = reviews.sort((x, y) => y.r.score - x.r.score).map(({ p, r }) => {
        const count = (sev: string) => r.issues.filter((i) => i.severity === sev).length;
        const worst = r.issues.slice(0, 3).map((i) => `${i.severity.toUpperCase()} ${i.rule}`).join(", ");
        return `${p.id === live.id ? "LIVE " : ""}${p.name} (${p.id}): ${r.score}/100, ${count("p1")} P1, ${count("p2")} P2, ${count("p3")} P3${worst ? ` — ${worst}` : ""}${p.option ? `\n  bets on: ${p.option.idea}` : ""}`;
      });
      return { label: "Compare options", ops: [], reply: `${live.name} and its ${all.length - 1} option${all.length === 2 ? "" : "s"}, best first:\n${lines.join("\n")}\nScores catch the mechanical part; judge the bet itself, and when the choice is the person's, ask_person.` };
    },
  }),

  make_take: tool({
    description: "Make a page that is already in the design a take of another page: it leaves its route and sits under that page's card as one of its options (a snapshot made as a page of its own, a copy that is really another version). idea says what it tries, in a line.",
    input: { page: z.string(), of: z.string(), idea: z.string().min(1).max(200).optional() },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      const live = takeOf(doc, a.of);
      if (live.id === p.id) throw new ToolError("a page can't be a take of itself");
      if (optionsOf(doc, p.id).length) throw new ToolError(`${p.name} has takes of its own; pick one of them first`);
      const { route: _r, state: _s, picked: _k, x: _x, y: _y, ...rest } = p;
      const value = { ...rest, option: { of: live.id, idea: a.idea?.trim() || `${p.name}, as it was made` } };
      return { label: `${p.name} is a take of ${live.name}`, ops: [{ kind: "put", collection: "pages", value }], reply: `${p.name} is now a take of ${live.name}; pick_option makes it the live one.` };
    },
  }),

  pick_option: tool({
    description:
      "Make an option the live page: it takes the page's route, links and flows to the page now reach it, and the page that was live becomes one of its options. " +
      "why names the edit. others: keep (default) leaves the other options beside it; delete removes them.",
    input: { option: z.string(), why: z.string().min(1), others: z.enum(["keep", "delete"]).optional() },
    run: async (doc, a, ctx) => {
      const chosen = page(doc, a.option);
      if (!chosen.option) throw new ToolError(`"${chosen.name}" isn't an option of another page`);
      const live = page(doc, chosen.option.of);
      const rest = optionsOf(doc, live.id).filter((p) => p.id !== chosen.id);
      const ops: Op[] = [];
      // The chosen one takes the live page's place: its route and spot in the list.
      // The winner takes the live page's place on the canvas too; the why stays with it.
      const { option: _o, x: _cx, y: _cy, ...chosenRest } = chosen;
      const { route: _r, x: _lx, y: _ly, ...liveRest } = live;
      const spot = live.x !== undefined && live.y !== undefined ? { x: live.x, y: live.y } : {};
      ops.push({ kind: "put", collection: "pages", value: { ...chosenRest, ...spot, index: live.index, ...(live.route !== undefined ? { route: live.route } : {}), picked: { why: a.why, at: ctx.now(), over: [live.id, ...rest.map((p) => p.id)] } } });
      ops.push({ kind: "put", collection: "pages", value: { ...liveRest, index: chosen.index, option: { of: chosen.id, idea: `As it was live until ${ctx.now().slice(0, 10)}` } } });
      for (const c of Object.values(doc.connections)) if (c.to === live.id) ops.push({ kind: "put", collection: "connections", value: { ...c, to: chosen.id } });
      for (const f of Object.values(doc.flows)) if (f.start === live.id) ops.push({ kind: "put", collection: "flows", value: { ...f, start: chosen.id } });
      for (const j of Object.values(doc.journeys)) if (j.steps.some((s) => s.page === live.id)) ops.push({ kind: "put", collection: "journeys", value: { ...j, steps: j.steps.map((s) => (s.page === live.id ? { ...s, page: chosen.id } : s)) } });
      if (a.others !== "delete") for (const p of rest) ops.push({ kind: "put", collection: "pages", value: { ...p, option: { ...p.option!, of: chosen.id } } });
      let reply = `${chosen.name} is live${live.route ? ` at ${live.route}` : ""}; ${live.name} is now one of its options.`;
      if (a.others === "delete" && rest.length) {
        let after = applied(doc, ops);
        for (const p of rest) {
          const gone = await pagesTools.delete_page.run(after, { page: p.id }, ctx);
          ops.push(...gone.ops);
          after = applied(after, gone.ops);
        }
        reply += ` Deleted ${rest.map((p) => p.name).join(", ")}.`;
      }
      if (live.route && Object.values(doc.pages).some((p) => p.state !== undefined && p.route === live.route)) reply += ` The route's states still copy ${live.name}'s layers; link_states {page: "${chosen.id}"} links them to this one.`;
      return { label: `Make ${chosen.name} live: ${a.why}`, ops, reply };
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
      page: z.object({ name: z.string().min(1), width: z.number().int().positive().default(1440), route: z.string().optional(), take_of: z.string().optional().describe("The page this is another version of: the import becomes a take of it, not a page of its own") }).optional(),
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
        const of = a.page.take_of === undefined ? undefined : takeOf(doc, a.page.take_of);
        ops.push({ kind: "put", collection: "pages", value: { id: madePage, name: a.page.name, frame: parent, index: generateKeyBetween(pagesInOrder(doc).at(-1)?.index ?? null, null), ...(of ? { option: { of: of.id, idea: `${a.page.name}, as imported` } } : a.page.route !== undefined ? { route: a.page.route } : {}), ...(drafts[0]?.sources ? { sources: drafts[0].sources } : {}) } });
      } else if (!parent || node(doc, parent).kind !== "frame") throw new ToolError("Import into a frame or a new page.");
      if (!parent) throw new ToolError("No destination frame.");
      const created: Id[] = [];
      ops.push(...draftOps(ids, drafts, parent, madePage ? "a0" : indexAt(doc, parent, a.after), created, madePage ? null : nextIndex(doc, parent, a.after)));
      // What a layer did that it can't do here (an import's loops and custom keyframes), as a comment on it. Drafts
      // were created in this same order, each before its children.
      const all = (ds: Draft[]): Draft[] => ds.flatMap((d) => [d, ...(d.kind === "frame" ? all(d.children) : [])]);
      all(drafts).forEach((d, i) => {
        for (const body of d.notes ?? []) ops.push({ kind: "put", collection: "comments", value: { id: ids.next(), node: created[i]!, state: "open", posts: [{ author: ctx.author, body, at: ctx.now() }] } });
      });
      return { label: "Import HTML", ops, reply: `${madePage ? `Created page ${madePage}.\n` : ""}Created ${created.length} nodes: ${created.join(", ")}.\n${warnings.map((w) => `Warning: ${w}`).join("\n")}` };
    },
  }),

  import_html_page: tool({
    description: "Convert a static HTML page or selected section into editable Buni layers, with resolved CSS, images and source context. Give exactly one of html, url or file, and either a new page or a parent frame. selector picks one element; width resolves responsive styles. Needs Chrome/Chromium/Edge on the host. Scripts and cookies are excluded unless live is set: live opens the url with its scripts running (local Buni only), cookies signs it in, wait_for waits for what must show. The design import is one undoable edit.",
    input: {
      ...htmlPageInput, parent: z.string().optional(), after: z.string().optional(),
      page: z.object({ name: z.string().min(1), width: z.number().int().min(240).max(3840).optional(), route: z.string().optional(), take_of: z.string().optional().describe("The page in the design this is a version of: the import becomes a take of it (an option), not a page of its own. A snapshot of a screen the design has goes here") }).optional(),
    },
    run: async (doc, a, ctx): Promise<ToolOutput> => {
      const width = placeFor(doc, a);
      return importCaptured(doc, await captureHtmlPage(a, width, ctx), width, a, ctx);
    },
  }),

  find_inspiration: tool({
    description:
      "Search the inspiration libraries: UI and UX patterns as finished HTML screens (command palette, data table with filters, pricing plans, " +
      "onboarding checklist…), buni's own and any the person added (buni inspiration add). Each says when to use it and when not. " +
      "Look before designing a familiar pattern, then use_inspiration brings one in as a reference page.",
    input: { query: z.string().optional().describe("What you're designing: \"settings page\", \"empty state\", \"checkout\"; omit to list all") },
    run: async (_doc, a) => {
      const all = await allPatterns();
      const found = a.query ? searchPatterns(all, a.query) : all;
      if (!found.length) return { label: "Find inspiration", ops: [], reply: all.length ? `No pattern fits "${a.query}". ${all.length} in the libraries; find_inspiration with no query lists them.` : "No inspiration libraries yet." };
      const lines = await Promise.all(found.slice(0, 12).map(async (p, i) => {
        const more = i < 3 ? `${p.why ? `\n  why: ${p.why}` : ""}${p.avoid ? `\n  avoid: ${p.avoid}` : ""}${p.seenIn ? `\n  seen in: ${p.seenIn}` : ""}` : "";
        return `${p.name} (${p.library}: ${await shortPath(p)}) [${p.tags.join(", ")}]\n  use: ${p.use}${more}`;
      }));
      return { label: "Find inspiration", ops: [], reply: `${found.length} pattern${found.length === 1 ? "" : "s"}${found.length > 12 ? ", the best 12" : ""}:\n${lines.join("\n")}` };
    },
  }),

  use_inspiration: tool({
    description:
      "Bring a pattern from the inspiration libraries into the design as editable layers: onto a new page (\"Inspiration · <name>\", a board outside the site) " +
      "or into a parent frame. pattern is its name or file from find_inspiration. Take its structure and behaviour, then make it this product's own: " +
      "its tokens, content and voice (tells skill).",
    input: {
      pattern: z.string().min(1), parent: z.string().optional(), after: z.string().optional(),
      page: z.object({ name: z.string().min(1) }).optional(),
    },
    run: async (doc, a, ctx): Promise<ToolOutput> => {
      const p = await patternFor(a.pattern);
      if (!p) throw new ToolError(`No pattern "${a.pattern}" in the inspiration libraries; find_inspiration lists them.`);
      const html = await readFile(p.file, "utf8");
      const where = a.parent ? { parent: a.parent, ...(a.after !== undefined ? { after: a.after } : {}) } : { page: { name: a.page?.name ?? `Inspiration · ${p.name}` } };
      const out = await pagesTools.import_html_page.run(doc, { html, ...where }, ctx);
      return { ...out, label: `Use ${p.name}`, reply: `${out.reply}\nFrom ${p.library}: ${p.name}. Use: ${p.use}${p.avoid ? `\nAvoid when: ${p.avoid}` : ""}\nTake its structure; make the look, content and words this product's own.` };
    },
  }),

  save_inspiration: tool({
    description:
      "Keep a finished page, or one part of it, as a pattern in an inspiration library, to bring back in any design (use_inspiration) and to show agents what good looks like here. " +
      "Say when to use it (use) and tag it; it goes to the person's own library unless library names another folder. Local buni only.",
    input: {
      page: z.string(), node: z.string().optional().describe("One layer of the page; omit for the whole page"),
      name: z.string().min(1), use: z.string().min(1), tags: z.array(z.string().min(1)).optional(),
      avoid: z.string().optional(), why: z.string().optional(),
      library: z.string().optional().describe("A library folder; defaults to the person's own"),
    },
    run: async (doc, a, ctx) => {
      if (ctx.localImports !== true) throw new ToolError("Inspiration libraries are folders on this machine; save one in local buni.");
      const p = page(doc, a.page);
      const out = a.node ? renderLayer(doc, p.id, node(doc, a.node).id) : renderPage(doc, p.id);
      // Self-contained: the fonts it uses, and its images as data, so the file means the same anywhere.
      let html = out.html, css = fontFaces(doc, embeddedFont) + out.css;
      for (const att of Object.values(doc.attachments)) {
        if (!html.includes(att.path) && !css.includes(att.path)) continue;
        const bytes = await ctx.readAttachmentBytes?.(att.path).catch(() => undefined);
        if (!bytes) continue;
        const data = `data:${att.mime};base64,${Buffer.from(bytes).toString("base64")}`;
        html = html.split(att.path).join(data); css = css.split(att.path).join(data);
      }
      const dir = a.library ?? await personalLibrary();
      const file = await writePattern(dir, { name: a.name, use: a.use, ...(a.tags ? { tags: a.tags } : {}), ...(a.avoid ? { avoid: a.avoid } : {}), ...(a.why ? { why: a.why } : {}), seenIn: `${p.name}${a.node ? ` · ${doc.nodes[a.node]?.name}` : ""}` }, { html, css });
      return { label: "Save inspiration", ops: [], reply: `Saved "${a.name}" to ${file}. find_inspiration finds it, use_inspiration brings it into any design.` };
    },
  }),

  import_snapshot: tool({
    description:
      "Import a page someone already captured in their own browser (buni's Chrome extension, or a saved snapshot file) as editable layers, " +
      "onto a new page or into a parent frame, in one undoable edit. snapshot is the capture as the extension sends it: html, images and where it came from.",
    input: {
      snapshot: z.object({
        html: z.string().min(1).max(16 * 1024 * 1024), count: z.number().int().positive(), warnings: z.array(z.string()).default([]),
        images: z.array(z.object({ id: z.string().regex(/^buni-import-(image|shot)-\d+-asset$/), base64: z.string(), mime: z.string() })).default([]),
        url: z.string().url().optional(), width: z.number().int().min(240).max(3840),
      }),
      parent: z.string().optional(), after: z.string().optional(),
      page: z.object({ name: z.string().min(1), route: z.string().optional() }).optional(),
      brief: z.string().optional().describe("What the person wants changed, kept as a comment on the new page for whoever redesigns it"),
    },
    run: async (doc, a, ctx): Promise<ToolOutput> => {
      const where = { ...(a.parent ? { parent: a.parent } : {}), ...(a.after !== undefined ? { after: a.after } : {}), ...(a.page ? { page: { ...a.page, width: a.snapshot.width } } : {}) };
      const width = placeFor(doc, where);
      let out = await importCaptured(doc, { ...a.snapshot, shots: [] }, width, where, ctx);
      // The page remembers where it was captured, when the layers didn't say.
      const url = a.snapshot.url;
      if (url) out = { ...out, ops: out.ops.map((o) => (o.kind === "put" && o.collection === "pages" && !o.value.sources?.length ? { ...o, value: { ...o.value, sources: [{ url }] } } : o)) };
      const brief = a.brief?.trim();
      if (!brief) return out;
      // On the captured page's root, where buni tree and the editor show it beside the snapshot.
      const made = out.ops.find((o) => o.kind === "put" && o.collection === "pages");
      const node = made?.kind === "put" && made.collection === "pages" ? made.value.frame : a.parent;
      if (!node) return out;
      const comment = { id: new Ids(applied(doc, out.ops), ctx).next(), node, state: "open" as const, posts: [{ author: ctx.author, body: `Brief: ${brief}`, at: ctx.now() }] };
      return { ...out, ops: [...out.ops, { kind: "put", collection: "comments", value: comment }], reply: `${out.reply}\nBrief kept as comment ${comment.id}.` };
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
      // What a kept layer had beyond its HTML: its sources, flags and widths, and a component use's overrides.
      for (const op of puts) {
        if (op.kind !== "put" || op.collection !== "nodes") continue;
        const was = doc.nodes[op.value.id];
        if (!was) continue;
        if (was.sources && !op.value.sources) op.value = { ...op.value, sources: was.sources };
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
      "The copies keep their styles and links on that page. Replies with the new ids.",
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
        // Its layers' comments, and the pen marks on the flows that start here.
        ...Object.values(doc.comments).filter((c) => gone.has(c.node) || flows.has(c.ink?.flow ?? "")).map((c): Op => ({ kind: "delete", collection: "comments", id: c.id })),
        ...[...flows].map((id): Op => ({ kind: "delete", collection: "flows", id })),
        // Its options become pages of their own.
        ...optionsOf(doc, page.id).map((p): Op => { const { option: _, ...rest } = p; return { kind: "put", collection: "pages", value: rest }; }),
      ];
      for (const j of Object.values(doc.journeys)) {
        if (flows.has(j.flow)) ops.push({ kind: "delete", collection: "journeys", id: j.id });
        else if (j.steps.some((s) => s.page === page.id)) ops.push({ kind: "put", collection: "journeys", value: { ...j, steps: j.steps.filter((s) => s.page !== page.id) } });
      }
      ops.push(...forget(doc, ops));
      return { label: `Delete page ${page.name}`, ops, reply: `Deleted page ${page.name}${flows.size ? ` and ${flows.size} flow${flows.size === 1 ? "" : "s"} starting there` : ""}.` };
    },
  }),

  tokens: tool({
    description:
      "Read design tokens, or set them (CSS custom properties; empty string removes). With mode (\"dark\"), set the values " +
      "tokens take in that mode: only the ones that differ. Pages are drawn in a mode on the canvas, in Play and on the " +
      "exported site, and \"dark\" follows the system too. Reading gives the tokens and every mode's values.",
    input: { set: z.record(z.string(), z.string()).optional(), mode: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional() },
    run: async (doc, a) => {
      if (!a.set) return { label: "Read tokens", ops: [], reply: JSON.stringify({ tokens: doc.tokens, ...(doc.modes ? { modes: doc.modes } : {}) }, null, 2) };
      const mode = a.mode === undefined ? {} : { mode: a.mode };
      const ops: Op[] = Object.entries(a.set).map(([name, value]) => (value === "" ? { kind: "token", name, ...mode } : { kind: "token", name, value, ...mode }));
      const where = a.mode === undefined ? "" : ` in ${a.mode} mode`;
      return { label: `Set ${ops.length} token${ops.length === 1 ? "" : "s"}${where}`, ops, reply: `Tokens updated${where}.` };
    },
  }),

  find_nodes: tool({
    description:
      "Find layers by style, token or words, on every page or under page/root. style: [{prop, value}], all must match: prop in either case with * wildcards (\"border*\"), " +
      "value a literal (\"#ccc\", \"16px\"), a token (\"--muted\") or * wildcards. A colour matches however it is written and inside longer values (a border), and also finds tokens set to it. " +
      "text matches words in text layers. replace_with swaps what one style query matched, on every match, in one edit: e.g. every #999 for var(--muted).",
    input: {
      style: z.array(z.object({ prop: z.string().optional(), value: z.string().optional() })).optional(),
      text: z.string().optional(),
      page: z.string().optional(), root: z.string().optional(),
      replace_with: z.string().optional().describe("Replaces the matched value (or the part of it that matched) on every layer found"),
    },
    run: async (doc, a) => {
      if (!a.style?.length && a.text === undefined) throw new ToolError("give style, text or both");
      if (a.replace_with !== undefined && (a.style?.length !== 1 || a.text !== undefined)) throw new ToolError("replace_with takes exactly one style query and no text");
      const roots = a.root ? [node(doc, a.root).id] : a.page ? [page(doc, a.page).frame] : undefined;
      const found = findNodes(doc, { ...(a.style ? { styles: a.style } : {}), ...(a.text !== undefined ? { text: a.text } : {}), ...(roots ? { roots } : {}) });
      const where = (id: Id) => { try { return pageOf(doc, id).name; } catch { return "a component"; } };
      const list = found.slice(0, 60).map((m) => `${doc.nodes[m.node]!.name} (${m.node}) on ${where(m.node)}: ${m.matched.slice(0, 3).join("; ")}`).join("\n");
      const more = found.length > 60 ? `\n…and ${found.length - 60} more` : "";
      if (a.replace_with === undefined) return { label: "Find", ops: [], reply: found.length ? `${found.length} layer${found.length === 1 ? "" : "s"}:\n${list}${more}` : "Nothing matches." };
      const want = a.style![0]!, by = a.replace_with;
      const ops: Op[] = found.flatMap((m) => {
        const n = doc.nodes[m.node]!;
        const style = replaceIn(doc, n.style, want, by);
        const at = n.at && Object.fromEntries(Object.entries(n.at).map(([w, st]) => [w, replaceIn(doc, st, want, by)]));
        const same = style === n.style && (!n.at || Object.entries(n.at).every(([w, st]) => at?.[w] === st));
        return same ? [] : [{ kind: "put" as const, collection: "nodes" as const, value: { ...n, style, ...(at ? { at } : {}) } }];
      });
      return { label: `Replace on ${ops.length} layers`, ops, reply: ops.length ? `Replaced on ${ops.length} layer${ops.length === 1 ? "" : "s"}:\n${list}${more}` : "Nothing matches." };
    },
  }),

  review_page: tool({
    description:
      "Review a page as it renders, motion included: rules a careful reviewer flags every time (bouncy or slow motion, transitions that lay the page out, " +
      "motion on everything, content left invisible, …), worst first, with the layers each is on and a score out of 100 that rises as they are fixed. " +
      "pin: true puts each issue as a comment on its first layer (not twice). against: the page it improves on (its \"· Now\" snapshot): says which issues were fixed, which remain and which are new. " +
      "It catches the mechanical part; judge the design itself with read_skill critique.",
    input: { page: z.string(), pin: z.boolean().optional(), against: z.string().optional().describe("The page this one improves on, e.g. the snapshot it was duplicated from") },
    run: async (doc, a, ctx) => {
      const p = page(doc, a.page);
      const was = a.against === undefined ? undefined : page(doc, a.against);
      let review, before;
      try {
        review = await reviewPage(doc, p.id);
        before = was && await reviewPage(doc, was.id);
      } catch (e) { throw new ToolError(e instanceof Error ? e.message : String(e)); }
      let reply = reviewText(doc, p.name, review);
      if (was && before) {
        const now = new Set(review.issues.map((i) => i.rule)), then = new Set(before.issues.map((i) => i.rule));
        const fixed = [...then].filter((r) => !now.has(r)), kept = [...now].filter((r) => then.has(r)), added = [...now].filter((r) => !then.has(r));
        reply = [`${was.name} ${before.score}/100 → ${p.name} ${review.score}/100.`, fixed.length ? `Fixed: ${fixed.join(", ")}.` : "", kept.length ? `Still there: ${kept.join(", ")}.` : "", added.length ? `New: ${added.join(", ")}.` : "", reply].filter(Boolean).join("\n");
      }
      if (!a.pin) return { label: "Review", ops: [], reply };
      const ids = new Ids(doc, ctx);
      const ops: Op[] = [];
      for (const issue of review.issues) {
        const at = issue.nodes[0] ?? p.frame;
        const pinned = Object.values(doc.comments).some((c) => c.node === at && c.state !== "resolved" && c.posts[0]?.body.startsWith(pinTag(issue.rule)));
        if (pinned) continue;
        const body = `${pinTag(issue.rule)} ${issue.severity.toUpperCase()} ${issue.messages[0]}${issue.messages.length > 1 ? ` (${issue.messages.length} places${issue.nodes.length > 1 ? `, also ${issue.nodes.slice(1, 6).join(", ")}` : ""})` : ""}`;
        ops.push({ kind: "put", collection: "comments", value: { id: ids.next(), node: at, state: "open", posts: [{ author: ctx.author, body, at: ctx.now() }] } });
      }
      return { label: "Pin review", ops, reply: ops.length ? `${reply}\nPinned ${ops.length} as comments.` : review.issues.length ? `${reply}\nAlready pinned.` : reply };
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

  mark: tool({
    description: "Draw a mark, as a pen does on a tablet: on a page (strokes in the page's own pixels, on the layer under them, else the page's frame), on an architecture view (context, system or api; strokes in that map's units, on the part or link under them) on a flow (strokes in the tablet's layout of it, on the screen under them), or as a sketch of a new screen on the Screens canvas (strokes in the canvas's units, where pages sit). Kept as a comment thread. remove takes a mark away.",
    input: {
      page: z.string().optional().describe("Page drawn on"),
      view: z.enum(INK_VIEWS).optional().describe("Or the architecture view drawn on"),
      flow: z.string().optional().describe("Or the flow drawn on"),
      sketch: z.boolean().optional().describe("Or true: a sketch of a new screen on the Screens canvas, outside any page"),
      node: z.string().optional().describe("Layer (on a page), part or link (on a view), or page (on a flow) the mark points at"),
      strokes: z.array(z.object({
        tool: z.enum(INK_TOOLS),
        color: z.string().min(1).max(40),
        width: z.number().min(0.5).max(60),
        points: z.array(z.number().finite()).min(2).max(8000).refine((p) => p.length % 2 === 0, "points are x, y pairs"),
      })).min(1).max(200).optional(),
      body: z.string().min(1).max(2000).optional().describe("Words typed with the mark"),
      from: z.string().max(80).optional().describe("The device it was drawn on: \"iPad\""),
      remove: z.string().optional().describe("Thread id of a mark to take away"),
    },
    run: async (doc, a, ctx) => {
      if (a.remove !== undefined) {
        const t = doc.comments[a.remove];
        if (!t?.ink) throw new ToolError(`mark "${a.remove}" does not exist`);
        return { label: "Erase mark", ops: [{ kind: "delete", collection: "comments", id: t.id }], reply: `Erased mark ${t.id}.` };
      }
      if (!a.strokes || [a.page, a.view, a.flow, a.sketch || undefined].filter((x) => x !== undefined).length !== 1) throw new ToolError("a new mark needs strokes and one of a page, a view, a flow or sketch: true");
      const id = new Ids(doc, ctx).next();
      const body = a.body ?? `Drew ${a.strokes.length === 1 ? "a mark" : `${a.strokes.length} strokes`}${a.from ? ` on ${a.from}` : ""}.`;
      const put = (node: Id, where: { page: Id } | { view: InkView } | { flow: Id } | { sketch: true }, reply: string): ToolOutput => ({
        label: "Mark",
        ops: [{ kind: "put", collection: "comments", value: { id, node, state: "open", posts: [{ author: ctx.author, body, at: ctx.now() }], ink: { ...where, strokes: a.strokes ?? [], ...(a.from ? { from: a.from } : {}) } } }],
        reply,
      });
      if (a.sketch) return put(SCREENS_ANCHOR, { sketch: true }, `Sketched a new screen on the canvas (thread ${id}).`);
      if (a.flow !== undefined) {
        const f = doc.flows[a.flow];
        if (!f) throw new ToolError(`flow "${a.flow}" does not exist`);
        // On the screen under it, else on the flow's first screen: either way it shows on a page in the editor.
        const under = doc.pages[a.node ?? ""] ?? doc.pages[f.start];
        if (!under) throw new ToolError(`flow "${f.name}" has no first page`);
        return put(under.frame, { flow: f.id }, `Marked the flow ${f.name} (thread ${id}).`);
      }
      if (a.view !== undefined) {
        const on = a.node !== undefined && archCollectionOf(architectureOf(doc), a.node) ? a.node : ARCHITECTURE_ANCHOR;
        return put(on, { view: a.view }, `Marked the ${a.view} view (thread ${id}).`);
      }
      const p = page(doc, a.page ?? "");
      const at = a.node !== undefined && doc.nodes[a.node] && pageOf(doc, a.node).id === p.id ? a.node : p.frame;
      return put(at, { page: p.id }, `Marked ${p.name} (thread ${id}).`);
    },
  }),

  read_marks: tool({
    description: "Read the pen marks people drew on pages (on a tablet): each one numbered, what it looks like (circle, strike, highlight), the layer under it, and the thread to answer. The handwriting is only in the picture: buni shot FILE PAGE out.png --marks.",
    input: { page: z.string().optional().describe("One page; all pages when left out") },
    run: async (doc, a) => ({ label: "Read marks", ops: [], reply: marksText(doc, a.page === undefined ? undefined : page(doc, a.page).id) }),
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
      "its size in columns and rows, and its colour depth. Resizes the page's frame to the grid. Read the terminal skill first.",
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

  export_html: tool({
    description: "One page as plain HTML and CSS, with tokens as CSS custom properties.",
    input: { page: z.string() },
    run: async (doc, a) => {
      if (!doc.pages[a.page]) throw new ToolError(`page "${a.page}" does not exist`);
      const { html, css } = renderPage(doc, a.page);
      return { label: "Export HTML", ops: [], reply: `${html}\n<style>\n${css}</style>` };
    },
  }),

  set_live: tool({
    description:
      "Make a page live, or still again. A live page runs scripts in its preview on the canvas, in Play and on the exported site, and loads libraries: " +
      "pass libraries to set the list (it replaces the old one), each {name, url} with the url pinned to a version on cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or fonts.googleapis.com " +
      "(https://cdn.jsdelivr.net/npm/motion@11.15.0/dist/motion.js, https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11, a Google Fonts css2 URL). " +
      "Its own stylesheet and script come from write_file. live: false makes it still again (its files stay on disk). Layers stay layers either way: read_tree, review_page and the Inspector see them.",
    input: {
      page: z.string(),
      live: z.boolean().default(true),
      libraries: z.array(z.object({ name: z.string().min(1).max(80), url: z.string().url() })).max(20).optional(),
    },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      if (!a.live) {
        const { live: _l, ...rest } = p;
        return { label: `${p.name} is still`, ops: [{ kind: "put", collection: "pages", value: rest }], reply: `${p.name} is a still page again: no scripts, no libraries.` };
      }
      for (const l of a.libraries ?? []) if (!LIBRARY_HOSTS.test(l.url)) throw new ToolError(`${l.name}: a library loads from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or fonts.googleapis.com, pinned to a version`);
      const live: LivePage = { ...(p.live ?? { libraries: [] }), ...(a.libraries ? { libraries: a.libraries } : {}) };
      return {
        label: `${p.name} is live`,
        ops: [{ kind: "put", collection: "pages", value: { ...p, live } }],
        reply: `${p.name} is live: scripts run in its preview and on the exported site.${live.libraries.length ? ` Libraries: ${live.libraries.map((l) => l.name).join(", ")}.` : ""} write_file gives it a stylesheet and a script.`,
      };
    },
  }),

  write_file: tool({
    description:
      "Write a live page's own stylesheet or script: the whole text of live/PAGE.css or live/PAGE.js beside the design (the page is made live if it isn't). " +
      "Reach layers by .b-ID (read_tree shows ids) or by the classes write_html keeps from class=\"\" (Tailwind's, your own). The script runs as a module in the preview and on the exported site; keep it to this page.",
    input: { page: z.string(), kind: z.enum(["css", "js"]), text: z.string().max(200_000) },
    run: async (doc, a, ctx) => {
      if (!ctx.writeFiles) throw new ToolError("This host can't write files beside the design.");
      const p = page(doc, a.page);
      const path = `live/${p.id}.${a.kind}`;
      await ctx.writeFiles("live", new Map([[`${p.id}.${a.kind}`, a.text]]));
      const live: LivePage = p.live ?? { libraries: [] };
      const ops: Op[] = [];
      let id = live[a.kind];
      if (id === undefined || doc.attachments[id]?.path !== path) {
        id = Object.values(doc.attachments).find((x) => x.path === path)?.id ?? new Ids(doc, ctx).next();
        ops.push({ kind: "put", collection: "attachments", value: { id, path, mime: a.kind === "css" ? "text/css" : "text/javascript" } });
      }
      ops.push({ kind: "put", collection: "pages", value: { ...p, live: { ...live, [a.kind]: id } } });
      return { label: `Write ${path}`, ops, reply: `Wrote ${path} (${a.text.length} characters); ${p.name} is live and shows it.` };
    },
  }),

  read_file: tool({
    description: "A live page's own stylesheet or script, as write_file wrote it.",
    input: { page: z.string(), kind: z.enum(["css", "js"]) },
    run: async (doc, a, ctx) => {
      const p = page(doc, a.page);
      const id = p.live?.[a.kind];
      const path = id === undefined ? undefined : doc.attachments[id]?.path;
      if (path === undefined) throw new ToolError(`${p.name} has no ${a.kind} file; write_file makes one`);
      return { label: `Read ${path}`, ops: [], reply: await ctx.readAttachment(path) };
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
