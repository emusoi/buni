// buni in Chrome's side panel, kept to one decision: capture this page. It goes to the design this site's captures go
// to (one of the person's projects, or a scratch design of its own), the prompt for Claude is copied, and the panel
// follows the redesign. Everything else (all captures, inspiration) waits in Library. Talks to buni on this machine
// through native messaging.
import type { LastSnap, SnapAnswer, SnapRequest } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // ponytail: the ids are in panel.html
const HOST = "com.buni.snap";
const tilde = (path: string) => path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/** One request to buni on this machine; undefined when it isn't set up for Chrome. */
async function native(message: object): Promise<Record<string, unknown> | undefined> {
  try {
    const r: unknown = await chrome.runtime.sendNativeMessage(HOST, message);
    return typeof r === "object" && r !== null ? (r as Record<string, unknown>) : undefined;
  } catch { return undefined; }
}

/** A message under the actions; a long one (a refused import) shows its first line, the rest behind details. */
function say(where: HTMLElement, message: string, error = false): void {
  where.className = `status${error ? " error" : ""}`;
  const first = message.split(/(?<=[.:])\s|\n/)[0] ?? message;
  if (message.length <= 140 || first.length >= message.length) { where.textContent = message; return; }
  const more = document.createElement("details");
  const head = document.createElement("summary");
  head.textContent = first.length > 140 ? `${first.slice(0, 137)}…` : first;
  const rest = document.createElement("p");
  rest.textContent = message;
  more.append(head, rest);
  where.replaceChildren(more);
}

// --- Views ------------------------------------------------------------------------------------------------------------

const VIEWS = ["home", "watch", "library", "editor"] as const;
type View = (typeof VIEWS)[number];
let watching: Capture | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
function show(view: View): void {
  for (const v of VIEWS) $<HTMLElement>(`view-${v}`).classList.toggle("on", v === view);
  if (view !== "editor") $<HTMLIFrameElement>("frame").removeAttribute("src");
  clearInterval(poll);
  if (view === "home") void loadHome();
  if (view === "library") void loadLibrary();
  // While a redesign is watched, its progress is read again every few seconds: Claude works in the design meanwhile.
  if (view === "watch") poll = setInterval(() => void refreshWatch(), 4000);
}

// --- Captures ---------------------------------------------------------------------------------------------------------

interface Capture { file: string; design: string; page: string; pageId?: string; url?: string; progress: string }

async function captures(): Promise<Capture[]> {
  const r = await native({ type: "snaps" });
  return (Array.isArray(r?.snaps) ? r.snaps : []).flatMap((s: Record<string, unknown>) => {
    const file = text(s.file), page = text(s.page);
    return file && page ? [{ file, page, design: text(s.design) ?? tilde(file), progress: text(s.progress) ?? "Captured", ...(text(s.pageId) ? { pageId: text(s.pageId)! } : {}), ...(text(s.url) ? { url: text(s.url)! } : {}) }] : [];
  });
}

/** Being worked on: reviewed, or with a Next page, and no options picked between yet. */
const working = (c: Capture) => c.progress === "Reviewed" || c.progress === "Next ready";

function row(c: Capture): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "row";
  el.innerHTML = `<span class="dot"></span><span class="name"></span><span class="state"></span>`;
  el.querySelector(".dot")!.classList.toggle("live", working(c));
  el.querySelector(".name")!.textContent = c.page;
  el.querySelector(".state")!.textContent = c.progress.toLowerCase();
  el.addEventListener("click", () => watch(c));
  return el;
}

/** What to paste into Claude (or any agent) so it redesigns the capture inside its project. */
function prompt(c: Capture): string {
  const file = tilde(c.file);
  return [
    `Redesign "${c.page}"${c.pageId ? ` (page ${c.pageId})` : ""}, which I captured with buni into ${file}${c.url ? ` from ${c.url}` : ""}.`,
    "Use the buni skill and read buni skills critique first. It sits in its project: use the project's tokens and components.",
    `1. buni tree ${file}, look at the page (buni shot), judge it, then review_page {page, pin: true}.`,
    `2. duplicate_page to "${c.page} · Next" and fix it there, worst first; if the direction isn't obvious, explore_page 3 options and compare_options.`,
    "3. review_page {page: Next, against: the capture} and show me before and after.",
  ].join("\n");
}

// --- Home -------------------------------------------------------------------------------------------------------------

let tabUrl = "";
const host = () => { try { return new URL(tabUrl).host; } catch { return ""; } };

async function loadHome(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url ?? "";
  $<HTMLElement>("host").textContent = host().replace(/^www\./, "");
  $<HTMLElement>("title").textContent = tab?.title || "This page";
  const usable = /^https?:/.test(tabUrl);
  for (const b of ["capture", "pick", "inspire"]) $<HTMLButtonElement>(b).disabled = !usable;
  say($("status"), usable ? "" : "Open a web page to capture it.");
  await loadWhere();
  $<HTMLElement>("recent").replaceChildren(...(await captures()).slice(0, 5).map(row));
}

/** Where this site's captures go, as one line; the hidden select over it changes that. */
async function loadWhere(): Promise<void> {
  const h = host();
  const select = $<HTMLSelectElement>("where");
  if (!h) { $<HTMLElement>("where-label").textContent = "nowhere yet"; select.replaceChildren(); return; }
  const r = await native({ type: "where", host: h });
  if (!r) return say($("status"), "buni isn't set up for Chrome yet: run  buni extension  once, then reopen this.", true);
  $<HTMLElement>("where-label").textContent = text(r.label) ?? "a scratch design";
  const scratch = new Option(`A scratch design for ${h.replace(/^www\./, "")}`, "");
  const choices = (Array.isArray(r.choices) ? r.choices : []).map((c: Record<string, unknown>) => new Option(text(c.label) ?? "", text(c.file) ?? "", false, text(c.file) === text(r.file) && r.linked === true));
  select.replaceChildren(scratch, ...choices);
  scratch.selected = r.linked !== true;
}
$<HTMLSelectElement>("where").addEventListener("change", async (e) => {
  const file = (e.target as HTMLSelectElement).value;
  await native({ type: "link", host: host(), ...(file ? { file } : {}) });
  await loadWhere();
});

async function capture(mode: "page" | "pick", intent: "redesign" | "inspiration"): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const request: SnapRequest = intent === "inspiration"
    ? { tabId: tab.id, mode, name: "", intent, use: "" }
    : { tabId: tab.id, mode, name: "", intent, into: "site", brief: "" };
  say($("status"), mode === "pick" ? "Point at a part: click it, ↑ for the part around it, Enter takes it, Esc cancels." : "Capturing…");
  for (const b of ["capture", "pick", "inspire"]) $<HTMLButtonElement>(b).disabled = true;
  const answer: SnapAnswer = await chrome.runtime.sendMessage({ ...request, wait: true });
  for (const b of ["capture", "pick", "inspire"]) $<HTMLButtonElement>(b).disabled = false;
  if (!answer.ok) return say($("status"), answer.reply, true);
  void chrome.action.setBadgeText({ text: "" });
  const last = (await chrome.storage.local.get("last")).last as LastSnap | undefined;
  if (intent === "inspiration" || !last?.file) { say($("status"), "Kept as inspiration: find it in Library."); return; }
  say($("status"), "");
  const c: Capture = { file: last.file, page: last.page, design: tilde(last.file), progress: "Captured", ...(last.pageId ? { pageId: last.pageId } : {}), ...(last.url ? { url: last.url } : {}) };
  // The prompt goes to the clipboard at once: paste it into Claude, and watch here.
  const copied = await navigator.clipboard.writeText(prompt(c)).then(() => true, () => false);
  watch(c, copied);
}

// --- Watching a redesign ----------------------------------------------------------------------------------------------

function watch(c: Capture, copied = false): void {
  watching = c;
  $<HTMLElement>("watch-where").textContent = `in ${c.design}`;
  $<HTMLElement>("watch-title").textContent = c.page;
  $<HTMLElement>("watch-note").textContent = copied ? "The prompt for Claude is copied: paste it in your terminal." : "";
  say($("watch-status"), "");
  paintWatch(c);
  show("watch");
  void captures().then((all) => {
    const me = all.find((x) => x.file === c.file && x.pageId === c.pageId);
    if (me && watching === c) { watching = { ...c, design: me.design, progress: me.progress }; $<HTMLElement>("watch-where").textContent = `in ${me.design}`; paintWatch(watching); }
    $<HTMLElement>("watch-others").replaceChildren(...all.filter((x) => !(x.file === c.file && x.pageId === c.pageId)).slice(0, 4).map(row));
  });
}
function paintWatch(c: Capture): void {
  const words: Record<string, string> = { Captured: "Captured, waiting for Claude", Reviewed: "Claude has reviewed it", "Next ready": "Claude made the Next version" };
  $<HTMLElement>("watch-state").textContent = words[c.progress] ?? `Claude made ${c.progress}`;
  $<HTMLElement>("watch-dot").classList.toggle("live", c.progress !== "Captured");
}
async function refreshWatch(): Promise<void> {
  if (!watching) return;
  const now = (await captures()).find((x) => x.file === watching!.file && x.pageId === watching!.pageId);
  if (now && now.progress !== watching.progress) { watching = { ...watching, progress: now.progress }; paintWatch(watching); }
}
$<HTMLButtonElement>("watch-copy").addEventListener("click", () => {
  if (watching) void navigator.clipboard.writeText(prompt(watching)).then(() => say($("watch-status"), "Copied. Paste it into Claude."));
});
$<HTMLButtonElement>("watch-open").addEventListener("click", () => { if (watching) void openEditor(watching); });

// --- The editor, here -------------------------------------------------------------------------------------------------

let editorUrl = "";
async function openEditor(c: Capture): Promise<void> {
  say($("watch-status"), "Opening buni…");
  const r = await native({ type: "open", file: c.file, ...(c.pageId ? { page: c.pageId } : {}) });
  const url = text(r?.url);
  if (!url) return say($("watch-status"), text(r?.reply) ?? "buni couldn't open the editor.", true);
  say($("watch-status"), "");
  editorUrl = url;
  // Compact: the canvas gets the room, and it follows Claude to the page it's changing.
  const here = new URL(url);
  here.searchParams.set("compact", "1");
  $<HTMLElement>("editor-title").textContent = c.page;
  show("editor");
  $<HTMLIFrameElement>("frame").src = here.href;
}
$<HTMLButtonElement>("editor-back").addEventListener("click", () => (watching ? watch(watching) : show("home")));
$<HTMLButtonElement>("editor-out").addEventListener("click", () => { if (editorUrl) void chrome.tabs.create({ url: editorUrl }); });

// --- Library ----------------------------------------------------------------------------------------------------------

let library: { captures: Capture[]; patterns: Record<string, unknown>[] } = { captures: [], patterns: [] };
async function loadLibrary(): Promise<void> {
  const [all, r] = await Promise.all([captures(), native({ type: "patterns" })]);
  library = { captures: all, patterns: Array.isArray(r?.patterns) ? r.patterns : [] };
  paintLibrary();
}
function paintLibrary(): void {
  const q = $<HTMLInputElement>("find").value.trim().toLowerCase();
  const caps = library.captures.filter((c) => !q || `${c.page} ${c.design}`.toLowerCase().includes(q));
  const pats = library.patterns.filter((p) => !q || `${text(p.name)} ${text(p.use)} ${(Array.isArray(p.tags) ? p.tags : []).join(" ")}`.toLowerCase().includes(q));
  const head = (t: string) => { const h = document.createElement("h2"); h.textContent = t; return h; };
  const pattern = (p: Record<string, unknown>) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "row";
    el.title = text(p.use) ?? "";
    el.innerHTML = `<span class="name"></span><span class="state"></span>`;
    el.querySelector(".name")!.textContent = text(p.name) ?? "";
    el.querySelector(".state")!.textContent = text(p.library) === "buni" ? "buni" : "yours";
    el.addEventListener("click", () => void navigator.clipboard.writeText(
      `Use the buni inspiration pattern "${text(p.name)}" as the reference for what we're designing: use_inspiration brings it in (buni skill). Take its structure and behaviour; make the look and words ours.`,
    ).then(() => { el.querySelector(".state")!.textContent = "prompt copied"; }));
    return el;
  };
  $<HTMLElement>("library").replaceChildren(head("Captures"), ...caps.map(row), head("Inspiration"), ...pats.map(pattern));
}
$<HTMLInputElement>("find").addEventListener("input", paintLibrary);

// --- Wiring -----------------------------------------------------------------------------------------------------------

$<HTMLButtonElement>("capture").addEventListener("click", () => void capture("page", "redesign"));
$<HTMLButtonElement>("pick").addEventListener("click", () => void capture("pick", "redesign"));
$<HTMLButtonElement>("inspire").addEventListener("click", () => void capture("page", "inspiration"));
for (const id of ["to-library", "watch-library"]) $<HTMLButtonElement>(id).addEventListener("click", () => show("library"));
for (const id of ["watch-back", "library-back"]) $<HTMLButtonElement>(id).addEventListener("click", () => show("home"));
// The panel follows the tab: switching tabs, or the page changing, updates what it would capture.
const follow = () => { if ($<HTMLElement>("view-home").classList.contains("on")) void loadHome(); };
chrome.tabs.onActivated.addListener(follow);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.title || change.url) follow(); });

void (async () => {
  void chrome.action.setBadgeText({ text: "" });
  const last = (await chrome.storage.local.get("last")).last as LastSnap | undefined;
  await loadHome();
  // A pick that failed after the panel closed says so once.
  if (last && !last.ok && Date.now() - last.at < 30 * 60_000) { say($("status"), last.reply, true); void chrome.storage.local.remove("last"); }
})();
