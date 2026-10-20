// Drives a snap: runs the capture in the tab, draws what can't be read (frames, cross-origin pixels) from the screen,
// and hands it to buni on this machine (native messaging: no editor needs to be running), which saves it as a
// scratch design or into one snapped into before.
import type { Snapped } from "./content.ts";

/**
 * redesign: into a design, "scratch" for a new scratch one or a design file snapped into before. inspiration: kept
 * in the person's inspiration library, with when to use it.
 */
export type SnapRequest = { tabId: number; mode: "page" | "pick"; name: string; /** Answer when done, even for a pick: the side panel stays open. */ wait?: boolean } & ({ intent: "redesign"; into: string; brief: string } | { intent: "inspiration"; use: string });
export type SnapAnswer = { ok: true; reply: string } | { ok: false; reply: string };

/** The page scrolled to `y` (as far as it goes), once it has painted there; answers where it got to. */
async function scrollTo(tabId: number, y: number): Promise<number> {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, args: [y], func: (to: number) => {
    scrollTo(scrollX, to);
    return new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(scrollY), 150))));
  } });
  return typeof r?.result === "number" ? r.result : y;
}

/** PNG bytes as base64, in chunks a call can take. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The boxes the capture couldn't read (frames, cross-origin pixels), drawn by Chrome's own screenshot of each box of the
 * page, wherever it is, at twice its size: what buni's live import does, here through the debugger. Undefined when the
 * debugger can't attach (DevTools open on the tab, or the permission not given), for the screen-cutting way below.
 */
async function drawShotsDebugger(snap: Snapped, tabId: number): Promise<{ images: Snapped["images"]; missed: number } | undefined> {
  if (!snap.shots.length) return { images: [], missed: 0 };
  const target = { tabId };
  try { await chrome.debugger.attach(target, "1.3"); } catch { return undefined; }
  const images: Snapped["images"] = [];
  let missed = 0;
  try {
    for (const s of snap.shots) {
      try {
        const r = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: s.x, y: s.y, width: s.width, height: s.height, scale: 2 } });
        const data = typeof r === "object" && r !== null && "data" in r && typeof r.data === "string" ? r.data : undefined;
        if (data) images.push({ id: s.id, base64: data, mime: "image/png" }); else missed++;
      } catch { missed++; }
    }
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
  return { images, missed };
}

/**
 * The same, cut from the screen: the page is scrolled to each
 * stretch that holds some, one screenshot a stretch (Chrome allows two a second), and put back where it was.
 */
async function drawShots(snap: Snapped, tabId: number, windowId: number): Promise<{ images: Snapped["images"]; missed: number }> {
  const images: Snapped["images"] = [];
  let left = [...snap.shots].sort((a, b) => a.y - b.y);
  let last = 0;
  while (left.length) {
    const at = await scrollTo(tabId, Math.max(0, left[0]!.y - 8));
    await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - last))));
    last = Date.now();
    const shown = await createImageBitmap(await (await fetch(await chrome.tabs.captureVisibleTab(windowId, { format: "png" }))).blob());
    const scale = shown.width / snap.width;
    const keep: typeof left = [];
    for (const s of left) {
      const x = (s.x - snap.scrollX) * scale, y = (s.y - at) * scale, w = s.width * scale;
      // A box taller than the window is drawn as far as the window shows it.
      const h = Math.min(s.height * scale, shown.height - y);
      if (x < 0 || y < 0 || x + w > shown.width + 1 || h <= 0) { keep.push(s); continue; }
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      canvas.getContext("2d")?.drawImage(shown, x, y, w, h, 0, 0, canvas.width, canvas.height);
      images.push({ id: s.id, base64: base64(new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())), mime: "image/png" });
    }
    // Nothing more reachable from here (outside the page's width, or the page won't scroll that far): stop.
    if (keep.length === left.length) break;
    left = keep;
  }
  if (snap.shots.length) await scrollTo(tabId, snap.scrollY);
  return { images, missed: left.length };
}

/** The last snap, for the popup to show when it opens again (a pick closes it before the snap ends). */
export interface LastSnap { ok: boolean; reply: string; file?: string; name?: string; page: string; pageId?: string; brief?: string; url: string; at: number }

async function snap(req: SnapRequest): Promise<SnapAnswer> {
  const tab = await chrome.tabs.get(req.tabId);
  await chrome.scripting.executeScript({ target: { tabId: req.tabId }, files: ["content.js"] });
  const [run] = await chrome.scripting.executeScript({ target: { tabId: req.tabId }, func: (mode: "page" | "pick") => window.buniSnap?.(mode), args: [req.mode] });
  const snapped = run?.result as Snapped | undefined;
  if (!snapped) return { ok: false, reply: "Nothing was snapped." };
  const drawn = (await drawShotsDebugger(snapped, req.tabId)) ?? (await drawShots(snapped, req.tabId, tab.windowId));
  const warnings = [...snapped.warnings, ...(drawn.missed ? [`${drawn.missed} picture${drawn.missed === 1 ? "" : "s"} couldn't be drawn from the screen and stay as empty boxes.`] : [])];
  const title = req.name || snapped.title || new URL(snapped.url).hostname;
  const page = `${title} · Now`;
  const snapshot = { html: snapped.html, count: snapped.count, warnings, images: [...snapped.images, ...drawn.images], url: snapped.url, width: snapped.width };
  const answer: unknown = await chrome.runtime.sendNativeMessage("com.buni.snap", req.intent === "inspiration"
    ? { type: "inspire", name: title, snapshot, ...(req.use ? { use: req.use } : {}) }
    : { type: "snap", into: req.into === "scratch" ? { scratch: title } : { file: req.into }, page: { name: page }, snapshot, ...(req.brief ? { brief: req.brief } : {}) });
  const field = (k: string) => (typeof answer === "object" && answer !== null && k in answer ? (answer as Record<string, unknown>)[k] : undefined);
  const ok = field("ok") === true, reply = typeof field("reply") === "string" ? String(field("reply")) : "buni didn't answer.";
  const file = typeof field("file") === "string" ? String(field("file")) : undefined;
  const name = typeof field("name") === "string" ? String(field("name")) : undefined;
  const pageId = typeof field("page") === "string" ? String(field("page")) : undefined;
  const brief = req.intent === "redesign" && req.brief ? req.brief : undefined;
  const last: LastSnap = { ok, reply, page, url: snapped.url, at: Date.now(), ...(file ? { file } : {}), ...(name ? { name } : {}), ...(pageId ? { pageId } : {}), ...(brief ? { brief } : {}) };
  await chrome.storage.local.set({ last, ...(file ? { into: file } : {}) });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#2f8a5b" : "#c0392b" });
  return { ok, reply };
}

/** Why a snap failed, in words the person can act on. */
function why(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/native messaging host/i.test(text)) return "buni isn't set up for Chrome yet: run  buni extension  once, then try again.";
  if (/cannot be scripted|chrome:\/\/|extensions gallery|Cannot access/i.test(text)) return "Chrome doesn't let extensions read this page (its own pages and the Web Store). Try another page.";
  return text;
}

async function failed(e: unknown): Promise<SnapAnswer> {
  const reply = why(e);
  await chrome.storage.local.set({ last: { ok: false, reply, page: "", url: "", at: Date.now() } satisfies LastSnap });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
  return { ok: false, reply };
}

chrome.runtime.onMessage.addListener((message: SnapRequest, _sender, respond: (a: SnapAnswer) => void) => {
  const done = snap(message).catch(failed);
  // A pick waits for the person to click the page, long after the popup closed: say at once it started, so the popup
  // can close knowing the request arrived. Its result shows on the icon and in the popup next time.
  if (message.mode === "pick" && !message.wait) { respond({ ok: true, reply: "Picking" }); void done; return false; }
  void done.then(respond);
  return true;
});

// The icon opens buni in the side panel, beside the page.
const sidePanel = () => void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
chrome.runtime.onInstalled.addListener(sidePanel);
chrome.runtime.onStartup.addListener(sidePanel);
