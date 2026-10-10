import { sourceRefs, SOURCE_COLLECTIONS } from "./sources.ts";
import { svgProblem } from "./svg.ts";
import {
  EASINGS,
  ENTRANCES,
  FORMAT_VERSION,
  overrideTarget,
  MOTION_TRIGGERS,
  RESPONSES,
  emptyDoc,
  entersOn,
  type Motion,
  type Attachment,
  type Bind,
  type Column,
  type Endpoint,
  type ErrorCase,
  type Operation,
  type OperationKind,
  type Trace,
  type TraceStep,
  type ApiStyle,
  type CanvasPosition,
  type Access,
  type DataClass,
  type FailurePolicy,
  type Phase,
  type Priority,
  type Question,
  type Requirement,
  type Review,
  type ReviewState,
  type Role,
  type Thread,
  CANVAS_VIEWS,
  type Cluster,
  type ClusterKind,
  type Environment,
  type Placement,
  type Runtime,
  callable,
  responseFields,
  type Field,
  type Link,
  type LinkKind,
  type Method,
  type Part,
  type PartKind,
  type QueueEvent,
  type Shape,
  PRIMITIVES,
  SYSTEM_COLLECTIONS,
  withImports,
  type Table,
  type Comment,
  type CommentState,
  type Decision,
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
  type Post,
  type Rule,
  type SharedSection,
  type Style,
  type Transition,
  type Trigger,
  type TerminalClient,
  type TerminalColors,
  type TerminalFramework,
  type TerminalLanguage,
  type TerminalScreen,
  type TerminalSurface,
  type TerminalTarget,
  FRAMEWORK_LANGUAGE,
  type AgentDef,
  type EvalCase,
  endpointToolName,
  operationToolName,
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
const TERMINAL_LANGUAGES = ["go", "rust", "python", "typescript"] as const satisfies readonly TerminalLanguage[];
const TERMINAL_FRAMEWORKS = ["bubbletea", "ratatui", "textual", "ink", "opentui", "pi-tui"] as const satisfies readonly TerminalFramework[];
const TERMINAL_SURFACES = [
  "app", "inline", "tmux-status", "tmux-layout", "tmux-popup", "tmux-menu", "zellij-plugin", "nvim-float", "nvim-split", "prompt", "picker",
] as const satisfies readonly TerminalSurface[];
const TERMINAL_COLORS = ["none", "16", "256", "truecolor"] as const satisfies readonly TerminalColors[];
const TRANSITIONS = ["none", "fade", "slide-left", "slide-right"] as const satisfies readonly Transition[];
const COMMENT_STATES = ["open", "addressed", "resolved"] as const satisfies readonly CommentState[];
const CONFIDENCES = [1, 2, 3, 4, 5] as const satisfies readonly Confidence[];
const PART_KINDS = ["client", "service", "store", "cache", "queue", "external"] as const satisfies readonly PartKind[];
const LINK_KINDS = ["calls", "reads", "writes", "publishes", "subscribes"] as const satisfies readonly LinkKind[];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const satisfies readonly Method[];
const OPERATION_KINDS = ["query", "mutation", "subscription"] as const satisfies readonly OperationKind[];
const API_STYLES = ["rest", "graphql", "none"] as const satisfies readonly ApiStyle[];
const PRIORITIES = ["must", "should", "could"] as const satisfies readonly Priority[];
const REVIEW_STATES = ["draft", "proposed", "changes", "approved"] as const satisfies readonly ReviewState[];
const DATA_CLASSES = ["personal", "secret"] as const satisfies readonly DataClass[];
const CLUSTER_KINDS = ["kubernetes", "ecs", "nomad", "vms"] as const satisfies readonly ClusterKind[];
const RUNTIMES = ["deployment", "statefulset", "daemonset", "cronjob", "job", "container", "function", "static", "managed", "vm"] as const satisfies readonly Runtime[];
/** Workloads Kubernetes schedules. */
const K8S_RUNTIMES: readonly Runtime[] = ["deployment", "statefulset", "daemonset", "cronjob", "job"];
/** A DNS label: Kubernetes names and namespaces. */
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
// Column types are written verbatim into exported SQL: words, an optional (n) or (n,m), an optional [].
const SQL_TYPE = /^[a-z][a-z0-9_]*( [a-z][a-z0-9_]*)*( ?\(\d+( ?, ?\d+)?\))?(\[\])?$/i;
/** What each kind of link may point at. */
const LINK_TARGET: Record<LinkKind, readonly PartKind[]> = {
  calls: ["service", "external"],
  reads: ["store", "cache"],
  writes: ["store", "cache"],
  publishes: ["queue"],
  subscribes: ["queue"],
};
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const POSITION_ID = /^[A-Za-z0-9_:-]{1,256}$/;
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
const TAGS = new Set([
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

  fail(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  /** A JSON object kept as text (a review's snapshot of what it approved), checked so reading it back can't fail. */
  jsonObject(v: unknown, path: string): string {
    const text = this.str(v, path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!isRecord(parsed)) this.fail(path, "expected a JSON object, as text");
    return text;
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

  optBool(v: unknown, path: string): boolean | undefined {
    if (v === undefined || typeof v === "boolean") return v;
    this.fail(path, "expected true or false");
    return undefined;
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
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (this.safeKey(k, join(path, k))) out[k] = this.str(val, join(path, k));
    return out;
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
    // Ids reach exported HTML, CSS selectors and file names, so they're plain words; a canvas position names a view
    // and a thing ("system:api"). Never a built-in name, which a lookup would find on every object.
    const shape = path === "positions" ? POSITION_ID : ID;
    for (const [key, raw] of Object.entries(v)) {
      const p = join(path, key);
      if (!this.safeKey(key, p)) continue;
      if (!shape.test(key) || key in Object.prototype) {
        this.fail(p, `id "${key.slice(0, 40)}" must be letters, digits, - and _ (up to 128)`);
        continue;
      }
      const sources = isRecord(raw) && path !== "positions" && path !== "reviews" ? raw.sources : undefined;
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
    const base = ["id", "parent", "index", "name", "style", "kind", "tag", "bind", "hidden", "locked", "at", "twin", "motion"];
    const kind = isRecord(v) ? v.kind : undefined;
    const extra =
      kind === "text" ? ["text", "filled"]
      : kind === "image" ? ["asset", "alt"]
      : kind === "svg" ? ["markup"]
      : kind === "instance" ? ["shared", "overrides"]
      : [];
    const o = this.obj(v, path, [...base, ...extra]);
    const common = {
      id: this.str(o.id, join(path, "id")),
      parent: this.optStr(o.parent, join(path, "parent")),
      index: this.str(o.index, join(path, "index")),
      name: this.str(o.name, join(path, "name")),
      style: this.style(o.style, join(path, "style")),
      ...this.tag(o.tag, join(path, "tag")),
      ...(o.bind !== undefined ? { bind: this.bind(o.bind, join(path, "bind")) } : {}),
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
    const o = this.obj(v, path, ["trigger", "effect", "durationMs", "delayMs", "easing", "staggerMs"]);
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
      ...(o.delayMs !== undefined ? { delayMs: ms("delayMs") } : {}),
      ...(o.staggerMs !== undefined ? { staggerMs: ms("staggerMs") } : {}),
    };
  }

  bind(v: unknown, path: string): Bind {
    const o = this.obj(v, path, ["endpoint", "field"]);
    return { endpoint: this.str(o.endpoint, join(path, "endpoint")), field: this.str(o.field, join(path, "field")) };
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
    const o = this.obj(v, path, ["id", "name", "route", "state", "frame", "index", "x", "y", "client", "terminal", "widths"]);
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
      ...(o.client !== undefined ? { client: this.str(o.client, join(path, "client")) } : {}),
      ...(o.terminal !== undefined ? { terminal: this.terminalScreen(o.terminal, join(path, "terminal")) } : {}),
      ...(o.widths !== undefined ? { widths: this.widths(o.widths, join(path, "widths")) } : {}),
    };
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

  terminalClient(v: unknown, path: string): TerminalClient {
    const o = this.obj(v, path, ["targets"]);
    const p = join(path, "targets");
    if (!Array.isArray(o.targets) || o.targets.length === 0) {
      this.fail(p, "a terminal client is built at least one way: a language, and a framework if it draws full screens");
      return { targets: [] };
    }
    const targets = o.targets.map((t, i) => this.terminalTarget(t, `${p}[${i}]`));
    const names = targets.map((t) => t.framework ?? t.language);
    names.forEach((n, i) => names.indexOf(n) !== i && this.fail(`${p}[${i}]`, `${n} is already a target`));
    return { targets };
  }

  terminalTarget(v: unknown, path: string): TerminalTarget {
    const o = this.obj(v, path, ["language", "framework"]);
    const language = this.oneOf(o.language, join(path, "language"), TERMINAL_LANGUAGES);
    if (o.framework === undefined) return { language };
    const framework = this.oneOf(o.framework, join(path, "framework"), TERMINAL_FRAMEWORKS);
    if (FRAMEWORK_LANGUAGE[framework] !== language) this.fail(join(path, "framework"), `${framework} is a ${FRAMEWORK_LANGUAGE[framework]} framework, not ${language}`);
    return { language, framework };
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
    const endpoint = this.optStr(o.endpoint, join(path, "endpoint"));
    if (endpoint !== undefined) c.endpoint = endpoint;
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

  decision(v: unknown, path: string): Decision {
    const o = this.obj(v, path, ["id", "text", "by", "at"]);
    return {
      id: this.str(o.id, join(path, "id")),
      text: this.str(o.text, join(path, "text")),
      by: this.str(o.by, join(path, "by")),
      at: this.str(o.at, join(path, "at")),
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

  part(v: unknown, path: string): Part {
    const o = this.obj(v, path, ["id", "kind", "name", "purpose", "tech", "api", "ifDown", "terminal", "index", "x", "y"]);
    const x = this.optNum(o.x, join(path, "x"));
    const y = this.optNum(o.y, join(path, "y"));
    if ((x === undefined) !== (y === undefined)) this.fail(path, "a canvas position needs both x and y");
    const tech = this.optStr(o.tech, join(path, "tech"));
    return {
      id: this.str(o.id, join(path, "id")),
      kind: this.oneOf(o.kind, join(path, "kind"), PART_KINDS),
      name: this.str(o.name, join(path, "name")),
      purpose: this.str(o.purpose, join(path, "purpose")),
      ...(tech !== undefined ? { tech } : {}),
      ...(o.api !== undefined ? { api: this.oneOf(o.api, join(path, "api"), API_STYLES) } : {}),
      ...(o.ifDown !== undefined ? { ifDown: this.str(o.ifDown, join(path, "ifDown")) } : {}),
      ...(o.terminal !== undefined ? { terminal: this.terminalClient(o.terminal, join(path, "terminal")) } : {}),
      index: this.str(o.index, join(path, "index")),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    };
  }

  link(v: unknown, path: string): Link {
    const o = this.obj(v, path, ["id", "from", "to", "kind", "note", "carries", "failure"]);
    const note = this.optStr(o.note, join(path, "note"));
    return {
      id: this.str(o.id, join(path, "id")),
      from: this.str(o.from, join(path, "from")),
      to: this.str(o.to, join(path, "to")),
      kind: this.oneOf(o.kind, join(path, "kind"), LINK_KINDS),
      ...(note !== undefined ? { note } : {}),
      ...(o.carries !== undefined ? { carries: this.list(o.carries, join(path, "carries"), (x, p) => this.str(x, p)) } : {}),
      ...(o.failure !== undefined ? { failure: this.failure(o.failure, join(path, "failure")) } : {}),
    };
  }

  column(v: unknown, path: string): Column {
    const o = this.obj(v, path, ["name", "type", "primary", "nullable", "unique", "ref", "classification"]);
    const c: Column = { name: this.str(o.name, join(path, "name")), type: this.str(o.type, join(path, "type")) };
    const primary = this.optBool(o.primary, join(path, "primary"));
    const nullable = this.optBool(o.nullable, join(path, "nullable"));
    const unique = this.optBool(o.unique, join(path, "unique"));
    if (primary !== undefined) c.primary = primary;
    if (nullable !== undefined) c.nullable = nullable;
    if (unique !== undefined) c.unique = unique;
    if (o.classification !== undefined) c.classification = this.oneOf(o.classification, join(path, "classification"), DATA_CLASSES);
    if (o.ref !== undefined) {
      const r = this.obj(o.ref, join(path, "ref"), ["table", "column"]);
      c.ref = { table: this.str(r.table, join(join(path, "ref"), "table")), column: this.str(r.column, join(join(path, "ref"), "column")) };
    }
    return c;
  }

  table(v: unknown, path: string): Table {
    const o = this.obj(v, path, ["id", "store", "name", "columns", "index", "x", "y"]);
    const x = this.optNum(o.x, join(path, "x"));
    const y = this.optNum(o.y, join(path, "y"));
    if ((x === undefined) !== (y === undefined)) this.fail(path, "a canvas position needs both x and y");
    return {
      id: this.str(o.id, join(path, "id")),
      store: this.str(o.store, join(path, "store")),
      name: this.str(o.name, join(path, "name")),
      columns: this.list(o.columns, join(path, "columns"), (x, p) => this.column(x, p)),
      index: this.str(o.index, join(path, "index")),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    };
  }

  field(v: unknown, path: string): Field {
    const o = this.obj(v, path, ["name", "type", "optional", "example"]);
    const f: Field = { name: this.str(o.name, join(path, "name")), type: this.str(o.type, join(path, "type")) };
    const optional = this.optBool(o.optional, join(path, "optional"));
    if (optional !== undefined) f.optional = optional;
    if (o.example !== undefined) {
      if (typeof o.example === "string" || typeof o.example === "number" || typeof o.example === "boolean") f.example = o.example;
      else this.fail(join(path, "example"), "an example is text, a number or true/false");
    }
    return f;
  }

  endpoint(v: unknown, path: string): Endpoint {
    const o = this.obj(v, path, ["id", "service", "method", "path", "summary", "request", "response", "requestShape", "responseShape", "reads", "writes", "emits", "cache", "invalidates", "errors", "access", "index"]);
    const at = (k: string) => join(path, k);
    const ids = (k: string) => this.list(o[k], at(k), (x, p) => this.str(x, p));
    const fields = (k: string) => this.list(o[k], at(k), (x, p) => this.field(x, p));
    return {
      id: this.str(o.id, at("id")),
      service: this.str(o.service, at("service")),
      method: this.oneOf(o.method, at("method"), METHODS),
      path: this.str(o.path, at("path")),
      summary: this.str(o.summary, at("summary")),
      request: fields("request"),
      response: fields("response"),
      ...(o.requestShape !== undefined ? { requestShape: this.str(o.requestShape, at("requestShape")) } : {}),
      ...(o.responseShape !== undefined ? { responseShape: this.str(o.responseShape, at("responseShape")) } : {}),
      reads: ids("reads"),
      writes: ids("writes"),
      emits: ids("emits"),
      ...(o.cache !== undefined ? { cache: this.cachePolicy(o.cache, at("cache")) } : {}),
      ...(o.invalidates !== undefined ? { invalidates: ids("invalidates") } : {}),
      ...(o.errors !== undefined ? { errors: this.errorCases(o.errors, at("errors")) } : {}),
      ...(o.access !== undefined ? { access: this.access(o.access, at("access")) } : {}),
      index: this.str(o.index, at("index")),
    };
  }

  access(v: unknown, path: string): Access {
    const o = this.obj(v, path, ["who", "roles", "rule"]);
    const a: Access = { who: this.oneOf(o.who, join(path, "who"), ["public", "signed-in", "roles"] as const) };
    if (o.roles !== undefined) a.roles = this.list(o.roles, join(path, "roles"), (x, p) => this.str(x, p));
    const rule = this.optStr(o.rule, join(path, "rule"));
    if (rule !== undefined) a.rule = rule;
    return a;
  }

  failure(v: unknown, path: string): FailurePolicy {
    const o = this.obj(v, path, ["timeoutMs", "retries", "idempotencyKey", "fallback"]);
    const f: FailurePolicy = {};
    const t = this.optNum(o.timeoutMs, join(path, "timeoutMs"));
    const r = this.optNum(o.retries, join(path, "retries"));
    const k = this.optStr(o.idempotencyKey, join(path, "idempotencyKey"));
    const fb = this.optStr(o.fallback, join(path, "fallback"));
    if (t !== undefined) f.timeoutMs = t;
    if (r !== undefined) f.retries = r;
    if (k !== undefined) f.idempotencyKey = k;
    if (fb !== undefined) f.fallback = fb;
    return f;
  }

  phase(v: unknown, path: string): Phase {
    const o = this.obj(v, path, ["id", "name", "goal", "index"]);
    const goal = this.optStr(o.goal, join(path, "goal"));
    return { id: this.str(o.id, join(path, "id")), name: this.str(o.name, join(path, "name")), ...(goal !== undefined ? { goal } : {}), index: this.str(o.index, join(path, "index")) };
  }

  requirement(v: unknown, path: string): Requirement {
    const o = this.obj(v, path, ["id", "title", "detail", "priority", "phase", "servedBy", "index"]);
    const detail = this.optStr(o.detail, join(path, "detail"));
    const phase = this.optStr(o.phase, join(path, "phase"));
    return {
      id: this.str(o.id, join(path, "id")), title: this.str(o.title, join(path, "title")),
      ...(detail !== undefined ? { detail } : {}),
      priority: this.oneOf(o.priority, join(path, "priority"), PRIORITIES),
      ...(phase !== undefined ? { phase } : {}),
      servedBy: this.list(o.servedBy, join(path, "servedBy"), (x, p) => this.str(x, p)),
      index: this.str(o.index, join(path, "index")),
    };
  }

  question(v: unknown, path: string): Question {
    const o = this.obj(v, path, ["id", "kind", "text", "options", "status", "chosen", "about", "by", "at", "index"]);
    const chosen = this.optStr(o.chosen, join(path, "chosen"));
    return {
      id: this.str(o.id, join(path, "id")),
      kind: this.oneOf(o.kind, join(path, "kind"), ["question", "assumption"] as const),
      text: this.str(o.text, join(path, "text")),
      options: this.list(o.options, join(path, "options"), (x, p) => {
        const q = this.obj(x, p, ["name", "pros", "cons"]);
        const pros = this.optStr(q.pros, join(p, "pros"));
        const cons = this.optStr(q.cons, join(p, "cons"));
        return { name: this.str(q.name, join(p, "name")), ...(pros !== undefined ? { pros } : {}), ...(cons !== undefined ? { cons } : {}) };
      }),
      status: this.oneOf(o.status, join(path, "status"), ["open", "decided"] as const),
      ...(chosen !== undefined ? { chosen } : {}),
      about: this.list(o.about, join(path, "about"), (x, p) => this.str(x, p)),
      by: this.str(o.by, join(path, "by")), at: this.str(o.at, join(path, "at")),
      index: this.str(o.index, join(path, "index")),
    };
  }

  agent(v: unknown, path: string): AgentDef {
    const o = this.obj(v, path, ["id", "name", "instructions", "model", "tools", "never", "index"]);
    const model = this.optStr(o.model, join(path, "model"));
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      instructions: this.str(o.instructions, join(path, "instructions")),
      ...(model !== undefined ? { model } : {}),
      tools: this.list(o.tools, join(path, "tools"), (x, p) => this.str(x, p)),
      never: this.list(o.never, join(path, "never"), (x, p) => this.str(x, p)),
      index: this.str(o.index, join(path, "index")),
    };
  }

  evalCase(v: unknown, path: string): EvalCase {
    const o = this.obj(v, path, ["id", "agent", "ask", "must", "given", "index"]);
    // Tool names to whatever JSON each answers: free keys, so checked only as an object.
    const given = o.given === undefined ? undefined : isRecord(o.given) ? o.given : (this.fail(join(path, "given"), "expected an object of tool answers"), undefined);
    return {
      id: this.str(o.id, join(path, "id")),
      agent: this.str(o.agent, join(path, "agent")),
      ask: this.str(o.ask, join(path, "ask")),
      must: this.list(o.must, join(path, "must"), (x, p) => this.str(x, p)),
      ...(given ? { given } : {}),
      index: this.str(o.index, join(path, "index")),
    };
  }

  role(v: unknown, path: string): Role {
    const o = this.obj(v, path, ["id", "name", "description", "index"]);
    return { id: this.str(o.id, join(path, "id")), name: this.str(o.name, join(path, "name")), description: this.str(o.description, join(path, "description")), index: this.str(o.index, join(path, "index")) };
  }

  review(v: unknown, path: string): Review {
    const o = this.obj(v, path, ["id", "state", "by", "at", "fingerprint", "was", "approved"]);
    const a = o.approved === undefined ? undefined : this.obj(o.approved, join(path, "approved"), ["by", "at", "was"]);
    return {
      id: this.str(o.id, join(path, "id")), state: this.oneOf(o.state, join(path, "state"), REVIEW_STATES), by: this.str(o.by, join(path, "by")), at: this.str(o.at, join(path, "at")),
      ...(o.fingerprint !== undefined ? { fingerprint: this.str(o.fingerprint, join(path, "fingerprint")) } : {}),
      ...(o.was !== undefined ? { was: this.jsonObject(o.was, join(path, "was")) } : {}),
      ...(a ? { approved: { by: this.str(a.by, join(join(path, "approved"), "by")), at: this.str(a.at, join(join(path, "approved"), "at")), ...(a.was !== undefined ? { was: this.jsonObject(a.was, join(join(path, "approved"), "was")) } : {}) } } : {}),
    };
  }

  thread(v: unknown, path: string): Thread {
    const o = this.obj(v, path, ["id", "target", "state", "posts"]);
    return {
      id: this.str(o.id, join(path, "id")), target: this.str(o.target, join(path, "target")),
      state: this.oneOf(o.state, join(path, "state"), COMMENT_STATES),
      posts: this.list(o.posts, join(path, "posts"), (x, p) => this.post(x, p)),
    };
  }

  errorCases(v: unknown, path: string): ErrorCase[] {
    return this.list(v, path, (x, p) => {
      const o = this.obj(x, p, ["code", "when"]);
      return { code: this.str(o.code, join(p, "code")), when: this.str(o.when, join(p, "when")) };
    });
  }

  operation(v: unknown, path: string): Operation {
    const o = this.obj(v, path, ["id", "service", "kind", "name", "summary", "args", "returns", "nullable", "reads", "writes", "emits", "cache", "invalidates", "errors", "access", "index"]);
    const at = (k: string) => join(path, k);
    const ids = (k: string) => this.list(o[k], at(k), (x, p) => this.str(x, p));
    const nullable = this.optBool(o.nullable, at("nullable"));
    return {
      id: this.str(o.id, at("id")),
      service: this.str(o.service, at("service")),
      kind: this.oneOf(o.kind, at("kind"), OPERATION_KINDS),
      name: this.str(o.name, at("name")),
      summary: this.str(o.summary, at("summary")),
      args: this.list(o.args, at("args"), (x, p) => this.field(x, p)),
      returns: this.str(o.returns, at("returns")),
      ...(nullable !== undefined ? { nullable } : {}),
      reads: ids("reads"),
      writes: ids("writes"),
      emits: ids("emits"),
      ...(o.cache !== undefined ? { cache: this.cachePolicy(o.cache, at("cache")) } : {}),
      ...(o.invalidates !== undefined ? { invalidates: ids("invalidates") } : {}),
      ...(o.errors !== undefined ? { errors: this.errorCases(o.errors, at("errors")) } : {}),
      ...(o.access !== undefined ? { access: this.access(o.access, at("access")) } : {}),
      index: this.str(o.index, at("index")),
    };
  }

  trace(v: unknown, path: string): Trace {
    const o = this.obj(v, path, ["id", "name", "page", "steps", "index"]);
    const page = this.optStr(o.page, join(path, "page"));
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      ...(page !== undefined ? { page } : {}),
      steps: this.list(o.steps, join(path, "steps"), (x, p) => this.traceStep(x, p)),
      index: this.str(o.index, join(path, "index")),
    };
  }

  traceStep(v: unknown, path: string): TraceStep {
    const o = this.obj(v, path, ["from", "to", "action", "via", "carries", "async", "ms", "ifFails"]);
    const step: TraceStep = { from: this.str(o.from, join(path, "from")), to: this.str(o.to, join(path, "to")), action: this.str(o.action, join(path, "action")) };
    const via = this.optStr(o.via, join(path, "via"));
    const carries = this.optStr(o.carries, join(path, "carries"));
    const async = this.optBool(o.async, join(path, "async"));
    const ms = this.optNum(o.ms, join(path, "ms"));
    if (via !== undefined) step.via = via;
    if (carries !== undefined) step.carries = carries;
    if (async !== undefined) step.async = async;
    if (ms !== undefined) step.ms = ms;
    const ifFails = this.optStr(o.ifFails, join(path, "ifFails"));
    if (ifFails !== undefined) step.ifFails = ifFails;
    return step;
  }

  environment(v: unknown, path: string): Environment {
    const o = this.obj(v, path, ["id", "name", "provider", "regions", "index"]);
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      provider: this.str(o.provider, join(path, "provider")),
      regions: this.list(o.regions, join(path, "regions"), (x, p) => this.str(x, p)),
      index: this.str(o.index, join(path, "index")),
    };
  }

  cluster(v: unknown, path: string): Cluster {
    const o = this.obj(v, path, ["id", "environment", "name", "kind", "region", "version"]);
    const version = this.optStr(o.version, join(path, "version"));
    return {
      id: this.str(o.id, join(path, "id")),
      environment: this.str(o.environment, join(path, "environment")),
      name: this.str(o.name, join(path, "name")),
      kind: this.oneOf(o.kind, join(path, "kind"), CLUSTER_KINDS),
      region: this.str(o.region, join(path, "region")),
      ...(version !== undefined ? { version } : {}),
    };
  }

  placement(v: unknown, path: string): Placement {
    const keys = ["id", "part", "environment", "runtime", "regions", "cluster", "namespace", "scale", "resources", "ingress", "schedule", "service", "config", "secrets", "replicas", "note"];
    const o = this.obj(v, path, keys);
    const at = (k: string) => join(path, k);
    const p: Placement = {
      id: this.str(o.id, at("id")),
      part: this.str(o.part, at("part")),
      environment: this.str(o.environment, at("environment")),
      runtime: this.oneOf(o.runtime, at("runtime"), RUNTIMES),
      regions: this.list(o.regions, at("regions"), (x, q) => this.str(x, q)),
    };
    for (const k of ["cluster", "namespace", "schedule", "service", "note"] as const) {
      const val = this.optStr(o[k], at(k));
      if (val !== undefined) p[k] = val;
    }
    const replicas = this.optNum(o.replicas, at("replicas"));
    if (replicas !== undefined) p.replicas = replicas;
    if (o.scale !== undefined) {
      const sc = this.obj(o.scale, at("scale"), ["min", "max", "cpuTarget"]);
      const cpuTarget = this.optNum(sc.cpuTarget, join(at("scale"), "cpuTarget"));
      p.scale = { min: this.num(sc.min, join(at("scale"), "min")), max: this.num(sc.max, join(at("scale"), "max")), ...(cpuTarget !== undefined ? { cpuTarget } : {}) };
    }
    if (o.resources !== undefined) {
      const rs = this.obj(o.resources, at("resources"), ["cpu", "memory"]);
      const cpu = this.optStr(rs.cpu, join(at("resources"), "cpu"));
      const memory = this.optStr(rs.memory, join(at("resources"), "memory"));
      p.resources = { ...(cpu !== undefined ? { cpu } : {}), ...(memory !== undefined ? { memory } : {}) };
    }
    if (o.ingress !== undefined) {
      const ig = this.obj(o.ingress, at("ingress"), ["host", "path"]);
      p.ingress = { host: this.str(ig.host, join(at("ingress"), "host")), path: this.str(ig.path, join(at("ingress"), "path")) };
    }
    if (o.config !== undefined) p.config = this.list(o.config, at("config"), (x, q) => this.str(x, q));
    if (o.secrets !== undefined) p.secrets = this.list(o.secrets, at("secrets"), (x, q) => this.str(x, q));
    return p;
  }

  position(v: unknown, path: string): CanvasPosition {
    const o = this.obj(v, path, ["id", "x", "y"]);
    const id = this.str(o.id, join(path, "id"));
    if (!CANVAS_VIEWS.some((view) => id.startsWith(`${view}:`))) this.fail(join(path, "id"), `a position id is "<view>:<id>" for a view in ${CANVAS_VIEWS.join(", ")}`);
    return { id, x: this.num(o.x, join(path, "x")), y: this.num(o.y, join(path, "y")) };
  }

  cachePolicy(v: unknown, path: string): Endpoint["cache"] & {} {
    const o = this.obj(v, path, ["part", "ttlSeconds", "key"]);
    return { part: this.str(o.part, join(path, "part")), ttlSeconds: this.num(o.ttlSeconds, join(path, "ttlSeconds")), key: this.str(o.key, join(path, "key")) };
  }

  shape(v: unknown, path: string): Shape {
    const o = this.obj(v, path, ["id", "name", "fields", "values", "note", "index"]);
    const note = this.optStr(o.note, join(path, "note"));
    return {
      id: this.str(o.id, join(path, "id")),
      name: this.str(o.name, join(path, "name")),
      fields: this.list(o.fields, join(path, "fields"), (x, p) => this.field(x, p)),
      ...(o.values !== undefined ? { values: this.list(o.values, join(path, "values"), (x, p) => this.str(x, p)) } : {}),
      ...(note !== undefined ? { note } : {}),
      index: this.str(o.index, join(path, "index")),
    };
  }

  event(v: unknown, path: string): QueueEvent {
    const o = this.obj(v, path, ["id", "queue", "name", "payload", "index"]);
    return {
      id: this.str(o.id, join(path, "id")),
      queue: this.str(o.queue, join(path, "queue")),
      name: this.str(o.name, join(path, "name")),
      payload: this.list(o.payload, join(path, "payload"), (x, p) => this.field(x, p)),
      index: this.str(o.index, join(path, "index")),
    };
  }

  doc(v: unknown): Doc {
    const o = this.obj(v, "", [
      "buni", "imports", "tokensRef", "tokens", "pages", "nodes", "shared", "connections",
      "flows", "journeys", "comments", "sections", "decisions", "rules", "attachments",
      "parts", "links", "tables", "endpoints", "events", "shapes", "operations", "traces",
      "environments", "clusters", "placements", "positions",
      "phases", "requirements", "questions", "roles", "reviews", "threads", "agents", "evals",
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
    doc.decisions = o.decisions === undefined ? {} : this.byId(o.decisions, "decisions", (x, p) => this.decision(x, p));
    doc.rules = this.byId(o.rules, "rules", (x, p) => this.rule(x, p));
    doc.attachments = this.byId(o.attachments, "attachments", (x, p) => this.attachment(x, p));
    // The system behind the pages arrived later still; files without it have none.
    const later = <T extends { id: Id }>(key: string, item: (v: unknown, path: string) => T): Record<Id, T> =>
      o[key] === undefined ? {} : this.byId(o[key], key, item);
    doc.parts = later("parts", (x, p) => this.part(x, p));
    doc.links = later("links", (x, p) => this.link(x, p));
    doc.tables = later("tables", (x, p) => this.table(x, p));
    doc.endpoints = later("endpoints", (x, p) => this.endpoint(x, p));
    doc.events = later("events", (x, p) => this.event(x, p));
    doc.shapes = later("shapes", (x, p) => this.shape(x, p));
    doc.operations = later("operations", (x, p) => this.operation(x, p));
    doc.traces = later("traces", (x, p) => this.trace(x, p));
    doc.environments = later("environments", (x, p) => this.environment(x, p));
    doc.clusters = later("clusters", (x, p) => this.cluster(x, p));
    doc.placements = later("placements", (x, p) => this.placement(x, p));
    // Positions of deleted things linger harmlessly; prune on save if files grow
    doc.positions = later("positions", (x, p) => this.position(x, p));
    doc.phases = later("phases", (x, p) => this.phase(x, p));
    doc.requirements = later("requirements", (x, p) => this.requirement(x, p));
    doc.questions = later("questions", (x, p) => this.question(x, p));
    doc.roles = later("roles", (x, p) => this.role(x, p));
    doc.reviews = later("reviews", (x, p) => this.review(x, p));
    doc.threads = later("threads", (x, p) => this.thread(x, p));
    doc.agents = later("agents", (x, p) => this.agent(x, p));
    doc.evals = later("evals", (x, p) => this.evalCase(x, p));
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
    if (!page) r.fail(join(p, "page"), `page "${c.page}" does not exist`);
    if (!nodes[c.node]) r.fail(join(p, "node"), `node "${c.node}" does not exist`);
    else if (page) {
      const root = rootOf.get(c.node);
      if (root !== page.frame && !(root && usedOn.get(root)?.has(page.frame))) r.fail(join(p, "node"), `node "${c.node}" is not on page "${c.page}"`);
    }
    if (!pages[c.to]) r.fail(join(p, "to"), `page "${c.to}" does not exist`);
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

  checkSystem(doc, r);
  checkTopology(doc, r);
  checkProcess(doc, r);
}

/** Anything a requirement, question, review or thread can be about. */
function traceable(doc: Doc, id: Id): boolean {
  return (
    !!doc.parts[id] || !!doc.links[id] || !!doc.tables[id] || !!doc.endpoints[id] || !!doc.operations[id] || !!doc.events[id] ||
    !!doc.shapes[id] || !!doc.traces[id] || !!doc.pages[id] || !!doc.flows[id] || !!doc.requirements[id] || !!doc.questions[id] ||
    !!doc.roles[id] || !!doc.environments[id] || !!doc.placements[id]
  );
}

/** Requirements and phases, open questions, roles and access, failure policies, reviews and threads. */
function checkProcess(doc: Doc, r: Reader): void {
  const unique = (items: { id: Id; name: string }[], coll: string, what: string) => {
    const seen = new Map<string, Id>();
    for (const x of items) {
      const dup = seen.get(x.name.toLowerCase());
      if (dup) r.fail(join(join(coll, x.id), "name"), `${what} "${x.name}" is also ${what} "${dup}"`);
      seen.set(x.name.toLowerCase(), x.id);
    }
  };
  unique(Object.values(doc.phases), "phases", "phase");
  unique(Object.values(doc.roles), "roles", "role");
  for (const q of Object.values(doc.requirements)) {
    const p = join("requirements", q.id);
    if (!q.title.trim()) r.fail(join(p, "title"), "a requirement needs a title");
    if (q.phase !== undefined && !doc.phases[q.phase]) r.fail(join(p, "phase"), `phase "${q.phase}" does not exist`);
    for (const id of q.servedBy) if (!traceable(doc, id)) r.fail(join(p, "servedBy"), `nothing called "${id}" to serve it`);
  }
  for (const q of Object.values(doc.questions)) {
    const p = join("questions", q.id);
    if (!q.text.trim()) r.fail(join(p, "text"), "a question needs its text");
    const names = q.options.map((o) => o.name);
    if (new Set(names).size !== names.length) r.fail(join(p, "options"), "option names must be unique");
    if (q.status === "decided" && q.kind === "question" && (q.chosen === undefined || !names.includes(q.chosen))) r.fail(join(p, "chosen"), "a decided question names one of its options");
    if (q.status === "open" && q.chosen !== undefined) r.fail(join(p, "chosen"), "an open question hasn't chosen yet");
    for (const id of q.about) if (!traceable(doc, id)) r.fail(join(p, "about"), `nothing called "${id}"`);
  }
  // An agent's API tools must name endpoints and operations that exist; buni's own tools are checked when it is set.
  const apiTools = new Set([...Object.values(doc.endpoints).map(endpointToolName), ...Object.values(doc.operations).map(operationToolName)]);
  for (const a of Object.values(doc.agents)) {
    const p = join("agents", a.id);
    if (!a.name.trim()) r.fail(join(p, "name"), "an agent needs a name");
    if (a.model !== undefined && !/^[\w.-]+\/.+$/.test(a.model)) r.fail(join(p, "model"), `"${a.model}" is not provider/model`);
    for (const t of a.tools) if (/^(api|gql)_/.test(t) && !apiTools.has(t)) r.fail(join(p, "tools"), `no endpoint or operation is the tool "${t}"`);
  }
  for (const c of Object.values(doc.evals)) {
    const p = join("evals", c.id);
    if (c.agent !== "buni" && !doc.agents[c.agent]) r.fail(join(p, "agent"), `no agent "${c.agent}" in this file`);
    if (!c.ask.trim()) r.fail(join(p, "ask"), "a case says what the person asks");
    if (!c.must.length) r.fail(join(p, "must"), "a case needs at least one thing the agent must do");
  }
  const checkAccess = (a: Access | undefined, p: string) => {
    if (!a) return;
    if (a.who === "roles" && !(a.roles ?? []).length) r.fail(join(p, "roles"), "name the roles that may call it");
    if (a.who !== "roles" && a.roles?.length) r.fail(join(p, "roles"), `roles only apply when who is "roles"`);
    for (const id of a.roles ?? []) if (!doc.roles[id]) r.fail(join(p, "roles"), `role "${id}" does not exist`);
  };
  for (const e of Object.values(doc.endpoints)) checkAccess(e.access, join(join("endpoints", e.id), "access"));
  for (const o of Object.values(doc.operations)) checkAccess(o.access, join(join("operations", o.id), "access"));
  for (const l of Object.values(doc.links)) {
    const f = l.failure;
    if (!f) continue;
    const p = join(join("links", l.id), "failure");
    if (f.timeoutMs !== undefined && !(f.timeoutMs > 0)) r.fail(join(p, "timeoutMs"), "a timeout is a positive number of ms");
    if (f.retries !== undefined && !(Number.isInteger(f.retries) && f.retries >= 0 && f.retries <= 20)) r.fail(join(p, "retries"), "retries is a whole number, 0 to 20");
  }
  for (const rv of Object.values(doc.reviews)) if (!traceable(doc, rv.id)) r.fail(join("reviews", rv.id), `nothing called "${rv.id}" to review`);
  for (const t of Object.values(doc.threads)) {
    const p = join("threads", t.id);
    if (!traceable(doc, t.target)) r.fail(join(p, "target"), `nothing called "${t.target}"`);
    if (t.posts.length === 0) r.fail(join(p, "posts"), "a thread needs at least one post");
  }
}

/** Which runtimes fit which parts: a store is not a cronjob, a client is not a StatefulSet. */
export function runtimesFor(part: Part): readonly Runtime[] {
  switch (part.kind) {
    case "client": return ["static", "function", "container", "deployment"];
    case "service": return part.api === "none" ? ["deployment", "container", "cronjob", "job", "daemonset", "function", "vm"] : ["deployment", "container", "function", "vm"];
    case "store": case "cache": case "queue": return ["managed", "statefulset", "vm"];
    case "external": return [];
  }
}

/** Environments, clusters and placements: every part runs somewhere real, in the terms its platform uses. */
function checkTopology(doc: Doc, r: Reader): void {
  const { environments, clusters, placements, parts } = doc;
  const envNames = new Map<string, Id>();
  for (const e of Object.values(environments)) {
    const p = join("environments", e.id);
    const dup = envNames.get(e.name);
    if (dup) r.fail(join(p, "name"), `environment "${e.name}" is also environment "${dup}"`);
    envNames.set(e.name, e.id);
    if (e.regions.length === 0) r.fail(join(p, "regions"), "an environment needs at least one region");
    if (new Set(e.regions).size !== e.regions.length) r.fail(join(p, "regions"), "regions must be unique");
  }
  for (const c of Object.values(clusters)) {
    const p = join("clusters", c.id);
    const env = environments[c.environment];
    if (!env) r.fail(join(p, "environment"), `environment "${c.environment}" does not exist`);
    else if (!env.regions.includes(c.region)) r.fail(join(p, "region"), `${env.name} doesn't run in ${c.region}; its regions are ${env.regions.join(", ")}`);
    if (!DNS_LABEL.test(c.name)) r.fail(join(p, "name"), "cluster names are lowercase letters, digits and dashes");
  }
  const placed = new Map<string, Id>();
  for (const pl of Object.values(placements)) {
    const p = join("placements", pl.id);
    const part = parts[pl.part];
    const env = environments[pl.environment];
    if (!part) r.fail(join(p, "part"), `part "${pl.part}" does not exist`);
    if (!env) r.fail(join(p, "environment"), `environment "${pl.environment}" does not exist`);
    const key = `${pl.part} ${pl.environment}`;
    const dup = placed.get(key);
    if (dup) r.fail(p, `"${pl.part}" is already placed in "${pl.environment}" by "${dup}"`);
    placed.set(key, pl.id);
    if (part) {
      const fits = runtimesFor(part);
      if (fits.length === 0) r.fail(join(p, "part"), `${part.name} is external; someone else runs it`);
      else if (!fits.includes(pl.runtime)) r.fail(join(p, "runtime"), `a ${part.kind === "service" && part.api === "none" ? "worker" : part.kind} runs as ${fits.join(", ")}, not ${pl.runtime}`);
    }
    if (pl.regions.length === 0) r.fail(join(p, "regions"), "say which region it runs in");
    if (env) for (const reg of pl.regions) if (!env.regions.includes(reg)) r.fail(join(p, "regions"), `${env.name} doesn't run in ${reg}`);
    const k8s = K8S_RUNTIMES.includes(pl.runtime);
    const cluster = pl.cluster === undefined ? undefined : clusters[pl.cluster];
    if (pl.cluster !== undefined && !cluster) r.fail(join(p, "cluster"), `cluster "${pl.cluster}" does not exist`);
    if (k8s && !cluster) r.fail(join(p, "cluster"), `a ${pl.runtime} runs on a Kubernetes cluster; pick one`);
    if (cluster) {
      if (k8s && cluster.kind !== "kubernetes") r.fail(join(p, "cluster"), `${cluster.name} is ${cluster.kind}, not Kubernetes`);
      if (cluster.environment !== pl.environment) r.fail(join(p, "cluster"), `${cluster.name} belongs to another environment`);
      if (pl.regions.some((reg) => reg !== cluster.region)) r.fail(join(p, "regions"), `${cluster.name} runs in ${cluster.region} only`);
    }
    if (k8s && pl.namespace === undefined) r.fail(join(p, "namespace"), "Kubernetes workloads need a namespace");
    // A container platform is a choice the builder needs: ECS Fargate and Cloud Run are built for differently.
    if (pl.runtime === "container" && !pl.service?.trim()) r.fail(join(p, "service"), 'say which platform runs the container: "ECS Fargate", "Cloud Run", "Fly Machines"');
    if (pl.namespace !== undefined && !DNS_LABEL.test(pl.namespace)) r.fail(join(p, "namespace"), "namespaces are lowercase letters, digits and dashes");
    if (pl.runtime === "cronjob" && (pl.schedule === undefined || pl.schedule.trim().split(/\s+/).length !== 5)) r.fail(join(p, "schedule"), 'a cronjob needs a five-field schedule, e.g. "0 3 * * *"');
    if (pl.runtime !== "cronjob" && pl.schedule !== undefined) r.fail(join(p, "schedule"), "only cronjobs run on a schedule");
    if (pl.scale) {
      if (pl.scale.min < 0 || pl.scale.max < pl.scale.min || !Number.isInteger(pl.scale.min) || !Number.isInteger(pl.scale.max)) r.fail(join(p, "scale"), "scale is whole numbers with 0 ≤ min ≤ max");
      if (pl.scale.cpuTarget !== undefined && !(pl.scale.cpuTarget > 0 && pl.scale.cpuTarget <= 100)) r.fail(join(join(p, "scale"), "cpuTarget"), "a CPU target is a percent, 1 to 100");
      if (pl.scale.min === 0 && k8s && pl.runtime !== "cronjob" && pl.runtime !== "job") r.fail(join(p, "scale"), "a Kubernetes workload keeps at least one pod; scale to zero with a function");
    }
    if (pl.resources?.cpu !== undefined && !/^\d+(\.\d+)?m?$/.test(pl.resources.cpu)) r.fail(join(join(p, "resources"), "cpu"), 'CPU is cores or millicores: "0.5", "250m"');
    if (pl.resources?.memory !== undefined && !/^\d+(Ki|Mi|Gi|Ti)$/.test(pl.resources.memory)) r.fail(join(join(p, "resources"), "memory"), 'memory is a size like "256Mi" or "2Gi"');
    if (pl.ingress) {
      if (part && !(part.kind === "client" || (part.kind === "service" && part.api !== "none"))) r.fail(join(p, "ingress"), "only clients and services with an API take outside traffic");
      if (!pl.ingress.host.trim()) r.fail(join(join(p, "ingress"), "host"), "an ingress needs a host");
      if (!pl.ingress.path.startsWith("/")) r.fail(join(join(p, "ingress"), "path"), 'paths start with "/"');
    }
    for (const k of ["config", "secrets"] as const) {
      (pl[k] ?? []).forEach((name, i) => { if (!ENV_NAME.test(name)) r.fail(`${p}.${k}[${i}]`, `"${name}" is not an environment variable name like DATABASE_URL`); });
    }
    if (pl.replicas !== undefined && !(Number.isInteger(pl.replicas) && pl.replicas >= 0)) r.fail(join(p, "replicas"), "replicas is a whole number");
  }
}

/** Every name in `items` once; reports the repeats. */
function uniqueNames(items: readonly { name: string }[], path: string, what: string, r: Reader): void {
  const seen = new Set<string>();
  items.forEach((x, i) => {
    if (seen.has(x.name)) r.fail(`${path}[${i}].name`, `${what} "${x.name}" appears twice`);
    seen.add(x.name);
  });
}

/** The system behind the pages: parts link sensibly, contracts sit on the right part and touch only what it is linked to. */
function checkSystem(doc: Doc, r: Reader): void {
  const { parts, links, tables, endpoints, events, shapes } = doc;

  // Data structures: unique names, and every field typed with a primitive or a shape.
  const shapeNames = new Map<string, Id>();
  for (const s of Object.values(shapes)) {
    const p = join("shapes", s.id);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(s.name)) r.fail(join(p, "name"), "shape names are PascalCase, e.g. Quote");
    const dup = shapeNames.get(s.name);
    if (dup) r.fail(join(p, "name"), `shape "${s.name}" is also shape "${dup}"`);
    shapeNames.set(s.name, s.id);
    if (s.values) {
      if (s.fields.length) r.fail(join(p, "values"), "a shape has fields or enum values, not both");
      if (s.values.length === 0) r.fail(join(p, "values"), "an enum needs at least one value");
      if (new Set(s.values).size !== s.values.length) r.fail(join(p, "values"), "enum values must be unique");
      s.values.forEach((v, i) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) r.fail(`${p}.values[${i}]`, `"${v}" is not a plain word; enum values are like draft or ACCEPTED`); });
    } else if (s.fields.length === 0) r.fail(join(p, "fields"), "a shape needs at least one field, or enum values");
    uniqueNames(s.fields, join(p, "fields"), "field", r);
  }
  const isType = (type: string) => {
    const base = type.endsWith("[]") ? type.slice(0, -2) : type;
    return PRIMITIVES.some((x) => x === base) || shapeNames.has(base);
  };
  const typeMessage = (type: string) => `"${type}" is not ${PRIMITIVES.join(", ")} or a shape (add one with set_shape), with [] for a list`;
  const typed = (fields: readonly Field[], path: string) =>
    fields.forEach((f, i) => {
      if (!isType(f.type)) r.fail(`${path}[${i}].type`, typeMessage(f.type));
    });
  for (const s of Object.values(shapes)) typed(s.fields, join(join("shapes", s.id), "fields"));
  for (const e of Object.values(events)) typed(e.payload, join(join("events", e.id), "payload"));
  for (const e of Object.values(endpoints)) {
    typed(e.request, join(join("endpoints", e.id), "request"));
    typed(e.response, join(join("endpoints", e.id), "response"));
    // A body is a shape or a list of fields, not both.
    for (const side of ["request", "response"] as const) {
      const shape = side === "request" ? e.requestShape : e.responseShape;
      if (shape === undefined) continue;
      const p = join(join("endpoints", e.id), `${side}Shape`);
      if (!shapes[shape]) r.fail(p, `shape "${shape}" does not exist`);
      else if (shapes[shape]?.values) r.fail(p, `${shapes[shape]?.name} is an enum; a body is a shape with fields`);
      if (e[side].length) r.fail(p, `the ${side} is either the shape or a list of fields, not both`);
    }
  }
  for (const o of Object.values(doc.operations)) {
    typed(o.args, join(join("operations", o.id), "args"));
    if (!isType(o.returns)) r.fail(join(join("operations", o.id), "returns"), typeMessage(o.returns));
  }
  const partOf = (id: Id, kind: PartKind, path: string): Part | undefined => {
    const part = parts[id];
    if (!part) r.fail(path, `part "${id}" does not exist`);
    else if (part.kind !== kind) r.fail(path, `part "${id}" is a ${part.kind}, not a ${kind}`);
    else return part;
    return undefined;
  };
  const linked = (from: Id, to: Id, kinds: readonly LinkKind[]) =>
    Object.values(links).some((l) => l.from === from && l.to === to && kinds.includes(l.kind));

  const seenLinks = new Set<string>();
  for (const l of Object.values(links)) {
    const p = join("links", l.id);
    const from = parts[l.from];
    const to = parts[l.to];
    if (!from) r.fail(join(p, "from"), `part "${l.from}" does not exist`);
    else if (from.kind === "store" || from.kind === "queue") r.fail(join(p, "from"), `a ${from.kind} does not start links`);
    if (!to) r.fail(join(p, "to"), `part "${l.to}" does not exist`);
    else if (!LINK_TARGET[l.kind].includes(to.kind)) r.fail(join(p, "to"), `${l.kind} goes to a ${LINK_TARGET[l.kind].join(" or ")}, not a ${to.kind}`);
    if (l.from === l.to) r.fail(p, "a part cannot link to itself");
    for (const s of l.carries ?? []) if (!shapes[s]) r.fail(join(p, "carries"), `shape "${s}" does not exist`);
    const key = `${l.from} ${l.kind} ${l.to}`;
    if (seenLinks.has(key)) r.fail(p, `"${l.from}" already ${l.kind} "${l.to}"`);
    seenLinks.add(key);
  }

  for (const t of Object.values(tables)) {
    const p = join("tables", t.id);
    partOf(t.store, "store", join(p, "store"));
    if (t.columns.length === 0) r.fail(join(p, "columns"), "a table needs at least one column");
    uniqueNames(t.columns, join(p, "columns"), "column", r);
    t.columns.forEach((c, i) => {
      if (!SQL_TYPE.test(c.type)) r.fail(`${p}.columns[${i}].type`, `"${c.type}" is not a SQL type like text, numeric(10,2) or uuid[]`);
      if (!c.ref) return;
      const cp = `${p}.columns[${i}].ref`;
      const target = tables[c.ref.table];
      const col = target?.columns.find((x) => x.name === c.ref?.column);
      if (!target) r.fail(join(cp, "table"), `table "${c.ref.table}" does not exist`);
      else if (!col) r.fail(join(cp, "column"), `table "${target.id}" has no column "${c.ref.column}"`);
      else if (target.store !== t.store) r.fail(join(cp, "table"), `table "${target.id}" is in another store; link across stores by id without a foreign key`);
      else if (col.type.toLowerCase() !== c.type.toLowerCase()) r.fail(`${p}.columns[${i}].type`, `${c.type} does not match ${target.name}.${col.name}, a ${col.type}`);
    });
  }
  const tableNames = new Map<string, Id>();
  for (const t of Object.values(tables)) {
    const key = `${t.store} ${t.name}`;
    const dup = tableNames.get(key);
    if (dup) r.fail(join(join("tables", t.id), "name"), `table "${t.name}" is also table "${dup}" in the same store`);
    tableNames.set(key, t.id);
  }

  for (const e of Object.values(events)) {
    partOf(e.queue, "queue", join(join("events", e.id), "queue"));
    uniqueNames(e.payload, join(join("events", e.id), "payload"), "field", r);
  }
  const eventNames = new Map<string, Id>();
  for (const e of Object.values(events)) {
    const key = `${e.queue} ${e.name}`;
    const dup = eventNames.get(key);
    if (dup) r.fail(join(join("events", e.id), "name"), `event "${e.name}" is also event "${dup}" on the same queue`);
    eventNames.set(key, e.id);
  }

  const styleOf = (service: Part) => service.api ?? "rest";
  /** What every call checks, REST or GraphQL: data it touches through its service's links, caching, staleness, errors. */
  const checkCall = (p: string, service: Part | undefined, c: Endpoint | Operation, cacheable: boolean, cacheRule: string) => {
    const touch = (ids: Id[], key: "reads" | "writes", kinds: readonly LinkKind[]) => {
      for (const id of ids) {
        const t = tables[id];
        if (!t) r.fail(join(p, key), `table "${id}" does not exist`);
        else if (service && !linked(service.id, t.store, kinds)) r.fail(join(p, key), `service "${service.id}" has no ${kinds.join(" or ")} link to store "${t.store}"`);
      }
    };
    touch(c.reads, "reads", ["reads", "writes"]);
    touch(c.writes, "writes", ["writes"]);
    if (c.cache) {
      const cp = join(p, "cache");
      const cache = partOf(c.cache.part, "cache", join(cp, "part"));
      if (cache && service && !linked(service.id, cache.id, ["reads", "writes"])) r.fail(join(cp, "part"), `service "${service.id}" has no link to cache "${cache.id}"`);
      if (!(c.cache.ttlSeconds > 0)) r.fail(join(cp, "ttlSeconds"), "a cache entry needs a positive lifetime");
      if (!cacheable) r.fail(cp, cacheRule);
    }
    for (const id of c.invalidates ?? []) {
      const target = callable(doc, id);
      if (!target) r.fail(join(p, "invalidates"), `endpoint or operation "${id}" does not exist`);
      else if (!(target.kind === "rest" ? target.endpoint.cache : target.operation.cache)) r.fail(join(p, "invalidates"), `"${id}" is not cached`);
    }
    for (const id of c.emits) {
      const ev = events[id];
      if (!ev) r.fail(join(p, "emits"), `event "${id}" does not exist`);
      else if (service && !linked(service.id, ev.queue, ["publishes"])) r.fail(join(p, "emits"), `service "${service.id}" has no publishes link to queue "${ev.queue}"`);
    }
    (c.errors ?? []).forEach((e, i) => {
      if (!e.code.trim()) r.fail(`${p}.errors[${i}].code`, "an error needs a code, e.g. 409 or PLAN_RETIRED");
    });
  };

  const routes = new Map<string, Id>();
  for (const e of Object.values(endpoints)) {
    const p = join("endpoints", e.id);
    const service = partOf(e.service, "service", join(p, "service"));
    if (service && styleOf(service) !== "rest") r.fail(join(p, "service"), `service "${service.id}" is ${styleOf(service) === "graphql" ? "GraphQL; add an operation instead" : "a worker with no API"}`);
    if (!e.path.startsWith("/")) r.fail(join(p, "path"), 'paths start with "/"');
    const key = `${e.service} ${e.method} ${e.path}`;
    const dup = routes.get(key);
    if (dup) r.fail(join(p, "path"), `${e.method} ${e.path} is also endpoint "${dup}"`);
    routes.set(key, e.id);
    uniqueNames(e.request, join(p, "request"), "field", r);
    uniqueNames(e.response, join(p, "response"), "field", r);
    checkCall(p, service, e, e.method === "GET", "only GET responses are cached; invalidate them from the endpoints that change the data");
  }

  const opNames = new Map<string, Id>();
  for (const o of Object.values(doc.operations)) {
    const p = join("operations", o.id);
    const service = partOf(o.service, "service", join(p, "service"));
    if (service && styleOf(service) !== "graphql") r.fail(join(p, "service"), `service "${service.id}" is ${styleOf(service) === "rest" ? "REST; set its API style to GraphQL, or add an endpoint" : "a worker with no API"}`);
    if (!/^[a-z][A-Za-z0-9]*$/.test(o.name)) r.fail(join(p, "name"), "operation names are camelCase, e.g. updatePlan");
    const key = `${o.service} ${o.kind} ${o.name}`;
    const dup = opNames.get(key);
    if (dup) r.fail(join(p, "name"), `${o.kind} ${o.name} is also operation "${dup}"`);
    opNames.set(key, o.id);
    uniqueNames(o.args, join(p, "args"), "argument", r);
    checkCall(p, service, o, o.kind === "query", "only queries are cached; invalidate them from the mutations that change the data");
  }

  const partIds = new Set(Object.keys(parts));
  for (const t of Object.values(doc.traces)) {
    const p = join("traces", t.id);
    if (t.page !== undefined && !doc.pages[t.page]) r.fail(join(p, "page"), `page "${t.page}" does not exist`);
    if (t.steps.length === 0) r.fail(join(p, "steps"), "a trace needs at least one step");
    t.steps.forEach((st, i) => {
      const sp = `${p}.steps[${i}]`;
      for (const k of ["from", "to"] as const) if (!partIds.has(st[k])) r.fail(join(sp, k), `part "${st[k]}" does not exist`);
      if (partIds.has(st.from) && partIds.has(st.to) && st.from !== st.to) {
        const any = Object.values(links).some((l) => (l.from === st.from && l.to === st.to) || (l.from === st.to && l.to === st.from));
        if (!any) r.fail(sp, `no link joins "${st.from}" and "${st.to}"; link them on the map first`);
      }
      if (st.via !== undefined && !callable(doc, st.via) && !events[st.via]) r.fail(join(sp, "via"), `no endpoint, operation or event "${st.via}"`);
      if (st.carries !== undefined && !shapes[st.carries]) r.fail(join(sp, "carries"), `shape "${st.carries}" does not exist`);
      if (st.ms !== undefined && st.ms < 0) r.fail(join(sp, "ms"), "a time budget cannot be negative");
    });
  }

  // Where the pages meet the system.
  for (const page of Object.values(doc.pages)) {
    const p = join("pages", page.id);
    const client = page.client !== undefined ? partOf(page.client, "client", join(p, "client")) : undefined;
    // A terminal screen belongs to a terminal client, and a terminal client has only terminal screens.
    if (page.terminal && !client?.terminal) r.fail(join(p, "terminal"), "a terminal screen belongs to a client that runs in a terminal");
    if (!page.terminal && client?.terminal) r.fail(join(p, "terminal"), `"${client.name}" runs in a terminal; say how big its screen is`);
    // Every build of a full-screen app needs a framework to draw it.
    const bare = page.terminal?.surface === "app" ? (client?.terminal?.targets ?? []).filter((t) => !t.framework) : [];
    for (const t of bare) r.fail(join(p, "terminal"), `a full-screen app needs a framework; "${client?.name}" builds it in ${t.language} without one`);
  }
  for (const part of Object.values(parts)) {
    if (part.terminal && part.kind !== "client") r.fail(join(join("parts", part.id), "terminal"), "only a client runs in a terminal");
  }
  for (const c of Object.values(doc.connections)) {
    if (c.endpoint === undefined) continue;
    const p = join("connections", c.id);
    const target = callable(doc, c.endpoint);
    if (!target) {
      r.fail(join(p, "endpoint"), `endpoint or operation "${c.endpoint}" does not exist`);
      continue;
    }
    const service = target.kind === "rest" ? target.endpoint.service : target.operation.service;
    const client = doc.pages[c.page]?.client;
    if (client !== undefined && parts[client] && !linked(client, service, ["calls"])) {
      r.fail(join(p, "endpoint"), `client "${client}" has no calls link to service "${service}"`);
    }
  }
  for (const n of Object.values(doc.nodes)) {
    if (!n.bind) continue;
    const p = join(join("nodes", n.id), "bind");
    const target = callable(doc, n.bind.endpoint);
    if (!target) r.fail(join(p, "endpoint"), `endpoint or operation "${n.bind.endpoint}" does not exist`);
    else if (!responseFields(doc, target).includes(n.bind.field)) r.fail(join(p, "field"), `"${n.bind.endpoint}" returns no field "${n.bind.field}"`);
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
 * With `context` (the system of the files it imports), references may point into those files;
 * only this file's own entries are reported, and an id in both is an error.
 */
export function validateDoc(given: Doc, givenContext?: Doc): FormatError[] {
  const doc = ownOnly(given);
  const context = givenContext && ownOnly(givenContext);
  const r = new Reader();
  if (!context) {
    checkRefs(doc, r);
    return r.errors;
  }
  checkRefs(withImports(doc, context), r);
  const own = (path: string) => {
    const c = SYSTEM_COLLECTIONS.find((x) => path.startsWith(`${x}.`));
    if (!c) return true;
    const id = path.slice(c.length + 1).split(/[.[]/)[0] ?? "";
    return doc[c][id] !== undefined;
  };
  const errors = r.errors.filter((e) => own(e.path));
  for (const c of SYSTEM_COLLECTIONS) {
    for (const id of Object.keys(doc[c])) if (context[c][id] !== undefined) errors.push({ path: `${c}.${id}`, message: `"${id}" is also in an imported file; ids are unique across files` });
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
