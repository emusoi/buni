// The helpers every design tool is built from: the tool wrapper, its errors and context, and lookups the tools share.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { CELL, EASINGS, ENTRANCES, MOTION_TRIGGERS, RESPONSES, entersOn, type Motion, childrenOf, setOf, statesOf, variantProperties, fingerprint, outline, pieceName, pageLabel, reviewCopy, type TerminalScreen, pagesInOrder, walkFlow, withImports, type Connection, type Decision, type Doc, type Endpoint, type Field, type Id, type Section, type InstanceNode, type Journey, type Link, type Node, type Page, type Part, type Access, type Cluster, type Environment, type Operation, type Phase, type Placement, type Post, type Question, type Requirement, type Role, type Thread, type QueueEvent, type Shape, type Trace, type SharedSection, type Style, type Table, type AgentDef, type EvalCase, endpointToolName, operationToolName } from "../format/doc.ts";
import { AREA_IDS } from "./areas/areas.ts";
import type { Op } from "../oplog/oplog.ts";
import { openApi, sqlSchema } from "./backend.ts";
import { layerHtml, parseHtml, renderPage, snippet, type Draft } from "./html.ts";
import { contextText, docText, parseFocus, sectionsInOrder } from "./context.ts";
import { forTarget } from "./terminal.ts";
import { placementOf } from "./topology.ts";
import { findIcons } from "./icons.ts";
import { layersOf, libraryReport, shapeOf, usesOf } from "./library.ts";

/** What a tool call produces: ops for one change (possibly none), and text for the caller. */
export interface ToolOutput {
  label: string;
  ops: Op[];
  reply: string;
}

export interface ToolContext {
  author: string;
  now: () => string;
  /** A candidate id; uniqueness is checked here, so it may be random. */
  randomId: () => Id;
  readAttachment: (path: string) => Promise<string>;
  localImports?: boolean;
  readImportFile: (path: string) => Promise<import("../editor/import-resource.ts").ImportResource>;
  saveImportImage: (base64: string, mime: string) => Promise<string>;
  /** The system of the files this one imports, for tools that read the whole system. */
  imported?: Doc;
}

/** Hands out ids unused anywhere in the document and by each other. */
export class Ids {
  private readonly taken: Set<Id>;
  constructor(doc: Doc, private readonly ctx: ToolContext) {
    // Every collection's ids, so a new one never lands on an entry of any kind (a list here fell behind once and new
    // requirements, agents and phases replaced old ones).
    this.taken = new Set(Object.entries(doc).flatMap(([k, v]) => (k !== "tokens" && typeof v === "object" && v !== null && !Array.isArray(v) ? Object.keys(v) : [])));
  }
  /** A readable id from a name ("Quote API" → "quote-api"), random when that is taken. */
  slug(name: string): Id {
    const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!s || this.taken.has(s)) return this.next();
    this.taken.add(s);
    return s;
  }
  next(): Id {
    let id = this.ctx.randomId();
    while (this.taken.has(id)) id = this.ctx.randomId();
    this.taken.add(id);
    return id;
  }
}

export class ToolError extends Error {}

/**
 * What else has to go when `edit` deletes things: their mentions in requirements and questions, their reviews and
 * threads, comments on deleted layers, and component overrides that point at them. Anything `edit` already writes is
 * left as it wrote it.
 */
export function forget(doc: Doc, edit: readonly Op[]): Op[] {
  const gone = deleted(edit);
  const written = new Set(edit.flatMap((o) => (o.kind === "put" ? [o.value.id] : [])));
  const ops: Op[] = [];
  for (const c of Object.values(doc.comments)) if (gone.has(c.node) && !gone.has(c.id) && !written.has(c.id)) ops.push({ kind: "delete", collection: "comments", id: c.id });
  for (const n of Object.values(doc.nodes)) {
    if (n.kind !== "instance" || gone.has(n.id) || written.has(n.id) || !Object.keys(n.overrides).some((id) => gone.has(id))) continue;
    ops.push({ kind: "put", collection: "nodes", value: { ...n, overrides: Object.fromEntries(Object.entries(n.overrides).filter(([id]) => !gone.has(id))) } });
  }
  for (const q of Object.values(doc.requirements)) {
    if (q.servedBy.some((id) => gone.has(id))) ops.push({ kind: "put", collection: "requirements", value: { ...q, servedBy: q.servedBy.filter((id) => !gone.has(id)) } });
  }
  for (const q of Object.values(doc.questions)) {
    if (q.about.some((id) => gone.has(id))) ops.push({ kind: "put", collection: "questions", value: { ...q, about: q.about.filter((id) => !gone.has(id)) } });
  }
  for (const id of gone) if (doc.reviews[id]) ops.push({ kind: "delete", collection: "reviews", id });
  for (const t of Object.values(doc.threads)) if (gone.has(t.target)) ops.push({ kind: "delete", collection: "threads", id: t.id });
  return ops;
}

/** The ids an op list deletes. */
export function deleted(ops: readonly Op[]): Set<Id> {
  return new Set(ops.flatMap((o) => (o.kind === "delete" ? [o.id] : [])));
}

export interface Tool {
  description: string;
  input: z.ZodRawShape;
  /** Validates raw arguments, then runs. Throws ToolError for anything the caller can fix. */
  run(doc: Doc, args: unknown, ctx: ToolContext): Promise<ToolOutput>;
}

export function tool<S extends z.ZodRawShape>(def: {
  description: string;
  input: S;
  run: (doc: Doc, args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolOutput>;
}): Tool {
  const schema = z.object(def.input);
  return {
    description: def.description,
    input: def.input,
    run: async (doc, raw, ctx) => {
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) throw new ToolError(`Invalid arguments: ${parsed.error.message}`);
      return def.run(doc, parsed.data, ctx);
    },
  };
}

export function node(doc: Doc, id: Id): Node {
  const n = doc.nodes[id];
  if (n) return n;
  // Page and component ids look like node ids; say which this is and where its nodes start.
  const page = doc.pages[id];
  if (page) throw new ToolError(`"${id}" is the page "${page.name}", not a node; its root frame is "${page.frame}"`);
  const c = doc.shared[id];
  if (c) throw new ToolError(`"${id}" is the component "${c.name}", not a node; its root node is "${c.root}"`);
  throw new ToolError(`node "${id}" does not exist`);
}

/** Index key for a new last child, or right after `after`. */
/** Where a new child goes: after `after`, first when `after` is "", last when it is left out. */
export function indexAt(doc: Doc, parent: Id, after?: Id): string {
  const siblings = childrenOf(doc, parent);
  if (after === undefined) return generateKeyBetween(siblings.at(-1)?.index ?? null, null);
  if (after === "") return generateKeyBetween(null, siblings[0]?.index ?? null);
  const i = siblings.findIndex((s) => s.id === after);
  if (i < 0) throw new ToolError(`"${after}" is not a child of "${parent}"`);
  return generateKeyBetween(siblings[i]?.index ?? null, siblings[i + 1]?.index ?? null);
}

/** The index of the sibling an insertion lands before, or null at the end. */
export function nextIndex(doc: Doc, parent: Id, after?: Id): string | null {
  const siblings = childrenOf(doc, parent);
  if (after === undefined) return null;
  if (after === "") return siblings[0]?.index ?? null;
  return siblings[siblings.findIndex((s) => s.id === after) + 1]?.index ?? null;
}

/** The top of the tree a node is in: a page's frame or a component's root. */
export function rootOf(doc: Doc, id: Id): Id {
  let n = node(doc, id);
  while (n.parent !== undefined) n = node(doc, n.parent);
  return n.id;
}

/** Whether a layer sits on a terminal screen, where spaces in text are layout and are kept. */
export const onTerminal = (doc: Doc, id: Id): boolean => {
  const root = rootOf(doc, id);
  return Object.values(doc.pages).some((p) => p.frame === root && p.terminal !== undefined);
};

export function subtree(doc: Doc, id: Id): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    for (const c of childrenOf(doc, n.id)) walk(c);
  };
  walk(node(doc, id));
  return out;
}

export const terminalScreen = z.object({
  surface: z.enum(["app", "inline", "tmux-status", "tmux-layout", "tmux-popup", "tmux-menu", "zellij-plugin", "nvim-float", "nvim-split", "prompt", "picker"]),
  cols: z.number().int().min(10).max(500).describe("Width in columns, e.g. 120 for an app, 80 for the narrow case"),
  rows: z.number().int().min(1).max(200).optional().describe("Height in rows; leave out for output printed inline"),
  colors: z.enum(["none", "16", "256", "truecolor"]).default("16"),
});

/** A terminal screen's frame: its grid in cells, one monospace font, the terminal's own dark ground. */
export function screenStyle(t: TerminalScreen, keep: Style = {}): Style {
  const { height: _, ...rest } = keep;
  return {
    background: "var(--term-bg)", color: "var(--term-fg)", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: "15px", lineHeight: `${CELL.h}px`,
    ...rest,
    width: `${t.cols * CELL.w}px`,
    ...(t.rows !== undefined ? { height: `${t.rows * CELL.h}px`, overflow: "hidden" } : {}),
  };
}

export function page(doc: Doc, id: Id): Page {
  const p = doc.pages[id];
  if (!p) throw new ToolError(`page "${id}" does not exist`);
  return p;
}

/** The page a node is drawn on; shared section sources are on none. */
export function pageOf(doc: Doc, id: Id): Page {
  let n = node(doc, id);
  while (n.parent !== undefined) n = node(doc, n.parent);
  const root = n.id;
  const p = Object.values(doc.pages).find((pg) => pg.frame === root);
  if (!p) throw new ToolError(`node "${id}" is not on a page`);
  return p;
}

/** The pages a node links on: its own page, or for a layer in a component, every page that uses that component. */
export function linkPages(doc: Doc, id: Id): Page[] {
  let n = node(doc, id);
  while (n.parent !== undefined) n = node(doc, n.parent);
  const root = n.id;
  const own = Object.values(doc.pages).find((pg) => pg.frame === root);
  if (own) return [own];
  const shared = Object.values(doc.shared).find((x) => x.root === root);
  if (!shared) throw new ToolError(`node "${id}" is not on a page or in a component`);
  const pages = new Map<Id, Page>();
  for (const i of Object.values(doc.nodes)) {
    if (i.kind !== "instance" || i.shared !== shared.id) continue;
    let top: Node = i;
    while (top.parent !== undefined) top = node(doc, top.parent);
    const p = Object.values(doc.pages).find((pg) => pg.frame === top.id);
    if (p) pages.set(p.id, p);
  }
  if (!pages.size) throw new ToolError(`component "${shared.name}" isn't on any page yet: place it on its pages first (place_component), then connect once; the link reaches every page that uses it, and pages it's placed on later`);
  return pagesInOrder(doc).filter((p) => pages.has(p.id));
}

/**
 * Nodes for drafts under a parent, in order from firstIndex and below `hi` (the next sibling's index), so a run
 * inserted mid-list stays together. `idFor` lets a draft keep an existing layer's id.
 */
export function draftOps(ids: Ids, drafts: Draft[], parent: Id, firstIndex: string, created: Id[], hi: string | null = null, idFor?: (d: Draft) => Id | undefined, keptIndex?: (id: Id) => string | undefined): Op[] {
  const ops: Op[] = [];
  let prev: string | null = null;
  for (const d of drafts) {
    const id = idFor?.(d) ?? ids.next();
    // A layer that keeps its id keeps its place too, when that still sits in order.
    const was = idFor ? keptIndex?.(id) : undefined;
    const fits = was !== undefined && (prev === null ? was === firstIndex || (hi === null || was < hi) : was > prev && (hi === null || was < hi));
    const index: string = fits ? was : prev === null ? firstIndex : generateKeyBetween(prev, hi);
    prev = index;
    created.push(id);
    const base = { id, parent, index, name: d.name, style: d.style, ...(d.sources?.length ? { sources: d.sources } : {}) };
    switch (d.kind) {
      case "frame":
        ops.push({ kind: "put", collection: "nodes", value: { ...base, kind: "frame", ...(d.tag ? { tag: d.tag } : {}) } });
        ops.push(...draftOps(ids, d.children, id, generateKeyBetween(null, null), created, null, idFor, keptIndex));
        break;
      case "text":
        ops.push({ kind: "put", collection: "nodes", value: { ...base, kind: "text", text: d.text, ...(d.tag ? { tag: d.tag } : {}), ...(d.filled ? { filled: true } : {}) } });
        break;
      case "image":
        ops.push({ kind: "put", collection: "nodes", value: { ...base, kind: "image", asset: d.asset, alt: d.alt } });
        break;
      case "svg":
        ops.push({ kind: "put", collection: "nodes", value: { ...base, kind: "svg", markup: d.markup } });
        break;
      case "instance":
        ops.push({ kind: "put", collection: "nodes", value: { ...base, kind: "instance", shared: d.shared, overrides: {} } });
        break;
    }
  }
  return ops;
}

export const styleValues = z.record(z.string(), z.string()).describe('CSS properties in camelCase or kebab-case; "" removes a property');

/**
 * The design tools: the only way buni's agent, MCP clients and the app change a document.
 * Attachment reads and HTML import assets go through the workspace storage boundary.
 */
export const ACCESS = z.object({
  who: z.enum(["public", "signed-in", "roles"]),
  roles: z.array(z.string()).optional().describe('Role ids, when who is "roles"'),
  rule: z.string().optional().describe('Which rows: "only their workspace\'s projects"'),
}).optional().describe("Who may call it; kept when omitted");
export const CACHE = z.object({
  part: z.string().describe("A cache part"),
  ttlSeconds: z.number().int().positive(),
  key: z.string().min(1).describe('What varies the entry, e.g. "plans" or "quote:{id}"; include every argument that changes the answer'),
});
export const ERRORS = z.array(z.object({ code: z.string().min(1).describe('"409", "NOT_FOUND"'), when: z.string().min(1) })).optional().describe("Failures a caller must handle");

export const FIELD = z.object({
  name: z.string().min(1),
  type: z.string().min(1).describe('id, string, integer, number, boolean, datetime, or a shape name ("Quote"); add [] for a list'),
  optional: z.boolean().optional(),
  example: z.union([z.string(), z.number(), z.boolean()]).optional().describe('A value it might hold, e.g. "Monstera": the mock API and evals use it so they read like the product'),
});
export const BODY = z.union([z.array(FIELD), z.string().min(1)]).optional();

/** An endpoint body as stored: a shape (named by id or name) whole, or a list of fields. */
export function body(doc: Doc, side: "request" | "response", v: string | Field[]): { fields: Field[]; shape?: Id | undefined } {
  if (typeof v !== "string") return { fields: v };
  const shape = doc.shapes[v] ?? Object.values(doc.shapes).find((s) => s.name === v);
  if (!shape) throw new ToolError(`no shape "${v}"; add it with set_shape, or give the ${side} as fields`);
  return { fields: [], shape: shape.id };
}
