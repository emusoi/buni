import { z } from "zod";
import { prepareHtml, resourceText } from "../editor/renderer/html-preview.ts";
import { importUrl, readImportResource } from "../editor/import-resource.ts";
import { evaluateLiveWithBrowser, evaluateWithBrowser, findBrowser } from "../term/chrome.ts";
import { captureSource } from "../term/capture-build.ts";
import { ToolError, type ToolContext } from "./kit.ts";
import type { CapturedHtml } from "../editor/renderer/capture-agent.ts";
import { fileURLToPath } from "node:url";

export const htmlPageInput = {
  html: z.string().min(1).max(8 * 1024 * 1024).optional().describe("A full HTML document or fragment, with class styles in style/link elements"),
  url: z.string().url().optional().describe("A public HTTP(S) page, or a same-origin loopback development page in local Buni"),
  file: z.string().min(1).optional().describe("HTML file inside the design's folder; relative CSS, images and fonts are loaded from there"),
  base_url: z.string().url().optional().describe("Base HTTP(S) URL for resources in pasted HTML"),
  selector: z.string().min(1).optional().describe("CSS selector matching exactly one visible element; omit to import the whole body"),
  width: z.number().int().min(240).max(3840).optional().describe("Viewport width for resolving CSS and media queries; defaults to the new page width, or 1440"),
  source_file: z.string().min(1).optional().describe("Implementation file to retain in source context, e.g. src/components/Hero.tsx"),
  symbol: z.string().min(1).optional().describe("Implementation symbol or component for the selection"),
  live: z.boolean().optional().describe("Open url in the browser with its scripts running and capture it once it settles, as a person sees it: for a JavaScript-rendered app. Local Buni only"),
  cookies: z.string().min(1).optional().describe('With live: a Cookie header, "name=value; name2=value2", to import a signed-in page'),
  wait_for: z.string().min(1).optional().describe("With live: a CSS selector the page must show before it is captured"),
};
const captured = z.object({
  html: z.string(), count: z.number().int().positive(), warnings: z.array(z.string()),
  images: z.array(z.object({ id: z.string(), base64: z.string(), mime: z.string() })),
});

export async function captureHtmlPage(input: z.infer<z.ZodObject<typeof htmlPageInput>>, width: number, ctx: ToolContext): Promise<CapturedHtml> {
  try {
    if ([input.html, input.url, input.file].filter((v) => v !== undefined).length !== 1) throw new Error("Give exactly one of html, url or file.");
    if (input.base_url && !input.html) throw new Error("base_url is only used with pasted HTML.");
    if (input.live && !input.url) throw new Error("live opens a url.");
    if ((input.cookies || input.wait_for) && !input.live) throw new Error("cookies and wait_for are only used with live.");
    if (input.live && ctx.localImports !== true) throw new Error("Live pages run their own scripts, so they can only be imported in local Buni.");
    const browser = findBrowser();
    if (!browser) throw new Error("HTML conversion needs Chrome, Chromium or Edge on this machine, or BUNI_CHROME pointing at one.");
    const sources = { ...(input.source_file || input.file ? { file: input.source_file ?? input.file } : {}), ...(input.symbol ? { symbol: input.symbol } : {}) };
    if (input.live && input.url) {
      const url = importUrl(input.url).href;
      const options = { ...(input.selector ? { selector: input.selector } : {}), url, ...sources };
      return parseCapture(await evaluateLiveWithBrowser(browser, { url, width, ...(input.cookies ? { cookies: input.cookies } : {}), ...(input.wait_for ? { waitFor: input.wait_for } : {}) },
        `${await captureSource()};window.buniCaptureHtml(${JSON.stringify(options)})`), []);
    }
    let html = input.html ?? "";
    let base = input.base_url ? importUrl(input.base_url).href : undefined;
    let url: string | undefined;
    if (input.url || input.file) {
      const main = input.url ? await readImportResource(input.url, input.url, ctx.localImports === true) : await ctx.readImportFile(input.file!);
      if (!/^text\/(html|plain)$|^application\/xhtml\+xml$/.test(main.mime)) throw new Error("The source did not return an HTML document.");
      html = resourceText(main); base = main.url;
      if (input.url) url = main.url;
    }
    const pageUrl = base ?? "https://buni-import.invalid/";
    const preview = await prepareHtml(html, pageUrl, (resource) => {
      const target = new URL(resource);
      return target.protocol === "file:" && input.file
        ? ctx.readImportFile(fileURLToPath(target))
        : readImportResource(resource, pageUrl, ctx.localImports === true);
    });
    const options = { ...(input.selector ? { selector: input.selector } : {}), ...(url ? { url } : {}), ...sources };
    return parseCapture(await evaluateWithBrowser(browser, { html: preview.html, width, dir: "." },
      `${await captureSource()};window.buniCaptureHtml(${JSON.stringify(options)})`), preview.warnings);
  } catch (e) {
    throw new ToolError(e instanceof Error ? e.message : String(e));
  }
}

/** The converter's reply: the captured layers, or the error it hit. */
function parseCapture(json: string, warnings: readonly string[]): CapturedHtml {
  const raw: unknown = JSON.parse(json);
  const failure = z.object({ error: z.string() }).safeParse(raw);
  if (failure.success) throw new Error(failure.data.error);
  const result = captured.parse(raw);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}
