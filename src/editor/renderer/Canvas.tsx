import { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { childrenOf, pageLabel, pagesInOrder, type Doc, type Id } from "buni/format/doc.ts";
import { componentWidth, placement, rowTitles, tidy, widthOf, type Point } from "./layout.ts";
import { fontFaces, fontSlug, renderComponent, renderPage } from "buni/tools/html.ts";

interface Props {
  doc: Doc;
  dir: string;
  activePage: Id | undefined;
  selected: Id | undefined;
  /** More layers selected with Shift, outlined like the first. */
  also: readonly Id[];
  /** Pages shown at one of their other widths. */
  viewAt?: Readonly<Record<Id, number>>;
  /** Where each busy agent is working: outlined and tagged in its colour; the first is scrolled into view. */
  focus: readonly AgentSpot[];
  /** What agents just changed, to show it arriving. */
  landing: readonly Landing[];
  /** A page to bring into view and frame, asked for once per `at` (search jumps, an agent's edit clicked). */
  reveal?: { page: Id; at: number } | undefined;
  onSelectPage: (id: Id) => void;
  onSelectNode: (id: Id | undefined, add?: boolean) => void;
  /** A page was dragged to a new top-left corner. */
  onMovePage: (id: Id, x: number, y: number) => void;
  /** Tidy was pressed: every page's new position. */
  onTidy: (at: Map<Id, Point>) => void;
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

export function srcdoc(doc: Doc, pageId: Id, dir: string, extraCss = ""): string {
  return wrap(renderPage(doc, pageId), dir, fontFaces(doc, fontFile) + extraCss);
}

/** A component board as a standalone document, for previews. */
export function componentSrcdoc(doc: Doc, sharedId: Id, dir: string, extraCss = ""): string {
  return wrap(renderComponent(doc, sharedId), dir, fontFaces(doc, fontFile) + extraCss);
}

function wrap({ html, css }: { html: string; css: string }, dir: string, extraCss: string): string {
  const base = `${window.buni.assetBase ?? "file://"}${dir.split("/").map(encodeURIComponent).join("/")}/`;
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><style>html,body{margin:0;overflow:hidden}${css}${extraCss}</style></head><body>${html}</body></html>`;
}

/** Small pictures in the overview, rather than hundreds of live browsing contexts. */
async function thumbnail(html: string, width: number, height: number, resources: Map<string, Promise<string>>): Promise<string> {
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}">${body}</foreignObject></svg>`;
}

/** The layer to select at a point: an enclosing component instance wins over the component's own layers. */
function pickNode(doc: Doc, frame: HTMLIFrameElement | null, x: number, y: number): Id | undefined {
  let el = frame?.contentDocument?.elementFromPoint(x, y)?.closest("[class^='b-']") ?? null;
  const first = el?.classList[0]?.slice(2);
  while (el) {
    for (const c of el.classList) if (c.startsWith("b-") && doc.nodes[c.slice(2)]?.kind === "instance") return unlocked(doc, c.slice(2));
    el = el.parentElement?.closest("[class^='b-']") ?? null;
  }
  return first && unlocked(doc, first);
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
  color: string;
}

const LAND = "@keyframes buni-land{0%{outline:3px solid var(--land);outline-offset:10px;opacity:.35}35%{outline:3px solid var(--land);outline-offset:2px;opacity:1}100%{outline:3px solid transparent;outline-offset:2px}}";

/** Outlines for the selected node, where each agent works and what just landed, as CSS; the same for every board. */
function marksCss(focus: readonly AgentSpot[], selected: Id | undefined, landing: readonly Landing[], also: readonly Id[] = [], commented: readonly Id[] = []): string {
  return [
    // Layers someone is talking about, dashed; selection and agents draw over it.
    ...commented.map((id) => `.b-${id}{outline:1.5px dashed #d97706;outline-offset:2px}`),
    landing.length ? LAND : "",
    ...landing.flatMap((l) => l.nodes.map((id) => `.b-${id}{--land:${l.color};animation:buni-land 1.8s ease-out}`)),
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
const MIN_ZOOM = 0.005;
/** Below this, page names would overlap the row above: only row titles are shown. */
const FAR = 0.15;
const OVERVIEW_PAD = 192;

/** Discrete preview resolutions avoid rebuilding a bitmap for every small zoom step. */
export function previewWidth(width: number, zoom: number, pixelRatio: number): number {
  return Math.min(200, Math.max(32, 2 ** Math.ceil(Math.log2(width * zoom * Math.min(pixelRatio, 2)))));
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
  if (prev.tokens !== next.tokens || prev.shared !== next.shared || prev.attachments !== next.attachments) return undefined;
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
  /** The selected layer: pressing it and dragging moves it. */
  selected?: Id | undefined;
  /** Read when handling a pointer, so zooming doesn't re-render every board. */
  zoom: RefObject<number>;
  onDrag: (pageId: Id, delta: Point | undefined, done: boolean) => void;
  register: (pageId: Id, frame: HTMLDivElement | null, iframe: HTMLIFrameElement | null) => void;
  onLoaded: (pageId: Id, height: number) => void;
  onSelectPage: (id: Id) => void;
  onSelectNode: (id: Id | undefined, add?: boolean) => void;
}) {
  const { doc, pageId } = props;
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
  // Edits can invalidate hundreds of boards: generate their documents within a frame budget, live boards first.
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (!seen) { setHtml(""); return; }
    return buildSoon(() => setHtml(page ? srcdoc(doc, pageId, props.dir) : componentSrcdoc(doc, pageId, props.dir)), live);
    // Not `doc`: most boards keep their drawing when an edit happens elsewhere.
  }, [seen, props.version, pageId, props.dir, page, live]);
  // Keep the document out of DOM attributes: inspection otherwise copies megabytes per board.
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!html || !live) { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [html, live]);
  useEffect(() => {
    if (!html || live) return;
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
        const svg = await thumbnail(html, width, height, props.resources);
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          finish = resolve;
          image.onload = () => {
            if (!cancelled) {
              const canvas = document.createElement("canvas");
              const scale = Math.min(props.previewWidth / width, 400 / height);
              canvas.width = Math.ceil(width * scale);
              canvas.height = Math.ceil(height * scale);
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
  }, [html, live, width, height, props.resources, props.previewWidth]);
  useEffect(() => () => props.onPicture(pageId, undefined), [live, html, width, height, props.previewWidth, props.onPicture, pageId]);
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
  const drag = useRef<{ id: Id; x: number; y: number; moving: boolean; pick: Id | undefined } | undefined>(undefined);
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
      drag.current = { id: sel, x: p.x, y: p.y, moving: false, pick: id };
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
      </button>
      <div ref={box} className={`frame${props.active ? " active" : ""}${component ? " component" : ""}${page?.terminal ? " terminal" : ""}`} style={{ width, height }}>
        {url ? (
          <iframe ref={frame} title={page?.name ?? component?.name} sandbox="allow-same-origin" src={url} width={width} height={height} onLoad={measure} />
        ) : <div className="board-placeholder" />}
        <div className="hit" onPointerDown={hit} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = undefined; setDrop(undefined); }} onDoubleClick={editText} style={editing ? { pointerEvents: "none" } : undefined} />
        {drop && <div className="drop-line" style={{ left: drop.line.x, top: drop.line.y, width: drop.line.w, height: drop.line.h }} />}
        {box2 && !drop && !editing && (
          <div className="sel-box" style={{ left: box2.x, top: box2.y, width: box2.w, height: box2.h }}>
            <span className="sel-size">{Math.round(box2.w)} × {Math.round(box2.h)}</span>
            <span className="sel-handle e" onPointerDown={resize("e")} title="Drag to set the width" />
            <span className="sel-handle s" onPointerDown={resize("s")} title="Drag to set the height" />
            <span className="sel-handle se" onPointerDown={resize("se")} title="Drag to set both" />
          </div>
        )}
      </div>
    </div>
  );
});

interface Arrow {
  id: Id;
  from: Id;
  to: Id;
  /** What triggers the link, shown along it. */
  label: string;
  /** Top centre of the triggering element, where the link's dot sits. */
  x: number;
  y: number;
  /** Top and bottom edges of the page the link leaves from: the line starts at one, not across the page's content. */
  sy: number;
  sb: number;
  /** Left edge and top of the target page's frame. */
  tx: number;
  ty: number;
  /** Highest top of the two pages; lanes run above it. */
  top: number;
}

/** Up from the top of the page, above the element, to a lane above both pages, across, and down into the target's top edge, with rounded corners. */
function route(a: Arrow, lane: number, slot: number, zoom: number): { d: string; lx: number; ly: number } {
  // Spacing is in screen pixels so lanes stay apart at any zoom.
  const px = 1 / zoom;
  const x2 = a.tx + (40 + slot * 24) * px;
  const r = Math.min(10 * px, Math.abs(x2 - a.x) / 2);
  const dir = x2 >= a.x ? 1 : -1;
  // A page in a row below: down from the source's bottom edge to a lane in the gap just above the
  // target's row, so the line never crosses the boards in between. Lanes squeeze to fit the gap.
  if (goesDown(a, zoom)) {
    const below = Math.max(a.sb + 16 * px, a.ty - (28 + lane * 22) * px);
    const d = `M ${a.x} ${a.sb} V ${below - r} Q ${a.x} ${below} ${a.x + r * dir} ${below} H ${x2 - r * dir} Q ${x2} ${below} ${x2} ${below + r} V ${a.ty - 6}`;
    return { d, lx: a.x + (x2 >= a.x ? 6 : -6) * px, ly: below - 5 * px };
  }
  const y = a.top - (28 + lane * 22) * px;
  const d = `M ${a.x} ${a.sy} V ${y + r} Q ${a.x} ${y} ${a.x + r * dir} ${y} H ${x2 - r * dir} Q ${x2} ${y} ${x2} ${y + r} V ${a.ty - 6}`;
  return { d, lx: a.x + (x2 >= a.x ? 6 : -6) * px, ly: y - 5 * px };
}

/** The link goes to a row below its page, with room for a lane between them. */
function goesDown(a: Arrow, zoom: number): boolean {
  return a.ty - 28 / zoom > a.sb + 16 / zoom;
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
      id: c.id, from: c.page, to: c.to, label: c.condition ? `if ${c.condition.charAt(0).toLowerCase()}${c.condition.slice(1)}` : c.trigger === "key" ? `${c.key ?? ""}` : doc.nodes[c.node]?.name ?? "",
      x: fx + (r ? r.left + r.width / 2 : from.width / 2), y: fy + (r?.top ?? 0), sy: fy, sb: fy + from.height, tx: to.x, ty, top: Math.min(fy, ty) - 24,
    });
  }
  return out;
}

export interface BoardRect extends Point { width: number; height: number }

/** Hit testing works even when overview boards have no DOM of their own. Last drawn wins. */
export function boardAt(boxes: ReadonlyMap<Id, BoardRect>, point: Point): Id | undefined {
  let found: Id | undefined;
  for (const [id, box] of boxes) if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) found = id;
  return found;
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
      if (next.zoom !== committed.current.zoom) { setView(next); return; }
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
    const slots = new Map<Id, number>(), lanes = { up: 0, down: 0 };
    return links.filter((a) => linkMode !== "off" && (linkMode === "all" || a.from === props.activePage)).map((a) => {
      const lane = goesDown(a, view.zoom) ? lanes.down++ : lanes.up++;
      const slot = slots.get(a.to) ?? 0;
      slots.set(a.to, slot + 1);
      const kind = a.from === props.activePage ? "out" : a.to === props.activePage ? "in" : "other";
      return { a, kind, ...route(a, lane, slot, view.zoom), endX: a.tx + (40 + slot * 24) / view.zoom };
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
  const pages = useMemo(() => pagesInOrder(props.doc), [props.doc.pages]);
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
  zoom.current = view.zoom;
  const commented = useMemo(() => Object.values(props.doc.comments).filter((c) => c.state !== "resolved").map((c) => c.node), [props.doc.comments]);
  const marks = marksCss(props.focus, props.selected, props.landing, props.also, commented);
  // One pass over the nodes for every component board, not one per board.
  const uses = useMemo(() => {
    const n = new Map<Id, number>();
    for (const x of Object.values(props.doc.nodes)) if (x.kind === "instance") n.set(x.shared, (n.get(x.shared) ?? 0) + 1);
    return n;
  }, [props.doc.nodes]);
  // Laid out again as boards report their heights, so rows keep clear of the tall pages and components above them.
  const saved = useMemo(() => placement(props.doc, heights.current), [props.doc, loads]);
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

  const at = useMemo(() => {
    if (!dragging) return saved;
    const m = new Map(saved);
    const p = saved.get(dragging.page);
    if (p) m.set(dragging.page, { x: p.x + dragging.delta.x, y: p.y + dragging.delta.y });
    return m;
  }, [saved, dragging]);
  const boxes = useMemo(() => new Map([...pages, ...Object.values(props.doc.shared)].map((board) => {
    const page = props.doc.pages[board.id];
    const style = props.doc.nodes[page?.frame ?? props.doc.shared[board.id]?.root ?? ""]?.style;
    const given = style?.height ?? style?.minHeight ?? "";
    const p = at.get(board.id) ?? ORIGIN;
    return [board.id, {
      x: p.x, y: p.y + LABEL + 10,
      width: page ? props.viewAt?.[board.id] ?? widthOf(props.doc, board.id) : componentWidth(props.doc, board.id),
      height: heights.current.get(board.id) ?? (/^\d+(?:\.\d+)?px$/.test(given) ? Number.parseFloat(given) : page ? 900 : 400),
    }];
  })), [pages, props.doc, props.viewAt, at, loads]);
  const nearby = useMemo(() => new Set([...boxes].filter(([, b]) => b.x * view.zoom + view.x < canvasSize.width + 600 && (b.x + b.width) * view.zoom + view.x > -600 && b.y * view.zoom + view.y < canvasSize.height + 600 && (b.y + b.height) * view.zoom + view.y > -600).map(([id]) => id)), [boxes, view, canvasSize]);
  useLayoutEffect(() => setLinks(arrows(props.doc, boxes, boards.current)), [props.doc, loads, boxes]);
  // Components named "Group / Name" are the variants of one set, drawn inside one frame, as a component set is.
  const sets = useMemo(() => {
    const groups = new Map<string, Id[]>();
    for (const s of Object.values(props.doc.shared)) {
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
  }, [props.doc.shared, props.doc.nodes, at, loads]); // heights arrive with loads
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
      return visible ? v : { ...v, x: 48 - p.x * v.zoom, y: 140 - p.y * v.zoom };
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
    // Room for the toolbar above, the insert bar below, and row titles in the margin on the left.
    const [left, right, top, bottom] = [titles.length ? 240 : 48, 48, 104, 72];
    const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min((r.width - left - right) / (x1 - x0), (r.height - top - bottom) / (y1 - y0))));
    zoomingNow();
    updateView({ zoom, x: left + (r.width - left - right - (x1 - x0) * zoom) / 2 - x0 * zoom, y: top - y0 * zoom });
  };
  const fitAll = () => fitTo([...pages.map((p) => p.id), ...Object.keys(props.doc.shared)]);
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
    requestAnimationFrame(() => fitPages.current());
  }, [pages.length]);
  const titles = useMemo(() => rowTitles(props.doc, at), [props.doc, at]);
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
      {pages.length === 0 && <div className="empty">No pages yet. Add one from the bar below, or ask your coding agent.</div>}
      {view.zoom < FAR && <canvas ref={overview} className="canvas-overview" style={{ left: -OVERVIEW_PAD, top: -OVERVIEW_PAD, width: `calc(100% + ${OVERVIEW_PAD * 2}px)`, height: `calc(100% + ${OVERVIEW_PAD * 2}px)` }} aria-hidden="true" />}
      <div ref={world} className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, ...cssVars({ "--zoom": view.zoom, "--inv": 1 / view.zoom }) }}>
        {sets.map((s) => (
          <div key={s.name} className="component-set" style={{ left: s.x - 24, top: s.y - 56, width: s.w + 48, height: s.h + 80 }}>
            <span className="set-label">◆ {s.name} · {s.count} {s.variants ? "variants" : "in this set"}</span>
          </div>
        ))}
        {[...pages, ...Object.values(props.doc.shared)].map((p) => (
          <Artboard
            key={p.id}
            doc={props.doc}
            dir={props.dir}
            pageId={p.id}
            at={at.get(p.id) ?? ORIGIN}
            active={p.id === props.activePage}
            retained={retained.has(p.id)}
            detail={view.zoom >= FAR}
            near={nearby.has(p.id)}
            resources={resources}
            heights={heights.current}
            onPicture={onPicture}
            previewWidth={previewWidth(props.doc.pages[p.id] ? props.viewAt?.[p.id] ?? widthOf(props.doc, p.id) : componentWidth(props.doc, p.id), view.zoom, window.devicePixelRatio)}
            onOpen={onOpen}
            marks={marks}
            uses={uses.get(p.id) ?? 0}
            viewWidth={props.viewAt?.[p.id]}
            selected={p.id === props.activePage ? props.selected : undefined}
            version={`${d.all}.${d.board.get(p.id) ?? 0}`}
            zoom={zoom}
            onDrag={onDrag}
            register={register}
            onLoaded={onLoaded}
            onSelectPage={props.onSelectPage}
            onSelectNode={props.onSelectNode}
          />
        ))}
        {tags.map((t) => (
          <div key={t.spot.agent} className="agent-tag" style={{ left: t.x, top: t.y, background: t.spot.color, transform: `translateY(-100%) scale(${1 / view.zoom})` }}>
            ✦ {t.spot.label}
          </div>
        ))}
        <svg className="links" aria-hidden="true">
          <defs>
            {(["out", "in", "other"] as const).map((k) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className={`head ${k}`} />
              </marker>
            ))}
          </defs>
          {routed.filter((link) => view.zoom >= FAR || link.kind === "out").map(({ a, kind, d, lx, ly }) => {
            const w = 1 / view.zoom;
            return <g key={a.id} className={`link ${kind}`}>
              <path d={d} strokeWidth={(kind === "out" ? 2 : 1.5) * w} markerEnd={`url(#arrow-${kind})`} />
              <circle cx={a.x} cy={a.y} r={4 * w} strokeWidth={1.5 * w} />
              {view.zoom >= FAR && kind === "out" && a.label && <text x={lx} y={ly} fontSize={11 * w} strokeWidth={4 * w} textAnchor={lx >= a.x ? "start" : "end"}>{a.label}</text>}
            </g>;
          })}
        </svg>
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
        <button type="button" onClick={() => props.onTidy(tidy(props.doc, heights.current))} title="One row per flow, then the rest">Tidy</button>
      </div>
    </div>
  );
}
