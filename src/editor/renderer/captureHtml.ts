import { FONT_FAMILIES } from "buni/tools/fonts.gen.ts";
import { sourceRefs, type SourceRef } from "buni/format/sources.ts";
import { elementMotion, pageMotion } from "./motionRead.ts";

const INHERITED = ["color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "white-space", "word-break"];
const PROPERTIES = ["display", "position", "top", "right", "bottom", "left", "z-index", "box-sizing", "min-width", "max-width", "min-height", "max-height", "padding", "border", "border-radius", "border-top", "border-right", "border-bottom", "border-left", "background-color", "background-image", "background-size", "background-position", "background-repeat", "box-shadow", "opacity", "overflow-x", "overflow-y", "gap", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "justify-content", "justify-items", "justify-self", "order", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "object-fit", "object-position", "transform", "transform-origin", "text-decoration", "text-shadow", "vertical-align", "list-style-type"];
const DEFAULTS: Record<string, string> = { position: "static", "z-index": "auto", "box-sizing": "border-box", "min-width": "0px", "max-width": "none", "min-height": "0px", "max-height": "none", padding: "0px", border: "0px none rgb(0, 0, 0)", "border-radius": "0px", "background-color": "rgba(0, 0, 0, 0)", "background-image": "none", "background-size": "auto", "background-position": "0% 0%", "background-repeat": "repeat", "box-shadow": "none", opacity: "1", "overflow-x": "visible", "overflow-y": "visible", gap: "normal", "flex-direction": "row", "flex-wrap": "nowrap", "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto", "align-items": "normal", "align-self": "auto", "justify-content": "normal", "justify-items": "normal", "justify-self": "auto", order: "0", "grid-template-columns": "none", "grid-template-rows": "none", "grid-column": "auto", "grid-row": "auto", "object-fit": "fill", "object-position": "50% 50%", transform: "none", "text-shadow": "none", "vertical-align": "baseline", "list-style-type": "disc" };
const SKIP = new Set(["script", "style", "link", "meta", "template", "noscript", "source"]);
/** Elements whose content is a picture, not layers: imported as an image of what they show. */
const PICTURES = new Set(["img", "canvas", "video", "iframe", "embed", "object"]);
// pdf.js (and react-pdf) lays invisible text and link boxes over each page's canvas; the canvas is the picture.
const OVERLAYS = ".textLayer, .annotationLayer";
const VOID = new Set(["img", "input", "br", "hr"]);

/** A reproducible locator for context, not an assertion about the implementation's filename. */
export function sourceSelector(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node && node.localName !== "html"; node = node.parentElement) {
    if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    const peers = node.parentElement ? [...node.parentElement.children].filter((s) => s.localName === node!.localName) : [];
    parts.unshift(node.localName + (peers.length > 1 ? `:nth-of-type(${peers.indexOf(node) + 1})` : ""));
  }
  return parts.join(" > ");
}

/** Whether the element is exactly as wide as its content, measured by laying it out at max-content for a moment. */
function sizedByContent(el: Element, view: Window & typeof globalThis): boolean {
  if (!(el instanceof view.HTMLElement || el instanceof view.SVGElement)) return false;
  const style = el.style;
  const laidOut = el.getBoundingClientRect().width;
  const [value, priority] = [style.getPropertyValue("width"), style.getPropertyPriority("width")];
  style.setProperty("width", "max-content", "important");
  const natural = el.getBoundingClientRect().width;
  style.setProperty("width", value, priority);
  return Math.abs(natural - laidOut) < 0.5;
}

/** Capture only the selected subtree. Class styles become compact, editable inline styles. */
export async function captureHtml(selected: Element, options: {
  url?: string; file?: string; symbol?: string; upload: (name: string, base64: string, mime: string) => Promise<string>;
  /** Asks the host to draw this box of the page (CSS px from the document's top-left) as an image; returns its asset id. */
  shot?: (box: { x: number; y: number; width: number; height: number }) => string;
}): Promise<{ html: string; count: number; warnings: string[] }> {
  const view = selected.ownerDocument.defaultView;
  if (!view) throw new Error("The preview is not ready.");
  if (selected.querySelectorAll("*").length > 10_000) throw new Error("Choose a section with fewer than 10,000 elements.");
  const out = selected.ownerDocument.implementation.createHTMLDocument();
  const warnings = new Set<string>();
  const assets = new Map<string, Promise<string>>();
  let count = 0;
  const motions = pageMotion(selected.ownerDocument, view);
  // Motion Buni can't hold, once per kind (a skeleton row's shimmer, thirty times over): the first layer, and how many.
  const unkept = new Map<string, { copy: Element; count: number }>();
  let moving = 0;
  const saveImage = async (url: string): Promise<string> => {
    let result = assets.get(url);
    if (!result) {
      result = (async () => {
        // A live page's images are still URLs; fetched from the page itself, they come with its sign-in.
        if (!url.startsWith("data:")) url = await fetch(url, { credentials: "include" }).then(async (response) => {
          if (!response.ok) throw new Error(`An image answered ${response.status}.`);
          const blob = await response.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("An image could not be read."));
            reader.readAsDataURL(blob);
          });
        });
        const match = url.match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);
        if (!match) throw new Error("An image did not finish loading. Preview the page again.");
        const data = match[2] ? match[3]! : btoa(unescape(encodeURIComponent(decodeURIComponent(match[3]!))));
        return options.upload(`import-${assets.size + 1}`, data, match[1]!);
      })();
      assets.set(url, result);
    }
    return result;
  };
  const style = async (cs: CSSStyleDeclaration, parent: CSSStyleDeclaration | undefined, root: boolean, el: Element, pseudo = false): Promise<string> => {
    const result = new Map<string, string>();
    // Zero margin matters too: Buni keeps real heading/paragraph tags with their browser defaults.
    result.set("margin", root ? "0px" : cs.margin);
    // Lists too: a list reset to no padding would get the browser's 40px indent back.
    if (["ul", "ol", "menu"].includes(el.localName)) result.set("padding", cs.padding);
    // Native controls have browser defaults that the design's CSS reset does not clear.
    if (["button", "input", "textarea", "select"].includes(el.localName)) {
      for (const prop of ["padding", "border", "border-radius", "background-color"]) result.set(prop, cs.getPropertyValue(prop));
      // Sides that differ leave the border shorthand empty; clear it so a side the design left bare isn't the browser's outset.
      if (!cs.border) result.set("border", "0px none");
    }
    for (const prop of PROPERTIES) {
      let value = cs.getPropertyValue(prop);
      if (!value || value === DEFAULTS[prop]) continue;
      if (["top", "right", "bottom", "left", "z-index"].includes(prop) && (root || cs.position === "static")) continue;
      if (prop === "transform-origin" && cs.transform === "none") continue;
      if (prop.startsWith("border") && prop !== "border-radius" && /(?:^| )none(?: |$)/.test(value)) continue;
      if (prop === "text-decoration" && value.startsWith("none")) continue;
      if (root && prop === "position") value = "relative";
      if (prop === "background-image") for (const match of [...value.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
        try { value = value.replace(match[0], `url(asset:${await saveImage(match[1]!)})`); } catch { warnings.add("A background image could not be loaded; it keeps its URL."); }
      }
      result.set(prop, value);
    }
    // Buni keeps the real tag, with the browser's defaults for it (<i> italic, <h2> large, <textarea> monospace): a
    // value is written when it differs from what that tag shows here unstyled. A bare twin finds that for a moment,
    // in a shadow root so the page's own resets (textarea { font: inherit }) don't reach it; only inheritance does.
    const unstyled = pseudo || ["div", "span"].includes(el.localName) || !el.parentElement ? parent : (() => {
      const host = el.ownerDocument.createElement("buni-twin");
      const twin = el.ownerDocument.createElement(el.localName);
      host.attachShadow({ mode: "open" }).append(twin);
      el.parentElement.append(host);
      const seen = view.getComputedStyle(twin);
      const values = new Map(INHERITED.map((prop) => [prop, seen.getPropertyValue(prop)]));
      host.remove();
      return { getPropertyValue: (prop: string) => values.get(prop) ?? "" };
    })();
    for (const prop of INHERITED) if (root || cs.getPropertyValue(prop) !== unstyled?.getPropertyValue(prop)) result.set(prop, cs.getPropertyValue(prop));
    const positioned = cs.position === "absolute" || cs.position === "fixed";
    // A flex item as wide as its content sizes to it: a width measured in the page's font wraps or clips its words in
    // Buni's. One given its own width (an avatar, a fixed column) or squeezed narrower keeps it.
    const flexItem = !pseudo && parent?.display.includes("flex") === true && cs.flexGrow === "0";
    const ownWidth = flexItem && !sizedByContent(el, view);
    // Text drawn in a box of its own size (an avatar's letter) keeps the box's height too.
    const textBox = ownWidth && el.childNodes.length > 0 && [...el.childNodes].every((n) => n.nodeType === 3);
    // A drawing is sized like a picture: its shapes don't size it.
    const drawn = PICTURES.has(el.localName) || el.localName === "svg";
    if (pseudo || root || drawn || positioned || ownWidth) result.set("width", cs.width);
    // A drawing never shrinks below its size in a row; a box in Buni would, squeezed by its neighbours.
    if (drawn && parent?.display.includes("flex")) result.set("flex-shrink", "0");
    // A box that scrolls or clips what overflows it keeps its height, or a long list inside spills out at full length.
    const clips = /(auto|scroll|hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    // So does a box whose children are all laid over it (a PDF page holding its canvas at inset 0): nothing in it gives
    // it a height, so without its own it collapses.
    const overlaid = !pseudo && el.children.length > 0 && [...el.childNodes].every((n) => n instanceof view.Element
      ? ["absolute", "fixed"].includes(view.getComputedStyle(n).position) : !n.textContent?.trim());
    if (pseudo || drawn || positioned || !el.childNodes.length || clips || textBox || overlaid) result.set("height", cs.height);
    // auto is the default for sizes, but a box that scrolls says so with it.
    return [...result].filter(([k, v]) => v && (v !== "auto" || k.startsWith("overflow"))).map(([k, v]) => `${k}: ${v}`).join("; ");
  };
  const source = (el: Element, root: boolean): SourceRef[] => {
    let refs: SourceRef[] = [];
    const declared = el.getAttribute("data-buni-sources");
    if (declared) try { const value: unknown = JSON.parse(declared); const parsed = sourceRefs.safeParse(value); if (parsed.success) refs = parsed.data; else warnings.add("Invalid source metadata was omitted."); } catch { warnings.add("Invalid source metadata was omitted."); }
    const file = (root ? options.file : undefined) || el.getAttribute("data-source-file") || undefined;
    const symbol = (root ? options.symbol : undefined) || el.getAttribute("data-source-symbol") || undefined;
    const url = root ? options.url : undefined;
    if (file || url) refs.push({ ...(file ? { file } : {}), ...(symbol ? { symbol } : {}), ...(url ? { url } : {}), selector: sourceSelector(el) });
    return refs;
  };
  /** What a picture element shows, as an asset id: read from the page where it can be, else drawn from the screen. */
  const picture = async (el: Element): Promise<string | undefined> => {
    try {
      if (el instanceof view.HTMLCanvasElement) return await saveImage(el.toDataURL("image/png"));
      if (el instanceof view.HTMLVideoElement && el.videoWidth) {
        const frame = el.ownerDocument.createElement("canvas");
        frame.width = el.videoWidth; frame.height = el.videoHeight;
        frame.getContext("2d")?.drawImage(el, 0, 0);
        return await saveImage(frame.toDataURL("image/png"));
      }
      if (el instanceof view.HTMLImageElement && el.currentSrc) return await saveImage(el.currentSrc);
      if (el instanceof view.HTMLVideoElement && el.poster) return await saveImage(el.poster);
    } catch {
      // Cross-origin pixels, or a URL that won't load: the screen still shows them.
    }
    const box = el.getBoundingClientRect();
    return options.shot && box.width && box.height ? options.shot({ x: box.x + view.scrollX, y: box.y + view.scrollY, width: box.width, height: box.height }) : undefined;
  };
  const visit = async (el: Element, parent?: CSSStyleDeclaration, root = false): Promise<Element | undefined> => {
    if (SKIP.has(el.localName) || (!root && el.matches(OVERLAYS))) return undefined;
    const cs = view.getComputedStyle(el);
    const family = cs.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
    if (family && !FONT_FAMILIES.some((f) => f.toLowerCase() === family.toLowerCase()) && !/^(system-ui|-apple-system|BlinkMacSystemFont|Arial|Helvetica|Times New Roman|Georgia|Verdana|Tahoma|Courier New|monospace|sans-serif|serif)$/i.test(family)) warnings.add(`Font "${family}" needs to be available on this computer; the layers keep its family name.`);
    if (cs.display === "none" || cs.visibility === "hidden") return undefined;
    if (++count % 100 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // A picture with no size (a canvas not drawn into yet, an image with nothing loaded) shows nothing.
    if (PICTURES.has(el.localName) && !el.getClientRects()[0]?.width) return undefined;
    const asset = PICTURES.has(el.localName) ? await picture(el) : undefined;
    if (PICTURES.has(el.localName) && !asset) warnings.add(`An unreadable ${el.localName} was left as an empty frame.`);
    const tag = PICTURES.has(el.localName) ? (asset ? "img" : "div") : el.localName === "body" ? "section" : el.localName;
    const copy = tag === "svg" ? out.importNode(el, true) : out.createElement(tag);
    if (tag === "svg") {
      const originals = [el, ...el.querySelectorAll("*")];
      [copy, ...copy.querySelectorAll("*")].forEach((node, i) => {
        for (const attr of [...node.attributes]) if (/^on/i.test(attr.name) || (attr.name === "href" && !attr.value.startsWith("#"))) node.removeAttribute(attr.name);
        const original = originals[i];
        if (original) {
          const drawing = view.getComputedStyle(original);
          for (const prop of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity"]) node.setAttribute(prop, drawing.getPropertyValue(prop));
        }
      });
    }
    copy.setAttribute("style", await style(cs, parent, root, el));
    const moves = elementMotion(el, cs, motions, view);
    if (moves.motion.length) { copy.setAttribute("data-buni-motion", JSON.stringify(moves.motion)); moving++; }
    for (const css of moves.unkept) {
      const seen = unkept.get(css);
      if (seen) seen.count++; else unkept.set(css, { copy, count: 1 });
    }
    const name = el.getAttribute("layer-name") || el.getAttribute("aria-label") || el.id || (root ? options.symbol || el.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 60) || "Imported section" : undefined);
    if (name) copy.setAttribute("layer-name", name);
    const refs = source(el, root);
    if (refs.length) copy.setAttribute("data-buni-sources", JSON.stringify(refs));
    if (tag === "img") {
      copy.setAttribute("src", `asset:${asset}`);
      copy.setAttribute("alt", el.getAttribute("alt") ?? el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "");
    } else if (el instanceof view.HTMLInputElement || el instanceof view.HTMLTextAreaElement) {
      // What the field shows, not its attribute: a controlled field keeps value="" there whatever was typed. The
      // placeholder comes too, for when nothing was.
      if (el.value && !(el instanceof view.HTMLInputElement && ["checkbox", "radio", "range", "color"].includes(el.type))) copy.setAttribute("value", el.value);
      if (el.placeholder) copy.setAttribute("placeholder", el.placeholder);
    } else if (tag !== "svg" && !VOID.has(tag) && !PICTURES.has(el.localName)) {
      const pseudo = async (which: "::before" | "::after") => {
        const p = view.getComputedStyle(el, which);
        if (!p.content || ["none", "normal"].includes(p.content)) return;
        if (!p.content.startsWith('"')) { warnings.add("A decorative pseudo-element could not be imported."); return; }
        const span = out.createElement("span");
        try { const value: unknown = JSON.parse(p.content); if (typeof value === "string") span.textContent = value; } catch { span.textContent = p.content.slice(1, -1); }
        span.setAttribute("style", await style(p, cs, false, el, true));
        span.setAttribute("layer-name", which);
        copy.append(span);
      };
      await pseudo("::before");
      for (const child of [...el.childNodes]) {
        if (child.nodeType === 3) copy.append(out.createTextNode(child.textContent ?? ""));
        else if (child.nodeType === 1) { const result = await visit(child as Element, cs); if (result) copy.append(result); }
      }
      await pseudo("::after");
    }
    return copy;
  };
  const root = await visit(selected, undefined, true);
  if (!root) throw new Error("This element is hidden. Choose a visible section.");
  for (const [css, { copy, count: many }] of unkept) {
    const notes = [copy.getAttribute("data-buni-note"), `On the page this moves in a way Buni's motion can't hold${many > 1 ? ` (and so do ${many - 1} more layers like it)` : ""}: ${css}`];
    copy.setAttribute("data-buni-note", notes.filter(Boolean).join("\n"));
  }
  if (moving) warnings.add(`${moving} layer${moving === 1 ? " moves" : "s move"} as on the page (set_motion changes it).`);
  if (unkept.size) warnings.add(`${unkept.size} kind${unkept.size === 1 ? "" : "s"} of motion Buni can't hold ${unkept.size === 1 ? "is" : "are"} noted as comments on the layers.`);
  return { html: root.outerHTML, count, warnings: [...warnings] };
}
