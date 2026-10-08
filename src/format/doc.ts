// A .buni file. Every collection is keyed by id so concurrent edits merge as
// separate JSON lines in git; order, where it matters, lives in `index`.

export type Id = string;

/** CSS property (camelCase or custom property) to value. */
export type Style = Record<string, string>;

interface NodeBase {
  id: Id;
  /** Absent on roots: a page frame or a shared section root. */
  parent?: Id;
  /** Sort key among siblings, compared as a plain string. */
  index: string;
  name: string;
  style: Style;
  /** HTML element for export; frames default to "div", text to "p". */
  tag?: string;
  /** Live data this node shows: a field of an endpoint's response. */
  bind?: Bind;
  /** Left out of the canvas and every export, kept in the file. */
  hidden?: true;
  /** Can't be picked on the canvas, so clicks go to what is around it; still selectable in Layers. */
  locked?: true;
  /**
   * Style at another of its page's widths, keyed by the width ("768"): below the page's own width it applies at
   * that width and narrower, above it at that width and wider.
   */
  at?: Record<string, Style>;
  /**
   * On a state's page: the layer of its screen this one was copied from. Style changes there reach it too; its
   * words and content stay its own, since those are what the state changes.
   */
  twin?: Id;
  /** How it moves in Play and on the exported site: at most one per trigger. The canvas and images stay still. */
  motion?: Motion[];
}

/** When a layer's motion plays: as the page loads, as it scrolls into view, while hovered, while pressed. */
export const MOTION_TRIGGERS = ["load", "scroll", "hover", "press"] as const;
export type MotionTrigger = (typeof MOTION_TRIGGERS)[number];
/** How a layer enters, for load and scroll. */
export const ENTRANCES = ["fade", "rise", "scale", "slide-left", "slide-right", "blur"] as const;
/** How a layer answers the pointer, for hover and press. */
export const RESPONSES = ["lift", "grow", "shrink", "dim"] as const;
export const EASINGS = ["out", "in-out", "dramatic", "linear"] as const;
export type MotionEffect = (typeof ENTRANCES)[number] | (typeof RESPONSES)[number];
export type Easing = (typeof EASINGS)[number];

export interface Motion {
  trigger: MotionTrigger;
  /** An entrance for load and scroll, a response for hover and press. */
  effect: MotionEffect;
  durationMs: number;
  delayMs?: number;
  easing: Easing;
  /** Load and scroll only: the layer's children enter one after another, this far apart, instead of the layer as one. */
  staggerMs?: number;
}

/** Whether a trigger takes an entrance (load, scroll) or a response (hover, press). */
export const entersOn = (t: MotionTrigger): boolean => t === "load" || t === "scroll";

export interface FrameNode extends NodeBase {
  kind: "frame";
}

export interface TextNode extends NodeBase {
  kind: "text";
  text: string;
  /** For an input or textarea: the text is what was typed (its value), not a hint (its placeholder). */
  filled?: true;
}

export interface ImageNode extends NodeBase {
  kind: "image";
  /** Attachment id of the image file. */
  asset: Id;
  alt: string;
}

export interface SvgNode extends NodeBase {
  kind: "svg";
  markup: string;
}

export interface Override {
  text?: string;
  style?: Style;
  /** For an svg layer: this use's own markup, e.g. another icon or size. */
  markup?: string;
  /** Style at one of the page's other widths, as NodeBase.at: only this use, only at that width. */
  at?: Record<string, Style>;
}

/** A use of a shared section; overrides are keyed by node ids in its source tree. */
export interface InstanceNode extends NodeBase {
  kind: "instance";
  shared: Id;
  overrides: Record<Id, Override>;
}

export type Node = FrameNode | TextNode | ImageNode | SvgNode | InstanceNode;
export type NodeKind = Node["kind"];

export interface Page {
  id: Id;
  name: string;
  /**
   * Starts with "/"; becomes the export folder. A page without one is a graphic (a logo,
   * an icon, a post): a fixed-size board that is not part of the site.
   */
  route?: string;
  /**
   * A state of the screen at this route ("Empty", "Label pending", "Error"): it shares the route with
   * that screen, and site export leaves it out, since it is not a page of its own.
   */
  state?: string;
  /** Root frame node of the page. */
  frame: Id;
  index: string;
  /** Top-left corner on the canvas; a page without one is laid out in a row. */
  x?: number;
  y?: number;
  /** The client part (web app, mobile app…) this page belongs to. */
  client?: Id;
  /** A screen in a terminal rather than a web page; its client must be a terminal client. */
  terminal?: TerminalScreen;
  /**
   * Other widths the page must work at, in px (390, 768). With any, the page fills the window, and layers can
   * change their style at each width (NodeBase.at).
   */
  widths?: number[];
}

/** The languages buni designs terminal software for. */
export type TerminalLanguage = "go" | "rust" | "python" | "typescript";
/** The terminal UI frameworks buni knows: Bubble Tea (Go), Ratatui (Rust), Textual (Python), Ink, OpenTUI and pi-tui (TypeScript). */
export type TerminalFramework = "bubbletea" | "ratatui" | "textual" | "ink" | "opentui" | "pi-tui";
export const FRAMEWORK_LANGUAGE: Record<TerminalFramework, TerminalLanguage> = {
  bubbletea: "go", ratatui: "rust", textual: "python", ink: "typescript", opentui: "typescript", "pi-tui": "typescript",
};

/** One way a terminal client is built: a language, and the TUI framework when it draws full screens. */
export interface TerminalTarget {
  language: TerminalLanguage;
  framework?: TerminalFramework;
}

/**
 * A client that runs in a terminal. Its screens are designed once; each target is a build of them,
 * so the same design can be built in Bubble Tea, Ratatui and OpenTUI and compared. The first is the main one.
 */
export interface TerminalClient {
  targets: TerminalTarget[];
}

/**
 * Where on a terminal a screen shows: a full-screen app; output printed into the scrollback; tmux's
 * status line, window layout, popup or menu; a zellij plugin pane; a Neovim float or split; a shell
 * prompt; an fzf-style picker.
 */
export type TerminalSurface =
  | "app" | "inline"
  | "tmux-status" | "tmux-layout" | "tmux-popup" | "tmux-menu"
  | "zellij-plugin"
  | "nvim-float" | "nvim-split"
  | "prompt" | "picker";

/** How much colour the screen is designed for; "none" is what it looks like with colour off. */
export type TerminalColors = "none" | "16" | "256" | "truecolor";

/** One character cell of a terminal screen on the canvas, in pixels: a screen's frame is its grid times this. */
export const CELL = { w: 9, h: 18 } as const;

/** A screen drawn on a grid of character cells. */
export interface TerminalScreen {
  surface: TerminalSurface;
  /** Width in columns. */
  cols: number;
  /** Height in rows; output printed inline has none, it grows as it prints. */
  rows?: number;
  colors: TerminalColors;
}

export interface SharedSection {
  id: Id;
  name: string;
  /** Root node of the section's source tree. */
  root: Id;
  /** Top-left corner on the canvas; a component without one sits in the row above the pages. */
  x?: number;
  y?: number;
  /**
   * Which variant of its set (its group) this is, as properties: { Tone: "Primary", Size: "Small" }. A use picks a
   * value for each, and shows the variant that has them.
   */
  variant?: Record<string, string>;
}

/** The components of a set: those sharing a group ("Buttons / …"), or just the one when it has no group. */
export function setOf(doc: Doc, sharedId: Id): SharedSection[] {
  const self = doc.shared[sharedId];
  if (!self) return [];
  const group = (name: string) => (name.lastIndexOf("/") > 0 ? name.slice(0, name.lastIndexOf("/")).trim() : undefined);
  const g = group(self.name);
  return g === undefined ? [self] : Object.values(doc.shared).filter((x) => group(x.name) === g).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** A set's properties and the values its variants give each, in the order first seen. */
export function variantProperties(set: readonly SharedSection[]): [string, string[]][] {
  const out = new Map<string, string[]>();
  for (const s of set) for (const [k, v] of Object.entries(s.variant ?? {})) out.set(k, [...new Set([...(out.get(k) ?? []), v])]);
  return [...out];
}

/** The variant of a set that best has these properties: all of them if one does, else the most. */
export function pickVariant(set: readonly SharedSection[], want: Record<string, string>): SharedSection | undefined {
  const score = (s: SharedSection) => Object.entries(want).filter(([k, v]) => s.variant?.[k] === v).length;
  return [...set].sort((a, b) => score(b) - score(a))[0];
}

/** "key" is a key press on a terminal screen, e.g. "ctrl+k", "enter", or a tmux binding "prefix g". */
export type Trigger = "click" | "hover" | "submit" | "key";
export type Transition = "none" | "fade" | "slide-left" | "slide-right";

export interface Connection {
  id: Id;
  /** Page the trigger node lives on. */
  page: Id;
  node: Id;
  to: Id;
  trigger: Trigger;
  transition: Transition;
  durationMs: number;
  condition?: string;
  /** The endpoint this trigger calls, e.g. a form submit that posts a quote. */
  endpoint?: Id;
  /** The key that follows the link; only for "key" triggers. */
  key?: string;
  /** Navigation (a sidebar, a tab bar): always there, so flows don't follow it as a step. */
  nav?: true;
}

export interface Flow {
  id: Id;
  name: string;
  start: Id;
  index: string;
}

export type Confidence = 1 | 2 | 3 | 4 | 5;

export interface JourneyStep {
  page: Id;
  confidence?: Confidence;
  /** Lane name to cell text. */
  cells: Record<string, string>;
  /** Attachment ids. */
  evidence: Id[];
}

export interface Journey {
  id: Id;
  flow: Id;
  lanes: string[];
  steps: JourneyStep[];
}

/** One part of the design doc: who it is for, principles, voice… Ordered by index. */
export interface Section {
  id: Id;
  heading: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
  index: string;
}

/** A settled design decision, e.g. "8px spacing grid". */
export interface Decision {
  id: Id;
  text: string;
  /** Who made it: a person or an agent's name. */
  by: string;
  /** ISO 8601. */
  at: string;
}

export type CommentState = "open" | "addressed" | "resolved";

export interface Post {
  author: string;
  body: string;
  /** ISO 8601 timestamp. */
  at: string;
}

export interface Comment {
  id: Id;
  node: Id;
  state: CommentState;
  posts: Post[];
}

export type Rule =
  | { id: Id; kind: "tokens-only" }
  | { id: Id; kind: "shared-required"; shared: Id[]; routePrefix: string }
  | { id: Id; kind: "fixed-width"; width: number };

export interface Attachment {
  id: Id;
  /** Path relative to the .buni file. */
  path: string;
  mime: string;
}

// The system behind the pages: parts and how they talk (system), then what each part exposes
// (contract). Pages tie in through Page.client, Connection.endpoint and NodeBase.bind.

export type PartKind = "client" | "service" | "store" | "cache" | "queue" | "external";

/** How a service is called: REST endpoints, GraphQL operations, or not at all (a worker). */
export type ApiStyle = "rest" | "graphql" | "none";

/** One deployable or rented piece of the system: a web app, an API, a database, a cache, a queue, Stripe. */
export interface Part {
  id: Id;
  kind: PartKind;
  name: string;
  /** What it is for, in a sentence or two. */
  purpose: string;
  /** What it is built on, e.g. "Bun + Hono", "Postgres 16". */
  tech?: string;
  /** Services only; absent means REST. */
  api?: ApiStyle;
  /** What the rest of the system does while this part is down. */
  ifDown?: string;
  /** Clients only: it runs in a terminal. */
  terminal?: TerminalClient;
  index: string;
  /** Top-left corner on the system canvas. */
  x?: number;
  y?: number;
}

/** calls: a service or external; reads/writes: a store or cache; publishes/subscribes: a queue. */
export type LinkKind = "calls" | "reads" | "writes" | "publishes" | "subscribes";

export interface Link {
  id: Id;
  from: Id;
  to: Id;
  kind: LinkKind;
  note?: string;
  /** Shapes of the data that passes along it. */
  carries?: Id[];
  /** How the caller copes when this hop is slow or fails. */
  failure?: FailurePolicy;
}

/** A hop's resilience: how long to wait, how often to retry, and what happens after that. */
export interface FailurePolicy {
  timeoutMs?: number;
  retries?: number;
  /** Retries are safe because each request carries this key, e.g. "Idempotency-Key header". */
  idempotencyKey?: string;
  /** What happens when it still fails: "show 'Couldn't save' and keep the form". */
  fallback?: string;
}

export interface ColumnRef {
  table: Id;
  column: string;
}

export interface Column {
  name: string;
  /** SQL type as written, e.g. "uuid", "text", "numeric(10,2)". */
  type: string;
  primary?: boolean;
  nullable?: boolean;
  unique?: boolean;
  /** Foreign key. */
  ref?: ColumnRef;
  /** personal: about a person (email, name); secret: never shown or logged (token hashes, keys). */
  classification?: DataClass;
}

export type DataClass = "personal" | "secret";

/** A table in a store part. Column order is the array's. */
export interface Table {
  id: Id;
  store: Id;
  name: string;
  columns: Column[];
  index: string;
  /** Top-left corner on the Data canvas; absent means laid out automatically. */
  x?: number;
  y?: number;
}

/** Types a field may use besides shapes. */
export const PRIMITIVES = ["id", "string", "integer", "number", "boolean", "datetime"] as const;

/** A named value in a request, response, event payload or shape. */
export interface Field {
  name: string;
  /** A primitive or a shape's name, with [] for a list: "string", "Quote", "Quote[]". */
  type: string;
  optional?: boolean;
  /** A value it might hold ("Monstera"), so mock data, examples and evals read like the product. */
  example?: string | number | boolean;
}

/** A data structure that moves between parts: a request body, a response, a message; or an enum. */
export interface Shape {
  id: Id;
  /** PascalCase, unique: "Quote", "Money". */
  name: string;
  /** Empty for an enum. */
  fields: Field[];
  /** An enum's allowed values, e.g. ["draft", "sent"]; a shape has fields or values, not both. */
  values?: string[];
  note?: string;
  index: string;
}

/** Responses kept in a cache part for a while, under a key. */
export interface CachePolicy {
  part: Id;
  ttlSeconds: number;
  /** What varies the entry, e.g. "plans" or "quote:{id}". */
  key: string;
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A way a call fails that a caller must handle: "409" when "the plan was retired". */
export interface ErrorCase {
  code: string;
  when: string;
}

/** An operation a service part exposes, and the data it touches. */
export interface Endpoint {
  id: Id;
  service: Id;
  method: Method;
  /** Starts with "/"; path parameters in braces, e.g. "/quotes/{id}". */
  path: string;
  summary: string;
  request: Field[];
  response: Field[];
  /** The request body is this shape, whole (ReturnRequest); then request is empty. */
  requestShape?: Id;
  /** The response body is this shape, whole (Return); then response is empty. */
  responseShape?: Id;
  /** Tables it reads and writes, and events it emits. */
  reads: Id[];
  writes: Id[];
  emits: Id[];
  cache?: CachePolicy;
  /** Cached endpoints or operations whose entries this one makes stale. */
  invalidates?: Id[];
  errors?: ErrorCase[];
  access?: Access;
  index: string;
}

/** A layer and everything under it, one line each: kind, tag, id, name and its words, image or component. */
export function outline(doc: Doc, n: Node, depth: number, lines: string[]): void {
  const detail =
    n.kind === "text" ? ` "${n.text.length > 40 ? `${n.text.slice(0, 40)}…` : n.text}"`
    : n.kind === "instance" ? ` → component "${doc.shared[n.shared]?.name ?? n.shared}" (${n.shared})`
    : n.kind === "image" ? ` asset "${n.asset}"`
    : "";
  const moves = n.motion?.length ? ` moves: ${n.motion.map((m) => `${m.trigger} ${m.effect} ${m.durationMs}ms`).join(", ")}` : "";
  lines.push(`${"  ".repeat(depth)}${n.kind}${n.tag ? `<${n.tag}>` : ""} ${n.id} "${n.name}"${detail}${moves}`);
  for (const c of childrenOf(doc, n.id)) outline(doc, c, depth + 1, lines);
}

/** An endpoint's body as fields: its own, or its shape's when the body is a shape. */
export function bodyFields(doc: Doc, e: Endpoint, side: "request" | "response"): Field[] {
  const shape = side === "request" ? e.requestShape : e.responseShape;
  return shape ? doc.shapes[shape]?.fields ?? [] : e[side];
}

/** An endpoint's body as typed fields, for briefs and type graphs: a shape body is one field of that shape. */
export function bodyTypes(doc: Doc, e: Endpoint, side: "request" | "response"): Field[] {
  const shape = side === "request" ? e.requestShape : e.responseShape;
  return shape ? [{ name: "body", type: doc.shapes[shape]?.name ?? shape }] : e[side];
}

/** Who may call something: anyone, anyone signed in, or these roles; and which rows they may touch. */
export interface Access {
  who: "public" | "signed-in" | "roles";
  /** With who: "roles". */
  roles?: Id[];
  /** The row rule, e.g. "only their workspace's projects". */
  rule?: string;
}

export type OperationKind = "query" | "mutation" | "subscription";

/** A GraphQL field on Query, Mutation or Subscription of a GraphQL service. */
export interface Operation {
  id: Id;
  service: Id;
  kind: OperationKind;
  /** camelCase, unique per kind on its service: "plans", "updatePlan". */
  name: string;
  summary: string;
  args: Field[];
  /** A primitive or shape, with [] for a list: "Plan[]". Non-null unless nullable. */
  returns: string;
  nullable?: boolean;
  reads: Id[];
  writes: Id[];
  emits: Id[];
  /** Queries only. */
  cache?: CachePolicy;
  invalidates?: Id[];
  errors?: ErrorCase[];
  access?: Access;
  index: string;
}

/** One hop of a trace: a part acting on another over a link, maybe through an endpoint, operation or event. */
export interface TraceStep {
  from: Id;
  to: Id;
  /** What happens, in a few words: "submit form", "insert quotes". */
  action: string;
  /** The endpoint, operation or event this hop uses. */
  via?: Id;
  /** The shape it carries. */
  carries?: Id;
  /** Happens after the response, off the request path. */
  async?: boolean;
  /** Time budget for the hop. */
  ms?: number;
  /** What the person ends up seeing if this hop fails. */
  ifFails?: string;
}

/** One user action followed through every part it touches, in order. */
export interface Trace {
  id: Id;
  name: string;
  /** The page it starts on. */
  page?: Id;
  steps: TraceStep[];
  index: string;
}

// Deployment topology: where each part runs, per environment, in the terms platforms use.

/** A copy of the system: production, staging, a preview. */
export interface Environment {
  id: Id;
  /** "prod", "staging". */
  name: string;
  /** "aws", "gcp", "fly", "vercel"… free text: the choice, not a category. */
  provider: string;
  /** Regions this environment runs in, as the provider names them: "us-east-1". */
  regions: string[];
  index: string;
}

export type ClusterKind = "kubernetes" | "ecs" | "nomad" | "vms";

/** Somewhere workloads are scheduled: a Kubernetes cluster, an ECS cluster, a fleet of VMs. */
export interface Cluster {
  id: Id;
  environment: Id;
  name: string;
  kind: ClusterKind;
  region: string;
  /** "1.30", "EKS 1.30". */
  version?: string;
}

/**
 * How a part runs. Kubernetes workloads (deployment, statefulset, daemonset, cronjob, job) need a
 * kubernetes cluster; function and static are serverless and edge; managed is a provider's service
 * (RDS, ElastiCache, SQS); vm is a machine you run.
 */
export type Runtime = "deployment" | "statefulset" | "daemonset" | "cronjob" | "job" | "container" | "function" | "static" | "managed" | "vm";

export interface Scale {
  min: number;
  max: number;
  /** Autoscale on CPU at this percent (a HorizontalPodAutoscaler on Kubernetes). */
  cpuTarget?: number;
}

export interface Resources {
  /** Kubernetes quantities: "250m", "1". */
  cpu?: string;
  /** "256Mi", "2Gi". */
  memory?: string;
}

/** Where one part runs in one environment. */
export interface Placement {
  id: Id;
  part: Id;
  environment: Id;
  runtime: Runtime;
  /** Regions it runs in; one unless it is spread out. */
  regions: string[];
  cluster?: Id;
  /** Kubernetes namespace. */
  namespace?: string;
  scale?: Scale;
  resources?: Resources;
  /** Public entry: a host and path routed to it (an Ingress on Kubernetes). */
  ingress?: { host: string; path: string };
  /** Cron schedule for cronjobs: "0 3 * * *". */
  schedule?: string;
  /** The service or product, for managed: "RDS Postgres", "ElastiCache Redis". */
  service?: string;
  /** Names of settings and secrets it reads; values never live in the design. */
  config?: string[];
  secrets?: string[];
  /** Standby copies, for stores and caches. */
  replicas?: number;
  note?: string;
}

/** Where something was dragged on one of the System canvases: id is "<view>:<thing id>", e.g. "api:create-quote". */
export interface CanvasPosition {
  id: string;
  x: number;
  y: number;
}

/** Canvases that remember where things were dragged. */
export const CANVAS_VIEWS = ["api", "shapes", "cache", "traces"] as const;
export type CanvasView = (typeof CANVAS_VIEWS)[number];

// The design process around the system: why each piece exists, what's still open, who may do what,
// and how far along review is.

/** When something ships: "v1", "later". Ordered by index. */
export interface Phase {
  id: Id;
  name: string;
  goal?: string;
  index: string;
}

export type Priority = "must" | "should" | "could";

/** Something the design has to achieve, and the pieces that achieve it. */
export interface Requirement {
  id: Id;
  title: string;
  detail?: string;
  priority: Priority;
  phase?: Id;
  /** Parts, calls, tables, events, shapes, traces, pages or flows that serve it. */
  servedBy: Id[];
  index: string;
}

export interface QuestionOption {
  name: string;
  pros?: string;
  cons?: string;
}

/** Something not decided yet (a question with options) or taken as given (an assumption). */
export interface Question {
  id: Id;
  kind: "question" | "assumption";
  text: string;
  options: QuestionOption[];
  status: "open" | "decided";
  /** The option chosen, once decided. */
  chosen?: string;
  /** Pieces it is about. */
  about: Id[];
  by: string;
  at: string;
  index: string;
}

/**
 * One eval case for an agent: what the person asks, and what it must do. Each "must" is checked after a run, on a
 * copy of the file, from the design afterwards and the run's steps.
 */
export interface EvalCase {
  id: Id;
  /** "buni" for buni's own agent, else the id of an agent designed in this file. */
  agent: string;
  ask: string;
  must: string[];
  /** What the design's API tools answer in this case, by tool name, instead of the mock's made-up example. */
  given?: Record<string, unknown>;
  index: string;
}

/**
 * An agent designed in this file: who it is and its job, the model it runs on, exactly which tools it may call, and
 * what it must never do. buni runs it in the app, the browser and the terminal, like its own agent.
 */
export interface AgentDef {
  id: Id;
  name: string;
  /** Its instructions: who it is, its job, how it works. Sent first with every request. */
  instructions: string;
  /** "provider/model", e.g. "openrouter/anthropic/claude-sonnet-5.5"; without one it uses buni's model. */
  model?: string;
  /**
   * The tools it may call, by name: the design's endpoints and operations as tools (api_post_refunds,
   * gql_query_returns), buni's own design tools (read_tree, write_html), or a whole area of them ("area:pages").
   */
  tools: string[];
  /** Things it must never do, said to it with its instructions. */
  never: string[];
  index: string;
}

/** "POST /refunds/{id}" -> "api_post_refunds_by_id": an endpoint's name as a tool, never the same as one of buni's own. */
export function endpointToolName(e: Pick<Endpoint, "method" | "path">): string {
  const path = e.path.replace(/\{([^}]+)\}/g, "by_$1").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `api_${e.method.toLowerCase()}_${path}`.toLowerCase().slice(0, 64);
}

/** "mutation issueRefund" -> "gql_mutation_issue_refund". */
export function operationToolName(o: Pick<Operation, "kind" | "name">): string {
  const snake = o.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  return `gql_${o.kind}_${snake}`.slice(0, 64);
}

/** Someone who uses the system, for access rules: "reviewer", "admin", "recipient". */
export interface Role {
  id: Id;
  name: string;
  description: string;
  index: string;
}

export type ReviewState = "draft" | "proposed" | "changes" | "approved";

/** Where a piece is in review; id is the piece's id. */
export interface Review {
  id: Id;
  state: ReviewState;
  by: string;
  at: string;
  /** The piece as it stood when reviewed (see fingerprint); a later change shows the review no longer covers it. */
  fingerprint?: string;
  /** The piece itself as reviewed, as JSON, so a reviewer sees what changed since; pages keep only the fingerprint. */
  was?: string;
  /** Proposed again after an approval: that approval, so the reviewer sees what changed since they said yes. */
  approved?: { by: string; at: string; was?: string };
}

const REVIEWABLE = ["parts", "links", "tables", "endpoints", "operations", "events", "shapes", "traces", "pages", "flows", "requirements", "questions", "roles", "environments", "placements"] as const;

/** JSON with keys in order and where things sit on a canvas left out: the same piece, the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    // An empty list and no list say the same thing; where a thing sits and which screen layer a state's layer
    // copies (twin) are bookkeeping, not what was reviewed.
    return `{${Object.entries(v).filter(([k, x]) => x !== undefined && !(Array.isArray(x) && x.length === 0) && k !== "index" && k !== "x" && k !== "y" && k !== "twin").sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * What a review covers, as a short hash: the piece itself, and for a page its layers and its states' too (a
 * screen review approves what is on the screen in every state). Undefined when nothing has that id.
 */
export function fingerprint(doc: Doc, id: Id): string | undefined {
  const col = REVIEWABLE.find((c) => doc[c][id] !== undefined);
  if (!col) return undefined;
  const page = doc.pages[id];
  const layers = (frame: Id): Node[] => { const x = doc.nodes[frame]; return x ? [x, ...childrenOf(doc, frame).flatMap((c) => layers(c.id))] : []; };
  const screen = (p: Page) => ({ page: p, layers: layers(p.frame) });
  const text = stable(page ? { ...screen(page), states: statesOf(doc, page).map(screen) } : doc[col][id]);
  // FNV-1a: short, stable, and enough to notice a change; nothing here needs to resist an attacker.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** The states drawn for a screen: pages at its route with a state, in page order; none for a state itself. */
export function statesOf(doc: Doc, screen: Page): Page[] {
  if (screen.state !== undefined || screen.route === undefined) return [];
  return pagesInOrder(doc).filter((p) => p.state !== undefined && p.route === screen.route);
}

/** Any piece by the name people know it: "POST /returns", "Main database", a page, a requirement's title. */
export function pieceName(doc: Doc, id: Id): string {
  const e = doc.endpoints[id];
  if (e) return `${e.method} ${e.path}`;
  const o = doc.operations[id];
  if (o) return `${o.kind} ${o.name}`;
  const q = doc.requirements[id] ?? doc.questions[id];
  if (q) return "title" in q ? q.title : q.text;
  return (doc.parts[id] ?? doc.tables[id] ?? doc.events[id] ?? doc.shapes[id] ?? doc.traces[id] ?? doc.pages[id] ?? doc.flows[id] ?? doc.roles[id] ?? doc.environments[id])?.name ?? id;
}

/** A piece as a review keeps it, to compare with later; undefined for pages (their layers make it large) and unknown ids. */
export function reviewCopy(doc: Doc, id: Id): string | undefined {
  if (doc.pages[id]) return undefined;
  const col = REVIEWABLE.find((c) => doc[c][id] !== undefined);
  return col ? stable(doc[col][id]) : undefined;
}

/** A field of a piece that changed since review: its name, and short forms of what it was and is. */
export interface ReviewChange {
  field: string;
  was: string;
  now: string;
}

/** A piece's review as it stands now: its recorded state, whether it changed after approval, and how. */
/** What a team reviews, in board order: screens (their states go with them), parts, calls, tables, traces, requirements. */
export function reviewablePieces(doc: Doc): Id[] {
  const ordered = <T extends { id: Id; index: string }>(xs: Record<Id, T>) => Object.values(xs).sort(byIndex).map((x) => x.id);
  return [
    ...pagesInOrder(doc).filter((p) => p.state === undefined).map((p) => p.id),
    ...ordered(doc.parts), ...ordered(doc.endpoints), ...ordered(doc.operations), ...ordered(doc.tables), ...ordered(doc.traces), ...ordered(doc.requirements),
  ];
}

/** A list whose items carry a name (or a code, for errors), keyed by it with the rest of each item; else undefined. */
function keyed(v: unknown): Map<string, unknown> | undefined {
  if (v === undefined) return new Map();
  if (!Array.isArray(v)) return undefined;
  const out = new Map<string, unknown>();
  for (const item of v) {
    if (typeof item !== "object" || item === null) return undefined;
    const { name, code, ...rest } = item as Record<string, unknown>;
    const key = typeof name === "string" ? name : typeof code === "string" ? code : undefined;
    if (key === undefined || out.has(key)) return undefined;
    out.set(key, rest);
  }
  return out;
}

export function reviewOf(doc: Doc, id: Id): (Review & { changed: boolean; changes: ReviewChange[] }) | undefined {
  const r = doc.reviews[id];
  if (!r) return undefined;
  const changed = r.state === "approved" && r.fingerprint !== undefined && r.fingerprint !== fingerprint(doc, id);
  const changes: ReviewChange[] = [];
  const now = reviewCopy(doc, id);
  // Against the approval this review follows from: the stale one itself, or the one before a new proposal.
  const was = changed ? r.was : r.state !== "approved" ? r.approved?.was : undefined;
  if (was && now) {
    const before: Record<string, unknown> = JSON.parse(was);
    const after: Record<string, unknown> = JSON.parse(now);
    const short = (v: unknown) => { const t = v === undefined ? "nothing" : typeof v === "string" ? v : JSON.stringify(v); return t.length > 240 ? `${t.slice(0, 240)}…` : t; };
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
      const same = (x: unknown) => (Array.isArray(x) && x.length === 0 ? undefined : x);
      if (stable(same(before[field])) === stable(same(after[field]))) continue;
      // A list of named things (columns, fields, errors) changes item by item, so a reviewer reads "columns amount", not two blobs.
      const was = keyed(before[field]);
      const now = keyed(after[field]);
      if (!was || !now) { changes.push({ field, was: short(before[field]), now: short(after[field]) }); continue; }
      for (const key of [...new Set([...was.keys(), ...now.keys()])]) {
        if (stable(was.get(key)) !== stable(now.get(key))) changes.push({ field: `${field} ${key}`, was: short(was.get(key)), now: short(now.get(key)) });
      }
    }
  }
  return { ...r, changed, changes };
}

/** A discussion on a piece of the system (page comments stay on page nodes). */
export interface Thread {
  id: Id;
  target: Id;
  state: CommentState;
  posts: Post[];
}

/** A message on a queue part. */
export interface QueueEvent {
  id: Id;
  queue: Id;
  /** Dotted, past tense: "quote.created". */
  name: string;
  payload: Field[];
  index: string;
}

/** A node showing `field` of the response of `endpoint` (an endpoint or an operation). */
export interface Bind {
  endpoint: Id;
  field: string;
}

export const FORMAT_VERSION = 1;

export interface Doc {
  buni: typeof FORMAT_VERSION;
  /**
   * Other .buni files (paths relative to this one) whose system this file builds on. Files may import
   * each other: everything reachable is checked as one system, and each thing lives in one file.
   */
  imports?: string[];
  /** Relative path of a linked tokens file, when tokens are shared across files. */
  tokensRef?: string;
  /** CSS custom property name ("--color-ink") to value. */
  tokens: Record<string, string>;
  pages: Record<Id, Page>;
  nodes: Record<Id, Node>;
  shared: Record<Id, SharedSection>;
  connections: Record<Id, Connection>;
  flows: Record<Id, Flow>;
  journeys: Record<Id, Journey>;
  comments: Record<Id, Comment>;
  /** The design doc every agent reads first. */
  sections: Record<Id, Section>;
  decisions: Record<Id, Decision>;
  rules: Record<Id, Rule>;
  attachments: Record<Id, Attachment>;
  parts: Record<Id, Part>;
  links: Record<Id, Link>;
  tables: Record<Id, Table>;
  endpoints: Record<Id, Endpoint>;
  events: Record<Id, QueueEvent>;
  shapes: Record<Id, Shape>;
  operations: Record<Id, Operation>;
  traces: Record<Id, Trace>;
  environments: Record<Id, Environment>;
  clusters: Record<Id, Cluster>;
  placements: Record<Id, Placement>;
  /** Layout only: where things sit on the System canvases. */
  positions: Record<string, CanvasPosition>;
  phases: Record<Id, Phase>;
  requirements: Record<Id, Requirement>;
  questions: Record<Id, Question>;
  /** Agents designed in this file. */
  agents: Record<Id, AgentDef>;
  evals: Record<Id, EvalCase>;
  roles: Record<Id, Role>;
  reviews: Record<Id, Review>;
  threads: Record<Id, Thread>;
}

export function emptyDoc(): Doc {
  return {
    buni: FORMAT_VERSION,
    tokens: {},
    pages: {},
    nodes: {},
    shared: {},
    connections: {},
    flows: {},
    journeys: {},
    comments: {},
    sections: {},
    decisions: {},
    rules: {},
    attachments: {},
    parts: {},
    links: {},
    tables: {},
    endpoints: {},
    events: {},
    shapes: {},
    operations: {},
    traces: {},
    environments: {},
    clusters: {},
    placements: {},
    positions: {},
    phases: {},
    requirements: {},
    questions: {},
    agents: {},
    evals: {},
    roles: {},
    reviews: {},
    threads: {},
  };
}

function byIndex(a: { index: string; id: Id }, b: { index: string; id: Id }): number {
  if (a.index !== b.index) return a.index < b.index ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Children of a node in sibling order. */
/**
 * Children by parent, built once per node table. Documents are never edited in place once read
 * (changes apply to a fresh clone), so the node table identifies a version. Without this, walking
 * a tree scanned every node once per layer: quadratic, and seconds on big files.
 */
const CHILDREN = new WeakMap<Record<Id, Node>, Map<Id, Node[]>>();

export function childrenOf(doc: Doc, id: Id): Node[] {
  let index = CHILDREN.get(doc.nodes);
  if (!index) {
    index = new Map();
    for (const n of Object.values(doc.nodes)) {
      if (n.parent === undefined) continue;
      const list = index.get(n.parent);
      if (list) list.push(n);
      else index.set(n.parent, [n]);
    }
    for (const list of index.values()) list.sort(byIndex);
    CHILDREN.set(doc.nodes, index);
  }
  return [...(index.get(id) ?? [])];
}

/** Pages in sitemap order. */
export function pagesInOrder(doc: Doc): Page[] {
  return Object.values(doc.pages).sort(byIndex);
}

/** What a page is at a glance: its route, or a graphic's size ("512×512"). */
export function pageLabel(doc: Doc, page: Page): string {
  const t = page.terminal;
  if (t) return `${t.surface.replace("-", " ")} · ${t.cols}${t.rows !== undefined ? `×${t.rows}` : " cols"}`;
  if (page.route !== undefined) return page.state ? `${page.route} · ${page.state}` : page.route;
  const style = doc.nodes[page.frame]?.style ?? {};
  const px = (v: string | undefined) => Number.parseInt(v ?? "", 10);
  const w = px(style.width);
  const h = px(style.height);
  return Number.isFinite(w) && Number.isFinite(h) ? `${w}×${h}` : "graphic";
}

/** Pages reachable from `start` by connections, breadth first, with the connections used. */
/**
 * The pages a flow reaches from `start`, in order. The usual path comes first, through links without a
 * condition; `alternatives` are the pages reached only when a condition holds (a slow carrier, an error),
 * listed after it.
 */
export function walkFlow(doc: Doc, start: Id): { pages: Id[]; links: Connection[]; alternatives: Id[] } {
  const main = [start];
  // Navigation is always there; following it would make every flow the whole app.
  const from = (page: Id) => Object.values(doc.connections).filter((x) => x.page === page && !x.nav).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = 0; i < main.length; i++) for (const c of from(main[i] ?? "")) if (!c.condition && !main.includes(c.to)) main.push(c.to);
  const pages = [...main];
  const links: Connection[] = [];
  for (let i = 0; i < pages.length; i++) {
    for (const c of from(pages[i] ?? "")) {
      links.push(c);
      if (!pages.includes(c.to)) pages.push(c.to);
    }
  }
  return { pages, links, alternatives: pages.filter((p) => !main.includes(p)) };
}

/** A REST endpoint or a GraphQL operation: anything a page or another part can call. */
export type Callable = { kind: "rest"; endpoint: Endpoint } | { kind: "graphql"; operation: Operation };

export function callable(doc: Doc, id: Id): Callable | undefined {
  const e = doc.endpoints[id];
  if (e) return { kind: "rest", endpoint: e };
  const o = doc.operations[id];
  return o ? { kind: "graphql", operation: o } : undefined;
}

/** Field names a page can show from a call: a REST response's fields, or the returned shape's fields. */
export function responseFields(doc: Doc, c: Callable): string[] {
  if (c.kind === "rest") return fieldPaths(doc, bodyFields(doc, c.endpoint, "response"));
  const base = c.operation.returns.replace(/\[\]$/, "");
  const shape = Object.values(doc.shapes).find((s) => s.name === base);
  return shape ? fieldPaths(doc, shape.fields) : [c.operation.name];
}

/**
 * Every field a page can show, through nested shapes: "total", "refund.amount", "lines[].price" ([] marks a
 * list, one row each). Three levels deep at most, and a shape inside itself is not followed again.
 */
export function fieldPaths(doc: Doc, fields: readonly Field[], prefix = "", seen: ReadonlySet<string> = new Set(), depth = 0): string[] {
  const byName = new Map(Object.values(doc.shapes).map((s) => [s.name, s]));
  return fields.flatMap((f) => {
    const list = f.type.endsWith("[]");
    const shape = byName.get(list ? f.type.slice(0, -2) : f.type);
    const path = `${prefix}${f.name}`;
    if (!shape?.fields.length || seen.has(shape.name) || depth >= 2) return [path];
    return [path, ...fieldPaths(doc, shape.fields, `${path}${list ? "[]" : ""}.`, new Set([...seen, shape.name]), depth + 1)];
  });
}

/** The collections that describe the system; these are what files share through imports. */
export const SYSTEM_COLLECTIONS = ["parts", "links", "tables", "endpoints", "operations", "events", "shapes", "traces", "environments", "clusters", "placements", "phases", "requirements", "questions", "roles"] as const;
export type SystemCollection = (typeof SYSTEM_COLLECTIONS)[number];

/** This file's system with other files' underneath: what the checks, briefs and System views see. Own entries win. */
export function withImports(doc: Doc, context: Doc | undefined): Doc {
  if (!context) return doc;
  const out: Doc = { ...doc };
  for (const c of SYSTEM_COLLECTIONS) (out as unknown as Record<string, unknown>)[c] = { ...context[c], ...doc[c] };
  return out;
}
