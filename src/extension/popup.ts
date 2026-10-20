// The popup: where a snap goes (a new scratch design, or one snapped into before), then the whole page or a part.
// After a snap it hands the design on: a prompt to paste into Claude or any agent, or the buni editor.
import type { LastSnap, SnapAnswer, SnapRequest } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // ponytail: the ids are in popup.html
const into = $<HTMLSelectElement>("into"), name = $<HTMLInputElement>("name"), use = $<HTMLInputElement>("use"), brief = $<HTMLTextAreaElement>("brief"), status = $<HTMLParagraphElement>("status");
/** What the capture is for: a page to redesign, or a pattern to keep. Remembered between visits. */
let intent: "redesign" | "inspiration" = "redesign";
function choose(next: typeof intent): void {
  intent = next;
  $<HTMLButtonElement>("redesign").setAttribute("aria-pressed", String(next === "redesign"));
  $<HTMLButtonElement>("inspire").setAttribute("aria-pressed", String(next === "inspiration"));
  $<HTMLElement>("into-field").hidden = next !== "redesign";
  $<HTMLElement>("brief-field").hidden = next !== "redesign";
  $<HTMLElement>("use-field").hidden = next !== "inspiration";
  void chrome.storage.local.set({ intent: next });
}
const say = (text: string, error = false) => { status.textContent = text; status.className = error ? "error" : ""; };
const HOST = "com.buni.snap";
const tilde = (path: string) => path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");

/** What to paste into an agent so it picks the design up where the snap left it. */
const prompt = (last: LastSnap) => {
  const file = tilde(last.file ?? "");
  if (file.endsWith(".html")) return `I kept ${last.url || "a page"} as a pattern in my buni inspiration library: ${file}. Use the buni skill: find_inspiration and use_inspiration bring it into a design.`;
  return [
    `Redesign the page I captured with buni: "${last.page}"${last.pageId ? ` (page ${last.pageId})` : ""} in ${file}, from ${last.url || "the live site"}.`,
    last.brief ? `What should change: ${last.brief}` : "Find what most needs to change.",
    "Use the buni skill (read buni skills critique first):",
    `1. buni tree ${file}, look at it (buni shot), judge it, then review_page {page, pin: true}.`,
    "2. duplicate_page to \"<Screen> · Next\" and fix it there, worst first; if the direction isn't obvious, explore_page 3 options and compare_options.",
    "3. review_page {page: Next, against: Now} and show me before and after.",
    "Check find_inspiration for patterns that fit. If I say to keep it, buni adopt moves it into the project.",
  ].join("\n");
};

function show(last: LastSnap | undefined): void {
  const box = $<HTMLElement>("result");
  if (!last || Date.now() - last.at > 30 * 60_000) { box.className = ""; return; }
  // A failure shows once, the next time the popup opens (a pick fails after the popup closed), then it's cleared.
  if (!last.ok || !last.file) { box.className = ""; say(last.reply, true); void chrome.storage.local.remove("last"); return; }
  box.className = "shown";
  const kept = last.file.endsWith(".html");
  $<HTMLElement>("result-title").textContent = kept ? "Kept as inspiration" : `Ready to redesign: “${last.page}”`;
  $<HTMLButtonElement>("open").hidden = kept;
  $<HTMLElement>("result-file").textContent = tilde(last.file);
  $<HTMLButtonElement>("copy").onclick = () => void navigator.clipboard.writeText(prompt(last)).then(() => say("Copied. Paste it into Claude."));
  $<HTMLButtonElement>("open").onclick = async () => {
    say("Opening buni…");
    const r: unknown = await chrome.runtime.sendNativeMessage(HOST, { type: "open", file: last.file, ...(last.pageId ? { page: last.pageId } : {}) });
    const url = typeof r === "object" && r !== null && "url" in r && typeof r.url === "string" ? r.url : undefined;
    if (url) { await chrome.tabs.create({ url }); window.close(); } else say("buni couldn't open the editor.", true);
  };
}

async function load(): Promise<void> {
  void chrome.action.setBadgeText({ text: "" });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  name.placeholder = tab?.title || "This page’s title";
  const saved = await chrome.storage.local.get(["last", "into", "intent"]);
  choose(saved.intent === "inspiration" ? "inspiration" : "redesign");
  show(saved.last as LastSnap | undefined);
  try {
    const r: unknown = await chrome.runtime.sendNativeMessage(HOST, { type: "list" });
    const list = typeof r === "object" && r !== null && "scratch" in r && Array.isArray(r.scratch) ? r.scratch : [];
    for (const d of list) {
      if (typeof d !== "object" || d === null || !("file" in d) || typeof d.file !== "string") continue;
      const o = document.createElement("option");
      o.value = d.file;
      o.textContent = `${"name" in d && typeof d.name === "string" ? d.name : d.file}`;
      o.selected = d.file === saved.into;
      into.append(o);
    }
  } catch {
    say("buni isn't set up for Chrome yet: run  buni extension  once, then reopen this.", true);
  }
}

async function snap(mode: "page" | "pick"): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const request: SnapRequest = intent === "inspiration"
    ? { tabId: tab.id, mode, name: name.value.trim(), intent, use: use.value.trim() }
    : { tabId: tab.id, mode, name: name.value.trim(), intent, into: into.value, brief: brief.value.trim() };
  if (mode === "pick") {
    // Closed only once the background has the request; it finishes after the click, and the icon shows ✓ or !.
    await chrome.runtime.sendMessage(request);
    window.close();
    return;
  }
  say("Capturing…");
  $<HTMLButtonElement>("page").disabled = true;
  const answer: SnapAnswer = await chrome.runtime.sendMessage(request);
  $<HTMLButtonElement>("page").disabled = false;
  if (!answer.ok) return say(answer.reply, true);
  say("");
  show((await chrome.storage.local.get("last")).last as LastSnap | undefined);
}

$<HTMLButtonElement>("redesign").addEventListener("click", () => choose("redesign"));
$<HTMLButtonElement>("inspire").addEventListener("click", () => choose("inspiration"));
$<HTMLButtonElement>("page").addEventListener("click", () => void snap("page"));
$<HTMLButtonElement>("pick").addEventListener("click", () => void snap("pick"));
void load();
