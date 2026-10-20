// buni in Chrome's side panel, beside the page being worked on: capture it (to redesign, or to keep as inspiration),
// pick up earlier captures, browse the inspiration libraries, and watch the design in the buni editor right here.
// It talks to buni on this machine through native messaging; no editor has to be running until one is opened.
import type { LastSnap, SnapAnswer, SnapRequest } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // ponytail: the ids are in panel.html
const HOST = "com.buni.snap";
const tilde = (path: string) => path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");
const into = $<HTMLSelectElement>("into"), name = $<HTMLInputElement>("name"), use = $<HTMLTextAreaElement>("use"), brief = $<HTMLTextAreaElement>("brief"), status = $<HTMLDivElement>("status");
/** A message under the buttons; a long one (a refused import) shows its first line, the rest behind Details. */
function say(text: string, error = false): void {
  status.className = error ? "error" : "";
  const first = text.split(/(?<=[.:])\s|\n/)[0] ?? text;
  if (text.length <= 160 || first.length >= text.length) { status.textContent = text; return; }
  const more = document.createElement("details");
  const head = document.createElement("summary");
  head.textContent = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  const rest = document.createElement("p");
  rest.textContent = text;
  more.append(head, rest);
  status.replaceChildren(more);
}

/** One request to buni on this machine; undefined when it isn't set up for Chrome. */
async function native(message: object): Promise<Record<string, unknown> | undefined> {
  try {
    const r: unknown = await chrome.runtime.sendNativeMessage(HOST, message);
    return typeof r === "object" && r !== null ? (r as Record<string, unknown>) : undefined;
  } catch { return undefined; }
}
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

// --- Tabs -------------------------------------------------------------------------------------------------------------

const TABS = ["capture", "snaps", "inspiration"] as const;
type Tab = (typeof TABS)[number];
function open(tab: Tab): void {
  closeEditor();
  for (const t of TABS) {
    $<HTMLButtonElement>(`tab-${t}`).setAttribute("aria-selected", String(t === tab));
    $<HTMLElement>(`view-${t}`).classList.toggle("on", t === tab);
  }
  if (tab === "snaps") void loadSnaps();
  if (tab === "inspiration") void loadPatterns();
}

// --- The editor, inside the panel ---------------------------------------------------------------------------------------

let editorUrl = "";
async function openEditor(file: string, page: string | undefined, title: string, here: boolean): Promise<void> {
  say("Opening buni…");
  const r = await native({ type: "open", file, ...(page ? { page } : {}) });
  const url = text(r?.url);
  if (!url) return say("buni couldn't open the editor.", true);
  say("");
  if (!here) { await chrome.tabs.create({ url }); return; }
  editorUrl = url;
  $<HTMLElement>("editor-title").textContent = title;
  // Compact in the panel: the canvas gets the room, so the redesign shows as it happens.
  const inPanel = new URL(url);
  inPanel.searchParams.set("compact", "1");
  $<HTMLIFrameElement>("frame").src = inPanel.href;
  for (const t of TABS) $<HTMLElement>(`view-${t}`).classList.remove("on");
  $<HTMLElement>("editor").classList.add("on");
}
function closeEditor(): void {
  $<HTMLElement>("editor").classList.remove("on");
  $<HTMLIFrameElement>("frame").removeAttribute("src");
}
$<HTMLButtonElement>("back").addEventListener("click", () => open("snaps"));
$<HTMLButtonElement>("pop-out").addEventListener("click", () => { if (editorUrl) void chrome.tabs.create({ url: editorUrl }); });

// --- Handing a capture on ---------------------------------------------------------------------------------------------

interface Captured { file: string; page: string; pageId?: string; url?: string; brief?: string }

/** What to paste into Claude (or any agent) so it picks the capture up where it was left. */
function prompt(c: Captured): string {
  const file = tilde(c.file);
  if (file.endsWith(".html")) return `I kept ${c.url || "a page"} as a pattern in my buni inspiration library: ${file}. Use the buni skill: find_inspiration and use_inspiration bring it into a design.`;
  return [
    `Redesign the page I captured with buni: "${c.page}"${c.pageId ? ` (page ${c.pageId})` : ""} in ${file}, from ${c.url || "the live site"}.`,
    c.brief ? `What should change: ${c.brief}` : "Find what most needs to change.",
    "Use the buni skill (read buni skills critique first):",
    `1. buni tree ${file}, look at it (buni shot), judge it, then review_page {page, pin: true}.`,
    "2. duplicate_page to \"<Screen> · Next\" and fix it there, worst first; if the direction isn't obvious, explore_page 3 options and compare_options.",
    "3. review_page {page: Next, against: Now} and show me before and after.",
    "Check find_inspiration for patterns that fit. If I say to keep it, buni adopt moves it into the project.",
  ].join("\n");
}

/** A capture as a card: what it is, its brief, and the ways on (Claude, the editor here, the editor in a tab). */
function card(c: Captured, heading: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";
  const kept = c.file.endsWith(".html");
  const host = c.url ? (() => { try { return new URL(c.url).host; } catch { return c.url; } })() : undefined;
  el.innerHTML = `<b></b><span class="meta"></span>${c.brief ? `<span class="brief"></span>` : ""}<code></code><div class="row"><button class="act" data-do="copy" type="button">Copy for Claude</button>${kept ? "" : `<button class="act" data-do="here" type="button">Open here</button><button class="act" data-do="tab" type="button" title="Open in a tab">↗</button>`}</div><span class="status"></span>`;
  el.querySelector("b")!.textContent = heading;
  el.querySelector(".meta")!.textContent = host ? `from ${host}` : "";
  if (c.brief) el.querySelector(".brief")!.textContent = `Brief: ${c.brief}`;
  el.querySelector("code")!.textContent = tilde(c.file);
  const note = el.querySelector(".status")!;
  el.addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).dataset.do;
    if (what === "copy") void navigator.clipboard.writeText(prompt(c)).then(() => { note.textContent = "Copied. Paste it into Claude."; });
    if (what === "here" || what === "tab") void openEditor(c.file, c.pageId, c.page, what === "here");
  });
  return el;
}

// --- Capture ----------------------------------------------------------------------------------------------------------

/** What the capture is for: a page to redesign, or a pattern to keep. Remembered between visits. */
let intent: "redesign" | "inspiration" = "redesign";
function choose(next: typeof intent): void {
  intent = next;
  $<HTMLButtonElement>("redesign").setAttribute("aria-pressed", String(next === "redesign"));
  $<HTMLButtonElement>("inspire").setAttribute("aria-pressed", String(next === "inspiration"));
  $<HTMLElement>("into-field").hidden = next !== "redesign";
  $<HTMLButtonElement>("page").textContent = next === "redesign" ? "Capture page" : "Keep page";
  $<HTMLElement>("brief-field").hidden = next !== "redesign";
  $<HTMLElement>("use-field").hidden = next !== "inspiration";
  void chrome.storage.local.set({ intent: next });
}

function showLast(last: LastSnap | undefined): void {
  const box = $<HTMLElement>("result");
  box.replaceChildren();
  if (!last || Date.now() - last.at > 30 * 60_000 || !last.ok || !last.file) return;
  const c: Captured = { file: last.file, page: last.page, ...(last.pageId ? { pageId: last.pageId } : {}), ...(last.url ? { url: last.url } : {}), ...(last.brief ? { brief: last.brief } : {}) };
  box.append(card(c, last.file.endsWith(".html") ? "Kept as inspiration" : `Ready to redesign: ${last.page}`));
}

async function loadTargets(): Promise<void> {
  const saved = await chrome.storage.local.get("into");
  const r = await native({ type: "list" });
  if (!r) return say("buni isn't set up for Chrome yet: run  buni extension  once, then reopen this.", true);
  into.replaceChildren(new Option("A new scratch design", "scratch"));
  for (const d of Array.isArray(r.scratch) ? r.scratch : []) {
    const file = text(d?.file), label = text(d?.name);
    if (file) into.append(new Option(label ?? file, file, false, file === saved.into));
  }
}

async function capture(mode: "page" | "pick"): Promise<void> {
  // Asked once, inside the click: the panel reads the page itself, so it needs the person's say-so for pages.
  const allowed = await chrome.permissions.request({ origins: ["<all_urls>"], permissions: ["debugger"] }).catch(() => false);
  if (!allowed) return say("buni needs to read the page to capture it. Allow it and try again.", true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const request: SnapRequest = intent === "inspiration"
    ? { tabId: tab.id, mode, name: name.value.trim(), intent, use: use.value.trim() }
    : { tabId: tab.id, mode, name: name.value.trim(), intent, into: into.value, brief: brief.value.trim() };
  say(mode === "pick" ? "Point at a part of the page: click it, ↑ for the part around it, Enter captures, Esc cancels." : "Capturing…");
  for (const b of ["page", "pick"]) $<HTMLButtonElement>(b).disabled = true;
  const answer: SnapAnswer = await chrome.runtime.sendMessage({ ...request, wait: true });
  for (const b of ["page", "pick"]) $<HTMLButtonElement>(b).disabled = false;
  if (!answer.ok) return say(answer.reply, true);
  say("");
  brief.value = ""; name.value = "";
  void chrome.action.setBadgeText({ text: "" });
  const last = (await chrome.storage.local.get("last")).last as LastSnap | undefined;
  showLast(last);
  void loadTargets();
  // A page to redesign opens in buni at once, beside the original, so the redesign shows as it happens.
  if (last?.ok && last.file?.endsWith(".buni")) await openEditor(last.file, last.pageId, last.page, true);
}

// --- Snaps and inspiration ----------------------------------------------------------------------------------------------

async function loadSnaps(): Promise<void> {
  const list = $<HTMLElement>("snaps");
  const r = await native({ type: "snaps" });
  const snaps = Array.isArray(r?.snaps) ? r.snaps : [];
  list.replaceChildren(...snaps.map((s: Record<string, unknown>) => {
    const c: Captured = { file: text(s.file) ?? "", page: text(s.page) ?? "", ...(text(s.pageId) ? { pageId: text(s.pageId)! } : {}), ...(text(s.url) ? { url: text(s.url)! } : {}), ...(text(s.brief) ? { brief: text(s.brief)! } : {}) };
    return card(c, c.page);
  }));
  if (!snaps.length) list.innerHTML = `<p class="empty">Nothing captured yet. Capture a page to redesign it, and it shows here.</p>`;
}

let patterns: Record<string, unknown>[] = [];
async function loadPatterns(): Promise<void> {
  const r = await native({ type: "patterns" });
  patterns = Array.isArray(r?.patterns) ? r.patterns : [];
  showPatterns();
}
function showPatterns(): void {
  const q = $<HTMLInputElement>("find").value.trim().toLowerCase();
  const shown = patterns.filter((p) => !q || `${text(p.name)} ${(Array.isArray(p.tags) ? p.tags : []).join(" ")} ${text(p.use)}`.toLowerCase().includes(q));
  $<HTMLElement>("patterns").replaceChildren(...shown.map((p) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<b></b><span class="meta"></span><span class="brief"></span><div class="row"><button class="act" type="button">Copy for Claude</button></div><span class="status"></span>`;
    el.querySelector("b")!.textContent = text(p.name) ?? "";
    el.querySelector(".meta")!.textContent = text(p.library) === "buni" ? "buni's library" : `your library: ${text(p.library)}`;
    el.querySelector(".brief")!.textContent = text(p.use) ?? "";
    el.querySelector("button")!.addEventListener("click", () => void navigator.clipboard.writeText(
      `Use my buni inspiration pattern "${text(p.name)}" as the reference for what we're designing: use_inspiration brings it in (buni skill). Take its structure and behaviour, and make the look and words ours.`,
    ).then(() => { el.querySelector(".status")!.textContent = "Copied. Paste it into Claude."; }));
    return el;
  }));
  if (!shown.length) $<HTMLElement>("patterns").innerHTML = `<p class="empty">${patterns.length ? "No pattern fits." : "No inspiration yet. Capture a page as inspiration, or run  buni inspiration add <folder>."}</p>`;
}

// --- Wiring -----------------------------------------------------------------------------------------------------------

for (const t of TABS) $<HTMLButtonElement>(`tab-${t}`).addEventListener("click", () => open(t));
$<HTMLButtonElement>("redesign").addEventListener("click", () => choose("redesign"));
$<HTMLButtonElement>("inspire").addEventListener("click", () => choose("inspiration"));
$<HTMLButtonElement>("page").addEventListener("click", () => void capture("page"));
$<HTMLButtonElement>("pick").addEventListener("click", () => void capture("pick"));
$<HTMLInputElement>("find").addEventListener("input", showPatterns);
// The page in the panel follows the tab: its title names the capture unless the person typed one.
const follow = async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); name.placeholder = tab?.title || "This page’s title"; };
chrome.tabs.onActivated.addListener(() => void follow());
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.title) void follow(); });

void (async () => {
  const saved = await chrome.storage.local.get(["last", "intent"]);
  choose(saved.intent === "inspiration" ? "inspiration" : "redesign");
  const last = saved.last as LastSnap | undefined;
  if (last && !last.ok && Date.now() - last.at < 30 * 60_000) { say(last.reply, true); void chrome.storage.local.remove("last"); } else showLast(last);
  void chrome.action.setBadgeText({ text: "" });
  await follow();
  await loadTargets();
})();
