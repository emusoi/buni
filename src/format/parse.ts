import { sourceRefs, SOURCE_COLLECTIONS } from "./sources.ts";
import { svgProblem } from "./svg.ts";
import {
  EASINGS,
  ENTRANCES,
  FORMAT_VERSION,
  overrideTarget,
  MOTION_TRIGGERS,
  CURVE,
  RESPONSES,
  emptyDoc,
  entersOn,
  withImports,
  componentNodes,
  type Motion,
  type Attachment,
  type Comment,
  type CommentState,
  type Section,
  type Confidence,
  type Connection,
  type Doc,
  type Flow,
  type Id,
  type Journey,
  type JourneyStep,
  type Node,
  type Override,
  type Page,
  type PageOption,
  type Post,
  type Rule,
  type SharedSection,
  type Style,
  type Transition,
  type Trigger,
  type TerminalColors,
  type TerminalScreen,
  type TerminalSurface,
} from "./doc.ts";

export interface FormatError {
  /** JSON path, e.g. "nodes.n1.parent". */
  path: string;
  message: string;
}

export type ParseResult = { ok: true; doc: Doc } | { ok: false; errors: FormatError[] };

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TRIGGERS = ["click", "hover", "submit", "key"] as const satisfies readonly Trigger[];
const TERMINAL_SURFACES = [
  "app", "inline", "tmux-status", "tmux-layout", "tmux-popup", "tmux-menu", "zellij-plugin", "nvim-float", "nvim-split", "prompt", "picker",
] as const satisfies readonly TerminalSurface[];
const TERMINAL_COLORS = ["none", "16", "256", "truecolor"] as const satisfies readonly TerminalColors[];
const TRANSITIONS = ["none", "fade", "slide-left", "slide-right"] as const satisfies readonly Transition[];
const COMMENT_STATES = ["open", "addressed", "resolved"] as const satisfies readonly CommentState[];
const CONFIDENCES = [1, 2, 3, 4, 5] as const satisfies readonly Confidence[];
/**
 * What files from when buni also designed the system behind the pages held: still accepted, so they open, and never
 * read, so the next save drops them. So are a layer's "bind", a page's "client" and a link's "endpoint", and the design
 * doc's old "decisions".
 */
const LEGACY_COLLECTIONS = [
  "parts", "links", "tables", "endpoints", "operations", "events", "shapes", "traces", "environments", "clusters", "placements",
  "positions", "phases", "requirements", "questions", "roles", "reviews", "threads", "agents", "evals", "decisions",
] as const;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** A style property: camelCase (or kebab-case) CSS, or a custom property. Written into stylesheets as it is. */
const STYLE_KEY = /^(--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/;
/** How deep layers may nest: far beyond any real design, short of what rendering recursion can take. */
const MAX_DEPTH = 256;
// Values are written verbatim into exported stylesheets; these would end the rule or the <style> element.
const UNSAFE_CSS = /[{}<]/;
const CSS_MESSAGE = "CSS values cannot contain {, } or <";
/** Elements a design may not hold: exported pages stay static markup that runs and embeds nothing. */
export const UNSAFE_TAGS = ["script", "style", "iframe", "object", "embed", "link", "meta", "base", "canvas"];
/** The elements a layer may be: layout, text and form controls. Exported pages stay static markup that loads nothing. */
export const TAGS: ReadonlySet<string> = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button", "caption", "cite", "code",
  "col", "colgroup", "data", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "input", "ins", "kbd",
  "label", "legend", "li", "main", "mark", "menu", "meter", "nav", "ol", "optgroup", "option", "output", "p", "pre",
  "progress", "q", "rp", "rt", "ruby", "s", "samp", "search", "section", "select", "small", "span", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);

/** Reads raw JSON into typed values, recording every problem instead of stopping at the first. */
class Reader {
  readonly errors: FormatError[] = [];
  private readonly strings = new Map<string, string>();

  fail(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  /** A page's other widths: whole pixels, 240 to 3840, each once. */
  widths(v: unknown, path: string): number[] {
    if (!Array.isArray(v)) { this.fail(path, "expected a list of widths in px"); return []; }
    const ok = v.filter((w): w is number => typeof w === "number" && Number.isInteger(w) && w >= 240 && w <= 3840);
    if (ok.length !== v.length) this.fail(path, "widths are whole numbers of px, 240 to 3840");
    if (new Set(ok).size !== ok.length) this.fail(path, "each width once");
    return ok;
  }

  /** Styles by width: keys are whole pixel widths. */
  atStyles(v: unknown, path: string): Record<string, Style> {
    if (!isRecord(v)) { this.fail(path, "expected an object of styles by width"); return {}; }
    const out: Record<string, Style> = {};
    for (const [k, s] of Object.entries(v)) {
      if (!/^[1-9]\d{1,3}$/.test(k)) this.fail(join(path, k), "a width in px, like \"768\"");
      out[k] = this.style(s, join(path, k));
    }
    return out;
  }

  /** A flag kept only when set: true, or absent. */
  flag(v: unknown, path: string): boolean {
    if (v !== undefined && v !== true) this.fail(path, "expected true, or leave it out");
    return v === true;
  }

  obj(v: unknown, path: string, allowed: readonly string[]): Json {
    if (!isRecord(v)) {
      this.fail(path, "expected an object");
      return {};
    }
    for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) this.fail(join(path, k), "unknown key");
    }
    return v;
  }

  /** "__proto__" as an own key would reset an object's prototype instead of storing an entry. */
  safeKey(key: string, path: string): boolean {
    if (key !== "__proto__") return true;
    this.fail(path, "reserved key");
    return false;
  }

  str(v: unknown, path: string): string {
    if (typeof v === "string") return v;
    this.fail(path, "expected a string");
    return "";
  }

  optStr(v: unknown, path: string): string | undefined {
    return v === undefined ? undefined : this.str(v, path);
  }

  optNum(v: unknown, path: string): number | undefined {
    return v === undefined ? undefined : this.num(v, path);
  }

  num(v: unknown, path: string): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    this.fail(path, "expected a number");
    return 0;
  }

  oneOf<T extends string | number>(v: unknown, path: string, options: readonly [T, ...T[]]): T {
    const hit = options.find((o) => o === v);
    if (hit !== undefined) return hit;
    this.fail(path, `expected one of ${options.join(", ")}`);
    return options[0];
  }

  strMap(v: unknown, path: string): Record<string, string> {
    if (!isRecord(v)) {
      this.fail(path, "expected an object of strings");
      return {};
    }
    for (const [k, val] of Object.entries(v)) {
      const at = join(path, k);
      if (!this.safeKey(k, at)) continue;
      const text = this.str(val, at);
      const saved = this.strings.get(text);
      if (saved === undefined) this.strings.set(text, text);
      v[k] = saved ?? text;
    }
    // Keep JSON's compact objects and share repeated CSS strings without sharing mutable style maps.
    return v as Record<string, string>;
  }

  list<T>(v: unknown, path: string, item: (v: unknown, path: string) => T): T[] {
    if (!Array.isArray(v)) {
      this.fail(path, "expected an array");
      return [];
    }
    return v.map((x, i) => item(x, `${path}[${i}]`));
  }

  /** A collection keyed by id; each entry's own `id` must equal its key. */
  byId<T extends { id: Id }>(v: unknown, path: string, item: (v: unknown, path: string) => T): Record<Id, T> {
    if (!isRecord(v)) {
      this.fail(path, "expected an object keyed by id");
      return {};
    }
    const out: Record<Id, T> = {};
    // Ids reach exported HTML, CSS selectors and file names, so they're plain words. Never a built-in name, which a
    // lookup would find on every object.
    for (const [key, raw] of Object.entries(v)) {
      const p = join(path, key);
      if (!this.safeKey(key, p)) continue;
      if (!ID.test(key) || key in Object.prototype) {
        this.fail(p, `id "${key.slice(0, 40)}" must be letters, digits, - and _ (up to 128)`);
        continue;
      }
      const sources = isRecord(raw) ? raw.sources : undefined;
      let input = raw;
      if (sources !== undefined && isRecord(raw)) { const { sources: _, ...rest } = raw; input = rest; }
      let value = item(input, p);
      if (sources !== undefined) {
        const parsed = sourceRefs.safeParse(sources);
        if (!parsed.success) this.fail(join(p, "sources"), parsed.error.issues.map((e) => e.message).join("; "));
        else if (parsed.data.length) value = { ...value, sources: parsed.data };
      }
      if (value.id !== key) this.fail(join(p, "id"), `id "${value.id}" does not match its key "${key}"`);
      out[key] = value;
    }
    return out;
  }

  style(v: unknown, path: string): Style {
    return this.strMap(v, path);
  }

  node(v: unknown, path: string): Node {
    const base = ["id", "parent", "index", "name", "style", "kind", "tag", "hidden", "locked", "at", "twin", "motion"];
    const kind = isRecord(v) ? v.kind : undefined;
    const extra =
      kind === "text" ? ["text", "filled"]
      : kind === "image" ? ["asset", "alt"]
      : kind === "svg" ? ["markup"]
      : kind === "instance" ? ["shared", "overrides"]
      : [];
    // "bind" is legacy (LEGACY_COLLECTIONS): allowed, never read.
    const o = this.obj(v, path, [...base, "bind", ...extra]);
    const common = {
      id: this.str(o.id, join(path, "id")),
      parent: this.optStr(o.parent, join(path, "parent")),
      index: this.str(o.index, join(path, "index")),
      name: this.str(o.name, join(path, "name")),
      style: this.style(o.style, join(path, "style")),
      ...this.tag(o.tag, join(path, "tag")),
      ...(this.flag(o.hidden, join(path, "hidden")) ? { hidden: true as const } : {}),
      ...(this.flag(o.locked, join(path, "locked")) ? { locked: true as const } : {}),
      ...(o.at !== undefined ? { at: this.atStyles(o.at, join(path, "at")) } : {}),
      ...(o.twin !== undefined ? { twin: this.str(o.twin, join(path, "twin")) } : {}),
      ...(o.motion !== undefined ? { motion: this.motions(o.motion, join(path, "motion")) } : {}),
    };
    const at = (k: string) => join(path, k);
    switch (this.oneOf(o.kind, at("kind"), ["frame", "text", "image", "svg", "instance"] as const)) {
      case "frame":
        return { ...common, kind: "frame" };
      case "text":
        if (o.filled !== undefined && o.filled !== true) this.fail(at("filled"), "expected true, or leave it out");
        return { ...common, kind: "text", text: this.str(o.text, at("text")), ...(o.filled === true ? { filled: true as const } : {}) };
      case "image":
        return { ...common, kind: "image", asset: this.str(o.asset, at("asset")), alt: this.str(o.alt, at("alt")) };
      case "svg":
        return { ...common, kind: "svg", markup: this.str(o.markup, at("markup")) };
      case "instance":
        return {
          ...common,
          kind: "instance",
          shared: this.str(o.shared, at("shared")),
          overrides: this.overrides(o.overrides, at("overrides")),
        };
    }
  }

  motions(v: unknown, path: string): Motion[] {
    if (!Array.isArray(v)) { this.fail(path, "expected a list of motions"); return []; }
    const list = v.map((m, i) => this.motion(m, join(path, String(i))));
    if (new Set(list.map((m) => m.trigger)).size !== list.length) this.fail(path, "at most one motion per trigger");
    return list;
  }

  motion(v: unknown, path: string): Motion {
    const o = this.obj(v, path, ["trigger", "effect", "durationMs", "delayMs", "easing", "curve", "staggerMs"]);
    const trigger = this.oneOf(o.trigger, join(path, "trigger"), MOTION_TRIGGERS);
    const effect = entersOn(trigger) ? this.oneOf(o.effect, join(path, "effect"), ENTRANCES) : this.oneOf(o.effect, join(path, "effect"), RESPONSES);
    const ms = (k: "durationMs" | "delayMs" | "staggerMs") => {
      const n = this.num(o[k], join(path, k));
      if (!Number.isInteger(n) || n < 0 || n > 10_000) this.fail(join(path, k), "whole milliseconds, 0 to 10000");
      return n;
    };
    if (o.staggerMs !== undefined && !entersOn(trigger)) this.fail(join(path, "staggerMs"), "only load and scroll stagger their children");
    return {
      trigger, effect, durationMs: ms("durationMs"), easing: this.oneOf(o.easing, join(path, "easing"), EASINGS),
      ...(o.curve !== undefined ? { curve: this.curve(o.curve, join(path, "curve")) } : {}),
      ...(o.delayMs !== undefined ? { delayMs: ms("delayMs") } : {}),
      ...(o.staggerMs !== undefined ? { staggerMs: ms("staggerMs") } : {}),
    };
  }

  /** Only a cubic-bezier of four numbers: it goes into CSS as it is. */
  curve(v: unknown, path: string): string {
    const s = this.str(v, path);
    if (!CURVE.test(s)) this.fail(path, "expected cubic-bezier(x1, y1, x2, y2)");
    return s;
  }

  /** Exported pages must stay static markup, so no element that runs or embeds code. */
  tag(v: unknown, path: string): { tag?: string } {
    const tag = this.optStr(v, path);
    if (tag === undefined) return {};
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) this.fail(path, "expected a lowercase element name");
    else if (UNSAFE_TAGS.includes(tag)) this.fail(path, `"${tag}" elements are not allowed`);
    else if (!TAGS.has(tag)) this.fail(path, `"${tag}" isn't a layout, text or form element`);
    return { tag };
  }

  overrides(v: unknown, path: string): Record<Id, Override> {
    if (!isRecord(v)) {
      this.fail(path, "expected an object keyed by node id");
      return {};
    }
    const out: Record<Id, Override> = {};
    for (const [key, raw] of Object.entries(v)) {
      const p = join(path, key);
      if (!this.safeKey(key, p)) continue;
      const o = this.obj(raw, p, ["text", "style", "at", "markup"]);
      const override: Override = {};
      if (o.text !== undefined) override.text = this.str(o.text, join(p, "text"));
      if (o.markup !== undefined) override.markup = this.str(o.markup, join(p, "markup"));
      if (o.style !== undefined) override.style = this.style(o.style, join(p, "style"));
      if (o.at !== undefined) override.at = this.atStyles(o.at, join(p, "at"));
      out[key] = override;
    }
    return out;
  }

  page(v: unknown, path: string): Page {
    // "client" is legacy (LEGACY_COLLECTIONS): allowed, never read.
    const o = this.obj(v, path, ["id", "name", "route", "state", "frame", "index", "x", "y", "client", "terminal", "widths", "option"]);
    const x = this.optNum(o.x, join(path, "x"));
    const y = this.optNum(o.y, join(path, "y"));
    if ((x === undefined) !== (y === undefined)) this.fail(path, "a canvas position needs both x and y");
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      ...(o.route !== undefined ? { route: this.str(o.route, join(path, "route")) } : {}),
      ...(o.state !== undefined ? { state: this.str(o.state, join(path, "state")) } : {}),
      frame: this.str(o.frame, join(path, "frame")),
      index: this.str(o.index, join(path, "index")),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(o.terminal !== undefined ? { terminal: this.terminalScreen(o.terminal, join(path, "terminal")) } : {}),
      ...(o.widths !== undefined ? { widths: this.widths(o.widths, join(path, "widths")) } : {}),
      ...(o.option !== undefined ? { option: this.pageOption(o.option, join(path, "option")) } : {}),
    };
  }

  pageOption(v: unknown, path: string): PageOption {
    const o = this.obj(v, path, ["of", "idea"]);
    return { of: this.str(o.of, join(path, "of")), idea: this.str(o.idea, join(path, "idea")) };
  }

  terminalScreen(v: unknown, path: string): TerminalScreen {
    const o = this.obj(v, path, ["surface", "cols", "rows", "colors"]);
    const surface = this.oneOf(o.surface, join(path, "surface"), TERMINAL_SURFACES);
    const cols = this.num(o.cols, join(path, "cols"));
    const rows = this.optNum(o.rows, join(path, "rows"));
    if (!Number.isInteger(cols) || cols < 10 || cols > 500) this.fail(join(path, "cols"), "a terminal is a whole number of columns, 10 to 500");
    if (rows !== undefined && (!Number.isInteger(rows) || rows < 1 || rows > 200)) this.fail(join(path, "rows"), "a terminal is a whole number of rows, 1 to 200");
    if (surface === "inline" && rows !== undefined) this.fail(join(path, "rows"), "output printed inline has no fixed height; it grows as it prints");
    if (surface !== "inline" && rows === undefined) this.fail(join(path, "rows"), `a ${surface} screen needs a height in rows`);
    if (surface === "tmux-status" && rows !== undefined && rows !== 1) this.fail(join(path, "rows"), "tmux's status line is one row");
    return { surface, cols, ...(rows !== undefined ? { rows } : {}), colors: this.oneOf(o.colors, join(path, "colors"), TERMINAL_COLORS) };
  }

  shared(v: unknown, path: string): SharedSection {
    const o = this.obj(v, path, ["id", "name", "root", "x", "y", "variant"]);
    const x = this.optNum(o.x, join(path, "x"));
    const y = this.optNum(o.y, join(path, "y"));
    if ((x === undefined) !== (y === undefined)) this.fail(path, "a canvas position needs both x and y");
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      root: this.str(o.root, join(path, "root")),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(o.variant !== undefined ? { variant: this.strMap(o.variant, join(path, "variant")) } : {}),
    };
  }

  connection(v: unknown, path: string): Connection {
    // "endpoint" is legacy (LEGACY_COLLECTIONS): allowed, never read.
    const o = this.obj(v, path, ["id", "page", "node", "to", "trigger", "transition", "durationMs", "condition", "endpoint", "key", "nav"]);
    const c: Connection = {
      id: this.str(o.id, join(path, "id")),
      page: this.str(o.page, join(path, "page")),
      node: this.str(o.node, join(path, "node")),
      to: this.str(o.to, join(path, "to")),
      trigger: this.oneOf(o.trigger, join(path, "trigger"), TRIGGERS),
      transition: this.oneOf(o.transition, join(path, "transition"), TRANSITIONS),
      durationMs: this.num(o.durationMs, join(path, "durationMs")),
    };
    const condition = this.optStr(o.condition, join(path, "condition"));
    if (condition !== undefined) c.condition = condition;
    const key = this.optStr(o.key, join(path, "key"));
    if (c.trigger === "key" && !key?.trim()) this.fail(join(path, "key"), 'a "key" trigger says which key, e.g. "ctrl+k"');
    if (c.trigger !== "key" && key !== undefined) this.fail(join(path, "key"), 'only a "key" trigger has a key');
    if (key !== undefined) c.key = key;
    if (o.nav !== undefined && o.nav !== true) this.fail(join(path, "nav"), "expected true, or leave it out");
    if (o.nav === true) c.nav = true;
    return c;
  }

  flow(v: unknown, path: string): Flow {
    const o = this.obj(v, path, ["id", "name", "start", "index"]);
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      start: this.str(o.start, join(path, "start")),
      index: this.str(o.index, join(path, "index")),
    };
  }

  step(v: unknown, path: string): JourneyStep {
    const o = this.obj(v, path, ["page", "confidence", "cells", "evidence"]);
    const step: JourneyStep = {
      page: this.str(o.page, join(path, "page")),
      cells: this.strMap(o.cells, join(path, "cells")),
      evidence: this.list(o.evidence, join(path, "evidence"), (x, p) => this.str(x, p)),
    };
    if (o.confidence !== undefined) step.confidence = this.oneOf(o.confidence, join(path, "confidence"), CONFIDENCES);
    return step;
  }

  journey(v: unknown, path: string): Journey {
    const o = this.obj(v, path, ["id", "flow", "lanes", "steps"]);
    return {
      id: this.str(o.id, join(path, "id")),
      flow: this.str(o.flow, join(path, "flow")),
      lanes: this.list(o.lanes, join(path, "lanes"), (x, p) => this.str(x, p)),
      steps: this.list(o.steps, join(path, "steps"), (x, p) => this.step(x, p)),
    };
  }

  post(v: unknown, path: string): Post {
    const o = this.obj(v, path, ["author", "body", "at"]);
    return {
      author: this.str(o.author, join(path, "author")),
      body: this.str(o.body, join(path, "body")),
      at: this.str(o.at, join(path, "at")),
    };
  }

  comment(v: unknown, path: string): Comment {
    const o = this.obj(v, path, ["id", "node", "state", "posts"]);
    return {
      id: this.str(o.id, join(path, "id")),
      node: this.str(o.node, join(path, "node")),
      state: this.oneOf(o.state, join(path, "state"), COMMENT_STATES),
      posts: this.list(o.posts, join(path, "posts"), (x, p) => this.post(x, p)),
    };
  }

  section(v: unknown, path: string): Section {
    const o = this.obj(v, path, ["id", "heading", "body", "index"]);
    return {
      id: this.str(o.id, join(path, "id")),
      heading: this.str(o.heading, join(path, "heading")),
      body: this.str(o.body, join(path, "body")),
      index: this.str(o.index, join(path, "index")),
    };
  }

  rule(v: unknown, path: string): Rule {
    const kind = isRecord(v) ? v.kind : undefined;
    const extra = kind === "shared-required" ? ["shared", "routePrefix"] : kind === "fixed-width" ? ["width"] : [];
    const o = this.obj(v, path, ["id", "kind", ...extra]);
    const id = this.str(o.id, join(path, "id"));
    switch (this.oneOf(o.kind, join(path, "kind"), ["tokens-only", "shared-required", "fixed-width"] as const)) {
      case "tokens-only":
        return { id, kind: "tokens-only" };
      case "shared-required":
        return {
          id,
          kind: "shared-required",
          shared: this.list(o.shared, join(path, "shared"), (x, p) => this.str(x, p)),
          routePrefix: this.str(o.routePrefix, join(path, "routePrefix")),
        };
      case "fixed-width":
        return { id, kind: "fixed-width", width: this.num(o.width, join(path, "width")) };
    }
  }

  attachment(v: unknown, path: string): Attachment {
    const o = this.obj(v, path, ["id", "path", "mime"]);
    return {
      id: this.str(o.id, join(path, "id")),
      path: this.str(o.path, join(path, "path")),
      mime: this.str(o.mime, join(path, "mime")),
    };
  }

  doc(v: unknown): Doc {
    const o = this.obj(v, "", [
      "buni", "imports", "tokensRef", "tokens", "pages", "nodes", "shared", "connections",
      "flows", "journeys", "comments", "sections", "rules", "attachments",
      ...LEGACY_COLLECTIONS,
    ]);
    if (o.buni !== FORMAT_VERSION) this.fail("buni", `unsupported format version (expected ${FORMAT_VERSION})`);
    const doc = emptyDoc();
    const tokensRef = this.optStr(o.tokensRef, "tokensRef");
    if (tokensRef !== undefined) doc.tokensRef = tokensRef;
    if (o.imports !== undefined) {
      doc.imports = this.list(o.imports, "imports", (x, p) => this.str(x, p));
      doc.imports.forEach((path, i) => { if (!path.endsWith(".buni") || path.startsWith("/")) this.fail(`imports[${i}]`, "imports are relative paths to .buni files"); });
    }
    doc.tokens = this.strMap(o.tokens, "tokens");
    doc.pages = this.byId(o.pages, "pages", (x, p) => this.page(x, p));
    doc.nodes = this.byId(o.nodes, "nodes", (x, p) => this.node(x, p));
    doc.shared = this.byId(o.shared, "shared", (x, p) => this.shared(x, p));
    doc.connections = this.byId(o.connections, "connections", (x, p) => this.connection(x, p));
    doc.flows = this.byId(o.flows, "flows", (x, p) => this.flow(x, p));
    doc.journeys = this.byId(o.journeys, "journeys", (x, p) => this.journey(x, p));
    doc.comments = this.byId(o.comments, "comments", (x, p) => this.comment(x, p));
    // The design doc arrived after the format did; files without one simply have none.
    doc.sections = o.sections === undefined ? {} : this.byId(o.sections, "sections", (x, p) => this.section(x, p));
    doc.rules = this.byId(o.rules, "rules", (x, p) => this.rule(x, p));
    doc.attachments = this.byId(o.attachments, "attachments", (x, p) => this.attachment(x, p));
    return doc;
  }
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

// Unchanged drawings keep the same object through edits; the cache does not retain old documents.
const drawings = new WeakMap<Pick<Override, "markup">, { markup: string; problem: string | undefined }>();
function drawingProblem(source: Pick<Override, "markup">): string | undefined {
  const markup = source.markup;
  if (markup === undefined) return undefined;
  const known = drawings.get(source);
  if (known?.markup === markup) return known.problem;
  const problem = svgProblem(markup);
  drawings.set(source, { markup, problem });
  return problem;
}

/** Cross-references that the JSON shape alone can't express. Assumes the shape is valid. */
function checkRefs(doc: Doc, r: Reader): void {
  const { nodes, pages, shared, attachments } = doc;
  for (const collection of SOURCE_COLLECTIONS) for (const entity of Object.values(doc[collection])) {
    if (!entity.sources) continue;
    const checked = sourceRefs.safeParse(entity.sources);
    if (!checked.success) r.fail(`${collection}.${entity.id}.sources`, checked.error.issues.map((e) => e.message).join("; "));
  }

  for (const [name, value] of Object.entries(doc.tokens)) {
    if (!/^--[A-Za-z0-9_-]+$/.test(name)) r.fail(join("tokens", name), 'token names are "--" then letters, digits, - and _');
    if (UNSAFE_CSS.test(value)) r.fail(join("tokens", name), CSS_MESSAGE);
  }
  const checkStyle = (style: Style, path: string) => {
    for (const [k, v] of Object.entries(style)) {
      if (!STYLE_KEY.test(k)) r.fail(join(path, k), "a style property is a CSS name (letters, digits and -) or a --custom-property");
      else if (UNSAFE_CSS.test(v)) r.fail(join(path, k), CSS_MESSAGE);
      if (v.includes("asset:")) for (const match of v.matchAll(/url\(\s*["']?asset:([a-zA-Z0-9_-]+)["']?\s*\)/g)) if (!attachments[match[1]!]) r.fail(join(path, k), `attachment "${match[1]}" does not exist`);
    }
  };
  const checkAt = (at: Record<string, Style> | undefined, path: string) => {
    for (const [w, style] of Object.entries(at ?? {})) checkStyle(style, join(join(path, "at"), w));
  };

  // Roots: every page frame and every shared section root, each owned once.
  const rootOwner = new Map<Id, string>();
  const pageByFrame = new Map(Object.values(pages).map((pg) => [pg.frame, { widths: pg.widths ?? [] }]));
  const claimRoot = (nodeId: Id, owner: string, path: string) => {
    const n = nodes[nodeId];
    if (!n) return r.fail(path, `node "${nodeId}" does not exist`);
    if (n.parent !== undefined) return r.fail(path, `root node "${nodeId}" must not have a parent`);
    const prior = rootOwner.get(nodeId);
    if (prior) return r.fail(path, `node "${nodeId}" is already the root of ${prior}`);
    rootOwner.set(nodeId, owner);
  };
  const routes = new Map<string, Id>();
  for (const page of Object.values(pages)) {
    const p = join("pages", page.id);
    claimRoot(page.frame, `page "${page.id}"`, join(p, "frame"));
    if (nodes[page.frame] && nodes[page.frame]?.kind !== "frame") r.fail(join(p, "frame"), "page root must be a frame");
    if (page.route === undefined) {
      if (page.state !== undefined) r.fail(join(p, "state"), "a state belongs to a screen: give it that screen's route");
      continue;
    }
    if (!page.route.startsWith("/")) r.fail(join(p, "route"), 'routes start with "/"');
    // A route becomes a folder of the exported site: it may not climb out of it.
    else if (/\\|[\u0000-\u001f]/.test(page.route) || page.route.split("/").some((s) => s === "." || s === "..")) r.fail(join(p, "route"), 'a route has no "." or ".." segments, backslashes or control characters');
    if (page.state !== undefined && !page.state.trim()) r.fail(join(p, "state"), "name the state, e.g. \"Empty\" or \"Error\"");
    // A route has one screen and any number of named states of it.
    const key = `${page.route}\u0000${page.state ?? ""}`;
    const dup = routes.get(key);
    if (dup) r.fail(join(p, page.state ? "state" : "route"), page.state ? `route "${page.route}" already has a "${page.state}" state: page "${dup}"` : `route "${page.route}" is also used by page "${dup}"`);
    routes.set(key, page.id);
  }
  // An option is another take on a page that has none of its own options: it waits beside it, with no route of its own.
  for (const page of Object.values(pages)) {
    if (!page.option) continue;
    const p = join(join("pages", page.id), "option");
    const of = pages[page.option.of];
    if (!of) r.fail(join(p, "of"), `page "${page.option.of}" does not exist`);
    else if (of.id === page.id) r.fail(join(p, "of"), "a page can't be an option of itself");
    else if (of.option) r.fail(join(p, "of"), `"${of.name}" is itself an option; make this an option of "${of.option.of}"`);
    if (page.route !== undefined) r.fail(join(join("pages", page.id), "route"), "an option has no route of its own while it is one; pick_option gives it its page's");
  }
  for (const page of Object.values(pages)) {
    if (page.state === undefined || page.route === undefined) continue;
    if (!routes.has(`${page.route}\u0000`)) r.fail(join(join("pages", page.id), "route"), `no screen has route "${page.route}" for this to be a state of`);
  }
  for (const s of Object.values(shared)) claimRoot(s.root, `shared section "${s.id}"`, join(join("shared", s.id), "root"));

  // Every node hangs off exactly one root, through frames, with no cycles, and not too deep.
  const rootOf = new Map<Id, Id>();
  /**
   * Where a node's way up ends: a root, a missing parent, a cycle, or a root no page or section owns. Remembered for
   * every node on the way, so each chain is walked once however deep the tree.
   */
  const fate = new Map<Id, { root: Id } | "dangling" | "cycle" | "orphan">();
  const fateOf = (start: Node): { root: Id } | "dangling" | "cycle" | "orphan" => {
    const path: Id[] = [];
    const onPath = new Set<Id>();
    let cur: Node | undefined = start;
    let end: { root: Id } | "dangling" | "cycle" | "orphan";
    for (;;) {
      if (!cur) { end = "dangling"; break; }
      const known = fate.get(cur.id);
      if (known) { end = known; break; }
      if (onPath.has(cur.id)) { end = "cycle"; break; }
      path.push(cur.id);
      onPath.add(cur.id);
      if (cur.parent === undefined) { end = rootOwner.has(cur.id) ? { root: cur.id } : "orphan"; break; }
      cur = nodes[cur.parent];
    }
    for (const id of path) fate.set(id, end);
    return end;
  };
  const depth = new Map<Id, number>();
  const depthOf = (id: Id): number => {
    const chain: Id[] = [];
    let cur = nodes[id];
    while (cur && cur.parent !== undefined && !depth.has(cur.id) && chain.length <= MAX_DEPTH * 4) {
      chain.push(cur.id);
      cur = nodes[cur.parent];
    }
    let d = cur ? (depth.get(cur.id) ?? 0) : 0;
    for (const c of chain.reverse()) depth.set(c, ++d);
    return depth.get(id) ?? 0;
  };
  for (const n of Object.values(nodes)) {
    const p = join("nodes", n.id);
    checkStyle(n.style, join(p, "style"));
    checkAt(n.at, p);
    if (n.kind === "instance") {
      for (const [target, o] of Object.entries(n.overrides)) {
        const op = join(join(p, "overrides"), target);
        if (o.style) checkStyle(o.style, join(op, "style"));
        checkAt(o.at, op);
        // A use's own icon is held to what an svg layer is: static drawing, nothing that runs or loads.
        // The key may be a path through nested uses ("use/layer"): the layer it names must be an svg.
        const layer = o.markup === undefined ? undefined : overrideTarget({ nodes, shared }, n.shared, target);
        const problem = o.markup === undefined ? undefined : layer?.kind !== "svg" ? "only an svg layer takes markup" : drawingProblem(o);
        if (problem) r.fail(join(op, "markup"), problem);
      }
    }
    if (n.parent !== undefined) {
      const parent = nodes[n.parent];
      if (!parent) r.fail(join(p, "parent"), `parent "${n.parent}" does not exist`);
      else if (parent.kind !== "frame") r.fail(join(p, "parent"), `parent "${n.parent}" is a ${parent.kind}, only frames have children`);
    }
    const end = fateOf(n);
    if (end === "dangling") continue; // dangling parent, reported above
    if (end === "cycle") r.fail(p, "node is part of a parent cycle");
    else if (end === "orphan") r.fail(p, "node is not under any page or shared section");
    else if (depthOf(n.id) > MAX_DEPTH) r.fail(p, `layers nest at most ${MAX_DEPTH} deep`);
    else {
      rootOf.set(n.id, end.root);
      // A style at a width only draws when that width is one of its page's; any other would sit there unseen.
      const widths = pageByFrame.get(end.root)?.widths;
      if (widths) for (const w of Object.keys(n.at ?? {})) if (!widths.includes(Number(w))) r.fail(join(join(p, "at"), w), `${w}px isn't one of the page's widths (${widths.join(", ") || "none"}); add it with set_widths`);
    }
  }

  const sharedRoots = new Set(Object.values(shared).map((s) => s.root));
  for (const n of Object.values(nodes)) {
    const p = join("nodes", n.id);
    if (n.kind === "image" && !attachments[n.asset]) r.fail(join(p, "asset"), `attachment "${n.asset}" does not exist`);
    if (n.kind === "svg") {
      const problem = drawingProblem(n);
      if (problem) r.fail(join(p, "markup"), problem);
    }
    if (n.kind !== "instance") continue;
    const section = shared[n.shared];
    if (!section) {
      r.fail(join(p, "shared"), `shared section "${n.shared}" does not exist`);
      continue;
    }
    // A key is a layer of the component, or a path through the component's nested uses to a layer inside one.
    for (const target of Object.keys(n.overrides)) {
      if (!overrideTarget({ nodes, shared }, section.id, target)) {
        r.fail(join(join(p, "overrides"), target), `"${target}" is not a layer in shared section "${section.id}" or in a component it uses`);
      }
    }
  }

  // Components may hold uses of other components, but never of themselves, however far down.
  const holds = new Map<Id, Set<Id>>();
  const sectionOfRoot = new Map(Object.values(shared).map((s) => [s.root, s.id]));
  for (const n of Object.values(nodes)) {
    if (n.kind !== "instance") continue;
    const outer = sectionOfRoot.get(rootOf.get(n.id) ?? "");
    if (outer) holds.set(outer, (holds.get(outer) ?? new Set()).add(n.shared));
  }
  const state = new Map<Id, "visiting" | "done">();
  const visit = (id: Id, trail: Id[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      const loop = [...trail.slice(trail.indexOf(id)), id].map((x) => shared[x]?.name ?? x).join(" → ");
      r.fail(join("shared", id), `components can't hold themselves: ${loop}`);
      return;
    }
    state.set(id, "visiting");
    for (const inner of holds.get(id) ?? []) visit(inner, [...trail, id]);
    state.set(id, "done");
  };
  for (const id of Object.keys(shared)) visit(id, []);

  // A link may sit on a layer inside a component when the page uses that component: every use links.
  const usedOn = new Map<Id, Set<Id>>();
  for (const n of Object.values(nodes)) {
    if (n.kind !== "instance") continue;
    const root = shared[n.shared]?.root;
    const pageRoot = rootOf.get(n.id);
    if (root && pageRoot) usedOn.set(root, (usedOn.get(root) ?? new Set()).add(pageRoot));
  }
  // A component used inside another is on every page that one is on.
  for (let changed = true, rounds = 0; changed && rounds < 64; rounds++) {
    changed = false;
    for (const n of Object.values(nodes)) {
      if (n.kind !== "instance") continue;
      const root = shared[n.shared]?.root, outer = rootOf.get(n.id);
      if (!root || outer === undefined || !sharedRoots.has(outer)) continue;
      const pagesHere = usedOn.get(root) ?? new Set<Id>();
      for (const pg of usedOn.get(outer) ?? []) if (!pagesHere.has(pg)) { pagesHere.add(pg); changed = true; }
      usedOn.set(root, pagesHere);
    }
  }
  for (const c of Object.values(doc.connections)) {
    const p = join("connections", c.id);
    const page = pages[c.page];
    // A link on a component's layer may hold on every use of the component: its "page" is the component.
    const everyUse = page ? undefined : shared[c.page];
    if (!page && !everyUse) r.fail(join(p, "page"), `page or component "${c.page}" does not exist`);
    if (!nodes[c.node]) r.fail(join(p, "node"), `node "${c.node}" does not exist`);
    else if (page) {
      const root = rootOf.get(c.node);
      if (root !== page.frame && !(root && usedOn.get(root)?.has(page.frame))) r.fail(join(p, "node"), `node "${c.node}" is not on page "${c.page}"`);
    } else if (everyUse && rootOf.get(c.node) !== everyUse.root) r.fail(join(p, "node"), `node "${c.node}" is not in component "${everyUse.name}"`);
    if (!pages[c.to] && !doc.elsewhere?.[c.to]) r.fail(join(p, "to"), `page "${c.to}" does not exist here or in a file this one imports`);
    if (c.durationMs < 0) r.fail(join(p, "durationMs"), "duration cannot be negative");
  }

  for (const f of Object.values(doc.flows)) {
    if (!pages[f.start]) r.fail(join(join("flows", f.id), "start"), `page "${f.start}" does not exist`);
  }

  for (const j of Object.values(doc.journeys)) {
    const p = join("journeys", j.id);
    if (!doc.flows[j.flow]) r.fail(join(p, "flow"), `flow "${j.flow}" does not exist`);
    if (new Set(j.lanes).size !== j.lanes.length) r.fail(join(p, "lanes"), "lane names must be unique");
    j.steps.forEach((s, i) => {
      const sp = `${p}.steps[${i}]`;
      if (!pages[s.page]) r.fail(join(sp, "page"), `page "${s.page}" does not exist`);
      for (const lane of Object.keys(s.cells)) {
        if (!j.lanes.includes(lane)) r.fail(join(join(sp, "cells"), lane), `lane "${lane}" is not in this journey`);
      }
      for (const a of s.evidence) {
        if (!attachments[a]) r.fail(join(sp, "evidence"), `attachment "${a}" does not exist`);
      }
    });
  }

  for (const c of Object.values(doc.comments)) {
    const p = join("comments", c.id);
    if (!nodes[c.node]) r.fail(join(p, "node"), `node "${c.node}" does not exist`);
    if (c.posts.length === 0) r.fail(join(p, "posts"), "a comment thread needs at least one post");
  }

  for (const rule of Object.values(doc.rules)) {
    const p = join("rules", rule.id);
    if (rule.kind === "shared-required") {
      for (const s of rule.shared) if (!shared[s]) r.fail(join(p, "shared"), `shared section "${s}" does not exist`);
    }
    if (rule.kind === "fixed-width" && rule.width <= 0) r.fail(join(p, "width"), "width must be positive");
  }
}

/**
 * The document with each collection on a null prototype, so a reference such as "toString" or "constructor" finds
 * nothing rather than a method every object has, and is reported as missing.
 */
function ownOnly(doc: Doc): Doc {
  const out = { ...doc };
  for (const k of Object.keys(out)) {
    const v: unknown = Reflect.get(out, k);
    if (isRecord(v)) Reflect.set(out, k, Object.assign(Object.create(null), v));
  }
  return out;
}

/**
 * Reference checks for a document built in memory, whose shape the types already guarantee.
 * With `context` (the files it imports), references may point into those files;
 * only this file's own entries are reported, and an id in both is an error.
 */
/** A layer's element must be one a design can hold: an edit that put any other in would save a file that won't open. */
function checkTags(doc: Doc, r: Reader): void {
  for (const n of Object.values(doc.nodes)) {
    if ((n.kind === "frame" || n.kind === "text") && n.tag !== undefined) r.tag(n.tag, join(join("nodes", n.id), "tag"));
  }
}

export function validateDoc(given: Doc, givenContext?: Doc): FormatError[] {
  const doc = ownOnly(given);
  const context = givenContext && ownOnly(givenContext);
  const r = new Reader();
  checkTags(doc, r);
  if (!context) {
    checkRefs(doc, r);
    return r.errors;
  }
  checkRefs(withImports(doc, context), r);
  // Components and their nodes come in from imports; each file answers only for its own.
  const importedNodes = componentNodes(context);
  const collections = ["shared", "nodes", "connections"] as const;
  const theirs = (c: (typeof collections)[number]): Record<string, unknown> => (c === "nodes" ? importedNodes : context[c]);
  const own = (path: string) => {
    const c = collections.find((x) => path.startsWith(`${x}.`));
    if (!c) return true;
    const id = path.slice(c.length + 1).split(/[.[]/)[0] ?? "";
    return doc[c][id] !== undefined;
  };
  // An override on a layer an imported component no longer has draws nothing; a core's edit never breaks its sections.
  const goneFromImport = (path: string) => {
    const use = /^nodes\.([^.]+)\.overrides\./.exec(path)?.[1];
    const n = use === undefined ? undefined : doc.nodes[use];
    return n?.kind === "instance" && !doc.shared[n.shared] && context.shared[n.shared] !== undefined;
  };
  const errors = r.errors.filter((e) => own(e.path) && !goneFromImport(e.path));
  for (const c of collections) {
    for (const id of Object.keys(doc[c])) if (theirs(c)[id] !== undefined) errors.push({ path: `${c}.${id}`, message: `"${id}" is also in an imported file; ids are unique across files` });
  }
  return errors;
}

export function parseDoc(text: string, options: { context?: Doc; refs?: boolean } = {}): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: "", message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const r = new Reader();
  const doc = r.doc(raw);
  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  if (options.refs === false) return { ok: true, doc };
  const errors = validateDoc(doc, options.context);
  return errors.length === 0 ? { ok: true, doc } : { ok: false, errors };
}
