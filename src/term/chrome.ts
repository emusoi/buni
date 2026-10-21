// Drawing a page with the Chrome, Chromium or Edge already on this machine: what `buni shot` and the agent's
// screenshots use when the buni desktop app isn't installed. The browser runs headless with a throwaway profile and
// is driven over the DevTools protocol; it loads the page from a file next to nothing but the design's own folder.
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const KNOWN = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const ON_PATH = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];

/** The browser to draw with: $BUNI_CHROME, else one in its usual place, else one on the PATH. */
export function findBrowser(): string | undefined {
  const given = process.env.BUNI_CHROME;
  if (given) return given;
  return KNOWN.find((p) => existsSync(p)) ?? ON_PATH.map((name) => Bun.which(name)).find((p): p is string => p !== null);
}

export interface Sheet {
  /** A whole HTML document; relative URLs in it resolve against `dir`. */
  html: string;
  dir: string;
  /** CSS width of the page; the height is the page's own. */
  width: number;
}

export interface Drawing extends Sheet {
  format: "png" | "pdf";
  /** Pixel density of a PNG: 1 is the page's CSS size. */
  scale?: number;
}

/** Stops `work` after `ms`, so a browser that hangs never holds up the command or the agent. */
function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** The page drawn as a PNG or a one-page PDF, at the page's full height (up to 8000 CSS px). */
export function drawWithBrowser(browser: string, d: Drawing): Promise<Uint8Array> {
  return inBrowser(browser, d, (cdp, url) => draw(cdp, url, d));
}

const target = z.object({ id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type CaptureTarget = z.infer<typeof target>;

/** Pixels and hit bounds from the same laid-out document, for native viewers. */
export function captureWithBrowser(browser: string, sheet: Sheet): Promise<{ png: Uint8Array; height: number; targets: CaptureTarget[] }> {
  return inBrowser(browser, sheet, async (cdp, url) => {
    const height = await load(cdp, url, sheet.width, 1);
    const png = bytesOf(await cdp.call("Page.captureScreenshot", { format: "png" }));
    const raw = await cdp.call("Runtime.evaluate", {
      expression: `JSON.stringify(Array.from(document.querySelectorAll('[class]')).flatMap(el => { const r = el.getBoundingClientRect(); return r.width && r.height ? Array.from(el.classList).filter(c => c.startsWith('b-')).map(c => ({id:c.slice(2),x:r.x,y:r.y,width:r.width,height:r.height})) : []; }))`,
      returnByValue: true,
    });
    const result = z.object({ result: z.object({ value: z.string() }) }).parse(raw);
    const parsed: unknown = JSON.parse(result.result.value);
    return { png, height, targets: z.array(target).parse(parsed) };
  });
}

/** The page as PNGs, one per pixel density, all from one browser: an icon set's sizes. */
export function drawScales(browser: string, sheet: Sheet, scales: readonly number[]): Promise<Uint8Array[]> {
  return inBrowser(browser, sheet, async (cdp, url) => {
    const out: Uint8Array[] = [];
    // Whatever the graphic doesn't cover stays see-through, as an icon's rounded corners must.
    await cdp.call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const scale of scales) out.push(await draw(cdp, url, { ...sheet, format: "png", scale }));
    return out;
  });
}

/**
 * The page's motion held still at `count` moments from its start to when the last entrance ends, one PNG each, with
 * each moment in ms. A loop is caught wherever it is at that moment.
 */
export function framesWithBrowser(browser: string, sheet: Sheet, count: number, scale = 1): Promise<{ pngs: Uint8Array[]; times: number[] }> {
  return inBrowser(browser, sheet, async (cdp, url) => {
    await load(cdp, url, sheet.width, scale);
    const end = Number(await readBack(cdp, "String(Math.max(0, ...document.getAnimations().map((a) => { a.pause(); return Number(a.effect?.getComputedTiming().endTime); }).filter(Number.isFinite)))"));
    const pngs: Uint8Array[] = [], times: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.round(count === 1 ? end : (end * i) / (count - 1));
      // Two frames later the held moment is what the screen shows.
      await readBack(cdp, `(() => { for (const a of document.getAnimations()) a.currentTime = ${t}; return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done("ok")))); })()`);
      pngs.push(bytesOf(await cdp.call("Page.captureScreenshot", { format: "png" })));
      times.push(t);
    }
    return { pngs, times };
  });
}

/** What `expression` evaluates to on the loaded page, as a string (the page's script returns JSON). */
export function evaluateWithBrowser(browser: string, sheet: Sheet, expression: string): Promise<string> {
  return inBrowser(browser, sheet, async (cdp, url) => {
    await load(cdp, url, sheet.width, 1);
    return readBack(cdp, expression);
  });
}

export interface LivePage {
  url: string;
  width: number;
  /** A Cookie header, "name=value; name2=value2", set for the page's URL before it opens: how a signed-in page is reached. */
  cookies?: string;
  /** A CSS selector the page must show before it counts as ready. */
  waitFor?: string;
}

/** A box of the page in CSS px from the document's top-left. */
export interface Clip { x: number; y: number; width: number; height: number }

/**
 * What `expression` evaluates to on a live page: opened at its own URL with its scripts running, then given time to
 * settle (no DOM changes for 600ms, and `waitFor` present), as a person would see it. Only for pages the person trusts.
 * `clips` reads boxes to draw out of the value; each comes back as a PNG (base64) at twice CSS resolution, in order.
 */
export function evaluateLiveWithBrowser(browser: string, live: LivePage, expression: string, clips: (value: string) => readonly Clip[] = () => []): Promise<{ value: string; pngs: string[] }> {
  return withBrowser(browser, async (cdp) => {
    const cookies = (live.cookies ?? "").split(";").map((c) => c.trim()).filter((c) => c.indexOf("=") > 0)
      .map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1), url: live.url }));
    if (cookies.length) await cdp.call("Network.setCookies", { cookies });
    // A desktop window while the app renders: fitting to the page now would size it to an empty shell, and an app laid
    // out in 100vh would then render at that height.
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: live.width, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.call("Page.enable");
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.call("Page.navigate", { url: live.url });
    await loaded;
    await readBack(cdp, `new Promise((resolve, reject) => {
      const selector = ${JSON.stringify(live.waitFor ?? "")}, until = Date.now() + 15000;
      let changed = Date.now(), pixels = "";
      new MutationObserver(() => { changed = Date.now(); }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      // Drawing on a canvas (a PDF page, a chart) changes no DOM: each visible canvas is sampled at 16×16, a change
      // counts as one, and a canvas that is still blank isn't drawn yet. A cross-origin canvas can't be read; it's skipped.
      const sample = document.createElement("canvas");
      sample.width = sample.height = 16;
      const pen = sample.getContext("2d", { willReadFrequently: true });
      const painted = () => {
        let blank = false, seen = "";
        for (const canvas of document.querySelectorAll("canvas")) {
          if (!canvas.width || !canvas.height || !canvas.getClientRects().length) continue;
          try {
            pen.clearRect(0, 0, 16, 16);
            pen.drawImage(canvas, 0, 0, 16, 16);
            const data = pen.getImageData(0, 0, 16, 16).data;
            if (data.every((v) => v === 0)) blank = true;
            seen += data.join(",") + ";";
          } catch {}
        }
        if (seen !== pixels) { pixels = seen; changed = Date.now(); }
        return !blank;
      };
      const tick = () => {
        const shown = !selector || document.querySelector(selector) !== null;
        if (painted() && shown && Date.now() - changed > 600) resolve("settled");
        // A page that never stops animating is captured as it stands; a missing selector is an error.
        else if (Date.now() > until) shown ? resolve("settled") : reject(new Error("The page never showed " + selector + " (now at " + location.href + ")."));
        else setTimeout(tick, 100);
      };
      tick();
    })`);
    // The settled page may be taller than the window, and an app shell laid out in 100vh scrolls its <main> inside
    // itself: the window grows once to show that page whole.
    const needed = async () => Number(await readBack(cdp, `String(Math.max(document.body.scrollHeight, ...[...document.querySelectorAll("main")]
      .filter((el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
      .map((el) => el.getBoundingClientRect().top + window.scrollY + el.scrollHeight
        + (window.innerHeight - el.getBoundingClientRect().bottom))))`)) || 900;
    const size = async (height: number) => {
      await cdp.call("Emulation.setDeviceMetricsOverride", { width: live.width, height: Math.min(Math.max(height, 1), 8000), deviceScaleFactor: 1, mobile: false });
      await readBack(cdp, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r("laid out"))))`);
    };
    // A page too tall to show whole stays in a desktop window, scrolling as a person sees it. A document needs the same
    // height in any window; a layout that fills the window (a reader, panes that scroll themselves) measures whatever
    // it is given, so a changed answer means it goes back to a desktop window too.
    const first = await needed();
    if (first > 900 && first <= 8000) {
      await size(first);
      if (Math.abs((await needed()) - first) > 1) await size(900);
    }
    const value = await readBack(cdp, expression);
    const boxes = clips(value);
    // Capturing measures the page by resizing things for a moment, and an app can answer by reloading its frames (an
    // editor's page previews): before drawing them, let every frame finish loading and paint.
    if (boxes.length) await readBack(cdp, `new Promise((resolve) => {
      const until = Date.now() + 5000;
      const ready = () => [...document.querySelectorAll("iframe")].every((f) => { try { return f.contentDocument?.readyState === "complete"; } catch { return true; } });
      const tick = () => ready() || Date.now() > until ? setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve("painted"))), 300) : setTimeout(tick, 50);
      tick();
    })`);
    const pngs: string[] = [];
    for (const clip of boxes) {
      const shot = await cdp.call("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2 }, captureBeyondViewport: true });
      pngs.push(Buffer.from(bytesOf(shot)).toString("base64"));
    }
    return { value, pngs };
  }, true);
}

/** Evaluates `expression` on the page and returns its string value. */
async function readBack(cdp: Cdp, expression: string): Promise<string> {
  const r = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const thrown = typeof r === "object" && r !== null && "exceptionDetails" in r && typeof r.exceptionDetails === "object" && r.exceptionDetails !== null && "exception" in r.exceptionDetails
    && typeof r.exceptionDetails.exception === "object" && r.exceptionDetails.exception !== null && "description" in r.exceptionDetails.exception ? String(r.exceptionDetails.exception.description) : undefined;
  if (thrown) throw new Error(thrown.split("\n")[0]!.replace(/^Error: /, ""));
  const value = typeof r === "object" && r !== null && "result" in r && typeof r.result === "object" && r.result !== null && "value" in r.result ? r.result.value : undefined;
  if (typeof value !== "string") throw new Error("the page read back nothing");
  return value;
}

/** A headless browser with `sheet` written beside a throwaway profile, for `work` to load and use. */
async function inBrowser<T>(browser: string, sheet: Sheet, work: (cdp: Cdp, url: string) => Promise<T>): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), "buni-page-"));
  const page = join(scratch, "page.html");
  // The page lives in the scratch folder; <base> points its images at the design's folder.
  await writeFile(page, sheet.html.replace("<head>", `<head><base href="${pathToFileURL(`${sheet.dir}/`).href}">`));
  try {
    return await withBrowser(browser, (cdp) => work(cdp, pathToFileURL(page).href));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** A headless browser started on a throwaway profile, with the DevTools address it answers on. */
interface Started { proc: Bun.Subprocess; endpoint: string | undefined; scratch: string }

/** Browsers this process started and hasn't closed: killed on the way out, so none outlive it. */
const running = new Set<Bun.Subprocess>();
process.once("exit", () => { for (const p of running) p.kill("SIGKILL"); });

async function start(browser: string): Promise<Started> {
  const scratch = await mkdtemp(join(tmpdir(), "buni-draw-"));
  const proc = Bun.spawn([browser, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(scratch, "profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdout: "ignore", stderr: "pipe" });
  running.add(proc);
  try {
    return { proc, endpoint: await within(15_000, "Starting the browser", devtools(proc.stderr)), scratch };
  } catch (e) {
    await stop({ proc, endpoint: undefined, scratch });
    throw e;
  }
}

async function stop(b: Started): Promise<void> {
  await quit(b.proc, b.endpoint);
  running.delete(b.proc);
  await rm(b.scratch, { recursive: true, force: true });
}

/** How long a kept browser waits for more work before it closes; 0 starts one per job (a CLI call that then exits). */
let keepFor = 0;
let kept: { browser: string; started: Promise<Started>; busy: number; idle?: ReturnType<typeof setTimeout> } | undefined;

/**
 * For a long-running server: keep one browser open between jobs, each in its own tab, instead of starting Chrome for
 * every edit check (about 2s each, and a pile of them when agents edit at once). It closes after `ms` with nothing to do.
 */
export function keepBrowserWarm(ms = 60_000): void {
  keepFor = ms;
  reapOrphans();
}

/**
 * Closes buni browsers whose buni was killed mid-job (no parent left, a buni-draw- profile): nothing else ever would,
 * and each holds a few hundred MB. Run when a server starts; a browser some live buni is using always has its parent.
 */
function reapOrphans(): void {
  if (process.platform === "win32") return;
  const ps = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,command="], { stdout: "pipe", stderr: "ignore" });
  for (const line of ps.stdout.toString().split("\n")) {
    const m = line.trim().match(/^(\d+)\s+1\s+(.*)$/);
    if (m?.[2]?.includes("--headless=new") && /--user-data-dir=\S*buni-draw-/.test(m[2])) {
      try { process.kill(Number(m[1]), "SIGKILL"); } catch { /* already gone */ }
    }
  }
}

/**
 * A headless browser for `work` to drive in a page of its own: a kept one when the server asked, else a fresh one.
 * `fresh` always starts its own: a live page's cookies and storage must not carry over to the next job.
 */
async function withBrowser<T>(browser: string, work: (cdp: Cdp) => Promise<T>, fresh = false): Promise<T> {
  if (!keepFor || fresh) {
    const b = await start(browser);
    try {
      return await inTab(b, work);
    } finally {
      await stop(b);
    }
  }
  if (!kept || kept.browser !== browser) {
    const old = kept;
    kept = { browser, started: start(browser), busy: 0 };
    if (old) void old.started.then(stop, () => undefined);
  }
  const k = kept;
  k.busy++;
  clearTimeout(k.idle);
  try {
    return await inTab(await k.started, work);
  } catch (e) {
    // A browser that died or never started is not kept: the next job starts a fresh one.
    if (kept === k) kept = undefined;
    void k.started.then(stop, () => undefined);
    throw e;
  } finally {
    k.busy--;
    if (kept === k && k.busy === 0) k.idle = setTimeout(() => { if (kept === k && k.busy === 0) { kept = undefined; void k.started.then(stop, () => undefined); } }, keepFor);
  }
}

/** `work` in a new tab of `b`, closed after. */
async function inTab<T>(b: Started, work: (cdp: Cdp) => Promise<T>): Promise<T> {
  if (!b.endpoint) throw new Error("the browser opened no DevTools");
  const port = new URL(b.endpoint).port;
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target: unknown = await res.json();
  if (typeof target !== "object" || target === null || !("webSocketDebuggerUrl" in target) || typeof target.webSocketDebuggerUrl !== "string" || !("id" in target) || typeof target.id !== "string") {
    throw new Error("the browser opened no page to draw in");
  }
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    return await within(45_000, "Drawing the page", work(cdp));
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => undefined);
  }
}

/** Closes the browser the quick way: asked to over DevTools, killed if it lingers (a plain kill takes it seconds). */
async function quit(proc: Bun.Subprocess, endpoint: string | undefined): Promise<void> {
  if (endpoint) {
    const browser = await within(2_000, "Reaching the browser", connect(endpoint)).catch(() => undefined);
    await browser?.call("Browser.close").catch(() => undefined);
    browser?.close();
  }
  // Its profile is thrown away next, so there's nothing for it to save: a moment's grace, then gone.
  const gone = await within(500, "Closing the browser", proc.exited).then(() => true, () => false);
  if (!gone) {
    proc.kill("SIGKILL");
    await proc.exited.catch(() => undefined);
  }
}

/** Loads the page at `width` and sizes the window to the page's height (up to 8000 CSS px), which it returns. */
async function load(cdp: Cdp, url: string, width: number, scale: number): Promise<number> {
  await cdp.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: scale, mobile: false });
  await cdp.call("Page.enable");
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.call("Page.navigate", { url });
  await loaded;
  return fit(cdp, width, scale);
}

/** Sizes the window to the loaded page's height (up to 8000 CSS px), which it returns. */
async function fit(cdp: Cdp, width: number, scale: number): Promise<number> {
  // The body, not the document: the document is never shorter than the window, which would pad a 512px logo.
  const measured = await cdp.call("Runtime.evaluate", { expression: "document.fonts.ready.then(() => document.body.scrollHeight)", awaitPromise: true, returnByValue: true });
  const value = typeof measured === "object" && measured !== null && "result" in measured && typeof measured.result === "object" && measured.result !== null && "value" in measured.result ? measured.result.value : undefined;
  const height = Math.min(Math.max(typeof value === "number" ? value : 900, 1), 8000);
  await cdp.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  return height;
}

async function draw(cdp: Cdp, url: string, d: Drawing): Promise<Uint8Array> {
  const height = await load(cdp, url, d.width, d.scale ?? 1);
  const out = d.format === "pdf"
    ? await cdp.call("Page.printToPDF", { printBackground: true, paperWidth: d.width / 96, paperHeight: height / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, pageRanges: "1" })
    : await cdp.call("Page.captureScreenshot", { format: "png" });
  return bytesOf(out);
}

/** The file DevTools sends back, base64 in `data`. */
function bytesOf(out: unknown): Uint8Array {
  const data = typeof out === "object" && out !== null && "data" in out && typeof out.data === "string" ? out.data : undefined;
  if (!data) throw new Error("the browser drew nothing");
  return Buffer.from(data, "base64");
}

/** The DevTools address Chrome prints when it starts. */
async function devtools(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let seen = "";
  const reader = stderr.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    seen += decoder.decode(r.value, { stream: true });
    const m = seen.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m?.[1]) {
      // Let go of the pipe: the browser's helper processes keep it open, and a held reader keeps buni running.
      await reader.cancel().catch(() => undefined);
      return m[1];
    }
  }
  throw new Error(`the browser stopped before it was ready: ${seen.trim().split("\n").at(-1) ?? ""}`);
}

interface Cdp {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  once(event: string): Promise<unknown>;
  close(): void;
}

/** A DevTools connection: numbered calls, and waiting for one event. */
async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("couldn't connect to the browser"));
  });
  let next = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const waiting = new Map<string, (v: unknown) => void>();
  ws.onmessage = (e) => {
    const m: unknown = JSON.parse(String(e.data));
    if (typeof m !== "object" || m === null) return;
    if ("id" in m && typeof m.id === "number") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if ("error" in m && typeof m.error === "object" && m.error !== null && "message" in m.error) p?.reject(new Error(String(m.error.message)));
      else p?.resolve("result" in m ? m.result : undefined);
    } else if ("method" in m && typeof m.method === "string") {
      waiting.get(m.method)?.("params" in m ? m.params : undefined);
      waiting.delete(m.method);
    }
  };
  return {
    call: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    once: (event) => new Promise((resolve) => void waiting.set(event, resolve)),
    close: () => ws.close(),
  };
}
