import { sourceLabel, type SourceOwner } from "./sources.ts";
// A .buni file. Every collection is keyed by id so concurrent edits merge as
// separate JSON lines in git; order, where it matters, lives in `index`.

export type Id = string;

/** CSS property (camelCase or custom property) to value. */
export type Style = Record<string, string>;

interface NodeBase extends SourceOwner {
  id: Id;
  /** Absent on roots: a page frame or a shared section root. */
  parent?: Id;
  /** Sort key among siblings, compared as a plain string. */
  index: string;
  name: string;
  style: Style;
  /** HTML element for export; frames default to "div", text to "p". */
  tag?: string;
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
  /** Class names of its own, for a live page's stylesheet, script or library (Tailwind) to find it by. */
  classes?: string[];
}

/** A class name as it goes into class="": one word, nothing that could end the attribute. */
export const CLASS_NAME = /^[^\s"'<>&]{1,200}$/;

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
/** A motion's own curve: a cubic-bezier of four plain numbers, nothing else that could reach the CSS. */
export const CURVE = /^cubic-bezier\(\s*-?\d*\.?\d+\s*(?:,\s*-?\d*\.?\d+\s*){3}\)$/;

export interface Motion {
  trigger: MotionTrigger;
  /** An entrance for load and scroll, a response for hover and press. */
  effect: MotionEffect;
  durationMs: number;
  delayMs?: number;
  easing: Easing;
  /** The exact timing curve, "cubic-bezier(…)", when it is none of the easings': kept from a page a design was imported from. */
  curve?: string;
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

/**
 * The layer an override key names in a component: a layer of its source, or one inside a component it uses, by the
 * path of uses to it ("nav-item/label": the label in the nav item this component holds). Undefined when there is none.
 */
export function overrideTarget(doc: Pick<Doc, "nodes" | "shared">, sharedId: Id, key: string): Node | undefined {
  const inTree = (id: Id, root: Id) => {
    let n = doc.nodes[id];
    for (let i = 0; n && i < 256; i++) {
      if (n.id === root) return true;
      n = n.parent !== undefined ? doc.nodes[n.parent] : undefined;
    }
    return false;
  };
  const parts = key.split("/");
  let section = doc.shared[sharedId];
  for (const [i, id] of parts.entries()) {
    if (!section || !inTree(id, section.root)) return undefined;
    const n = doc.nodes[id];
    if (i === parts.length - 1) return n;
    if (n?.kind !== "instance") return undefined;
    section = doc.shared[n.shared];
  }
  return undefined;
}

/** An outer use's overrides for the layers inside one of its component's nested uses, keyed as that use's own. */
export function nestedOverrides(overrides: Record<Id, Override>, use: Id): Record<Id, Override> {
  const out: Record<Id, Override> = {};
  for (const [k, o] of Object.entries(overrides)) if (k.startsWith(`${use}/`)) out[k.slice(use.length + 1)] = o;
  return out;
}

/** One override over another: the later one's words, icon and styles win, property by property. */
export function layered(under: Override | undefined, over: Override | undefined): Override | undefined {
  if (!under) return over;
  if (!over) return under;
  const style = under.style || over.style ? { ...under.style, ...over.style } : undefined;
  return { ...under, ...over, ...(style ? { style } : {}) };
}

/** A use of a shared section; overrides are keyed by node ids in its source tree, or by paths through nested uses. */
export interface InstanceNode extends NodeBase {
  kind: "instance";
  shared: Id;
  overrides: Record<Id, Override>;
}

export type Node = FrameNode | TextNode | ImageNode | SvgNode | InstanceNode;
export type NodeKind = Node["kind"];

export interface Page extends SourceOwner {
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
  /** A screen in a terminal rather than a web page. */
  terminal?: TerminalScreen;
  /** A live page: scripts run in its preview, and it has a stylesheet, a script and libraries of its own. */
  live?: LivePage;
  /**
   * Other widths the page must work at, in px (390, 768). With any, the page fills the window, and layers can
   * change their style at each width (NodeBase.at).
   */
  widths?: number[];
  /**
   * Another take on page `of`, to compare with it and maybe make live (pick_option). Not linked to it, so each changes
   * on its own; it has no route while it is an option, so Play and export show the page it is an option of.
   */
  option?: PageOption;
}

/**
 * What makes a page live: libraries from a pinned CDN, and its own stylesheet and script (attachments under live/).
 * Its layers are still layers; the files and libraries reach them by class (`classes` on a layer, `.b-ID` always).
 */
export interface LivePage {
  libraries: Library[];
  css?: Id;
  js?: Id;
}
export interface Library {
  /** "tailwindcss", "motion", "Manrope": how the page names it. */
  name: string;
  /** Pinned: a URL on one of LIBRARY_HOSTS, with the version in it. */
  url: string;
}
/** The only places a library may load from: pinned, versioned, public. */
export const LIBRARY_HOSTS = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com)\//;
/** A library that is a stylesheet (a font, a CSS file) rather than a script. */
export const libraryIsStyle = (url: string): boolean => /\.css(\?|$)/.test(url) || url.startsWith("https://fonts.googleapis.com/");

export interface PageOption {
  of: Id;
  /** What it bets on, one line: "Proof first: buyers trust lead times before they ask for a price". */
  idea: string;
}

/** The options of a page, in page order. */
export function optionsOf(doc: Doc, pageId: Id): Page[] {
  return pagesInOrder(doc).filter((p) => p.option?.of === pageId);
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

export interface SharedSection extends SourceOwner {
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

export interface Connection extends SourceOwner {
  id: Id;
  /**
   * Page the trigger node lives on; or a component, for a link on one of its layers that holds on every use of it,
   * in this file and in the designs that import it (a core's nav). A page's own link for the layer wins there.
   */
  page: Id;
  node: Id;
  to: Id;
  trigger: Trigger;
  transition: Transition;
  durationMs: number;
  condition?: string;
  /** The key that follows the link; only for "key" triggers. */
  key?: string;
  /** Navigation (a sidebar, a tab bar): always there, so flows don't follow it as a step. */
  nav?: true;
}

export interface Flow extends SourceOwner {
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

export interface Journey extends SourceOwner {
  id: Id;
  flow: Id;
  lanes: string[];
  steps: JourneyStep[];
}

/** One part of the design doc: who it is for, principles, voice… Ordered by index. */
export interface Section extends SourceOwner {
  id: Id;
  heading: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
  index: string;
}

export type CommentState = "open" | "addressed" | "resolved";

export interface Post {
  author: string;
  body: string;
  /** ISO 8601 timestamp. */
  at: string;
}

export const INK_TOOLS = ["pen", "highlighter"] as const;
/** The architecture views a pen can draw on, besides pages: what the tablet shows. */
export const INK_VIEWS = ["context", "system", "api"] as const;
export type InkView = (typeof INK_VIEWS)[number];
/** Where a mark on the architecture points when no part or link is under it. */
export const ARCHITECTURE_ANCHOR = "architecture";
/** Where a sketch of a new screen points: the Screens canvas, outside any page. */
export const SCREENS_ANCHOR = "screens";

/** One line drawn with a pen: its points are x, y pairs in the page's own pixels. */
export interface Stroke {
  tool: (typeof INK_TOOLS)[number];
  /** A CSS colour: "#c8331f". */
  color: string;
  width: number;
  points: number[];
}

export interface Comment extends SourceOwner {
  id: Id;
  node: Id;
  state: CommentState;
  posts: Post[];
  /**
   * A mark drawn with a pen (on a tablet): the strokes and where they were drawn, a page, an architecture view or a
   * flow. On a page, `node` is the layer under it; on a view, the part or link under it (or ARCHITECTURE_ANCHOR), and
   * its points are in that view's map units; on a flow, the frame of the screen under it (or of the flow's first), and
   * its points are in the units the tablet lays the flow out in (src/editor/tablet-api.ts). A `sketch` is drawn on the
   * Screens canvas outside any page, a screen to be built: `node` is SCREENS_ANCHOR and its points are the canvas's
   * own, where pages sit (a page built from it is moved there).
   */
  ink?: { page?: Id; view?: InkView; flow?: Id; sketch?: true; strokes: Stroke[]; from?: string };
}

export type Rule = SourceOwner & (
  | { id: Id; kind: "tokens-only" }
  | { id: Id; kind: "shared-required"; shared: Id[]; routePrefix: string }
  | { id: Id; kind: "fixed-width"; width: number });

export interface Attachment extends SourceOwner {
  id: Id;
  /** Path relative to the .buni file. */
  path: string;
  mime: string;
}

/** A layer and everything under it, one line each: kind, tag, id, name and its words, image or component. */
export function outline(doc: Doc, n: Node, depth: number, lines: string[]): void {
  const detail =
    n.kind === "text" ? ` "${n.text.length > 40 ? `${n.text.slice(0, 40)}…` : n.text}"`
    : n.kind === "instance" ? ` → component "${doc.shared[n.shared]?.name ?? n.shared}" (${n.shared})`
    : n.kind === "image" ? ` asset "${n.asset}"`
    : "";
  const moves = n.motion?.length ? ` moves: ${n.motion.map((m) => `${m.trigger} ${m.effect} ${m.durationMs}ms${m.curve ? ` ${m.curve}` : ""}`).join(", ")}` : "";
  lines.push(`${"  ".repeat(depth)}${n.kind}${n.tag ? `<${n.tag}>` : ""} ${n.id} "${n.name}"${detail}${moves}`);
  const sources = n.sources ?? (n.kind === "instance" ? doc.shared[n.shared]?.sources : undefined);
  for (const source of sources ?? []) lines.push(`${"  ".repeat(depth + 1)}source: ${sourceLabel(source)}`);
  for (const c of childrenOf(doc, n.id)) outline(doc, c, depth + 1, lines);
}

/** The states drawn for a screen: pages at its route with a state, in page order; none for a state itself. */
export function statesOf(doc: Doc, screen: Page): Page[] {
  if (screen.state !== undefined || screen.route === undefined) return [];
  return pagesInOrder(doc).filter((p) => p.state !== undefined && p.route === screen.route);
}

// How the app behind the screens is built and shipped: code → build → release → Kubernetes → run. buni designs it
// (before and while it is built); it is not monitoring. All of it lives under the document's one `architecture` key.

/** Whether a thing exists yet: planned and removed are a plan's proposal (merge_plan makes them so). */
export const ARCH_STATUSES = ["live", "planned", "deprecated", "removed"] as const;
export type ArchStatus = (typeof ARCH_STATUSES)[number];
/** person: someone who uses the system (a buyer, a merchant), drawn on the Context level. */
export const PART_KINDS = ["client", "service", "worker", "job", "store", "cache", "queue", "external", "edge", "person"] as const;
export type PartKind = (typeof PART_KINDS)[number];
export const LINK_KINDS = ["calls", "reads", "writes", "publishes", "subscribes", "routes"] as const;
export const GROUP_KINDS = ["system", "domain", "team"] as const;
export const CLUSTER_PROVIDERS = ["eks", "gke", "aks", "k3s", "kind", "other"] as const;
export const GITOPS_TOOLS = ["argocd", "flux"] as const;
export const WORKLOAD_KINDS = ["Deployment", "Rollout", "StatefulSet", "Job", "CronJob", "DaemonSet"] as const;
export type WorkloadKind = (typeof WORKLOAD_KINDS)[number];
export const SCALE_BY = ["cpu", "memory", "queue"] as const;
export const STRATEGIES = ["rolling", "canary", "blue-green"] as const;
export const MIGRATION_SAFETY = ["additive", "breaking"] as const;
export const PLAY_KINDS = ["request", "release", "failure"] as const;
/** A Kubernetes object name (RFC 1123 label): what namespaces, workloads and node pools are called in the cluster. */
export const K8S_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** The architecture map's levels a person can arrange by hand; Code is a table, always laid out. */
export const MAP_LEVELS = ["system", "runtime"] as const;
export type MapLevel = (typeof MAP_LEVELS)[number];
export interface MapPoint { x: number; y: number }
/** Where a person put a card on each level of the map; a level left out is laid out automatically. */
export type MapPlaces = Partial<Record<MapLevel, MapPoint>>;

/** What a part, link, workload or migration's plan says about it, and the plan it belongs to. */
interface Planned {
  status?: ArchStatus;
  /** The Plan this belongs to: planned, it is added on merge; removed, it goes. */
  plan?: Id;
}

export interface Build {
  repo: string;
  path?: string;
  dockerfile?: string;
  steps?: string[];
  /** What it makes: "api image", "web bundle". */
  artifact?: string;
  registry?: string;
}

export interface Part extends Planned, SourceOwner {
  id: Id;
  name: string;
  kind: PartKind;
  /** "Next.js", "Postgres 16", "CloudFront". */
  tech?: string;
  about?: string;
  group?: Id;
  owners?: string;
  build?: Build;
  /** "RDS Postgres Multi-AZ": runs as a managed service, not a workload. */
  managed?: string;
  place?: MapPlaces;
  /** The API it offers others, designed before it is built. */
  api?: Api;
}

export const API_KINDS = ["rest", "graphql"] as const;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const GRAPHQL_TYPES = ["query", "mutation", "subscription"] as const;

/** A part's API: REST operations (openapi.yaml) or GraphQL fields (schema.graphql). */
export interface Api {
  kind: (typeof API_KINDS)[number];
  /** The file it is written to: "openapi.yaml", "schema.graphql". */
  spec?: string;
  operations: Operation[];
}

/** One thing an API offers: a REST method and path, or a GraphQL field with its type. */
export interface Operation {
  /** Unique across the architecture's operations, so another can resolve to it. */
  id: Id;
  method?: (typeof HTTP_METHODS)[number];
  /** "/returns/{id}/refund". */
  path?: string;
  type?: (typeof GRAPHQL_TYPES)[number];
  /** "requestRefund(returnId: ID!)". */
  field?: string;
  /** "Refund", "[Return!]!". */
  returns?: string;
  about?: string;
  /** "RefundRequest { amount, reason }". */
  request?: string;
  /** "202 Refund queued". */
  responses?: string[];
  /** The operation (on another part) this one is served by: a GraphQL field's REST call. */
  resolves?: Id;
}

/** Every operation in the architecture, with the part that offers it. */
export function operationsOf(arch: Architecture): { part: Part; op: Operation }[] {
  return Object.values(arch.parts).flatMap((part) => (part.api?.operations ?? []).map((op) => ({ part, op })));
}

/** "POST /returns/{id}/refund" or "requestRefund(returnId: ID!)": how an operation reads. */
export const operationLabel = (op: Operation): string => (op.field ?? `${op.method ?? "GET"} ${op.path ?? "/"}`);

export interface ArchLink extends Planned {
  id: Id;
  from: Id;
  to: Id;
  kind: (typeof LINK_KINDS)[number];
  /** What passes along it: "RefundJob", "Return". */
  carries?: string;
}

export interface Group {
  id: Id;
  name: string;
  kind: (typeof GROUP_KINDS)[number];
  parent?: Id;
}

export interface Environment {
  id: Id;
  name: string;
  /** Where it comes on the way to production: lower ships first. */
  order: number;
  cluster?: Id;
  provider?: string;
  region?: string;
  /** One per pull request. */
  preview?: boolean;
}

export interface NodePool {
  name: string;
  machine?: string;
  min: number;
  max: number;
  spot?: boolean;
  taint?: string;
}

export interface Cluster {
  id: Id;
  name: string;
  provider: (typeof CLUSTER_PROVIDERS)[number];
  version?: string;
  zones?: number;
  pools?: NodePool[];
  addons?: string[];
  gitops?: { tool: (typeof GITOPS_TOOLS)[number]; repo: string; path?: string };
}

export interface Namespace {
  id: Id;
  cluster: Id;
  name: string;
  owners?: string;
}

export interface Workload extends Planned, SourceOwner {
  id: Id;
  part: Id;
  environment: Id;
  namespace: Id;
  kind: WorkloadKind;
  /** Its name in the cluster; the part's name made Kubernetes-safe when absent. */
  name?: string;
  image?: string;
  replicas?: { min: number; max?: number };
  /** "70%", "depth > 100". */
  scale?: { by: (typeof SCALE_BY)[number]; target: string };
  /** Pods kept during disruptions (a PodDisruptionBudget's minAvailable). */
  keep?: number;
  resources?: { cpu?: string; memory?: string; limitCpu?: string; limitMemory?: string };
  probes?: { ready?: string; live?: string };
  service?: { port: number };
  ingress?: { host: string; path?: string };
  config?: string[];
  /** Secret names; where they come from is a part (external, or managed like "Secrets Manager"). */
  secrets?: string[];
  account?: { name: string; role?: string };
  /** Parts its NetworkPolicy lets it reach. */
  egress?: Id[];
  /** A CronJob's schedule. */
  schedule?: string;
  /** A Job that runs before each sync (migrations). */
  before?: boolean;
  /** The node pool it runs on. */
  nodes?: string;
  /** On the runtime map. */
  place?: MapPlaces;
}

export interface Release extends SourceOwner {
  id: Id;
  /** "v42", or a path's name. */
  name: string;
  parts: Id[];
  /** Environment ids, in the order it ships through them. */
  path: Id[];
  /** Where the manifests live: "parcel-deploy/apps/returns-api". */
  manifests?: string;
  /** Canary steps are percentages of traffic, ending at 100; hold is how long each step waits ("15 min"). */
  strategy: { kind: (typeof STRATEGIES)[number]; steps?: number[]; hold?: string };
  /** What each step must pass: "error rate < 1%". */
  checks?: string[];
  rollback?: string;
  /** Workloads (Jobs) that run first: migrations. */
  before?: Id[];
  plan?: Id;
}

export interface Migration extends Planned {
  id: Id;
  /** "0042_store_credit". */
  name: string;
  /** The store part it changes. */
  store: Id;
  release?: Id;
  change: string;
  /** Additive keeps the running code working; breaking needs it gone first. */
  safe: (typeof MIGRATION_SAFETY)[number];
}

export interface Plan extends SourceOwner {
  id: Id;
  name: string;
  /** "RET-214". */
  issue?: string;
  about?: string;
  /** Release ids it ships in, in order. */
  releases?: Id[];
}

/** A stage of the software path, idea to respond, and the gate to the next. */
export interface Stage {
  id: Id;
  name: string;
  order: number;
  tools?: string;
  steps?: string[];
  makes?: string[];
  gate?: string;
  about?: string;
}

export interface PlayStep {
  name: string;
  about?: string;
  /** Any architecture ids: what this step lights. */
  touches: Id[];
  check?: string;
}

/** A request, a release or a failure, played step by step over the architecture. */
export interface Play {
  id: Id;
  name: string;
  kind: (typeof PLAY_KINDS)[number];
  release?: Id;
  steps: PlayStep[];
  /** Where a check can fail (a step number, from 1) and the failure play that follows. */
  fails?: { at: number; then: Id };
}

// A type, not an interface: a document's bags are read as plain records (patch.ts).
export type Architecture = {
  parts: Record<Id, Part>;
  links: Record<Id, ArchLink>;
  groups: Record<Id, Group>;
  environments: Record<Id, Environment>;
  clusters: Record<Id, Cluster>;
  namespaces: Record<Id, Namespace>;
  workloads: Record<Id, Workload>;
  releases: Record<Id, Release>;
  migrations: Record<Id, Migration>;
  plans: Record<Id, Plan>;
  stages: Record<Id, Stage>;
  plays: Record<Id, Play>;
};
export type ArchCollection = keyof Architecture;
export const ARCH_COLLECTIONS = [
  "parts", "links", "groups", "environments", "clusters", "namespaces", "workloads", "releases", "migrations", "plans", "stages", "plays",
] as const satisfies readonly ArchCollection[];

export function emptyArchitecture(): Architecture {
  return { parts: {}, links: {}, groups: {}, environments: {}, clusters: {}, namespaces: {}, workloads: {}, releases: {}, migrations: {}, plans: {}, stages: {}, plays: {} };
}

/** The document's architecture, every collection there (empty when it has none). */
export function architectureOf(doc: Pick<Doc, "architecture">): Architecture {
  return { ...emptyArchitecture(), ...doc.architecture };
}

/** Which collection holds an architecture id, if any. */
export function archCollectionOf(arch: Architecture, id: Id): ArchCollection | undefined {
  return ARCH_COLLECTIONS.find((c) => Object.hasOwn(arch[c], id));
}

/** A workload's name in the cluster: its own, or its part's made Kubernetes-safe. */
export function workloadName(arch: Architecture, w: Workload): string {
  return w.name ?? k8sName(arch.parts[w.part]?.name ?? w.part);
}

export const k8sName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);

export const FORMAT_VERSION = 1;

export interface Doc {
  buni: typeof FORMAT_VERSION;
  /**
   * Other .buni files (paths relative to this one) whose components and tokens this file builds on. Files may
   * import each other, and each thing lives in one file.
   */
  imports?: string[];
  /** Relative path of a linked tokens file, when tokens are shared across files. */
  tokensRef?: string;
  /** CSS custom property name ("--color-ink") to value. */
  tokens: Record<string, string>;
  /**
   * Other appearances of the tokens, by mode name ("dark"): the tokens that differ there, to their values. A page
   * is drawn in a mode on the canvas, in Play, and on the exported site; "dark" also follows the system's choice.
   */
  modes?: Record<string, Record<string, string>>;
  pages: Record<Id, Page>;
  /**
   * Pages of the files this one imports, as links may reach them: filled in with the imports (withImports),
   * never written to a file. A link to one opens the other file.
   */
  elsewhere?: Record<Id, Pick<Page, "id" | "name" | "route">>;
  nodes: Record<Id, Node>;
  shared: Record<Id, SharedSection>;
  connections: Record<Id, Connection>;
  flows: Record<Id, Flow>;
  journeys: Record<Id, Journey>;
  comments: Record<Id, Comment>;
  /** The design doc every agent reads first. */
  sections: Record<Id, Section>;
  rules: Record<Id, Rule>;
  attachments: Record<Id, Attachment>;
  /** How the app is built and shipped; absent while it has none. */
  architecture?: Architecture;
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
    rules: {},
    attachments: {},
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
  // A flow stays in its file: a link to another file's page ends it there.
  for (let i = 0; i < main.length; i++) for (const c of from(main[i] ?? "")) if (!c.condition && doc.pages[c.to] && !main.includes(c.to)) main.push(c.to);
  const pages = [...main];
  const links: Connection[] = [];
  for (let i = 0; i < pages.length; i++) {
    for (const c of from(pages[i] ?? "")) {
      if (!doc.pages[c.to]) continue;
      links.push(c);
      if (!pages.includes(c.to)) pages.push(c.to);
    }
  }
  return { pages, links, alternatives: pages.filter((p) => !main.includes(p)) };
}

/** This file with the files it imports underneath: what the checks, briefs and canvas see. Own entries win. */
export function withImports(doc: Doc, context: Doc | undefined): Doc {
  if (!context) return doc;
  const out: Doc = { ...doc };
  // A file shares its components and tokens too, so a core file can hold what every section reuses. Its pages stay its own.
  out.shared = { ...context.shared, ...doc.shared };
  out.nodes = { ...componentNodes(context), ...doc.nodes };
  out.tokens = { ...context.tokens, ...doc.tokens };
  if (context.modes || doc.modes) {
    out.modes = { ...context.modes };
    for (const [mode, values] of Object.entries(doc.modes ?? {})) out.modes[mode] = { ...context.modes?.[mode], ...values };
  }
  // Links a component holds on every use come with it.
  out.connections = { ...Object.fromEntries(Object.entries(context.connections).filter(([, c]) => context.shared[c.page])), ...doc.connections };
  // The imported files' pages, as places a link may go: names and routes only, never drawn here.
  out.elsewhere = { ...context.elsewhere };
  for (const p of Object.values(context.pages)) out.elsewhere[p.id] = { id: p.id, name: p.name, ...(p.route !== undefined ? { route: p.route } : {}) };
  for (const id of Object.keys(doc.pages)) delete out.elsewhere[id];
  return out;
}

/** A link drawn from a component's every-use link onto one page: its id is the link's, then "~", then the page. */
export const isUseLink = (id: Id): boolean => id.includes("~");

/** The pages that show a component, directly or inside another component they show. */
export function pagesUsing(doc: Doc): Map<Id, Set<Id>> {
  const pageOfFrame = new Map(Object.values(doc.pages).map((p) => [p.frame, p.id]));
  const componentOfRoot = new Map(Object.values(doc.shared).map((s) => [s.root, s.id]));
  const top = (id: Id): Id => { let n = doc.nodes[id]; for (let i = 0; n?.parent !== undefined && i < 512; i++) n = doc.nodes[n.parent]; return n?.id ?? id; };
  // Where each component is placed: on pages, or in other components.
  const placed = new Map<Id, { pages: Set<Id>; in: Set<Id> }>();
  for (const n of Object.values(doc.nodes)) {
    if (n.kind !== "instance") continue;
    const root = top(n.id);
    const at = placed.get(n.shared) ?? { pages: new Set<Id>(), in: new Set<Id>() };
    const page = pageOfFrame.get(root), holder = componentOfRoot.get(root);
    if (page) at.pages.add(page);
    if (holder) at.in.add(holder);
    placed.set(n.shared, at);
  }
  const out = new Map<Id, Set<Id>>();
  const pagesOf = (id: Id, seen: Set<Id>): Set<Id> => {
    const known = out.get(id);
    if (known) return known;
    const at = placed.get(id);
    const pages = new Set(at?.pages ?? []);
    for (const holder of at?.in ?? []) if (!seen.has(holder)) for (const p of pagesOf(holder, new Set([...seen, holder]))) pages.add(p);
    out.set(id, pages);
    return pages;
  };
  for (const id of Object.keys(doc.shared)) pagesOf(id, new Set([id]));
  return out;
}

/**
 * `doc` with each every-use link (on a component) also as a link on each page that uses the component, where that
 * page has no link of its own for the layer: what Play, export, flows and the canvas follow. Never written to a file.
 */
export function withUseLinks(doc: Doc): Doc {
  const everyUse = Object.values(doc.connections).filter((c) => doc.shared[c.page]);
  if (!everyUse.length) return doc;
  const using = pagesUsing(doc);
  const same = (a: Connection, b: Connection) => a.node === b.node && a.trigger === b.trigger && (a.key ?? "") === (b.key ?? "") && (a.condition ?? "") === (b.condition ?? "");
  const own = Object.values(doc.connections).filter((c) => doc.pages[c.page]);
  const connections = { ...doc.connections };
  for (const c of everyUse) {
    for (const page of using.get(c.page) ?? []) {
      if (own.some((o) => o.page === page && same(o, c))) continue;
      const id = `${c.id}~${page}`;
      connections[id] = { ...c, id, page };
    }
  }
  return { ...doc, connections };
}

/**
 * `doc` with the other designs of its project alongside, as one app to walk and play: their pages, layers,
 * components, links, flows and attachments, this design's own winning. Flows and Play cross from one design into the
 * next; nothing of it is written, and their pages show in this design's tokens.
 */
export function withProject(doc: Doc, others: readonly Doc[]): Doc {
  if (!others.length) return doc;
  const merge = <K extends "pages" | "nodes" | "shared" | "connections" | "flows" | "journeys" | "attachments">(k: K): Doc[K] =>
    Object.assign({}, ...others.map((o) => o[k]), doc[k]);
  const elsewhere = { ...doc.elsewhere };
  for (const o of others) for (const id of Object.keys(o.pages)) delete elsewhere[id];
  return { ...doc, pages: merge("pages"), nodes: merge("nodes"), shared: merge("shared"), connections: merge("connections"), flows: merge("flows"), journeys: merge("journeys"), attachments: merge("attachments"), elsewhere };
}

/** A page's name, here or in an imported file a link reaches. */
export function pageName(doc: Doc, id: Id): string {
  return doc.pages[id]?.name ?? doc.elsewhere?.[id]?.name ?? id;
}

/** Every node of a document's components, roots and all; not its pages'. */
export function componentNodes(doc: Doc): Record<Id, Node> {
  const out: Record<Id, Node> = {};
  const walk = (n: Node | undefined): void => {
    if (!n || out[n.id]) return;
    out[n.id] = n;
    for (const c of childrenOf(doc, n.id)) walk(c);
  };
  for (const s of Object.values(doc.shared)) walk(doc.nodes[s.root]);
  return out;
}
