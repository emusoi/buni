// Pages drawn to PNG or PDF, icon sets and the system PDF, with no editor open. The buni desktop app draws them when
// buni runs inside it or a host names it; otherwise any Chrome, Chromium or Edge on this machine does (chrome.ts). The CLI's shot, icons and pdf use
// this, and so does the terminal agent when it looks at its own work.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pagesInOrder, type Doc, type Id, type Page } from "../format/doc.ts";
import { embeddedFont } from "../tools/fontdata.ts";
import { fontFaces, renderPage } from "../tools/html.ts";
import { Workspace } from "../tools/workspace.ts";
import { ANSI } from "../tools/terminal.ts";
import { cellsAnsi, cellsText, computed, READ_CELLS, type Screen } from "./cells.ts";
import { systemReport } from "../tools/report.ts";
import { drawScales, drawWithBrowser, evaluateWithBrowser, findBrowser, printWithBrowser, type Sheet } from "./chrome.ts";
import { icnsFile, icoFile, ICON_SIZES } from "./iconset.ts";

export interface Reply {
  ok: boolean;
  text: string;
}

export interface RenderJob {
  file: string;
  /** The page to draw, by id, name or route; absent for the system design. */
  page?: string;
  out: string;
  /** txt and ans: a terminal screen as its characters, plain or coloured. */
  format: "png" | "pdf" | "icons" | "system" | "txt" | "ans";
  scale?: number;
}

const NEEDS = "Drawing pages needs Chrome, Chromium or Edge (or set BUNI_CHROME to one), or the buni desktop app. Everything else works without them.";

/**
 * Draws with the buni desktop app when there is one, else with a browser on this machine. A host that ships the app
 * beside it (a server with Electron installed) names it as `app`.
 */
export async function renderHeadless(job: RenderJob, app: AppRenderer | undefined = appRenderer()): Promise<Reply> {
  try {
    const ws = await Workspace.open(job.file);
    const doc = ws.view();
    if (job.format === "system") {
      if (app) return await renderInApp(app, job);
      const browser = findBrowser();
      if (!browser) return { ok: false, text: NEEDS };
      const html = systemReport(ws.system(), { title: basename(job.file, ".buni"), date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), owners: ws.owners() });
      await writeFile(job.out, await printWithBrowser(browser, { html, dir: dirname(job.file), width: 1123 }));
      return { ok: true, text: `Saved ${job.out}.` };
    }
    const wanted = job.page ?? "";
    const page = doc.pages[wanted] ?? pagesInOrder(doc).find((p) => p.name.toLowerCase() === wanted.toLowerCase() || p.route === wanted);
    if (!page) return { ok: false, text: `No page "${wanted}" in ${job.file}; buni tree lists them.` };
    if (job.format === "txt" || job.format === "ans") {
      const screen = await screenOf(doc, page, dirname(job.file));
      if (typeof screen === "string") return { ok: false, text: screen };
      // A 16-colour screen's palette colours are the terminal's own, by number.
      const slots = page.terminal?.colors === "16" ? new Map(ANSI.map(([, hex], i) => [computed(hex), i])) : undefined;
      await writeFile(job.out, job.format === "txt" ? cellsText(screen) : cellsAnsi(screen, slots));
      return { ok: true, text: `Saved ${job.out}.` };
    }
    // The app is handed the page by id, whichever way it was named here.
    if (app) return await renderInApp(app, { ...job, page: page.id });
    const browser = findBrowser();
    if (!browser) return { ok: false, text: NEEDS };
    if (job.format === "icons") return await writeIconSet(browser, doc, page, dirname(job.file), job.out);
    const bytes = await drawWithBrowser(browser, { ...sheet(doc, page.id, dirname(job.file)), format: job.format, ...(job.scale ? { scale: job.scale } : {}) });
    await writeFile(job.out, bytes);
    return { ok: true, text: `Saved ${job.out}.` };
  } catch (e) {
    return { ok: false, text: `Could not render: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** An app icon set from a square graphic: each size drawn at its own pixel density, so small ones stay sharp. */
async function writeIconSet(browser: string, doc: Doc, page: Page, dir: string, outDir: string): Promise<Reply> {
  const style = doc.nodes[page.frame]?.style ?? {};
  const width = Number.parseInt(style.width ?? "", 10);
  if (!(width > 0) || style.height !== style.width) return { ok: false, text: `${page.name} isn't square; an app icon is a graphic with equal width and height.` };
  const drawn = await drawScales(browser, sheet(doc, page.id, dir), ICON_SIZES.map((s) => s / width));
  const pngs = new Map(ICON_SIZES.map((s, i) => [s, Buffer.from(drawn[i] ?? new Uint8Array())]));
  await mkdir(outDir, { recursive: true });
  const files: [string, Buffer][] = [
    ...[...pngs].map(([s, png]): [string, Buffer] => [s === 180 ? "apple-touch-icon.png" : `icon-${s}.png`, png]),
    ["favicon.ico", icoFile(pngs)],
    ["AppIcon.icns", icnsFile(pngs)],
  ];
  await Promise.all(files.map(([name, data]) => writeFile(join(outDir, name), data)));
  return { ok: true, text: `Wrote ${files.length} files to ${outDir}: ${files.map(([n]) => n).join(", ")}.` };
}

/** A page as one HTML document at its own width, ready for a browser. */
function sheet(doc: Doc, pageId: Id, dir: string): Sheet {
  const { html, css } = renderPage(doc, pageId);
  const width = Number.parseInt(doc.nodes[doc.pages[pageId]?.frame ?? ""]?.style.width ?? "", 10) || 1440;
  return { html: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}${fontFaces(doc, embeddedFont)}${css}</style></head><body>${html}</body></html>`, dir, width };
}

/** A page of the design in `file` drawn as a PNG (base64): an MCP client's or an agent's screenshot. */
export async function screenshotPng(file: string, page: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "buni-shot-"));
  try {
    const out = join(dir, "page.png");
    const r = await renderHeadless({ file, page, out, format: "png" });
    if (!r.ok) throw new Error(r.text);
    return (await readFile(out)).toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A terminal screen of the design in `file` as the characters a terminal shows; the agent's and MCP's read_screen. */
export async function screenAsText(file: string, pageId: Id): Promise<string> {
  const doc = (await Workspace.open(file)).view();
  const page = doc.pages[pageId];
  if (!page) throw new Error(`page "${pageId}" does not exist`);
  const screen = await screenOf(doc, page, dirname(file));
  if (typeof screen === "string") throw new Error(screen);
  return cellsText(screen);
}

/** The screen read cell by cell, or why it can't be. */
async function screenOf(doc: Doc, page: Page, dir: string): Promise<Screen | string> {
  if (!page.terminal) return `${page.name} isn't a terminal screen; only those draw as text (set_screen makes one).`;
  const browser = findBrowser();
  if (!browser) return NEEDS;
  return readScreen(browser, doc, page.id, dir);
}

/** A terminal screen read cell by cell, as the browser lays it out. */
export async function readScreen(browser: string, doc: Doc, pageId: Id, dir: string): Promise<Screen> {
  const raw: unknown = JSON.parse(await evaluateWithBrowser(browser, sheet(doc, pageId, dir), READ_CELLS));
  if (!isScreen(raw)) throw new Error("the screen read back in an unexpected shape");
  return raw;
}

const isScreen = (v: unknown): v is Screen => typeof v === "object" && v !== null && "grid" in v && Array.isArray(v.grid) && v.grid.every((row: unknown) => Array.isArray(row) && row.every((c: unknown) => typeof c === "object" && c !== null && "ch" in c && typeof c.ch === "string"));

/** The desktop app in its render-only mode: the binary to start, and the app it runs. */
export interface AppRenderer {
  bin: string;
  entry: string;
}

/** The desktop app, when it is the one running buni (its command line runs as Node inside it). */
function appRenderer(): AppRenderer | undefined {
  if (process.env.ELECTRON_RUN_AS_NODE !== "1") return undefined;
  const entry = dirname(process.argv[1] ?? "");
  return existsSync(entry) ? { bin: process.execPath, entry } : undefined;
}

/** Starts the app in its render-only mode (BUNI_RENDER) and waits for the file it writes. */
async function renderInApp({ bin, entry }: AppRenderer, job: RenderJob): Promise<Reply> {
  // The app's browser profile for this one drawing. It's removed here, once the app has exited: Chromium holds it
  // open while it runs, so the app can't remove it itself.
  const profile = await mkdtemp(join(tmpdir(), "buni-render-"));
  try {
    return await drawInApp(bin, entry, job, profile);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

async function drawInApp(bin: string, entry: string, job: RenderJob, profile: string): Promise<Reply> {
  const env: NodeJS.ProcessEnv = { ...process.env, BUNI_RENDER: JSON.stringify(job), BUNI_RENDER_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  // The drawing process reads people's pages; it gets no server's secrets.
  delete env.BUNI_SECRET;
  delete env.BUNI_DATABASE_URL;
  const child = spawn(bin, [entry], { env, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
  const code = await new Promise<number>((done) => child.on("close", (c) => done(c ?? 1)));
  if (code !== 0 || !existsSync(job.out)) {
    // Chromium logs noise to stderr; the render's own message is the last line that isn't a log line.
    const why = err.split("\n").filter((l) => l.trim() && !l.startsWith("[")).at(-1) ?? `renderer exited with ${code}`;
    return { ok: false, text: `Could not render: ${why}` };
  }
  return { ok: true, text: `Saved ${job.out}.` };
}

