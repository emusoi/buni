import { FONT_FAMILIES } from "buni/tools/fonts.gen.ts";
import { sourceRefs, type SourceRef } from "buni/format/sources.ts";

const INHERITED = ["color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "white-space", "word-break"];
const PROPERTIES = ["display", "position", "top", "right", "bottom", "left", "z-index", "box-sizing", "min-width", "max-width", "min-height", "max-height", "padding", "border", "border-radius", "border-top", "border-right", "border-bottom", "border-left", "background-color", "background-image", "background-size", "background-position", "background-repeat", "box-shadow", "opacity", "overflow-x", "overflow-y", "gap", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "justify-content", "order", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "object-fit", "object-position", "transform", "transform-origin", "text-decoration", "text-shadow", "vertical-align", "list-style-type"];
const DEFAULTS: Record<string, string> = { position: "static", "z-index": "auto", "box-sizing": "border-box", "min-width": "0px", "max-width": "none", "min-height": "0px", "max-height": "none", padding: "0px", border: "0px none rgb(0, 0, 0)", "border-radius": "0px", "background-color": "rgba(0, 0, 0, 0)", "background-image": "none", "background-size": "auto", "background-position": "0% 0%", "background-repeat": "repeat", "box-shadow": "none", opacity: "1", "overflow-x": "visible", "overflow-y": "visible", gap: "normal", "flex-direction": "row", "flex-wrap": "nowrap", "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto", "align-items": "normal", "align-self": "auto", "justify-content": "normal", order: "0", "grid-template-columns": "none", "grid-template-rows": "none", "grid-column": "auto", "grid-row": "auto", "object-fit": "fill", "object-position": "50% 50%", transform: "none", "text-shadow": "none", "vertical-align": "baseline", "list-style-type": "disc" };
const SKIP = new Set(["script", "style", "link", "meta", "template", "noscript", "source", "iframe", "object", "embed"]);
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

/** Capture only the selected subtree. Class styles become compact, editable inline styles. */
export async function captureHtml(selected: Element, options: { url?: string; file?: string; symbol?: string; upload: (name: string, base64: string, mime: string) => Promise<string> }): Promise<{ html: string; count: number; warnings: string[] }> {
  const view = selected.ownerDocument.defaultView;
  if (!view) throw new Error("The preview is not ready.");
  if (selected.querySelectorAll("*").length > 10_000) throw new Error("Choose a section with fewer than 10,000 elements.");
  const out = selected.ownerDocument.implementation.createHTMLDocument();
  const warnings = new Set<string>();
  const assets = new Map<string, Promise<string>>();
  let count = 0;
  const saveImage = async (url: string): Promise<string> => {
    let result = assets.get(url);
    if (!result) {
      result = (async () => {
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
    for (const prop of PROPERTIES) {
      let value = cs.getPropertyValue(prop);
      if (!value || value === DEFAULTS[prop]) continue;
      if (["top", "right", "bottom", "left", "z-index"].includes(prop) && (root || cs.position === "static")) continue;
      if (prop === "transform-origin" && cs.transform === "none") continue;
      if (prop.startsWith("border") && prop !== "border-radius" && /(?:^| )none(?: |$)/.test(value)) continue;
      if (prop === "text-decoration" && value.startsWith("none")) continue;
      if (root && prop === "position") value = "relative";
      if (prop === "background-image") for (const match of [...value.matchAll(/url\(["']?(data:[^"')]+)["']?\)/g)]) value = value.replace(match[0], `url(asset:${await saveImage(match[1]!)})`);
      result.set(prop, value);
    }
    for (const prop of INHERITED) if (root || cs.getPropertyValue(prop) !== parent?.getPropertyValue(prop)) result.set(prop, cs.getPropertyValue(prop));
    const positioned = cs.position === "absolute" || cs.position === "fixed";
    if (pseudo || root || el.localName === "img" || positioned || (parent?.display.includes("flex") && cs.flexGrow === "0")) result.set("width", cs.width);
    if (pseudo || el.localName === "img" || positioned || !el.childNodes.length) result.set("height", cs.height);
    return [...result].filter(([, v]) => v && v !== "auto").map(([k, v]) => `${k}: ${v}`).join("; ");
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
  const visit = async (el: Element, parent?: CSSStyleDeclaration, root = false): Promise<Element | undefined> => {
    if (SKIP.has(el.localName)) return undefined;
    const cs = view.getComputedStyle(el);
    const family = cs.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
    if (family && !FONT_FAMILIES.some((f) => f.toLowerCase() === family.toLowerCase()) && !/^(system-ui|-apple-system|BlinkMacSystemFont|Arial|Helvetica|Times New Roman|Georgia|Verdana|Tahoma|Courier New|monospace|sans-serif|serif)$/i.test(family)) warnings.add(`Font "${family}" needs to be available on this computer; the layers keep its family name.`);
    if (cs.display === "none" || cs.visibility === "hidden") return undefined;
    if (++count % 100 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const missingImage = el.localName === "img" && !el.getAttribute("src");
    if (missingImage) warnings.add("An unavailable image was left as an empty frame.");
    const tag = missingImage ? "div" : el.localName === "body" ? "section" : el.localName;
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
    const name = el.getAttribute("layer-name") || el.getAttribute("aria-label") || el.id || (root ? options.symbol || el.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 60) || "Imported section" : undefined);
    if (name) copy.setAttribute("layer-name", name);
    const refs = source(el, root);
    if (refs.length) copy.setAttribute("data-buni-sources", JSON.stringify(refs));
    if (tag === "img") {
      copy.setAttribute("src", `asset:${await saveImage(el.getAttribute("src") ?? "")}`);
      copy.setAttribute("alt", el.getAttribute("alt") ?? "");
    } else if (tag === "input" || tag === "textarea") {
      const value = el.getAttribute("value") ?? el.getAttribute("placeholder") ?? (tag === "textarea" ? el.textContent : "") ?? "";
      copy.setAttribute(el.hasAttribute("value") || tag === "textarea" ? "value" : "placeholder", value);
    } else if (tag !== "svg" && !VOID.has(tag)) {
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
  return { html: root.outerHTML, count, warnings: [...warnings] };
}
