// Drives a snap: runs the capture in the tab, draws what can't be read (frames, cross-origin pixels) from the screen,
// and hands it to buni on this machine (native messaging: no editor needs to be running), which saves it as a
// scratch design or into one snapped into before.
import type { Snapped } from "./content.ts";

/**
 * redesign: into a design, "scratch" for a new scratch one or a design file snapped into before. inspiration: kept
 * in the person's inspiration library, with when to use it.
 */
export type SnapRequest = { tabId: number; mode: "page" | "pick"; name: string } & ({ intent: "redesign"; into: string; brief: string } | { intent: "inspiration"; use: string });
export type SnapAnswer = { ok: true; reply: string } | { ok: false; reply: string };

/** The boxes the capture couldn't read, cut from what the tab shows now; one outside the window can't be drawn. */
async function drawShots(snap: Snapped, windowId: number): Promise<{ images: Snapped["images"]; missed: number }> {
  if (!snap.shots.length) return { images: [], missed: 0 };
  const shown = await createImageBitmap(await (await fetch(await chrome.tabs.captureVisibleTab(windowId, { format: "png" }))).blob());
  const scale = shown.width / snap.width;
  const images: Snapped["images"] = [];
  let missed = 0;
  for (const s of snap.shots) {
    const x = (s.x - snap.scrollX) * scale, y = (s.y - snap.scrollY) * scale, w = s.width * scale, h = s.height * scale;
    if (x < 0 || y < 0 || x + w > shown.width || y + h > shown.height) { missed++; continue; }
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    canvas.getContext("2d")?.drawImage(shown, x, y, w, h, 0, 0, canvas.width, canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    images.push({ id: s.id, base64: btoa(binary), mime: "image/png" });
  }
  return { images, missed };
}

/** The last snap, for the popup to show when it opens again (a pick closes it before the snap ends). */
export interface LastSnap { ok: boolean; reply: string; file?: string; name?: string; page: string; pageId?: string; brief?: string; url: string; at: number }

async function snap(req: SnapRequest): Promise<SnapAnswer> {
  const tab = await chrome.tabs.get(req.tabId);
  await chrome.scripting.executeScript({ target: { tabId: req.tabId }, files: ["content.js"] });
  const [run] = await chrome.scripting.executeScript({ target: { tabId: req.tabId }, func: (mode: "page" | "pick") => window.buniSnap?.(mode), args: [req.mode] });
  const snapped = run?.result as Snapped | undefined;
  if (!snapped) return { ok: false, reply: "Nothing was snapped." };
  const drawn = await drawShots(snapped, tab.windowId);
  const warnings = [...snapped.warnings, ...(drawn.missed ? [`${drawn.missed} frame${drawn.missed === 1 ? " was" : "s were"} outside the window and left empty; scroll to it and snap again.`] : [])];
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
  if (message.mode === "pick") { respond({ ok: true, reply: "Picking" }); void done; return false; }
  void done.then(respond);
  return true;
});
