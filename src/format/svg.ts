// What an svg node's markup may hold. A design's SVG is written into exported sites and drawn in editors, and a
// .buni file can come from anyone, so markup is read the way a browser reads it (parse5 decodes entities, which a
// text match would miss) and checked against what drawings need: shapes, text, paint servers, filters and animation
// that can't reach a link. Nothing runs, embeds HTML, or loads from elsewhere.
import { parseFragment, type DefaultTreeAdapterTypes as P } from "parse5";

const ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textpath", "a", "image",
  "lineargradient", "radialgradient", "stop", "pattern", "clippath", "mask", "marker",
  "filter", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix", "fediffuselighting",
  "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr",
  "fegaussianblur", "feimage", "femerge", "femergenode", "femorphology", "feoffset", "fepointlight",
  "fespecularlighting", "fespotlight", "fetile", "feturbulence",
  "animate", "animatemotion", "animatetransform", "mpath",
]);

/** Attributes that name another resource. */
const URL_ATTRS = new Set(["href", "xlink:href", "src"]);
/** Elements that draw what their href names: only something inside the drawing, or an embedded raster image. */
const EMBEDS = new Set(["image", "use", "feimage", "mpath", "textpath"]);
const RASTER = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i;

/** CSS as a browser reads it: escapes like \72 (an "r") stand for the characters they encode. */
const unescapeCss = (v: string) => v.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd)).replace(/\\(.)/g, "$1");
/** Any value that loads something: url(...) not pointing into the drawing, or image-set(...). Presentation attributes
 * (fill, stroke, filter, mask, marker-*), style and animation values are all CSS a browser resolves the same way. */
const LOADS = /url\s*\(\s*(?!['"]?#)|image-set\s*\(|expression\s*\(|@import/i;

/** A URL as a browser resolves its scheme: control characters and whitespace inside it don't count. */
const squash = (v: string) => v.replace(/[\u0000- ]+/g, "").toLowerCase();

function urlProblem(element: string, value: string): string | undefined {
  const v = squash(value);
  if (v.startsWith("#")) return undefined;
  if (EMBEDS.has(element)) return RASTER.test(value.trim()) ? undefined : `<${element}> may only point inside the drawing (#id) or embed a PNG, JPEG, GIF or WebP as data:`;
  if (element === "a" && /^(https?:|mailto:)/.test(v)) return undefined;
  return `a link may only go to http(s), mailto or #id, not "${value.slice(0, 40)}"`;
}

/** Why this markup can't be an svg node, or undefined when it can. */
export function svgProblem(markup: string): string | undefined {
  const fragment = parseFragment(markup);
  const roots = fragment.childNodes.filter((n) => n.nodeName !== "#text" || ("value" in n && n.value.trim() !== ""));
  if (roots.length !== 1 || roots[0]?.nodeName !== "svg") return "svg markup is one <svg> element";
  const walk = (node: P.ChildNode): string | undefined => {
    if (!("tagName" in node)) return node.nodeName === "#text" || node.nodeName === "#comment" ? undefined : `${node.nodeName} isn't allowed in svg markup`;
    const element = node.tagName.toLowerCase();
    if (!ELEMENTS.has(element)) return `<${node.tagName}> isn't allowed in svg markup: drawings hold shapes, text, gradients and filters, nothing that runs or embeds HTML`;
    for (const { name, value, prefix } of node.attrs) {
      const attr = (prefix ? `${prefix}:${name}` : name).toLowerCase();
      if (attr.startsWith("on")) return `event handlers (${attr}) aren't allowed in svg markup`;
      if (URL_ATTRS.has(attr)) {
        const problem = urlProblem(element, value);
        if (problem) return problem;
      }
      if (LOADS.test(unescapeCss(value))) return `${attr} may only use url(#id), pointing inside the drawing`;
      // An animation could rewrite a link or a handler after the check: it may animate anything but those.
      if (attr === "attributename" && /^(href|xlink:href|src|on|style)/i.test(value.trim())) return `animating ${value.trim()} isn't allowed in svg markup`;
    }
    for (const child of node.childNodes) {
      const problem = walk(child);
      if (problem) return problem;
    }
    return undefined;
  };
  return walk(roots[0]);
}
