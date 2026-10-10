import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes as P } from "parse5";
import type { ImportResource } from "../import-resource.ts";

export type ResourceLoader = (url: string) => Promise<ImportResource>;
export const resourceText = (r: ImportResource) => new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)));
const attr = (el: P.Element, name: string) => el.attrs.find((a) => a.name === name)?.value;
const element = (n: P.ChildNode): n is P.Element => "tagName" in n;
const DROP = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "base", "meta"]);
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;
const DATA_FONT = /^data:(?:font\/[^;,]+|application\/(?:font-woff|octet-stream))[;,]/i;

/** Static HTML with embedded resources. Scripts and navigation never enter the preview. */
export async function prepareHtml(html: string, base: string | undefined, load?: ResourceLoader): Promise<{ html: string; warnings: string[] }> {
  if (html.length > 8 * 1024 * 1024) throw new Error("HTML must be under 8 MB.");
  const doc = parse(html, { scriptingEnabled: false });
  const warnings = new Set<string>();
  const cache = new Map<string, Promise<ImportResource>>();
  let bytes = html.length;
  let embeddedBytes = 0;
  const embed = (value: string) => {
    embeddedBytes += value.length;
    if (embeddedBytes > 48 * 1024 * 1024) throw new Error("Embedded assets exceed 48 MB. Import a smaller section.");
    return value;
  };
  const resource = (value: string, from: string | undefined) => {
    if (!from || !load) throw new Error("Pick associated CSS and images with the HTML file, or give a page URL.");
    const url = new URL(value, from).href;
    let request = cache.get(url);
    if (!request) {
      if (cache.size >= 80) throw new Error("The preview is limited to 80 resources. Import a smaller section.");
      request = load(url).then((r) => { bytes += r.base64.length * 0.75; if (bytes > 32 * 1024 * 1024) throw new Error("The preview is limited to 32 MB. Import a smaller section."); return r; });
      cache.set(url, request);
    }
    return request;
  };
  const asset = async (value: string, from: string | undefined): Promise<string> => {
    if (value.startsWith("#")) return value;
    try {
      if (DATA_IMAGE.test(value) || DATA_FONT.test(value)) return embed(value);
      const r = await resource(value, from);
      if (!/^(image\/|font\/|application\/(font-|octet-stream))/.test(r.mime)) throw new Error("Not an image or font");
      return embed(`data:${r.mime};base64,${r.base64}`);
    } catch (e) { warnings.add(`An image or font was omitted: ${e instanceof Error ? e.message : String(e)}`); return ""; }
  };
  const css = async (text: string, from: string | undefined, depth = 0): Promise<string> => {
    let result = text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of [...result.matchAll(/@import\s+(?:url\(\s*["']?([^\s"')]+)["']?\s*\)|["']([^"']+)["'])\s*([^;]*);/gi)]) {
      let imported = "";
      try {
        if (depth >= 3) throw new Error("Nested stylesheets are too deep");
        const r = await resource(match[1] ?? match[2] ?? "", from);
        const nested = await css(resourceText(r), r.url, depth + 1);
        imported = match[3]?.trim() ? `@media ${match[3]}{${nested}}` : nested;
      } catch (e) { warnings.add(`A stylesheet was omitted: ${e instanceof Error ? e.message : String(e)}`); }
      result = result.replace(match[0], imported);
    }
    for (const match of [...result.matchAll(CSS_URL)]) {
      const url = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      result = result.replace(match[0], `url(${JSON.stringify(await asset(url, from))})`);
    }
    return result.replace(/</g, "\\3c ");
  };
  const visit = async (parent: P.ParentNode): Promise<void> => {
    const keep: P.ChildNode[] = [];
    for (const node of parent.childNodes) {
      if (!element(node)) { keep.push(node); continue; }
      if (DROP.has(node.tagName)) { if (node.tagName === "script") warnings.add("Scripts are paused. This preview imports the HTML currently available from the page."); continue; }
      if (node.tagName === "link") {
        if (attr(node, "rel")?.toLowerCase() === "stylesheet") try {
          const r = await resource(attr(node, "href") ?? "", base);
          const rules = await css(resourceText(r), r.url);
          const media = attr(node, "media");
          const style = parseFragment(`<style>${media ? `@media ${media}{${rules}}` : rules}</style>`).childNodes[0];
          if (style) { style.parentNode = parent; keep.push(style); }
        } catch (e) { warnings.add(`A stylesheet was omitted: ${e instanceof Error ? e.message : String(e)}`); }
        continue;
      }
      if (node.tagName === "style") for (const child of node.childNodes) if (child.nodeName === "#text") (child as P.TextNode).value = await css((child as P.TextNode).value, base);
      const image = node.tagName === "img" ? attr(node, "src") : undefined;
      const inline = attr(node, "style");
      const ref = attr(node, "href");
      node.attrs = node.attrs.filter((a) => !/^on/i.test(a.name) && !["src", "srcset", "href", "action", "formaction", "srcdoc", "target", "ping", "poster", "background", "autofocus", "autoplay", "contenteditable", "style"].includes(a.name) && !a.prefix);
      if (image) node.attrs.push({ name: "src", value: await asset(image, base) });
      if (inline) node.attrs.push({ name: "style", value: await css(inline, base) });
      // SVG references inside the same document are inert and needed for icons.
      if (node.namespaceURI === "http://www.w3.org/2000/svg") {
        if (ref?.startsWith("#")) node.attrs.push({ name: "href", value: ref });
      }
      if (node.tagName !== "style") await visit(node);
      keep.push(node);
    }
    parent.childNodes = keep;
  };
  await visit(doc);
  const content = serialize(doc);
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">`;
  return { html: content.replace(/<head>/, `<head>${csp}`), warnings: [...warnings] };
}
