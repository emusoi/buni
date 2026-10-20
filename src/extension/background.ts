// Drives a snap: runs the capture in the tab, draws what can't be read (frames, cross-origin pixels) from the screen,
// and sends it to the buni editor the person chose, which opens with the new page.
import type { Snapped } from "./content.ts";

export interface SnapRequest { tabId: number; mode: "page" | "pick"; server: string; file: string; name: string }
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

async function snap(req: SnapRequest): Promise<SnapAnswer> {
  const tab = await chrome.tabs.get(req.tabId);
  await chrome.scripting.executeScript({ target: { tabId: req.tabId }, files: ["content.js"] });
  const [run] = await chrome.scripting.executeScript({ target: { tabId: req.tabId }, func: (mode: "page" | "pick") => window.buniSnap?.(mode), args: [req.mode] });
  const snapped = run?.result as Snapped | undefined;
  if (!snapped) return { ok: false, reply: "Nothing was snapped." };
  const drawn = await drawShots(snapped, tab.windowId);
  const warnings = [...snapped.warnings, ...(drawn.missed ? [`${drawn.missed} frame${drawn.missed === 1 ? " was" : "s were"} outside the window and left empty; scroll to it and snap again.`] : [])];
  const body = {
    snapshot: { html: snapped.html, count: snapped.count, warnings, images: [...snapped.images, ...drawn.images], url: snapped.url, width: snapped.width },
    page: { name: req.name || `${snapped.title || new URL(snapped.url).hostname} · Now` },
  };
  const response = await fetch(`${req.server}/snap?file=${encodeURIComponent(req.file)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const answer: unknown = await response.json().catch(() => ({}));
  const reply = typeof answer === "object" && answer !== null && "reply" in answer && typeof answer.reply === "string" ? answer.reply : `buni answered ${response.status}`;
  const open = typeof answer === "object" && answer !== null && "open" in answer && typeof answer.open === "string" ? answer.open : undefined;
  if (response.ok && open) await chrome.tabs.create({ url: open });
  return { ok: response.ok, reply };
}

chrome.runtime.onMessage.addListener((message: SnapRequest, _sender, respond: (a: SnapAnswer) => void) => {
  snap(message).then(respond, (e: unknown) => respond({ ok: false, reply: e instanceof Error ? e.message : String(e) }));
  return true;
});
