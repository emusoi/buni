// Drawing a page with the Chrome, Chromium or Edge already on this machine: what `buni shot` and the agent's
// screenshots use when the buni desktop app isn't installed. The browser runs headless with a throwaway profile and
// is driven over the DevTools protocol; it loads the page from a file next to nothing but the design's own folder.
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

/** What `expression` evaluates to on the loaded page, as a string (the page's script returns JSON). */
export function evaluateWithBrowser(browser: string, sheet: Sheet, expression: string): Promise<string> {
  return inBrowser(browser, sheet, async (cdp, url) => {
    await load(cdp, url, sheet.width, 1);
    const r = await cdp.call("Runtime.evaluate", { expression, returnByValue: true });
    const value = typeof r === "object" && r !== null && "result" in r && typeof r.result === "object" && r.result !== null && "value" in r.result ? r.result.value : undefined;
    if (typeof value !== "string") throw new Error("the page read back nothing");
    return value;
  });
}

/** A headless browser with `sheet` written beside a throwaway profile, for `work` to load and use. */
async function inBrowser<T>(browser: string, sheet: Sheet, work: (cdp: Cdp, url: string) => Promise<T>): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), "buni-draw-"));
  const page = join(scratch, "page.html");
  // The page lives in the scratch folder; <base> points its images at the design's folder.
  await writeFile(page, sheet.html.replace("<head>", `<head><base href="${pathToFileURL(`${sheet.dir}/`).href}">`));
  let endpoint: string | undefined;
  const proc = Bun.spawn([browser, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(scratch, "profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdout: "ignore", stderr: "pipe" });
  try {
    endpoint = await within(15_000, "Starting the browser", devtools(proc.stderr));
    const port = new URL(endpoint).port;
    const targets: unknown = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const target = Array.isArray(targets) ? targets.find((t): t is { type: string; webSocketDebuggerUrl: string } => typeof t === "object" && t !== null && t.type === "page" && typeof t.webSocketDebuggerUrl === "string") : undefined;
    if (!target) throw new Error("the browser opened no page to draw in");
    const cdp = await connect(target.webSocketDebuggerUrl);
    try {
      return await within(30_000, "Drawing the page", work(cdp, pathToFileURL(page).href));
    } finally {
      cdp.close();
    }
  } finally {
    await quit(proc, endpoint);
    await rm(scratch, { recursive: true, force: true });
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
  const metrics = (height: number) => cdp.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await metrics(900);
  await cdp.call("Page.enable");
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.call("Page.navigate", { url });
  await loaded;
  // The body, not the document: the document is never shorter than the window, which would pad a 512px logo.
  const measured = await cdp.call("Runtime.evaluate", { expression: "document.fonts.ready.then(() => document.body.scrollHeight)", awaitPromise: true, returnByValue: true });
  const value = typeof measured === "object" && measured !== null && "result" in measured && typeof measured.result === "object" && measured.result !== null && "value" in measured.result ? measured.result.value : undefined;
  const height = Math.min(Math.max(typeof value === "number" ? value : 900, 1), 8000);
  await metrics(height);
  return height;
}

async function draw(cdp: Cdp, url: string, d: Drawing): Promise<Uint8Array> {
  const height = await load(cdp, url, d.width, d.scale ?? 1);
  const out = d.format === "pdf"
    ? await cdp.call("Page.printToPDF", { printBackground: true, paperWidth: d.width / 96, paperHeight: height / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, pageRanges: "1" })
    : await cdp.call("Page.captureScreenshot", { format: "png" });
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
