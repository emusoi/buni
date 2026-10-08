import { parseFragment, serializeOuter, type DefaultTreeAdapterTypes as P } from "parse5";
import { findIcons, iconSvg } from "./icons.ts";
import { paletteVars } from "./terminal.ts";
import { FONT_FAMILIES } from "./fonts.gen.ts";
import { UNSAFE_TAGS } from "../format/parse.ts";
import { CELL, childrenOf, entersOn, pagesInOrder, type Doc, type Easing, type Id, type Motion, type Node, type Override, type Style } from "../format/doc.ts";

// ---------------------------------------------------------------------------
// HTML in: agent markup to node drafts
// ---------------------------------------------------------------------------

/** A node before it has an id, parent and index in a document. */
export type Draft =
  | { kind: "frame"; name: string; tag?: string; style: Style; children: Draft[] }
  | { kind: "text"; name: string; tag?: string; style: Style; text: string; filled?: true }
  | { kind: "image"; name: string; style: Style; asset: Id; alt: string }
  | { kind: "svg"; name: string; style: Style; markup: string }
  | { kind: "instance"; name: string; style: Style; shared: Id };

export interface ParsedHtml {
  drafts: Draft[];
  /** Things the markup asked for that a .buni node can't hold. */
  warnings: string[];
}

const KNOWN_ATTRS = new Set(["style", "layer-name", "alt", "src", "shared", "name", "size", "stroke-width", "placeholder", "value"]);

/** Form fields whose text is their placeholder: kept as text layers with this tag, drawn as real fields. */
const FIELD_TAGS = new Set(["input", "textarea"]);

/** Splits `a: b; c: url(x;y)` on top-level semicolons only. */
export function parseStyle(css: string): Style {
  const style: Style = {};
  let depth = 0;
  let quote = "";
  let start = 0;
  const decls: string[] = [];
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      decls.push(css.slice(start, i));
      start = i + 1;
    }
  }
  decls.push(css.slice(start));
  for (const decl of decls) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (prop && value) style[camel(prop)] = value;
  }
  return style;
}

function camel(prop: string): string {
  return prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function kebab(prop: string): string {
  return prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function isElement(n: P.ChildNode): n is P.Element {
  return "tagName" in n;
}

function isText(n: P.ChildNode): n is P.TextNode {
  return n.nodeName === "#text";
}

function attr(el: P.Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/**
 * Text as a terminal screen holds it: runs of spaces are layout and stay; only the source's own line breaks and
 * indentation around the text go.
 */
function verbatim(s: string): string {
  return s.replace(/^[ \t]*\n\s*/, "").replace(/\s*\n[ \t]*$/, "");
}

/** Runs of whitespace as one space; an edge is trimmed only when it is layout (a line break), not a space between words. */
function collapse(s: string): string {
  let out = s.replace(/\s+/g, " ");
  if (/^\s*\n/.test(s) || !/^[ \t]/.test(s)) out = out.trimStart();
  if (/\n\s*$/.test(s) || !/[ \t]$/.test(s)) out = out.trimEnd();
  return out;
}

/** A text layer's default name: the start of its text. */
export function snippet(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/** Elements that sit in a line of text. */
const INLINE = new Set(["span", "a", "em", "strong", "b", "i", "u", "s", "mark", "code", "small", "sub", "sup", "abbr", "cite", "q", "kbd", "time", "del", "ins"]);
/** Elements whose content is a line of text, where the spaces between inline pieces are part of the words. */
const TEXT_BLOCKS = new Set([...INLINE, "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "label", "blockquote", "figcaption", "td", "th", "dt", "dd", "legend", "caption", "button"]);
const flowsText = (tag: string, style: Style) => TEXT_BLOCKS.has(tag) && !/^(inline-)?(flex|grid)$/.test(style.display ?? "");

/**
 * A layer whose children are pieces of one line of text (a paragraph with a highlighted phrase): they are written
 * next to each other, since whitespace between them would be a space in the sentence ("gro und").
 */
function inlineRun(doc: Doc, n: Node, kids: readonly Node[]): boolean {
  if (n.kind !== "frame" || !kids.length || !flowsText(n.tag ?? "div", n.style)) return false;
  return kids.every((k) => (k.kind === "text" || k.kind === "frame") && INLINE.has(k.tag ?? (k.kind === "text" ? "p" : "div")));
}

function toDraft(el: P.Element, warnings: string[], keep: boolean): Draft | undefined {
  // Kept, these would make the file one buni refuses to open, and every headless screenshot of it fail.
  if (UNSAFE_TAGS.includes(el.tagName)) {
    warnings.push(el.tagName === "style"
      ? "<style> was dropped: styles go inline in style=\"\"; for other widths use update_styles with a width, and for hover or entrances set_motion"
      : `<${el.tagName}> was dropped: designs hold static markup only`);
    return undefined;
  }
  // An <svg> is kept whole as markup, attributes and all.
  for (const a of el.tagName === "svg" ? [] : el.attrs) {
    if (!KNOWN_ATTRS.has(a.name)) warnings.push(`<${el.tagName}> attribute "${a.name}" was dropped`);
  }
  const style = parseStyle(attr(el, "style") ?? "");
  const layer = attr(el, "layer-name");
  const tag = el.tagName;

  if (tag === "img") {
    const src = attr(el, "src") ?? "";
    if (!src.startsWith("asset:")) {
      warnings.push(`<img src="${src}"> must reference an attachment as "asset:<id>"; it was dropped`);
      return undefined;
    }
    return { kind: "image", name: layer ?? "Image", style, asset: src.slice("asset:".length), alt: attr(el, "alt") ?? "" };
  }
  // Its name and style belong to the layer, not the markup, so they aren't kept twice.
  if (tag === "svg") return { kind: "svg", name: layer ?? "Icon", style, markup: serializeOuter(el).replace(/^(<svg\b[^>]*?)\s(?:layer-name|style)="[^"]*"/, "$1").replace(/^(<svg\b[^>]*?)\s(?:layer-name|style)="[^"]*"/, "$1") };
  if (tag === "buni-icon") {
    const name = attr(el, "name") ?? "";
    const size = Number(attr(el, "size") ?? 16);
    const stroke = Number(attr(el, "stroke-width") ?? 2);
    const markup = iconSvg(name, Number.isFinite(size) && size > 0 ? size : 16, Number.isFinite(stroke) && stroke > 0 ? stroke : 2);
    if (!markup) {
      const near = findIcons(name.replace(/-/g, " ").split(" ")[0] ?? "", 8);
      warnings.push(`<buni-icon name="${name}"> is not a Lucide icon; it was dropped${near.length ? `. Close: ${near.join(", ")}` : ""}. find_icons searches all of them`);
      return undefined;
    }
    return { kind: "svg", name: layer ?? name, style: { display: "inline-flex", flexShrink: "0", ...style }, markup };
  }
  // A field shows what was typed in it, or else its placeholder: it becomes a text layer, so set_text changes it
  // like any other words.
  if (FIELD_TAGS.has(tag)) {
    const value = (attr(el, "value") ?? (tag === "textarea" ? el.childNodes.filter(isText).map((t) => t.value).join("") : "")).trim();
    const placeholder = attr(el, "placeholder")?.trim() ?? "";
    if (value) return { kind: "text", name: layer ?? snippet(value), tag, style, text: value, filled: true };
    return placeholder ? { kind: "text", name: layer ?? snippet(placeholder), tag, style, text: placeholder } : { kind: "frame", name: layer ?? tag, tag, style, children: [] };
  }
  if (tag === "buni-instance") {
    return { kind: "instance", name: layer ?? "Shared section", style, shared: attr(el, "shared") ?? "" };
  }

  const kids = el.childNodes;
  if (kids.every((k) => isText(k) || !isElement(k))) {
    const text = (keep ? verbatim : collapse)(kids.filter(isText).map((k) => k.value).join(""));
    if (text.trim()) return { kind: "text", name: layer ?? snippet(text), tag, style, text };
    return { kind: "frame", name: layer ?? tag, tag, style, children: [] };
  }
  // In a line of text, a space between two inline pieces ("<b>a</b> <i>b</i>") is a word space and stays.
  const spaces = flowsText(tag, style) && kids.every((k) => !isElement(k) || INLINE.has(k.tagName));
  return { kind: "frame", name: layer ?? tag, tag, style, children: childDrafts(kids, warnings, keep, spaces) };
}

function childDrafts(nodes: P.ChildNode[], warnings: string[], keep: boolean, keepSpaces = false): Draft[] {
  const out: Draft[] = [];
  for (const [i, n] of nodes.entries()) {
    if (isElement(n)) {
      const d = toDraft(n, warnings, keep);
      if (d) out.push(d);
    } else if (isText(n)) {
      const text = (keep ? verbatim : collapse)(n.value);
      if (text.trim()) out.push({ kind: "text", name: snippet(text), tag: "span", style: {}, text });
      else if (keepSpaces && /\s/.test(n.value) && i > 0 && i < nodes.length - 1) out.push({ kind: "text", name: "space", tag: "span", style: {}, text: " " });
    }
  }
  return out;
}

/** keepSpaces: for a terminal screen, where runs of spaces in text are layout. */
export function parseHtml(html: string, opts: { keepSpaces?: boolean } = {}): ParsedHtml {
  const warnings: string[] = [];
  const fragment = parseFragment(html);
  return { drafts: childDrafts(fragment.childNodes, warnings, opts.keepSpaces ?? false), warnings };
}

// ---------------------------------------------------------------------------
// HTML out: pages to static HTML + CSS
// ---------------------------------------------------------------------------

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function cssRule(selector: string, style: Style): string {
  const decls = Object.entries(style).map(([k, v]) => `  ${kebab(k)}: ${v};`);
  return decls.length === 0 ? "" : `${selector} {\n${decls.join("\n")}\n}\n`;
}

/**
 * A layer on a terminal screen. Its width counts its border, as a terminal box does, and a border takes whole cells
 * (a row above and below, a column each side), drawn as a line through their middle like a box-drawing character.
 * The line is a ::before carrying the layer's own border, which is also where the screen's text reader finds it.
 */
function cellCss(selector: string, style: Style): string {
  const own: Style = { boxSizing: "border-box" };
  const line: Style = {};
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith("border")) line[k] = v;
    else own[k] = v;
  }
  const drawn = (k: string) => line[k] !== undefined && !/^(none|0)\b/.test(line[k] ?? "");
  const all = drawn("border") || drawn("borderStyle") || drawn("borderWidth") || drawn("borderColor");
  const [top, right, bottom, left] = ["Top", "Right", "Bottom", "Left"].map((side) => all || drawn(`border${side}`));
  if (!top && !right && !bottom && !left) return cssRule(selector, own);
  const cell = (on: boolean | undefined, px: number) => (on ? `${px}px` : "0");
  return (
    cssRule(selector, {
      ...own,
      borderStyle: "solid",
      borderColor: "transparent",
      borderWidth: `${cell(top, CELL.h)} ${cell(right, CELL.w)} ${cell(bottom, CELL.h)} ${cell(left, CELL.w)}`,
      position: own.position ?? "relative",
    }) +
    cssRule(`${selector}::before`, {
      content: '""',
      position: "absolute",
      pointerEvents: "none",
      top: top ? `-${CELL.h / 2}px` : "0",
      right: right ? `-${CELL.w / 2}px` : "0",
      bottom: bottom ? `-${CELL.h / 2}px` : "0",
      left: left ? `-${CELL.w / 2}px` : "0",
      ...line,
    })
  );
}

export interface RenderOptions {
  /** Where each page lives, to turn connections into links. Omit for a single-page preview. */
  /** Where a link to a page goes; undefined leaves the element without a link (a page the site doesn't have). */
  hrefFor?: (pageId: Id) => string | undefined;
  /** Prefix for attachment paths relative to the rendered page. */
  assetPrefix?: string;
}

interface InstanceCtx {
  instance: Id;
  overrides: Record<Id, Override>;
}

class Renderer {
  private css = "";
  private readonly links: Map<Id, Id>;

  /** The page's own width, and whether it has other widths (then its root fills the window). */
  private readonly base: number;
  private readonly fluid: boolean;
  /** On a terminal screen spaces in text are layout, so text keeps them. */
  private readonly terminal: boolean;

  constructor(private readonly doc: Doc, private readonly pageId: Id, private readonly opts: RenderOptions) {
    const page = doc.pages[pageId];
    this.base = Number.parseInt(doc.nodes[page?.frame ?? ""]?.style.width ?? "", 10) || 1440;
    this.fluid = (page?.widths?.length ?? 0) > 0;
    this.terminal = page?.terminal !== undefined;
    this.links = new Map(
      Object.values(doc.connections).filter((c) => c.page === pageId && c.trigger === "click").map((c) => [c.node, c.to]),
    );
  }

  /**
   * A layer's style at its page's other widths: below the page's own width it holds at that width and narrower
   * (max-width, widest first), above it at that width and wider (min-width, narrowest first), so the nearest wins.
   */
  private atCss(selector: string, at: Record<string, Style> | undefined): string {
    if (!at || !this.fluid) return "";
    const widths = Object.keys(at).map(Number).filter((w) => w !== this.base);
    const down = widths.filter((w) => w < this.base).sort((a, b) => b - a);
    const up = widths.filter((w) => w > this.base).sort((a, b) => a - b);
    return [...down.map((w) => [w, "max"] as const), ...up.map((w) => [w, "min"] as const)]
      .map(([w, edge]) => {
        const rule = cssRule(selector, at[String(w)] ?? {});
        return rule ? `@media (${edge}-width: ${w}px) {\n${rule}}\n` : "";
      })
      .join("");
  }

  /** Shared-section nodes keep their own class (styled in shared.css); instance overrides add a page class. */
  node(n: Node, depth: number, ctx?: InstanceCtx, extraClass?: string): string {
    if (n.hidden) return "";
    const pad = "  ".repeat(depth);
    const classes = [`b-${n.id}`];
    const root = n.id === this.doc.pages[this.pageId]?.frame;
    // A page with other widths fills the window; its design width is where the canvas shows it first.
    // A terminal screen's frame names the terminal's colours, for its layers to paint with.
    if (!ctx && root && this.terminal) this.css += cssRule(`.b-${n.id}`, paletteVars());
    if (!ctx) this.css += this.terminal ? cellCss(`.b-${n.id}`, n.style) : cssRule(`.b-${n.id}`, root && this.fluid ? { ...n.style, width: "100%" } : n.style) + this.atCss(`.b-${n.id}`, n.at);
    const ov = ctx?.overrides[n.id];
    if (ctx && (ov?.style || ov?.at)) {
      classes.push(`b-${ctx.instance}-${n.id}`);
      this.css += cssRule(`.b-${ctx.instance}-${n.id}`, ov.style ?? {}) + this.atCss(`.b-${ctx.instance}-${n.id}`, ov.at);
    }
    // A component's layers draw from the shared styles, made for web pages; on a terminal screen they take cells too,
    // with this use's overrides, under the screen's frame so they win over the shared rule.
    if (ctx && this.terminal) this.css += cellCss(`.b-${this.doc.pages[this.pageId]?.frame ?? ""} .b-${n.id}`, { ...n.style, ...(ov?.style ?? {}) });
    if (extraClass) classes.push(extraClass);
    const cls = classes.join(" ");

    const target = this.links.get(n.id);
    const to = target !== undefined ? this.opts.hrefFor?.(target) : undefined;
    const href = to !== undefined ? ` href="${escapeAttr(to)}"` : "";
    const tag = n.kind === "frame" ? n.tag ?? "div" : n.kind === "text" ? n.tag ?? "p" : undefined;
    const anchorHref = tag === "a" ? href : "";
    let out: string;
    switch (n.kind) {
      case "frame": {
        const children = childrenOf(this.doc, n.id);
        if (inlineRun(this.doc, n, children)) {
          const words = children.map((c) => this.node(c, 0, ctx).trim()).join("");
          out = `${pad}<${tag} class="${cls}"${anchorHref}>${words}</${tag}>\n`;
          break;
        }
        const kids = children.map((c) => this.node(c, depth + 1, ctx)).join("");
        out = `${pad}<${tag} class="${cls}"${anchorHref}>\n${kids}${pad}</${tag}>\n`;
        break;
      }
      case "text":
        if (this.terminal) this.css += cssRule(`.b-${n.id}`, { whiteSpace: "pre" });
        if (tag === "input") out = `${pad}<input class="${cls}" ${n.filled ? "value" : "placeholder"}="${escapeAttr(ov?.text ?? n.text)}">\n`;
        else if (tag === "textarea") out = n.filled ? `${pad}<textarea class="${cls}">${escapeText(ov?.text ?? n.text)}</textarea>\n` : `${pad}<textarea class="${cls}" placeholder="${escapeAttr(ov?.text ?? n.text)}"></textarea>\n`;
        else out = `${pad}<${tag} class="${cls}"${anchorHref}>${escapeText(ov?.text ?? n.text)}</${tag}>\n`;
        break;
      case "image": {
        const path = this.doc.attachments[n.asset]?.path ?? "";
        out = `${pad}<img class="${cls}" src="${escapeAttr((this.opts.assetPrefix ?? "") + path)}" alt="${escapeAttr(n.alt)}">\n`;
        break;
      }
      case "svg": {
        // A <div> is not allowed inside a paragraph, heading or link: the browser would end the text there and
        // push the icon out of its line. A <span> sits in the line; its class still gives it its display.
        const holder = TEXT_BLOCKS.has(this.doc.nodes[n.parent ?? ""]?.tag ?? "div") ? "span" : "div";
        out = `${pad}<${holder} class="${cls}">${ov?.markup ?? n.markup}</${holder}>\n`;
        break;
      }
      case "instance": {
        const root = this.doc.nodes[this.doc.shared[n.shared]?.root ?? ""];
        out = root ? this.node(root, depth, { instance: n.id, overrides: n.overrides }, `b-${n.id}`) : "";
        break;
      }
    }
    // A link on anything but an anchor wraps it, so the exported page still navigates.
    if (href && tag !== "a") out = `${pad}<a class="b-link"${href}>\n${out}${pad}</a>\n`;
    return out;
  }

  render(): { html: string; css: string } {
    const page = this.doc.pages[this.pageId];
    const frame = page && this.doc.nodes[page.frame];
    if (!page || !frame) throw new Error(`page "${this.pageId}" does not exist`);
    return { html: this.node(frame, 0), css: this.css };
  }
}

/**
 * Sizes include padding and borders, so a panel at height 100% with padding fits its window instead of spilling
 * past it; the way designers and agents expect boxes to measure. Every page, board and export starts with it.
 */
const BASE_CSS = "*, *::before, *::after {\n  box-sizing: border-box;\n}\n";

function tokensCss(doc: Doc): string {
  // In name order, as the file keeps them: the CSS of a page doesn't change when only the tokens' order did.
  return BASE_CSS + cssRule(":root", Object.fromEntries(Object.entries(doc.tokens).sort(([a], [b]) => (a < b ? -1 : 1))));
}

/** Styles of every shared section's source tree; the same on every page. */
function sharedCss(doc: Doc): string {
  let css = "";
  const walk = (n: Node) => {
    css += cssRule(`.b-${n.id}`, n.style);
    for (const c of childrenOf(doc, n.id)) walk(c);
  };
  for (const s of Object.values(doc.shared)) {
    const root = doc.nodes[s.root];
    if (root) walk(root);
  }
  return css;
}

const EASE: Record<Easing, string> = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  "in-out": "cubic-bezier(0.65, 0, 0.35, 1)",
  dramatic: "cubic-bezier(0.19, 1, 0.22, 1)",
  linear: "linear",
};
/** Where each entrance starts; it ends at the layer's own style. */
const ENTER_FROM: Record<string, string> = {
  fade: "opacity: 0",
  rise: "opacity: 0; transform: translateY(24px)",
  scale: "opacity: 0; transform: scale(0.96)",
  "slide-left": "opacity: 0; transform: translateX(32px)",
  "slide-right": "opacity: 0; transform: translateX(-32px)",
  blur: "opacity: 0; filter: blur(12px)",
};
/** What hover and press change while they last. */
const RESPOND: Record<string, string> = {
  lift: "transform: translateY(-4px)",
  grow: "transform: scale(1.03)",
  shrink: "transform: scale(0.97)",
  dim: "opacity: 0.72",
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Every layer's motion as CSS, for Play and the exported site; the canvas and images leave it out so they show the
 * finished state. Pure CSS, so it runs in sandboxed frames: scroll entrances follow the scroll (a view timeline,
 * their duration read as how far), and all of it is skipped for people who ask for reduced motion.
 */
export function motionCss(doc: Doc): string {
  const used = new Set<string>();
  let rules = "";
  const enter = (sel: string, m: Motion, i: number) => {
    used.add(m.effect);
    const delay = (m.delayMs ?? 0) + i * (m.staggerMs ?? 0);
    rules += m.trigger === "load"
      ? `${sel} { animation: buni-${m.effect} ${m.durationMs}ms ${EASE[m.easing]} ${delay}ms backwards; }\n`
      : `${sel} { animation: buni-${m.effect} linear backwards; animation-timing-function: ${EASE[m.easing]}; animation-timeline: view(); animation-range: entry ${clamp(Math.round(delay / 10), 0, 90)}% cover ${clamp(Math.round((delay + m.durationMs) / 20), 10, 60)}%; }\n`;
  };
  for (const n of Object.values(doc.nodes)) {
    if (!n.motion?.length) continue;
    const sel = `.b-${n.id}`;
    for (const m of n.motion.filter((x) => entersOn(x.trigger))) {
      // A stagger moves the children one after another instead of the layer as one.
      if (m.staggerMs === undefined) enter(sel, m, 0);
      else childrenOf(doc, n.id).forEach((c, i) => enter(`.b-${c.id}`, m, i));
    }
    const responses = n.motion.filter((x) => !entersOn(x.trigger));
    if (!responses.length) continue;
    const ms = Math.max(...responses.map((m) => m.durationMs));
    const ease = EASE[responses[0]?.easing ?? "out"];
    rules += `${sel} { transition: transform ${ms}ms ${ease}, opacity ${ms}ms ${ease}; }\n`;
    for (const m of responses) rules += `${sel}:${m.trigger === "hover" ? "hover" : "active"} { ${RESPOND[m.effect]}; }\n`;
  }
  if (!rules) return "";
  const frames = [...used].map((e) => `@keyframes buni-${e} { from { ${ENTER_FROM[e]}; } }\n`).join("");
  return `@media (prefers-reduced-motion: no-preference) {\n${frames}${rules}}\n`;
}

/** One page as HTML plus the CSS it needs, e.g. for the Code tab. */
export function renderPage(doc: Doc, pageId: Id, opts: RenderOptions = {}): { html: string; css: string } {
  const r = new Renderer(doc, pageId, opts).render();
  return { html: r.html, css: tokensCss(doc) + sharedCss(doc) + r.css };
}

/** One component's source tree on its own, as drawn on its canvas board. */
export function renderComponent(doc: Doc, sharedId: Id): { html: string; css: string } {
  const root = doc.nodes[doc.shared[sharedId]?.root ?? ""];
  if (!root) throw new Error(`component "${sharedId}" does not exist`);
  return { html: new Renderer(doc, "", {}).node(root, 0), css: tokensCss(doc) + sharedCss(doc) };
}

/**
 * @font-face rules for the embedded fonts (Manrope, Inter) this design names anywhere: layer
 * styles, tokens or svg text. Embedded so the canvas, screenshots and exports draw the real
 * font on any machine instead of falling back. `url` points at a font file instead of embedding
 * it: the canvas has a hundred boards, and each would otherwise parse and decode its own copy.
 */
/** A family's file name where fonts are served by URL: its @fontsource-variable package name ("Source Serif 4" → "source-serif-4"). */
export const fontSlug = (family: string): string => family.toLowerCase().replace(/ /g, "-");

/** Where a font's woff2 comes from: a URL the page can load, or the file itself (embeddedFont in fontdata.ts). */
export type FontSrc = (family: string) => string;

export function fontFaces(doc: Doc, src: FontSrc): string {
  return fontsUsed(doc)
    .map((family) => `@font-face{font-family:"${family}";src:url(${JSON.stringify(src(family))}) format("woff2");font-weight:100 900;font-display:block}`)
    .join("");
}

function fontsUsed(doc: Doc): readonly string[] {
  const cached = used.get(doc);
  if (cached) return cached;
  const names = [
    ...Object.values(doc.nodes).map((n) => `${n.style.fontFamily ?? ""} ${n.kind === "svg" ? n.markup : ""}`),
    ...Object.values(doc.tokens),
  ].join(" ");
  const fonts = FONT_FAMILIES.filter((f) => names.includes(f));
  used.set(doc, fonts);
  return fonts;
}
/** Documents are never edited in place once read, so each version's fonts are worked out once. */
const used = new WeakMap<Doc, readonly string[]>();

/**
 * A graphic that is one drawing (its root frame holds a single svg) as a standalone SVG file at
 * the page's size, with the fonts its text uses embedded. Undefined for anything else.
 */
export function pageSvg(doc: Doc, pageId: Id, font: FontSrc): string | undefined {
  const only = graphicOf(doc, pageId);
  if (!only) return undefined;
  const faces = fontFaces(doc, font);
  // The editor's name and the canvas style belong to the root <svg> only; nested elements keep theirs.
  return `${only.markup
    .replace(/^<svg[^>]*>/, (open) => open.replace(/\slayer-name="[^"]*"/, "").replace(/\sstyle="[^"]*"/, ""))
    .replace(/^<svg(?![^>]*\sxmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"')
    .replace(/^(<svg[^>]*>)/, faces ? `$1<style>${faces}</style>` : "$1")}\n`;
}

/** The one svg a graphic page is made of; undefined for any other page. */
export function graphicOf(doc: Doc, pageId: Id): Extract<Node, { kind: "svg" }> | undefined {
  const page = doc.pages[pageId];
  const kids = page ? childrenOf(doc, page.frame) : [];
  const only = kids[0];
  return kids.length === 1 && only?.kind === "svg" ? only : undefined;
}

/** Folder for a route: "/" is the site root, "/app/quote" becomes "app/quote/". */
const isParam = (segment: string) => segment.startsWith(":") || /^\{[^}]+\}$/.test(segment);

function folderOf(route: string): string {
  // Parameters, ":id" or "{id}", aren't folders: the page is written as a file in its parent.
  const parts = route.split("/").filter((p) => p && !isParam(p));
  return parts.length === 0 ? "" : `${parts.join("/")}/`;
}

/**
 * Every page as a static file tree: `<route>/index.html`, plus stylesheets for
 * tokens, shared sections and pages. Relative links, so it opens from disk.
 */
export function exportSite(doc: Doc, font: FontSrc): Map<string, string> {
  const files = new Map<string, string>();
  // Graphics (pages without a route) are boards, not part of the site.
  // States share their screen's route: the site has the screen, not each of its states.
  const sitePages = pagesInOrder(doc).flatMap((p) => (p.route === undefined || p.state !== undefined ? [] : [{ ...p, route: p.route }]));
  const folders = new Map(sitePages.map((p) => [p.id, folderOf(p.route)]));
  const taken = new Set<string>();
  const fileOf = new Map<Id, string>();
  for (const p of sitePages) {
    // Dynamic segments (":id") and collisions get their own file in the parent folder.
    let file = `${folders.get(p.id)}index.html`;
    if (taken.has(file) || p.route.split("/").some(isParam)) file = `${folders.get(p.id)}${p.id}.html`;
    taken.add(file);
    fileOf.set(p.id, file);
  }

  let pages = "";
  for (const p of sitePages) {
    const file = fileOf.get(p.id) ?? "index.html";
    const up = "../".repeat(file.split("/").length - 1);
    const r = new Renderer(doc, p.id, {
      assetPrefix: up,
      // A state of a screen opens the screen; a graphic isn't part of the site, so a link to one goes nowhere.
      hrefFor: (to) => {
        const target = doc.pages[to];
        const screen = target?.state === undefined ? to : sitePages.find((s) => s.route === target.route)?.id;
        const file = screen === undefined ? undefined : fileOf.get(screen);
        return file === undefined ? undefined : up + file;
      },
    }).render();
    pages += r.css;
    files.set(
      file,
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        `<title>${escapeText(p.name)}</title>`,
        `<link rel="stylesheet" href="${up}styles/tokens.css">`,
        `<link rel="stylesheet" href="${up}styles/shared.css">`,
        `<link rel="stylesheet" href="${up}styles/pages.css">`,
        "</head>",
        "<body>",
        r.html.trimEnd(),
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
  }
  files.set("styles/tokens.css", fontFaces(doc, font) + tokensCss(doc));
  files.set("styles/shared.css", sharedCss(doc) + motionCss(doc));
  files.set("styles/pages.css", pages);
  return files;
}

/**
 * A layer as the HTML write_html reads: inline styles, layer-name where the name isn't the default, components as
 * <buni-instance>, images as asset: links. Editing it and writing it back changes only what was edited.
 */
export function layerHtml(doc: Doc, id: Id, depth = 0): string {
  const n = doc.nodes[id];
  if (!n) return "";
  const pad = "  ".repeat(depth);
  const style = Object.entries(n.style).map(([k, v]) => `${kebab(k)}: ${v}`).join("; ");
  const attrs = (defaultName: string, extra = "") =>
    `${n.name !== defaultName ? ` layer-name="${escapeAttr(n.name)}"` : ""}${extra}${style ? ` style="${escapeAttr(style)}"` : ""}`;
  switch (n.kind) {
    case "frame": {
      const tag = n.tag ?? "div";
      const kids = childrenOf(doc, n.id);
      if (!kids.length) return `${pad}<${tag}${attrs(tag)}></${tag}>`;
      if (inlineRun(doc, n, kids)) return `${pad}<${tag}${attrs(tag)}>${kids.map((k) => layerHtml(doc, k.id, 0)).join("")}</${tag}>`;
      return `${pad}<${tag}${attrs(tag)}>\n${kids.map((k) => layerHtml(doc, k.id, depth + 1)).join("\n")}\n${pad}</${tag}>`;
    }
    case "text": {
      const tag = n.tag ?? "p";
      if (tag === "input") return `${pad}<input${attrs(snippet(n.text), ` ${n.filled ? "value" : "placeholder"}="${escapeAttr(n.text)}"`)}>`;
      if (tag === "textarea") return n.filled ? `${pad}<textarea${attrs(snippet(n.text))}>${escapeText(n.text)}</textarea>` : `${pad}<textarea${attrs(snippet(n.text), ` placeholder="${escapeAttr(n.text)}"`)}></textarea>`;
      return `${pad}<${tag}${attrs(snippet(n.text))}>${escapeText(n.text)}</${tag}>`;
    }
    case "image":
      return `${pad}<img${attrs("Image", ` src="asset:${n.asset}" alt="${escapeAttr(n.alt)}"`)}>`;
    case "instance":
      return `${pad}<buni-instance${attrs("Shared section", ` shared="${n.shared}"`)}></buni-instance>`;
    case "svg": {
      // The markup carries its own attributes; the layer's name and style replace any it was written with.
      const open = n.markup.match(/^<svg\b[^>]*>/)?.[0] ?? "<svg>";
      const bare = open.replace(/\s(layer-name|style)="[^"]*"/g, "").replace(/>$/, "");
      return `${pad}${bare}${attrs("Icon")}>${n.markup.slice(open.length)}`;
    }
  }
}

/** A JSX style object from a layer's style: camelCase keys as they are, custom properties quoted. */
function jsxStyle(style: Style): string {
  const entries = Object.entries(style);
  if (!entries.length) return "";
  return ` style={{ ${entries.map(([k, v]) => `${/^[a-zA-Z]+$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }}`;
}

const jsxText = (s: string) => s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`);
const component = (name: string) => name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Component";

/**
 * A layer as React JSX for a front-end engineer: the same tree as layerHtml with style objects, components used by
 * name (<BuyerStoreHeader />), images by their file. Bindings show as {data.field} so the data a layer shows is plain.
 */
export function layerJsx(doc: Doc, id: Id, depth = 0): string {
  const n = doc.nodes[id];
  if (!n || n.hidden) return "";
  const pad = "  ".repeat(depth);
  const style = jsxStyle(n.style);
  switch (n.kind) {
    case "frame": {
      const tag = n.tag ?? "div";
      const kids = childrenOf(doc, n.id).map((k) => layerJsx(doc, k.id, depth + 1)).filter(Boolean);
      return kids.length ? `${pad}<${tag}${style}>\n${kids.join("\n")}\n${pad}</${tag}>` : `${pad}<${tag}${style} />`;
    }
    case "text": {
      const tag = n.tag ?? "p";
      const words = n.bind ? `{data.${n.bind.field.replace(/\[\]/g, "[0]")}}` : jsxText(n.text);
      if (tag === "input") return `${pad}<input${style} ${n.filled ? "defaultValue" : "placeholder"}=${JSON.stringify(n.text)} />`;
      if (tag === "textarea") return `${pad}<textarea${style} ${n.filled ? "defaultValue" : "placeholder"}=${JSON.stringify(n.text)} />`;
      return `${pad}<${tag}${style}>${words}</${tag}>`;
    }
    case "image": {
      const file = doc.attachments[n.asset]?.path ?? n.asset;
      return `${pad}<img${style} src=${JSON.stringify(file)} alt=${JSON.stringify(n.alt)} />`;
    }
    case "instance":
      return `${pad}<${component(doc.shared[n.shared]?.name ?? n.name)}${style} />`;
    case "svg":
      return `${pad}{/* ${n.name} icon */}\n${pad}${n.markup.replace(/\sclass=/g, " className=").replace(/\sstroke-(width|linecap|linejoin)=/g, (_m, p: string) => ` stroke${p.charAt(0).toUpperCase()}${p.slice(1)}=`)}`;
  }
}
