import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { childrenOf, pageLabel, pageVersionsOf, pagesInOrder, type Doc, type Id, type PageVersion } from "buni/format/doc.ts";
import { diffCss, diffVersion, docAtVersion } from "./pageVersions.ts";
import { ago } from "./Home.tsx";
import { NameDialog } from "./Ask.tsx";
import { componentWidth, placement, rowTitles, tidy, widthOf, type Point } from "./layout.ts";
import { linkLabel, routeAll, type Arrow } from "./links.ts";
import { InkLayer, StrokePaths } from "./tablet/Ink.tsx";
import { sketchesOpen } from "buni/tools/ink.ts";
import { fontFaces, fontSlug, renderComponent, renderPage, liveHead, motionCss } from "buni/tools/html.ts";
import { entrancesOn, motionEnd } from "./moments.ts";

interface Props {
  /** The design with what it imports: imported components render in instances, but aren't boards here. */
  doc: Doc;
  /** Components that live in an imported file, by id. */
  imported?: ReadonlySet<Id>;
  dir: string;
  activePage: Id | undefined;
  selected: Id | undefined;
  /** More layers selected with Shift, outlined like the first. */
  also: readonly Id[];
  /** Pages shown at one of their other widths. */
  viewAt?: Readonly<Record<Id, number>>;
  /** The token mode every board is drawn in ("dark"), or none for the tokens as they are. */
  mode?: string | undefined;
  onMode?: (mode: string | undefined) => void;
  /** Pages drawn in a mode of their own, over the canvas-wide one. */
  modeAt?: Readonly<Record<Id, string>>;
  onModeAt?: (page: Id, mode: string | undefined) => void;
  /** Shows a page's takes side by side, to pick one. */
  onOpenTakes?: ((page: Id) => void) | undefined;
  /** Where each busy agent is working: outlined and tagged in its colour; the first is scrolled into view. */
  focus: readonly AgentSpot[];
  /** What agents just changed, to show it arriving. */
  landing: readonly Landing[];
  /** A page to bring into view and frame, asked for once per `at` (search jumps, an agent's edit clicked). */
  reveal?: { page: Id; at: number } | undefined;
  onSelectPage: (id: Id) => void;
  onSelectNode: (id: Id | undefined, add?: boolean) => void;
  /** A right-click on a layer, after it's selected: where to open its menu. */
  onMenu?: (x: number, y: number) => void;
  /** A page was dragged to a new top-left corner. */
  onMovePage: (id: Id, x: number, y: number) => void;
  /** Tidy was pressed: every page's new position. */
  onTidy: (at: Map<Id, Point>) => void;
  /** The file each imported page lives in, by id, to name where a link out of this file goes. */
  owners?: Readonly<Record<Id, string>> | undefined;
  /** Uses of this file's components in the project's other designs, by component, for their boards' counts. */
  usedElsewhere?: Readonly<Record<Id, number>> | undefined;
  /** A link out of this file was clicked: open its page there. */
  onOpenElsewhere?: ((page: Id) => void) | undefined;
}

export interface AgentSpot {
  agent: string;
  nodes: Id[];
  label: string;
  color: string;
}

/** A page as a standalone document for an iframe; no scripts, attachments resolve next to the .buni file. */
/** The app's own copy of an embedded font: every board shares one load and decode instead of carrying its own. */
const fontFile = (family: string) => new URL(`fonts/${fontSlug(family)}.woff2`, location.href).href;

export function srcdoc(doc: Doc, pageId: Id, dir: string, extraCss = "", mode?: string, headFirst = ""): string {
  // A live page's files are fetched again on every build, so a save shows at once.
  return wrap(renderPage(doc, pageId), dir, fontFaces(doc, fontFile) + extraCss, mode, headFirst + liveHead(doc, pageId, { bust: String(Date.now()) }));
}

/** A component board as a standalone document, for previews. */
export function componentSrcdoc(doc: Doc, sharedId: Id, dir: string, extraCss = "", mode?: string): string {
  return wrap(renderComponent(doc, sharedId), dir, fontFaces(doc, fontFile) + extraCss, mode);
}

/** `mode`: one of the design's token modes to draw in ("dark"); the tokens' CSS answers to it on <html>. */
function wrap({ html, css }: { html: string; css: string }, dir: string, extraCss: string, mode?: string, head = ""): string {
  const base = `${window.buni.assetBase ?? "file://"}${dir.split("/").map(encodeURIComponent).join("/")}/`;
  return `<!doctype html><html${mode ? ` data-mode="${mode}"` : ""}><head><meta charset="utf-8"><base href="${base}"><style>html,body{margin:0;overflow:hidden}${css}${extraCss}</style>${head}</head><body>${html}</body></html>`;
}

/** Small pictures in the overview, rather than hundreds of live browsing contexts. */
async function thumbnail(html: string, width: number, height: number, previewWidth: number, resources: Map<string, Promise<string>>): Promise<string> {
  // Parsing megabytes of CSS into an extra HTML document needlessly builds a second stylesheet.
  const bodyAt = html.indexOf("<body>");
  const base = html.match(/<base href="([^"]*)">/)?.[1] ?? location.href;
  const doc = new DOMParser().parseFromString(html.slice(bodyAt), "text/html");
  const embed = (url: string) => {
    let loading = resources.get(url);
    if (!loading) {
      loading = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`Preview asset: ${response.status} ${url}`);
        const blob = await response.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Preview asset was not text"));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      });
      resources.set(url, loading);
    }
    return loading;
  };
  let css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const urls = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)];
  await Promise.all(urls.map(async ([given, quoted, single, plain]) => {
    const url = (quoted ?? single ?? plain ?? "").trim();
    if (!url || /^(data:|#)/.test(url)) return;
    css = css.replaceAll(given, `url("${await embed(new URL(url, base).href)}")`);
  }));
  await Promise.all([...doc.images].map(async (img) => {
    const src = img.getAttribute("src");
    if (src && !src.startsWith("data:")) img.src = await embed(new URL(src, base).href);
  }));
  css = `body{margin:0;width:${width}px;height:${height}px}${css.replace(":root", "body")}*,*::before,*::after{animation:none!important;transition:none!important}`;
  const body = new XMLSerializer().serializeToString(doc.body).replace(/^(<body[^>]*>)/, (start) => `${start}<style><![CDATA[${css.replaceAll("]]>", "]]]]><![CDATA[>")}]]></style>`);
  // Decode at the stored thumbnail size; layout still uses the page's original coordinate system.
  const size = previewSize(width, height, previewWidth);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><foreignObject width="${width}" height="${height}">${body}</foreignObject></svg>`;
}

/** The layer to select at a point: an enclosing component instance wins over the component's own layers. */
function pickNode(doc: Doc, frame: HTMLIFrameElement | null, x: number, y: number): Id | undefined {
  let el = frame?.contentDocument?.elementFromPoint(x, y)?.closest("[class^='b-']") ?? null;
  const first = el?.classList[0]?.slice(2);
  // The outermost use under the point: a button inside a card component is part of the card's source, so a click on
  // the page takes the card, not a layer every card shares.
  let use: Id | undefined;
  while (el) {
    for (const c of el.classList) if (c.startsWith("b-") && doc.nodes[c.slice(2)]?.kind === "instance") use = c.slice(2);
    el = el.parentElement?.closest("[class^='b-']") ?? null;
  }
  return use ? unlocked(doc, use) : first && unlocked(doc, first);
}

/**
 * Where a dragged layer would land at a point: next to the layer under it (before or after, by which half the
 * point is in along the parent's direction), or into it when it is an empty frame; never into itself or a component.
 */
function dropAt(doc: Doc, frame: HTMLIFrameElement | null, dragged: Id, x: number, y: number): { parent: Id; after: Id | ""; line: { x: number; y: number; w: number; h: number } } | undefined {
  const under = nodeAt(frame, x, y);
  // Over the dragged layer's own siblings, the sibling is the target, so dragging reorders; elsewhere the innermost.
  const home = doc.nodes[dragged]?.parent;
  let t = under ? doc.nodes[under] : undefined;
  for (let n = t; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.parent === home) { t = n; break; }
  if (!t || t.id === dragged) return undefined;
  for (let n: typeof t | undefined = t; n; n = n.parent ? doc.nodes[n.parent] : undefined) {
    if (n.id === dragged) return undefined;
    if (n.kind === "instance" || n.locked) return undefined;
  }
  const el = frame?.contentDocument?.querySelector<HTMLElement>(`.b-${t.id}`);
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (t.kind === "frame" && childrenOf(doc, t.id).length === 0) return { parent: t.id, after: "", line: { x: r.left, y: r.top, w: r.width, h: r.height } };
  if (t.parent === undefined) return undefined;
  const parent = doc.nodes[t.parent];
  const row = /^row/.test(parent?.style.flexDirection ?? "") && (parent?.style.display ?? "").includes("flex");
  const before = row ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
  const siblings = childrenOf(doc, t.parent).filter((s) => s.id !== dragged);
  const at = siblings.findIndex((s) => s.id === t.id);
  const after = before ? siblings[at - 1]?.id ?? "" : t.id;
  const line = row ? { x: before ? r.left - 1 : r.right - 1, y: r.top, w: 2, h: r.height } : { x: r.left, y: before ? r.top - 1 : r.bottom - 1, w: r.width, h: 2 };
  return { parent: t.parent, after, line };
}

/** A locked layer can't be picked on the canvas: the click goes to what holds the outermost locked one. */
function unlocked(doc: Doc, id: Id): Id | undefined {
  let pick: Id | undefined = id;
  for (let n = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.locked) pick = n.parent;
  return pick;
}

/** Id of the nearest element at a point that belongs to a buni node. */
export function nodeAt(frame: HTMLIFrameElement | null, x: number, y: number): Id | undefined {
  const cls = frame?.contentDocument?.elementFromPoint(x, y)?.closest("[class^='b-']")?.classList[0];
  return cls?.startsWith("b-") ? cls.slice(2) : undefined;
}

/** Layers an agent just changed, in its colour: they land with an outline that settles, then fades. */
export interface Landing {
  nodes: readonly Id[];
  /** Of those, the layers that are new: they rise into place rather than only flash. */
  fresh?: readonly Id[];
  color: string;
}

const LAND = "@keyframes buni-land{0%{outline:3px solid var(--land);outline-offset:10px}35%{outline:3px solid var(--land);outline-offset:2px}100%{outline:3px solid transparent;outline-offset:2px}}"
  + "@keyframes buni-enter{from{opacity:0;transform:translateY(14px);filter:blur(3px)}to{opacity:1;transform:none;filter:none}}"
  + "@media (prefers-reduced-motion:reduce){[class^='b-']{animation-duration:1ms!important}}";

/** Outlines for the selected node, where each agent works and what just landed, as CSS; the same for every board. */
function marksCss(focus: readonly AgentSpot[], selected: Id | undefined, landing: readonly Landing[], also: readonly Id[] = [], commented: readonly Id[] = []): string {
  return [
    // Layers someone is talking about, dashed; selection and agents draw over it.
    ...commented.map((id) => `.b-${id}{outline:1.5px dashed #d97706;outline-offset:2px}`),
    landing.length ? LAND : "",
    ...landing.flatMap((l) => l.nodes.map((id) => `.b-${id}{--land:${l.color};animation:buni-land 1.8s ease-out${l.fresh?.includes(id) ? ",buni-enter .7s cubic-bezier(.2,.8,.2,1) both" : ""}}`)),
    ...focus.flatMap((f) => f.nodes.map((id) => `.b-${id}{outline:2px solid ${f.color};outline-offset:3px}`)),
    selected ? `.b-${selected}{outline:2px solid #3346d3;outline-offset:2px}` : "",
    ...also.map((id) => `.b-${id}{outline:2px solid #3346d3;outline-offset:2px}`),
  ].join("");
}

const ORIGIN: Point = { x: 0, y: 0 };

/** CSS custom properties as a style. */
function cssVars(vars: Record<`--${string}`, number>): CSSProperties {
  return Object.fromEntries(Object.entries(vars));
}

/** Height of a board's name above its frame, at 100%. */
const LABEL = 19;
/** Allow thousand-page files to fit without clipping their bottom rows. */
/** Further out than this the boards are specks and every label and link stands over them: no use to anyone. */
const MIN_ZOOM = 0.02;
/** Below this, labels, set frames and links hide: the boards alone say where things are. */
const SPECK = 0.05;
/** Below this, page names would overlap the row above: only row titles are shown. */
const FAR = 0.15;
/** Closer than this, a board shows its chrome (play, mode, the version rail); further out, only its label. */
const CLOSE = 0.45;
const OVERVIEW_PAD = 192;

/** Discrete preview resolutions avoid rebuilding a bitmap for every small zoom step. */
export function previewWidth(width: number, zoom: number, pixelRatio: number): number {
  return Math.min(200, Math.max(32, 2 ** Math.ceil(Math.log2(width * zoom * Math.min(pixelRatio, 2)))));
}

export function previewSize(width: number, height: number, requestedWidth: number): { width: number; height: number } {
  const scale = Math.min(requestedWidth / width, 400 / height);
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale) };
}

/**
 * Boards that came into view, built a few per frame: zooming out or panning can bring dozens in
 * at once, and building every one of them in the same frame stalls the canvas.
 */
const waiting: (() => void)[] = [];
let building = 0;
function buildSoon(show: () => void, urgent = false): () => void {
  if (urgent) waiting.unshift(show);
  else waiting.push(show);
  building ||= requestAnimationFrame(function next() {
    const until = performance.now() + 4;
    do { waiting.shift()?.(); } while (waiting.length && performance.now() < until);
    building = waiting.length > 0 ? requestAnimationFrame(next) : 0;
  });
  return () => {
    const i = waiting.indexOf(show);
    if (i >= 0) waiting.splice(i, 1);
  };
}

// Decoding SVG documents also creates layout work in Chrome. Keep only one in flight.
const previews: (() => Promise<void>)[] = [];
let drawing = false;
let previewAfter = 0;
function previewSoon(draw: () => Promise<void>): () => void {
  previews.push(draw);
  const next = () => {
    if (performance.now() < previewAfter) { requestAnimationFrame(next); return; }
    const job = previews.shift();
    if (!job) { drawing = false; return; }
    void job().finally(() => requestAnimationFrame(next));
  };
  if (!drawing) { drawing = true; requestAnimationFrame(next); }
  return () => {
    const i = previews.indexOf(draw);
    if (i >= 0) previews.splice(i, 1);
  };
}

/**
 * The boards whose drawing an edit from `prev` to `next` could have changed; undefined when it could be
 * any of them (tokens, components and attachments show on every board). Unchanged entries are shared
 * between versions, so this compares by identity.
 */
export function touchedBoards(prev: Doc, next: Doc): Set<Id> | undefined {
  if (prev.tokens !== next.tokens || prev.modes !== next.modes || prev.shared !== next.shared || prev.attachments !== next.attachments) return undefined;
  const out = new Set<Id>();
  if (prev.pages !== next.pages) for (const id of new Set([...Object.keys(prev.pages), ...Object.keys(next.pages)])) if (prev.pages[id] !== next.pages[id]) out.add(id);
  if (prev.nodes === next.nodes) return out;
  for (const [doc, other] of [[prev, next], [next, prev]] as const) {
    const pageOf = new Map(Object.values(doc.pages).map((p) => [p.frame, p.id]));
    for (const [id, n] of Object.entries(doc.nodes)) {
      if (other.nodes[id] === n) continue;
      let root = n;
      for (let up = doc.nodes[root.parent ?? ""]; up; up = doc.nodes[up.parent ?? ""]) root = up;
      // A component's own tree: every board placing it changes.
      const page = pageOf.get(root.id);
      if (page === undefined) return undefined;
      out.add(page);
    }
  }
  return out;
}

// Memoised: a hundred boards must not all re-render on every pan, zoom step or streamed token.
const Artboard = memo(function Artboard(props: {
  doc: Doc;
  dir: string;
  pageId: Id;
  at: Point;
  active: boolean;
  retained: boolean;
  detail: boolean;
  /** Close enough to show the board's chrome: play, mode, the version rail. */
  close: boolean;
  near: boolean;
  resources: Map<string, Promise<string>>;
  heights: Map<Id, number>;
  previewWidth: number;
  onPicture: (id: Id, picture: HTMLCanvasElement | undefined) => void;
  onOpen: (id: Id) => void;
  marks: string;
  /** Changes when the board's drawing may have: its HTML is built again only then. */
  version: string;
  /** How many instances of this board's component there are; 0 for a page. */
  uses: number;
  /** One of the page's other widths to show it at, instead of its own. */
  viewWidth?: number | undefined;
  /** The token mode to draw in. */
  mode?: string | undefined;
  /** The design's modes, and how to set this page's own: a toggle on the label cycles through them. */
  modes?: readonly string[];
  onMode?: ((mode: string | undefined) => void) | undefined;
  /** The selected layer: pressing it and dragging moves it. */
  selected?: Id | undefined;
  /** Read when handling a pointer, so zooming doesn't re-render every board. */
  zoom: RefObject<number>;
  onDrag: (pageId: Id, delta: Point | undefined, done: boolean) => void;
  register: (pageId: Id, frame: HTMLDivElement | null, iframe: HTMLIFrameElement | null) => void;
  onLoaded: (pageId: Id, height: number) => void;
  onSelectPage: (id: Id) => void;
  onSelectNode: (id: Id | undefined, add?: boolean) => void;
  /** A right-click on a layer, after it's selected: where to open its menu. */
  onMenu?: (x: number, y: number) => void;
  /** How many takes (options) this page has, and how to open them side by side. */
  takes?: number;
  onOpenTakes?: ((page: Id) => void) | undefined;
}) {
  const { doc, pageId } = props;
  /** An older version looked at in place, beside the live page. */
  const [looking, setLooking] = useState<Id>();
  const [naming, setNaming] = useState(false);
  // A board is a page or a component.
  const page = doc.pages[pageId];
  const component = doc.shared[pageId];
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(() => {
    const style = doc.nodes[page?.frame ?? component?.root ?? ""]?.style;
    const given = style?.height ?? style?.minHeight ?? "";
    // An auto-height board is measured when opened; its overview starts with the usual page height.
    return props.heights.get(pageId) ?? (/^\d+(?:\.\d+)?px$/.test(given) ? Number.parseFloat(given) : page ? 900 : 400);
  });
  const width = page ? props.viewWidth ?? widthOf(doc, pageId) : componentWidth(doc, pageId);
  // At another width the page reflows, so its height is measured again.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const h = frame.current?.contentDocument?.body?.scrollHeight;
      if (h) { setHeight(h); props.heights.set(pageId, h); }
    });
    return () => cancelAnimationFrame(id);
  }, [width, pageId]);
  // Keep the active board mounted; distant boards release their documents but keep their measured size.
  const [editing, setEditing] = useState(false);
  const seen = props.near || props.active || props.retained || editing;
  const live = seen && (props.detail || props.active || props.retained || editing);
  // Keep HTML only for live boards; queued overview jobs hold no generated documents.
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (!live) { setHtml(""); return; }
    return buildSoon(() => setHtml(page ? srcdoc(doc, pageId, props.dir, "", props.mode) : componentSrcdoc(doc, pageId, props.dir, "", props.mode)), true);
    // Not `doc`: most boards keep their drawing when an edit happens elsewhere.
  }, [props.version, pageId, props.dir, page, live]);
  // Keep the document out of DOM attributes: inspection otherwise copies megabytes per board.
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!html || !live) { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [html, live]);
  useEffect(() => {
    if (!seen || live) return;
    let cancelled = false;
    let href: string | undefined;
    let finish: (() => void) | undefined;
    const image = new Image();
    const release = () => {
      image.onload = image.onerror = null;
      image.src = "";
      if (href) URL.revokeObjectURL(href);
      const done = finish;
      finish = undefined;
      done?.();
    };
    const cancelBuild = previewSoon(async () => {
      try {
        const html = page ? srcdoc(doc, pageId, props.dir, "", props.mode) : componentSrcdoc(doc, pageId, props.dir, "", props.mode);
        const svg = await thumbnail(html, width, height, props.previewWidth, props.resources);
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          finish = resolve;
          image.onload = () => {
            if (!cancelled) {
              const canvas = document.createElement("canvas");
              const size = previewSize(width, height, props.previewWidth);
              canvas.width = size.width;
              canvas.height = size.height;
              canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
              props.onPicture(pageId, canvas);
            }
            release();
          };
          image.onerror = () => { console.error("Could not draw the board preview"); release(); };
          href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          image.src = href;
        });
      } catch (error) {
        if (!cancelled) console.error(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { cancelled = true; cancelBuild(); release(); };
  }, [seen, live, props.version, pageId, props.dir, page, width, height, props.resources, props.previewWidth]);
  useEffect(() => () => props.onPicture(pageId, undefined), [seen, live, props.version, props.dir, page, width, height, props.previewWidth, props.onPicture, pageId]);
  const { marks } = props;
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    const d = frame.current?.contentDocument;
    if (!d?.head) return;
    let tag = d.getElementById("buni-marks");
    if (!tag) {
      tag = d.createElement("style");
      tag.id = "buni-marks";
      d.head.append(tag);
    }
    if (tag.textContent !== marks) tag.textContent = marks;
  }, [marks, loads]);

  const { register } = props;
  useEffect(() => {
    register(pageId, box.current, frame.current);
    return () => register(pageId, null, null);
  }, [register, pageId, seen, live, url]);

  // The iframe runs no scripts; same-origin lets the canvas measure and hit-test it.
  const measure = () => {
    // The body, not the document: the document is never shorter than the iframe itself.
    const h = frame.current?.contentDocument?.body?.scrollHeight;
    if (h) {
      setHeight(h);
      props.heights.set(pageId, h);
    }
    setLoads((n) => n + 1);
    props.onLoaded(pageId, h || 900);
  };

  // Pressing the selected layer and dragging moves it: before or after the layer under the pointer, along its
  // parent's direction, or into an empty frame; a line shows where it lands.
  const drag = useRef<{ id: Id; x: number; y: number; moving: boolean; pick: Id | undefined; from?: { x: number; y: number; w: number; h: number } } | undefined>(undefined);
  /** The dragged layer's box, carried along with the pointer so it reads as moving, not just its drop line. */
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; name: string }>();
  const [drop, setDrop] = useState<{ parent: Id; after: Id | ""; line: { x: number; y: number; w: number; h: number } }>();
  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / props.zoom.current, y: (e.clientY - rect.top) / props.zoom.current };
  };
  const hit = (e: ReactPointerEvent<HTMLDivElement>) => {
    props.onSelectPage(pageId);
    const p = local(e);
    const id = pickNode(doc, frame.current, p.x, p.y);
    // Pressing inside the selected layer grabs it, as in other design tools; a click without moving then picks
    // the layer under the pointer, so going deeper still works.
    const sel = props.selected;
    let inside = false;
    for (let n = id ? doc.nodes[id] : undefined; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.id === sel) { inside = true; break; }
    if (sel && inside && !e.shiftKey && doc.nodes[sel]?.parent !== undefined) {
      drag.current = { id: sel, x: p.x, y: p.y, moving: false, pick: id, ...(box2 ? { from: box2 } : {}) };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    props.onSelectNode(id, e.shiftKey);
  };
  const dragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    if (!d.moving && Math.hypot(p.x - d.x, p.y - d.y) * props.zoom.current < 5) return;
    d.moving = true;
    setDrop(dropAt(doc, frame.current, d.id, p.x, p.y));
    if (d.from) setGhost({ x: d.from.x + (p.x - d.x), y: d.from.y + (p.y - d.y), w: d.from.w, h: d.from.h, name: doc.nodes[d.id]?.name ?? "" });
  };
  // The selected layer's box, for its size and resize handles; measured after each change to the board.
  const [box2, setBox] = useState<{ x: number; y: number; w: number; h: number }>();
  useEffect(() => {
    const sel = props.selected;
    const el = sel ? frame.current?.contentDocument?.querySelector<HTMLElement>(`.b-${sel}`) : null;
    if (!el || doc.nodes[sel ?? ""]?.parent === undefined) { setBox(undefined); return; }
    const r = el.getBoundingClientRect();
    setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [props.selected, props.version, width, height, loads]); // the board's drawing changes with these

  // The selected frame's spacing, dragged where it is: the gap between its first two children, and its padding at
  // the top and left edges (each sets both sides). Shown live in the page; written once, on release.
  type Rect = { x: number; y: number; w: number; h: number };
  const [spacing, setSpacing] = useState<{ gap?: Rect & { axis: "x" | "y" }; pad?: { t: number; l: number } }>();
  const measureSpacing = useCallback(() => {
    const sel = props.selected;
    const node = sel ? doc.nodes[sel] : undefined;
    const el = sel ? frame.current?.contentDocument?.querySelector<HTMLElement>(`.b-${sel}`) : null;
    const cs = el?.ownerDocument.defaultView?.getComputedStyle(el);
    if (!sel || !el || !cs || node?.kind !== "frame" || node.parent === undefined) { setSpacing(undefined); return; }
    const kids = childrenOf(doc, sel).filter((c) => !c.hidden).map((c) => el.querySelector<HTMLElement>(`.b-${c.id}`)?.getBoundingClientRect()).filter((k) => k !== undefined);
    const [a, b] = kids;
    let gap: (Rect & { axis: "x" | "y" }) | undefined;
    if (cs.display === "flex" && a && b) {
      gap = cs.flexDirection.startsWith("column")
        ? { x: a.left, y: a.bottom, w: a.width, h: Math.max(0, b.top - a.bottom), axis: "y" }
        : { x: a.right, y: a.top, w: Math.max(0, b.left - a.right), h: a.height, axis: "x" };
    }
    setSpacing({ ...(gap ? { gap } : {}), pad: { t: parseFloat(cs.paddingTop) || 0, l: parseFloat(cs.paddingLeft) || 0 } });
  }, [props.selected, doc]);
  useEffect(measureSpacing, [measureSpacing, box2]);
  const dragSpacing = (what: "gap" | "pt" | "pl") => (e: ReactPointerEvent<HTMLSpanElement>) => {
    const sel = props.selected;
    const el = sel ? frame.current?.contentDocument?.querySelector<HTMLElement>(`.b-${sel}`) : null;
    const cs = el?.ownerDocument.defaultView?.getComputedStyle(el);
    if (!sel || !el || !cs) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const px = (v: string) => parseFloat(v) || 0;
    const along = what === "pl" || (what === "gap" && spacing?.gap?.axis === "x") ? "x" : "y";
    const start = { x: e.clientX, y: e.clientY, from: what === "gap" ? px(along === "x" ? cs.columnGap : cs.rowGap) : what === "pt" ? px(cs.paddingTop) : px(cs.paddingLeft) };
    const pad = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
    const value = (ev: PointerEvent) => Math.max(0, Math.round(start.from + (along === "x" ? ev.clientX - start.x : ev.clientY - start.y) / props.zoom.current));
    const apply = (v: number) => {
      if (what === "gap") el.style.gap = `${v}px`;
      else if (what === "pt") el.style.paddingTop = el.style.paddingBottom = `${v}px`;
      else el.style.paddingLeft = el.style.paddingRight = `${v}px`;
    };
    const move = (ev: PointerEvent) => { apply(value(ev)); measureSpacing(); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const v = value(ev);
      const p = what === "pt" ? { ...pad, t: v, b: v } : { ...pad, l: v, r: v };
      // The shorthand, as short as it can be.
      const padding = p.t === p.b && p.l === p.r ? (p.t === p.l ? `${p.t}px` : `${p.t}px ${p.l}px`) : `${p.t}px ${p.r}px ${p.b}px ${p.l}px`;
      void window.buni.edit("update_styles", { nodes: [sel], style: what === "gap" ? { gap: `${v}px` } : { padding }, ...(props.viewWidth !== undefined ? { width: props.viewWidth } : {}) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Holding ⌥ over another layer measures from the selected one to it: a line and a number for each axis they're apart on.
  const [gauge, setGauge] = useState<(Rect & { label: string })[]>();
  const measureMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.altKey || !box2 || !props.selected || drag.current) { if (gauge) setGauge(undefined); return; }
    const p = local(e);
    const id = pickNode(doc, frame.current, p.x, p.y);
    const r = id && id !== props.selected ? frame.current?.contentDocument?.querySelector(`.b-${CSS.escape(id)}`)?.getBoundingClientRect() : undefined;
    if (!r) { if (gauge) setGauge(undefined); return; }
    const s = { left: box2.x, right: box2.x + box2.w, top: box2.y, bottom: box2.y + box2.h };
    const lines: (Rect & { label: string })[] = [];
    const span = (from: number, to: number): [number, number] => [from, to];
    const dx = r.left >= s.right ? span(s.right, r.left) : r.right <= s.left ? span(r.right, s.left) : undefined;
    const dy = r.top >= s.bottom ? span(s.bottom, r.top) : r.bottom <= s.top ? span(r.bottom, s.top) : undefined;
    if (dx) { const y = (Math.max(s.top, r.top) + Math.min(s.bottom, r.bottom)) / 2; lines.push({ x: dx[0], y, w: dx[1] - dx[0], h: 0, label: `${Math.round(dx[1] - dx[0])}` }); }
    if (dy) { const x = (Math.max(s.left, r.left) + Math.min(s.right, r.right)) / 2; lines.push({ x, y: dy[0], w: 0, h: dy[1] - dy[0], label: `${Math.round(dy[1] - dy[0])}` }); }
    setGauge(lines);
  };
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key === "Alt") setGauge(undefined); };
    window.addEventListener("keyup", up);
    return () => window.removeEventListener("keyup", up);
  }, []);
  const resize = (edge: "e" | "s" | "se") => (e: ReactPointerEvent<HTMLSpanElement>) => {
    const sel = props.selected;
    const el = sel ? frame.current?.contentDocument?.querySelector<HTMLElement>(`.b-${sel}`) : null;
    if (!sel || !el || !box2) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, w: box2.w, h: box2.h };
    const size = (ev: PointerEvent) => ({
      w: Math.max(1, Math.round(start.w + (edge === "s" ? 0 : (ev.clientX - start.x) / props.zoom.current))),
      h: Math.max(1, Math.round(start.h + (edge === "e" ? 0 : (ev.clientY - start.y) / props.zoom.current))),
    });
    const move = (ev: PointerEvent) => {
      const s = size(ev);
      // Shown live in the page; written once, on release.
      if (edge !== "s") el.style.width = `${s.w}px`;
      if (edge !== "e") el.style.height = `${s.h}px`;
      setBox((b) => (b ? { ...b, w: edge === "s" ? b.w : s.w, h: edge === "e" ? b.h : s.h } : b));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const s = size(ev);
      const style = { ...(edge !== "s" ? { width: `${s.w}px` } : {}), ...(edge !== "e" ? { height: `${s.h}px` } : {}) };
      void window.buni.edit("update_styles", { nodes: [sel], style, ...(props.viewWidth !== undefined ? { width: props.viewWidth } : {}) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const dragEnd = () => {
    const d = drag.current;
    drag.current = undefined;
    const target = drop;
    setDrop(undefined);
    setGhost(undefined);
    if (d && !d.moving) { if (d.pick !== d.id) props.onSelectNode(d.pick); return; }
    if (!d || !target) return;
    void window.buni.edit("move_nodes", { nodes: [d.id], parent: target.parent, after: target.after });
  };

  // Double-clicking a text layer edits it in place, in its own font and box: Enter keeps it, Shift+Enter breaks the
  // line, Escape puts it back. Layers inside a component instance are changed in the component, not here.
  const editText = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!props.detail) { props.onOpen(pageId); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / props.zoom.current;
    const y = (e.clientY - rect.top) / props.zoom.current;
    if (pickNode(doc, frame.current, x, y) !== nodeAt(frame.current, x, y)) return;
    const id = nodeAt(frame.current, x, y);
    const n = id ? doc.nodes[id] : undefined;
    const el = frame.current?.contentDocument?.querySelector<HTMLElement>(`.b-${id}`);
    if (!n || n.kind !== "text" || !el || n.tag === "input" || n.tag === "textarea") return;
    const before = el.innerText;
    setEditing(true);
    el.contentEditable = "plaintext-only";
    el.style.outline = "2px solid #3346d3";
    el.style.cursor = "text";
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const sel = el.ownerDocument.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const done = (keep: boolean) => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.contentEditable = "false";
      el.style.outline = "";
      el.style.cursor = "";
      setEditing(false);
      const text = el.innerText.replace(/\n$/, "");
      if (!keep || text === before) { el.innerText = before; return; }
      void window.buni.edit("set_text", { node: n.id, text });
    };
    const onKey = (k: KeyboardEvent) => {
      if (k.key === "Escape") { k.preventDefault(); done(false); }
      else if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); done(true); }
      k.stopPropagation();
    };
    const onBlur = () => done(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  };

  // Dragging the label moves the page; a press without movement selects it.
  const grab = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const delta = (e: ReactPointerEvent) => ({ x: (e.clientX - (grab.current?.x ?? 0)) / props.zoom.current, y: (e.clientY - (grab.current?.y ?? 0)) / props.zoom.current });

  if ((!page && !component) || !live) return null;
  const { uses } = props;
  return (
    <div className="artboard" style={{ left: props.at.x, top: props.at.y, ...cssVars({ "--w": width }) }}>
      <button
        type="button"
        className={`artboard-label${props.active ? " active" : ""}${component ? " component" : ""}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = { x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          if (!grab.current) return;
          const d = delta(e);
          if (!grab.current.moved && Math.hypot(d.x * props.zoom.current, d.y * props.zoom.current) < 4) return;
          grab.current.moved = true;
          props.onDrag(pageId, d, false);
        }}
        // Keyboard activation has no pointer events.
        onClick={(e) => e.detail === 0 && props.onSelectPage(pageId)}
        onPointerUp={(e) => {
          if (!grab.current) return;
          const { moved } = grab.current;
          const d = delta(e);
          grab.current = undefined;
          if (moved) props.onDrag(pageId, d, true);
          else props.onSelectPage(pageId);
        }}
      >
        {page ? page.name : `◆ ${component?.name}`}
        <span className="route">{page ? pageLabel(props.doc, page) : component?.variant ? `${Object.entries(component.variant).map(([k, v]) => `${k}: ${v}`).join(" · ")} · ${uses} use${uses === 1 ? "" : "s"}` : `component · ${uses} use${uses === 1 ? "" : "s"}`}</span>
        {page && props.viewWidth !== undefined && <span className="view-width">at {props.viewWidth} px</span>}
        {page?.live && <span className="board-live" title="A live page: its scripts and libraries run here">Scripts run</span>}
        {page && (props.takes ?? 0) > 0 && (
          <span role="button" tabIndex={0} className="board-takes" title="Open the takes side by side, to pick one"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); props.onOpenTakes?.(pageId); }} onKeyDown={(e) => { if (e.key === "Enter") props.onOpenTakes?.(pageId); }}>
            ⧉ {props.takes} takes
          </span>
        )}
        {page?.option && <span className="board-takes" title={`A take of ${doc.pages[page.option.of]?.name ?? "a page"}`}>take</span>}
      </button>
      {page && (props.takes ?? 0) > 0 && <div className="take-stack" aria-hidden="true" />}
      {page && props.close && <VersionRail doc={doc} page={page.id} dir={props.dir} mode={props.mode} width={width} looking={looking} onLook={setLooking} naming={naming} onNaming={setNaming} liveFrame={frame} />}
      {page && props.close && (page.live || entrancesOn(props.doc, page.id).length > 0) && (
        <button type="button" className="board-play" title={page.live ? "Run the page again, here" : "Play its motion here"} aria-label="Play here"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const f = frame.current;
            if (!f) return;
            // A live page runs again from the top; a still one gets its motion for as long as it plays, then rests.
            if (page.live) { f.src = f.src; return; }
            const d = f.contentDocument;
            if (!d) return;
            d.getElementById("buni-play")?.remove();
            const s = d.createElement("style");
            s.id = "buni-play";
            s.textContent = motionCss(props.doc, { scrollByTime: true });
            d.head.append(s);
            setTimeout(() => s.remove(), motionEnd(props.doc, page.id) + 200);
          }}>▷</button>
      )}
      {page && props.close && props.modes && props.modes.length > 0 && props.onMode && (
        <button type="button" className={`board-mode${props.mode ? " on" : ""}`} title={props.mode ? `Drawn in ${props.mode} mode; click for the next, or back to the tokens as they are` : "Draw this page in a mode"}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => { const i = props.mode ? props.modes!.indexOf(props.mode) : -1; props.onMode?.(props.modes![i + 1]); }}>
          {props.mode === "dark" ? "☾" : props.mode ? props.mode[0]?.toUpperCase() : "☼"}
        </button>
      )}
      {page?.picked && props.close && <div className="why-line" title={page.picked.over.map((id) => doc.pages[id]?.name).filter(Boolean).join(", ")}><b>Picked</b> {page.picked.why}</div>}
      <div ref={box} className={`frame${props.active ? " active" : ""}${component ? " component" : ""}${page?.terminal ? " terminal" : ""}`} style={{ width, height }}>
        {url ? (
          <iframe ref={frame} title={page?.name ?? component?.name} sandbox={page?.live ? "allow-same-origin allow-scripts" : "allow-same-origin"} src={url} width={width} height={height} onLoad={measure} />
        ) : <div className="board-placeholder" />}
        {page && <InkLayer doc={doc} page={pageId} width={width} />}
        <div className="hit" onPointerDown={hit} onContextMenu={(e) => { if (!props.onMenu) return; e.preventDefault(); props.onMenu(e.clientX, e.clientY); }} onPointerMove={(e) => { dragMove(e); measureMove(e); }} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = undefined; setDrop(undefined); setGhost(undefined); }} onDoubleClick={editText} style={editing ? { pointerEvents: "none" } : undefined} />
        {drop && <div className="drop-line" style={{ left: drop.line.x, top: drop.line.y, width: drop.line.w, height: drop.line.h }} />}
        {ghost && <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}><span>{ghost.name}</span></div>}
        {box2 && !drop && !editing && (
          <div className={`sel-box${gauge?.length ? " measuring" : ""}`} style={{ left: box2.x, top: box2.y, width: box2.w, height: box2.h }}>
            <span className="sel-size">{Math.round(box2.w)} × {Math.round(box2.h)}</span>
            <span className="sel-handle e" onPointerDown={resize("e")} title="Drag to set the width" />
            <span className="sel-handle s" onPointerDown={resize("s")} title="Drag to set the height" />
            <span className="sel-handle se" onPointerDown={resize("se")} title="Drag to set both" />
            {spacing?.gap && <span className={`gap-handle ${spacing.gap.axis}`} style={{ left: spacing.gap.x - box2.x, top: spacing.gap.y - box2.y, width: spacing.gap.w, height: spacing.gap.h }} onPointerDown={dragSpacing("gap")} title="Drag to set the gap between the children" />}
            {spacing?.pad && <span className="pad-handle t" style={{ top: spacing.pad.t }} onPointerDown={dragSpacing("pt")} title="Drag to set the padding above and below" />}
            {spacing?.pad && <span className="pad-handle l" style={{ left: spacing.pad.l }} onPointerDown={dragSpacing("pl")} title="Drag to set the padding left and right" />}
          </div>
        )}
        {gauge?.map((m) => (
          <div key={`${m.x},${m.y}`} className={`measure ${m.w ? "x" : "y"}`} style={{ left: m.x, top: m.y, width: m.w, height: m.h }}><span>{m.label}</span></div>
        ))}
      </div>
    </div>
  );
});

/**
 * The page's points in time under its label: v1 — v2 — v3, then the page as it is. An older one opens beside the
 * page, greyed and read only, with Restore and Branch a take; Save a version keeps the page as it is, with a note.
 */
function VersionRail({ doc, page, dir, mode, width, looking, onLook, naming, onNaming, liveFrame }: { doc: Doc; page: Id; dir: string; mode: string | undefined; width: number; looking: Id | undefined; onLook: (v: Id | undefined) => void; naming: boolean; onNaming: (on: boolean) => void; liveFrame: RefObject<HTMLIFrameElement | null> }) {
  const versions = pageVersionsOf(doc, page);
  const seen = looking !== undefined ? doc.versions[looking] : undefined;
  const now = Date.now();
  // What differs between then and now: outlined on both boards, listed under the version.
  const diff = useMemo(() => (seen ? diffVersion(doc, seen) : undefined), [doc, seen]);
  const ghost = useMemo(() => (seen && diff ? srcdoc(docAtVersion(doc, seen), page, dir, diffCss(diff, "then"), mode) : undefined), [doc, seen, diff, page, dir, mode]);
  useEffect(() => {
    const d = liveFrame.current?.contentDocument;
    if (!d) return;
    d.getElementById("buni-diff")?.remove();
    if (!diff) return;
    const s = d.createElement("style");
    s.id = "buni-diff";
    s.textContent = diffCss(diff, "now");
    d.head.append(s);
    return () => s.remove();
  }, [diff, liveFrame]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!ghost) { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([ghost], { type: "text/html" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [ghost]);
  // A page without versions shows no rail: Save a version is in the Inspector.
  if (!versions.length) return null;
  const act = (tool: "restore_version" | "branch_version", v: PageVersion) => void window.buni.edit(tool, { version: v.id }).then(() => onLook(undefined));
  return (
    <>
      <div className="version-rail" onPointerDown={(e) => e.stopPropagation()}>
        {versions.map((v) => (
          <button type="button" key={v.id} className={`vdot${looking === v.id ? " on" : ""}`} title={`${v.by} · ${ago(v.at, now)}${v.note ? ` · ${v.note}` : ""}`} onClick={() => onLook(looking === v.id ? undefined : v.id)}>v{v.n}</button>
        ))}
        <button type="button" className="vdot now" disabled title="The page as it is">now</button>
        <button type="button" className="vdot add" onClick={() => onNaming(true)}>+ Save a version</button>
      </div>
      {seen && (
        <div className="ghost" style={{ left: width + 80, width }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="ghost-label">
            <b>v{seen.n}</b><span className="dim">{seen.by} · {ago(seen.at, now)}{seen.note ? ` · ${seen.note}` : ""}</span>
            {diff && <span className="dim">· {diff.added.length + diff.removed.length + diff.changed.length === 0 ? "the same as now" : `${diff.added.length + diff.removed.length + diff.changed.length} layers differ`}</span>}
            <span className="grow" />
            <button type="button" className="link-btn" onClick={() => act("restore_version", seen)}>Restore</button>
            <button type="button" className="link-btn" onClick={() => act("branch_version", seen)}>Branch a take</button>
            <button type="button" className="link-btn" aria-label="Close" onClick={() => onLook(undefined)}>×</button>
          </div>
          {diff && (diff.added.length + diff.removed.length + diff.changed.length) > 0 && (
            <ul className="ghost-diff">
              {diff.removed.slice(0, 6).map((n) => <li key={`r${n.id}`}><b>{n.name}</b> gone since</li>)}
              {diff.added.slice(0, 6).map((n) => <li key={`a${n.id}`}><b>{n.name}</b> new since</li>)}
              {diff.changed.slice(0, 8).map((c) => <li key={`c${c.node.id}`}><b>{c.node.name}</b> {c.what}</li>)}
            </ul>
          )}
          <div className="ghost-frame" style={{ width }}>{url && <iframe title={`v${seen.n}`} sandbox="allow-same-origin" src={url} width={width} height={900} />}</div>
        </div>
      )}
      {naming && (
        <NameDialog title="Save a version" label="What this point is" initial="" action="Save" onClose={() => onNaming(false)}
          onSubmit={(note) => { onNaming(false); void window.buni.edit("save_version", { page, note }); }} />
      )}
    </>
  );
}

/** Which links the canvas draws: the active page's, all of them, or none. */
type LinkMode = "page" | "all" | "off";
const NEXT_MODE: Record<LinkMode, LinkMode> = { page: "all", all: "off", off: "page" };

/** Links drawn from the triggering node to the left edge of the page it opens, in world coordinates. */
export function arrows(doc: Doc, boxes: ReadonlyMap<Id, BoardRect>, boards: ReadonlyMap<Id, { frame: HTMLDivElement; iframe: HTMLIFrameElement | undefined }>): Arrow[] {
  const out: Arrow[] = [];
  for (const c of Object.values(doc.connections)) {
    const from = boxes.get(c.page), to = boxes.get(c.to);
    if (!from || !to || c.page === c.to) continue;
    const iframe = boards.get(c.page)?.iframe;
    const el = iframe?.contentDocument?.querySelector(`.b-${CSS.escape(c.node)}`);
    const r = el?.getBoundingClientRect();
    const fx = from.x, fy = from.y, ty = to.y;
    out.push({
      // A key link reads as its key; anything else as the layer that triggers it.
      // A condition is what tells a branch from the usual path out of the same element, so it is the label.
      id: c.id, from: c.page, to: c.to, label: linkLabel(doc, c),
      x: fx + (r ? r.left + r.width / 2 : from.width / 2), y: fy + (r?.top ?? 0), sy: fy, sb: fy + from.height, tx: to.x, ty, top: Math.min(fy, ty) - 24,
    });
  }
  return out;
}

/** Links to another file's page: a tag on the right edge of the page they leave, level with what triggers them. */
export function exits(doc: Doc, boxes: ReadonlyMap<Id, BoardRect>, boards: ReadonlyMap<Id, { frame: HTMLDivElement; iframe: HTMLIFrameElement | undefined }>): { id: Id; from: Id; to: Id; x: number; y: number }[] {
  return Object.values(doc.connections).flatMap((c) => {
    const from = boxes.get(c.page);
    if (!from || doc.pages[c.to] || !doc.elsewhere?.[c.to]) return [];
    const r = boards.get(c.page)?.iframe?.contentDocument?.querySelector(`.b-${CSS.escape(c.node)}`)?.getBoundingClientRect();
    return [{ id: c.id, from: c.page, to: c.to, x: from.x + from.width, y: from.y + (r ? r.top + r.height / 2 : 24) }];
  });
}

export interface BoardRect extends Point { width: number; height: number }

/** Hit testing works even when overview boards have no DOM of their own. Last drawn wins. */
export function boardAt(boxes: ReadonlyMap<Id, BoardRect>, point: Point): Id | undefined {
  let found: Id | undefined;
  for (const [id, box] of boxes) if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) found = id;
  return found;
}

/** Only boards inside the drawing buffer need React state or a browsing context. */
export function nearbyBoards(boxes: ReadonlyMap<Id, BoardRect>, view: Point & { zoom: number }, size: { width: number; height: number }): Set<Id> {
  const pad = view.zoom < FAR ? OVERVIEW_PAD : 64;
  const near = new Set<Id>();
  for (const [id, b] of boxes) {
    if (b.x * view.zoom + view.x < size.width + pad && (b.x + b.width) * view.zoom + view.x > -pad
      && b.y * view.zoom + view.y < size.height + pad && (b.y + b.height) * view.zoom + view.y > -pad) near.add(id);
  }
  return near;
}

/** Every page on one big canvas, where it was placed; drag a page by its name, wheel pans, pinch or ⌘-wheel zooms. */
export function Canvas(props: Props) {
  // Opens with room on the left for the rows' titles.
  const [view, setView] = useState({ x: 240, y: 140, zoom: 0.4 });
  const overview = useRef<HTMLCanvasElement>(null);
  const pictures = useRef(new Map<Id, HTMLCanvasElement>());
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const overviewView = useRef<{ x: number; y: number; zoom: number } | undefined>(undefined);
  const dirtyPictures = useRef(new Set<Id>());
  const fullPaint = useRef(false);
  const paint = useRef((_all: boolean) => {});
  const painting = useRef(0);
  const repaint = useMemo(() => (all = false) => {
    fullPaint.current ||= all;
    painting.current ||= requestAnimationFrame(function next() {
      if (performance.now() < previewAfter) { painting.current = requestAnimationFrame(next); return; }
      painting.current = 0;
      const full = fullPaint.current; fullPaint.current = false;
      paint.current(full);
    });
  }, []);
  const onPicture = useMemo(() => (id: Id, picture: HTMLCanvasElement | undefined) => {
    if (picture) pictures.current.set(id, picture); else pictures.current.delete(id);
    dirtyPictures.current.add(id);
    repaint();
  }, [repaint]);
  useEffect(() => () => cancelAnimationFrame(painting.current), []);
  const world = useRef<HTMLDivElement>(null);
  const rowLabels = useRef<HTMLDivElement>(null);
  const camera = useRef(view);
  const committed = useRef(view);
  committed.current = view;
  const cameraFrame = useRef(0);
  const cameraIdle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const updateView = (next: typeof view | ((v: typeof view) => typeof view)) => {
    camera.current = typeof next === "function" ? next(camera.current) : next;
    zoom.current = camera.current.zoom;
    previewAfter = performance.now() + 180;
    clearTimeout(cameraIdle.current);
    cameraIdle.current = setTimeout(() => setView(camera.current), 180);
    cameraFrame.current ||= requestAnimationFrame(() => {
      cameraFrame.current = 0;
      const next = camera.current;
      // Move the last composited overview during gestures; redraw only when the camera settles.
      const drawn = overviewView.current;
      if (overview.current && drawn) {
        const scale = next.zoom / drawn.zoom;
        overview.current.style.transform = `translate(${next.x - drawn.x * scale + OVERVIEW_PAD * (1 - scale)}px, ${next.y - drawn.y * scale + OVERVIEW_PAD * (1 - scale)}px) scale(${scale})`;
      }
      if (world.current) world.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
      if (rowLabels.current) rowLabels.current.style.transform = `translate(${next.x - committed.current.x}px, ${next.y - committed.current.y}px)`;
    });
  };
  useLayoutEffect(() => { if (rowLabels.current) rowLabels.current.style.transform = ""; }, [view]);
  useEffect(() => () => { cancelAnimationFrame(cameraFrame.current); clearTimeout(cameraIdle.current); }, []);
  const [dragging, setDragging] = useState<{ page: Id; delta: Point }>();
  const [panning, setPanning] = useState(false);
  const [loads, setLoads] = useState(0);
  const [links, setLinks] = useState<Arrow[]>([]);
  const [linkMode, setLinkMode] = useState<LinkMode>("page");
  const routed = useMemo(() => {
    return routeAll(links.filter((a) => linkMode !== "off" && (linkMode === "all" || a.from === props.activePage)), view.zoom).map((r) => {
      const kind = r.a.from === props.activePage ? "out" : r.a.to === props.activePage ? "in" : "other";
      return { ...r, kind };
    });
  }, [links, linkMode, props.activePage, view.zoom]);
  const drag = useRef<{ x: number; y: number; start: Point; moved: boolean; pick: boolean } | undefined>(undefined);
  const endPan = () => {
    drag.current = undefined;
    setPanning(false);
  };
  // Holding Space turns any drag into a pan, as in Figma; ignored while typing.
  const space = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing()) return;
      e.preventDefault();
      space.current = true;
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      space.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  const boards = useRef(new Map<Id, { frame: HTMLDivElement; iframe: HTMLIFrameElement | undefined }>());
  // A take (an option) sits under its page's card; it shows as a board of its own only while it is the open page.
  const openTakeOf = props.activePage ? props.doc.pages[props.activePage]?.option?.of : undefined;
  const pages = useMemo(() => pagesInOrder(props.doc).filter((p) => (!p.option || p.id === props.activePage) && p.id !== openTakeOf), [props.doc.pages, props.activePage, openTakeOf]);
  const takesOf = useMemo(() => {
    const n = new Map<Id, number>();
    for (const p of Object.values(props.doc.pages)) if (p.option) n.set(p.option.of, (n.get(p.option.of) ?? 0) + 1);
    return n;
  }, [props.doc.pages]);
  // This file's own boards; imported components are drawn inside instances only, and edited in their own file.
  const own = useMemo(() => !props.imported?.size ? props.doc : { ...props.doc, shared: Object.fromEntries(Object.entries(props.doc.shared).filter(([id]) => !props.imported?.has(id))) }, [props.doc, props.imported]);
  const resources = useMemo(() => new Map<string, Promise<string>>(), [props.dir]);

  const register = useMemo(
    () => (pageId: Id, frame: HTMLDivElement | null, iframe: HTMLIFrameElement | null) => {
      if (frame) boards.current.set(pageId, { frame, iframe: iframe ?? undefined });
      else boards.current.delete(pageId);
    },
    [],
  );
  const heights = useRef(new Map<Id, number>());
  // Boards load one after another; links and tags are laid out again once per frame, not once per board.
  const relayout = useRef(0);
  useEffect(() => () => cancelAnimationFrame(relayout.current), []);
  const onLoaded = useMemo(
    () => (pageId: Id, height: number) => {
      heights.current.set(pageId, height);
      relayout.current ||= requestAnimationFrame(() => {
        relayout.current = 0;
        setLoads((n) => n + 1);
      });
    },
    [],
  );
  const zoom = useRef(view.zoom);
  zoom.current = camera.current.zoom;
  const commented = useMemo(() => Object.values(props.doc.comments).filter((c) => c.state !== "resolved").map((c) => c.node), [props.doc.comments]);
  const marks = marksCss(props.focus, props.selected, props.landing, props.also, commented);
  // One pass over the nodes for every component board, not one per board.
  const uses = useMemo(() => {
    const n = new Map<Id, number>();
    for (const x of Object.values(props.doc.nodes)) if (x.kind === "instance") n.set(x.shared, (n.get(x.shared) ?? 0) + 1);
    for (const [id, more] of Object.entries(props.usedElsewhere ?? {})) n.set(id, (n.get(id) ?? 0) + more);
    return n;
  }, [props.doc.nodes, props.usedElsewhere]);
  // Laid out again as boards report their heights, so rows keep clear of the tall pages and components above them.
  const saved = useMemo(() => placement(own, heights.current), [own, loads]);
  // An agent's jump chip needs its target document even when the board is offscreen.
  const retained = useMemo(() => {
    const roots = new Map<Id, Id>([
      ...Object.values(props.doc.pages).map(p => [p.frame, p.id] as const),
      ...Object.values(props.doc.shared).map(s => [s.root, s.id] as const),
    ]);
    const ids = new Set<Id>();
    for (const spot of props.focus) {
      let node = props.doc.nodes[spot.nodes[0] ?? ""];
      while (node?.parent !== undefined) node = props.doc.nodes[node.parent];
      const board = node && roots.get(node.id);
      if (board) ids.add(board);
    }
    return ids;
  }, [props.focus, props.doc.pages, props.doc.shared, props.doc.nodes]);
  const modeNames = useMemo(() => Object.keys(props.doc.modes ?? {}), [props.doc.modes]);
  // Each board's version: bumped for the boards an edit touched, or for all of them when it can't tell.
  const drawn = useRef({ doc: props.doc, all: 0, board: new Map<Id, number>() });
  const d = drawn.current;
  if (d.doc !== props.doc) {
    const touched = touchedBoards(d.doc, props.doc);
    if (touched) for (const id of touched) d.board.set(id, (d.board.get(id) ?? 0) + 1);
    else d.all++;
    d.doc = props.doc;
  }
  // Tag each agent's current spot; the first one is followed into view.
  const [tags, setTags] = useState<{ x: number; y: number; board: Id; spot: AgentSpot }[]>([]);
  useLayoutEffect(() => {
    const found: { x: number; y: number; board: Id; spot: AgentSpot }[] = [];
    for (const spot of props.focus) {
      const target = spot.nodes[0];
      if (!target) continue;
      for (const [board, { frame, iframe }] of boards.current) {
        const doc = iframe?.contentDocument;
        const el = doc?.querySelector(`[data-buni-draft="${CSS.escape(spot.agent)}"]`) ?? doc?.querySelector(`.b-${CSS.escape(target)}`);
        const at = saved.get(board);
        if (!el || !at) continue;
        const r = el.getBoundingClientRect();
        found.push({ x: at.x + frame.offsetLeft + r.left, y: at.y + frame.offsetTop + r.top, board, spot });
        break;
      }
    }
    setTags(found);
  }, [props.focus, loads, saved]);
  // A pin on each layer people or agents are talking about: how many posts, and who spoke last.
  const [pins, setPins] = useState<{ x: number; y: number; node: Id; n: number; by: string }[]>([]);
  useLayoutEffect(() => {
    const found: { x: number; y: number; node: Id; n: number; by: string }[] = [];
    for (const c of Object.values(props.doc.comments)) {
      if (c.state === "resolved") continue;
      for (const [board, { frame, iframe }] of boards.current) {
        const el = iframe?.contentDocument?.querySelector(`.b-${CSS.escape(c.node)}`);
        const at = saved.get(board);
        if (!el || !at) continue;
        const r = el.getBoundingClientRect();
        found.push({ x: at.x + frame.offsetLeft + r.right, y: at.y + frame.offsetTop + r.top, node: c.node, n: c.posts.length, by: c.posts.at(-1)?.author ?? "" });
        break;
      }
    }
    setPins(found);
  }, [props.doc.comments, loads, saved]);

  const at = useMemo(() => {
    if (!dragging) return saved;
    const m = new Map(saved);
    const p = saved.get(dragging.page);
    if (p) m.set(dragging.page, { x: p.x + dragging.delta.x, y: p.y + dragging.delta.y });
    return m;
  }, [saved, dragging]);
  const boxes = useMemo(() => new Map([...pages, ...Object.values(own.shared)].map((board) => {
    const page = props.doc.pages[board.id];
    const style = props.doc.nodes[page?.frame ?? props.doc.shared[board.id]?.root ?? ""]?.style;
    const given = style?.height ?? style?.minHeight ?? "";
    const p = at.get(board.id) ?? (page?.option ? at.get(page.option.of) : undefined) ?? ORIGIN;
    return [board.id, {
      x: p.x, y: p.y + LABEL + 10,
      width: page ? props.viewAt?.[board.id] ?? widthOf(props.doc, board.id) : componentWidth(props.doc, board.id),
      height: heights.current.get(board.id) ?? (/^\d+(?:\.\d+)?px$/.test(given) ? Number.parseFloat(given) : page ? 900 : 400),
    }];
  })), [pages, own, props.doc, props.viewAt, at, loads]);
  const nearby = useMemo(() => nearbyBoards(boxes, view, canvasSize), [boxes, view, canvasSize]);
  const [away, setAway] = useState<ReturnType<typeof exits>>([]);
  useLayoutEffect(() => { setLinks(arrows(props.doc, boxes, boards.current)); setAway(exits(props.doc, boxes, boards.current)); }, [props.doc, loads, boxes]);
  // Components named "Group / Name" are the variants of one set, drawn inside one frame, as a component set is.
  const sets = useMemo(() => {
    const groups = new Map<string, Id[]>();
    for (const s of Object.values(own.shared)) {
      const cut = s.name.lastIndexOf("/");
      if (cut > 0) groups.set(s.name.slice(0, cut).trim(), [...(groups.get(s.name.slice(0, cut).trim()) ?? []), s.id]);
    }
    return [...groups].filter(([, ids]) => ids.length > 1).flatMap(([name, ids]) => {
      const boxes = ids.flatMap((id) => {
        const p = at.get(id);
        return p ? [{ x: p.x, y: p.y, w: componentWidth(props.doc, id), h: heights.current.get(id) ?? 400 }] : [];
      });
      if (!boxes.length) return [];
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      return [{ name, count: ids.length, variants: ids.some((id) => props.doc.shared[id]?.variant), x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }];
    });
  }, [own.shared, props.doc.nodes, at, loads]); // heights arrive with loads
  const { onMovePage } = props;
  const onDrag = useMemo(
    () => (page: Id, delta: Point | undefined, done: boolean) => {
      if (!done) return setDragging(delta && { page, delta });
      const p = saved.get(page);
      // Keep the page where it was dropped until the saved position comes back.
      if (p && delta) onMovePage(page, Math.round((p.x + delta.x) / 10) * 10, Math.round((p.y + delta.y) / 10) * 10);
    },
    [saved, onMovePage],
  );
  useEffect(() => setDragging(undefined), [saved]);

  // The canvas never moves by itself; a chip per busy agent jumps to where it works.
  const goTo = (t: { x: number; y: number; board: Id }) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    updateView((v) => ({ ...v, x: r.width / 2 - t.x * v.zoom, y: r.height / 3 - t.y * v.zoom }));
  };

  // Bring the active page into view when it is opened from elsewhere and sits off screen.
  const box = useRef<HTMLDivElement>(null);
  /** How far a floating side panel covers the canvas on that side (set by the app as a CSS variable). */
  const floatOf = (side: "--float-left" | "--float-right") => (box.current ? parseFloat(getComputedStyle(box.current).getPropertyValue(side)) || 0 : 0);
  // Build the overview once, patch arriving tiles, then move one surface during a gesture.
  paint.current = (all) => {
    const canvas = overview.current;
    const { width, height } = canvasSize;
    if (!canvas || !width || !height) return;
    const v = camera.current, old = overviewView.current;
    all ||= !old || old.x !== v.x || old.y !== v.y || old.zoom !== v.zoom;
    // Overview detail is deliberately one pixel per CSS pixel; opening a board is full resolution.
    const wpx = Math.ceil(width + OVERVIEW_PAD * 2), hpx = Math.ceil(height + OVERVIEW_PAD * 2);
    if (canvas.width !== wpx) { canvas.width = wpx; all = true; }
    if (canvas.height !== hpx) { canvas.height = hpx; all = true; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, OVERVIEW_PAD, OVERVIEW_PAD);
    const rects = [...boxes].map(([id, b]) => ({ id, x: b.x * v.zoom + v.x, y: b.y * v.zoom + v.y, width: b.width * v.zoom, height: b.height * v.zoom }));
    const dirty = rects.filter((b) => dirtyPictures.current.has(b.id));
    // Clip partial updates, then redraw in board order so overlapping boards stay correct.
    ctx.save();
    if (!all) {
      ctx.beginPath();
      for (const b of dirty) ctx.rect(Math.floor(b.x), Math.floor(b.y), Math.ceil(b.width) + 1, Math.ceil(b.height) + 1);
      ctx.clip();
    }
    ctx.clearRect(-OVERVIEW_PAD, -OVERVIEW_PAD, wpx, hpx);
    ctx.fillStyle = "#fff";
    for (const b of rects) {
      if (b.x + b.width < -OVERVIEW_PAD || b.y + b.height < -OVERVIEW_PAD || b.x > width + OVERVIEW_PAD || b.y > height + OVERVIEW_PAD || boards.current.has(b.id)) continue;
      if (!all && !dirty.some((d) => b.x < d.x + d.width + 1 && b.x + b.width > d.x - 1 && b.y < d.y + d.height + 1 && b.y + b.height > d.y - 1)) continue;
      ctx.fillRect(b.x, b.y, b.width, b.height);
      const picture = pictures.current.get(b.id);
      if (picture) ctx.drawImage(picture, b.x, b.y, b.width, b.height);
    }
    // Overview connections share the cached surface. The selected page keeps its precise SVG overlay.
    const style = getComputedStyle(canvas);
    ctx.translate(v.x, v.y);
    ctx.scale(v.zoom, v.zoom);
    ctx.lineWidth = 1.5 / v.zoom;
    const colour = style.getPropertyValue("--label"), surface = style.getPropertyValue("--surface");
    for (const link of routed) {
      if (link.kind === "out") continue;
      ctx.strokeStyle = colour;
      ctx.globalAlpha = link.kind === "other" ? 0.55 : 1;
      ctx.setLineDash(link.kind === "in" ? [6 / v.zoom, 5 / v.zoom] : []);
      ctx.stroke(new Path2D(link.d));
      ctx.setLineDash([]);
      const tip = link.a.ty - 6, unit = 1 / v.zoom;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(link.endX, tip);
      ctx.lineTo(link.endX - 3.75 * unit, tip - 7.5 * unit);
      ctx.lineTo(link.endX + 3.75 * unit, tip - 7.5 * unit);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = surface;
      ctx.beginPath();
      ctx.arc(link.a.x, link.a.y, 4 * unit, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    dirtyPictures.current.clear();
    overviewView.current = { ...v };
    canvas.style.transform = "";
  };
  useLayoutEffect(() => repaint(true), [view, boxes, canvasSize, repaint, props.activePage, routed]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, [repaint]);
  useEffect(() => {
    const p = props.activePage ? saved.get(props.activePage) : undefined;
    const r = box.current?.getBoundingClientRect();
    if (!p || !r) return;
    updateView((v) => {
      const left = p.x * v.zoom + v.x;
      const top = p.y * v.zoom + v.y;
      const bounds = props.activePage ? boxes.get(props.activePage) : undefined;
      const visible = left + (bounds?.width ?? 0) * v.zoom > 0 && left < r.width && top + (bounds?.height ?? 0) * v.zoom > 0 && top < r.height;
      return visible ? v : { ...v, x: floatOf("--float-left") + 48 - p.x * v.zoom, y: 140 - p.y * v.zoom };
    });
  }, [props.activePage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onSelectNode(undefined);
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      // As in Figma: ⇧1 shows every page, ⇧2 the selected one.
      if (e.shiftKey && e.code === "Digit1") fit.current.all();
      if (e.shiftKey && e.code === "Digit2") fit.current.page();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onSelectNode]);

  // The world is one picture the GPU moves and scales, so panning and each step of a pinch don't draw a
  // hundred pages afresh. Once a zoom stops, it is drawn again, once, sharp at the new scale.
  const [redraw, setRedraw] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  const zoomingNow = () => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      setRedraw(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setRedraw(false)));
    }, 200);
  };

  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      zoomingNow();
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      updateView((v) => {
        const zoom = Math.min(4, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.01)));
        return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom };
      });
    } else {
      updateView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // React's wheel listener is passive: the browser would also zoom the whole page on a pinch.
    const wheel = (event: WheelEvent) => { event.preventDefault(); onWheel(event); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  /** Shows the given boards whole, under the toolbar, at no more than 100%. */
  const fitTo = (ids: readonly Id[]) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const b = boxes.get(id);
      if (!b) continue;
      [x0, y0, x1, y1] = [Math.min(x0, b.x), Math.min(y0, b.y - LABEL - 10), Math.max(x1, b.x + b.width), Math.max(y1, b.y + b.height)];
    }
    if (x0 === Infinity) return;
    // Room for the floating side panels, the insert bar below, and row titles in the margin on the left.
    // A narrow canvas (Chrome's side panel) keeps thin margins: the page is what's being watched.
    const narrow = r.width < 640;
    // The folded sidebar's icon rail and the zoom pill still float there, so the page starts clear of them.
    const [left, right, top, bottom] = [floatOf("--float-left") + (titles.length && !narrow ? 240 : narrow ? 76 : 48), floatOf("--float-right") + (narrow ? 12 : 48), narrow ? 112 : 124, narrow ? 24 : 72];
    const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min((r.width - left - right) / (x1 - x0), (r.height - top - bottom) / (y1 - y0))));
    zoomingNow();
    updateView({ zoom, x: left + (r.width - left - right - (x1 - x0) * zoom) / 2 - x0 * zoom, y: top - y0 * zoom });
  };
  const fitAll = () => fitTo([...pages.map((p) => p.id), ...Object.keys(own.shared)]);
  const fitPage = () => props.activePage && fitTo([props.activePage]);
  const fit = useRef({ all: fitAll, page: fitPage, board: (id: Id) => fitTo([id]) });
  fit.current = { all: fitAll, page: fitPage, board: (id: Id) => fitTo([id]) };
  const onOpen = useMemo(() => (id: Id) => { props.onSelectPage(id); fit.current.board(id); }, [props.onSelectPage]);
  // Asked to show a page (a search result, an agent's edit): frame it, whatever the zoom was.
  useEffect(() => {
    if (props.reveal) requestAnimationFrame(() => fitTo([props.reveal?.page ?? ""]));
  }, [props.reveal?.at]);
  // A design opens framed on its pages, not wherever the default camera happens to point; component boards
  // can sit far off, and ⇧1 still shows everything.
  const framed = useRef(false);
  const fitPages = useRef(() => {});
  fitPages.current = () => fitTo(pages.map((p) => p.id));
  useEffect(() => {
    if (framed.current || pages.length === 0) return;
    framed.current = true;
    // Opened to show one page (?page=), it frames that page, not everything.
    requestAnimationFrame(() => (props.reveal ? fitTo([props.reveal.page]) : fitPages.current()));
  }, [pages.length]);
  const titles = useMemo(() => rowTitles(own, at), [own, at]);
  /** Top of the last row title drawn this render; closer ones are skipped. */
  let shown: number | undefined;

  const zoomBy = (f: number) => {
    zoomingNow();
    updateView((v) => ({ ...v, zoom: Math.min(4, Math.max(MIN_ZOOM, v.zoom * f)) }));
  };

  return (
    <div
      ref={box}
      className={`canvas${panning ? " panning" : ""}${spaceHeld ? " space" : ""}${redraw ? " redraw" : ""}${view.zoom < FAR ? " far" : ""}`}
      // Capture phase, so Space-drag pans even when it starts over a page.
      onPointerDownCapture={(e) => {
        // A field still being edited (a layer's text, a width) saves first: the press below changes the selection,
        // and its preventDefault would keep the field from ever losing focus.
        const editing = document.activeElement;
        if (editing instanceof HTMLElement && !e.currentTarget.contains(editing)) editing.blur();
        const onBackground = e.target === e.currentTarget || e.target === world.current;
        if (!onBackground && e.button !== 1 && !space.current) return;
        // No text selection or native drag: either can steal the pointer mid-pan.
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX - camera.current.x, y: e.clientY - camera.current.y, start: { x: e.clientX, y: e.clientY }, moved: false, pick: onBackground && e.button === 0 && !space.current };
        setPanning(true);
        if (onBackground) props.onSelectNode(undefined);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
        d.moved = true;
        // Read the start now: by the time a queued update runs, the drag may have ended.
        const x = e.clientX - d.x;
        const y = e.clientY - d.y;
        updateView((v) => ({ ...v, x, y }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (d?.pick && !d.moved && camera.current.zoom < FAR) {
          const r = e.currentTarget.getBoundingClientRect(), v = camera.current;
          const id = boardAt(boxes, { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom });
          if (id) props.onSelectPage(id);
        }
        endPan();
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget && e.target !== world.current) return;
        const r = e.currentTarget.getBoundingClientRect(), v = camera.current;
        const id = boardAt(boxes, { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom });
        if (id) onOpen(id);
      }}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
    >
      {pages.length === 0 && Object.keys(own.shared).length === 0 && <div className="empty">No pages yet. Use + beside Pages to add one.</div>}
      {view.zoom < FAR && <canvas ref={overview} className="canvas-overview" style={{ left: -OVERVIEW_PAD, top: -OVERVIEW_PAD, width: `calc(100% + ${OVERVIEW_PAD * 2}px)`, height: `calc(100% + ${OVERVIEW_PAD * 2}px)` }} aria-hidden="true" />}
      <div ref={world} className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, ...cssVars({ "--zoom": view.zoom, "--inv": 1 / view.zoom }) }}>
        {sets.map((s) => (
          <div key={s.name} className="component-set" style={{ left: s.x - 24, top: s.y - 56, width: s.w + 48, height: s.h + 80 }}>
            {view.zoom >= SPECK && <span className="set-label">◆ {s.name} · {s.count} {s.variants ? "variants" : "in this set"}</span>}
          </div>
        ))}
        {[...pages, ...Object.values(own.shared)].filter((p) => nearby.has(p.id) || p.id === props.activePage || retained.has(p.id) || p.id === dragging?.page).map((p) => (
          <Artboard
            key={p.id}
            doc={props.doc}
            dir={props.dir}
            pageId={p.id}
            at={at.get(p.id) ?? (props.doc.pages[p.id]?.option ? at.get(props.doc.pages[p.id]!.option!.of) : undefined) ?? ORIGIN}
            active={p.id === props.activePage}
            takes={takesOf.get(p.id) ?? 0}
            onOpenTakes={props.onOpenTakes}
            retained={retained.has(p.id)}
            detail={view.zoom >= FAR}
            close={view.zoom >= CLOSE}
            near={nearby.has(p.id)}
            resources={resources}
            heights={heights.current}
            onPicture={onPicture}
            previewWidth={previewWidth(props.doc.pages[p.id] ? props.viewAt?.[p.id] ?? widthOf(props.doc, p.id) : componentWidth(props.doc, p.id), view.zoom, window.devicePixelRatio)}
            onOpen={onOpen}
            marks={marks}
            uses={uses.get(p.id) ?? 0}
            viewWidth={props.viewAt?.[p.id]}
            mode={props.modeAt?.[p.id] ?? props.mode}
            modes={modeNames}
            onMode={props.onModeAt ? (m) => props.onModeAt?.(p.id, m) : undefined}
            selected={p.id === props.activePage ? props.selected : undefined}
            version={`${d.all}.${d.board.get(p.id) ?? 0}.${props.modeAt?.[p.id] ?? props.mode ?? ""}`}
            zoom={zoom}
            onDrag={onDrag}
            register={register}
            onLoaded={onLoaded}
            onSelectPage={props.onSelectPage}
            onSelectNode={props.onSelectNode}
            onMenu={props.onMenu}
          />
        ))}
        {pins.map((p) => (
          <button type="button" key={p.node} className="comment-pin" title={`${p.n} ${p.n === 1 ? "comment" : "comments"} · open to read`} style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${1 / view.zoom})` }} onPointerDown={(e) => e.stopPropagation()} onClick={() => { props.onSelectNode(p.node); setTimeout(() => document.querySelector(".inspector .comments")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60); }}>
            <span className="comment-pin-face">{(p.by[0] ?? "?").toUpperCase()}</span>{p.n > 1 && <span className="comment-pin-n">{p.n}</span>}
          </button>
        ))}
        {tags.map((t) => (
          <div key={t.spot.agent} className="agent-tag" style={{ left: t.x, top: t.y, background: t.spot.color, transform: `translateY(-100%) scale(${1 / view.zoom})` }}>
            ✦ {t.spot.label}
          </div>
        ))}
        {/* Sketches of new screens, drawn on the tablet's canvas outside any page, where they were drawn: built ones faded. */}
        <svg className="ink-layer" width={1} height={1} aria-hidden="true">
          {sketchesOpen(props.doc).map((c) => <g key={c.id} opacity={c.state === "addressed" ? 0.35 : 1}><StrokePaths strokes={c.ink?.strokes ?? []} /></g>)}
        </svg>
        <svg className="links" aria-hidden="true">
          <defs>
            {(["out", "in", "other"] as const).map((k) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className={`head ${k}`} />
              </marker>
            ))}
          </defs>
          {routed.filter((link) => view.zoom >= SPECK && (view.zoom >= FAR || link.kind === "out")).map(({ a, kind, d, lx, ly }) => {
            const w = 1 / view.zoom;
            return <g key={a.id} className={`link ${kind}`}>
              <path d={d} strokeWidth={(kind === "out" ? 2 : 1.5) * w} markerEnd={`url(#arrow-${kind})`} />
              <circle cx={a.x} cy={a.y} r={4 * w} strokeWidth={1.5 * w} />
              {view.zoom >= FAR && kind === "out" && a.label && <text x={lx} y={ly} fontSize={11 * w} strokeWidth={4 * w} textAnchor={lx >= a.x ? "start" : "end"}>{a.label}</text>}
            </g>;
          })}
        </svg>
        {linkMode !== "off" && away.filter((e) => linkMode === "all" || e.from === props.activePage).map((e) => (
          <button type="button" key={e.id} className="link-away" style={{ left: e.x, top: e.y, transform: `translate(${8 / view.zoom}px, -50%) scale(${1 / view.zoom})` }}
            title={`Opens ${props.doc.elsewhere?.[e.to]?.name} in ${props.owners?.[e.to] ?? "another file"}`} onPointerDown={(ev) => ev.stopPropagation()} onClick={() => props.onOpenElsewhere?.(e.to)}>
            → {props.doc.elsewhere?.[e.to]?.name}<span>{props.owners?.[e.to]?.replace(/^.*\//, "")}</span>
          </button>
        ))}
      </div>
      {/* Drawn over the world at screen size, so a row's name reads the same at any zoom. */}
      <div ref={rowLabels} className="row-titles" aria-hidden="true">
        {titles
          // Rows too close together at this zoom: the upper one keeps its title.
          .filter((t) => {
            if (shown !== undefined && (t.y - shown) * view.zoom < 40) return false;
            shown = t.y;
            return true;
          })
          .map((t) => (
            <div key={t.y} className="row-title" style={{ left: t.x * view.zoom + view.x - 20, top: t.y * view.zoom + view.y }}>
              {t.name}
              <span>{t.pages} pages</span>
            </div>
          ))}
      </div>
      {tags.length > 0 && (
        <div className="agent-jumps">
          {tags.map((t) => (
            <button type="button" key={t.spot.agent} className="agent-jump" onClick={() => goTo(t)} title="Show where it is working">
              <span className="agent-dot busy" style={{ background: t.spot.color }} />
              {t.spot.label}
              <span className="where">· {props.doc.pages[t.board]?.name ?? props.doc.shared[t.board]?.name ?? ""}</span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      )}
      <div className="zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
        <span className="mono">{Math.round(view.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
        <button type="button" onClick={fitAll} title="Show every page (⇧1); ⇧2 shows the selected one">Fit</button>
      </div>
      {/* How the boards are drawn and laid out: apart from zoom, so neither crowds the insert bar. */}
      <div className="zoom canvas-tools">
        <button type="button" onClick={() => setLinkMode((m) => NEXT_MODE[m])} title={`Links drawn: ${linkMode === "page" ? "this page's" : linkMode}. Click for the next.`}>
          Links {linkMode === "page" ? "here" : linkMode}
        </button>
        <button type="button" onClick={() => props.onTidy(tidy(own, heights.current))} title="One row per flow, then the rest">Tidy</button>
        {Object.keys(props.doc.modes ?? {}).map((m) => (
          <button type="button" key={m} className={props.mode === m ? "active" : undefined} onClick={() => props.onMode?.(props.mode === m ? undefined : m)} title={`Draw every page in ${m} mode; click again for the tokens as they are`}>
            {m === "dark" ? "☾ " : ""}{m[0]?.toUpperCase()}{m.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
