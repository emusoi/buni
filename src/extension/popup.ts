// The popup: which buni editor and design to snap into, then the whole page or a part the person picks.
import type { SnapAnswer, SnapRequest } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // ponytail: the ids are in popup.html
const server = $<HTMLInputElement>("server"), file = $<HTMLSelectElement>("file"), name = $<HTMLInputElement>("name"), status = $<HTMLParagraphElement>("status");
const say = (text: string, error = false) => { status.textContent = text; status.className = error ? "error" : ""; };

/** The editor's address from what was pasted (its link, with the design it had open), or undefined. */
function editor(text: string): { origin: string; file?: string } | undefined {
  try {
    const u = new URL(text.trim());
    if (!["localhost", "127.0.0.1"].includes(u.hostname)) return undefined;
    const open = u.searchParams.get("file");
    return { origin: u.origin, ...(open ? { file: open } : {}) };
  } catch { return undefined; }
}

async function connect(): Promise<void> {
  const at = editor(server.value);
  file.disabled = true;
  if (!at) { file.innerHTML = "<option>Paste the editor’s link, http://localhost:…</option>"; return; }
  try {
    const list: unknown = await (await fetch(`${at.origin}/snap`)).json();
    if (!Array.isArray(list)) throw new Error("not a buni editor");
    const saved = (await chrome.storage.local.get("file")).file;
    file.replaceChildren(...list.flatMap((d: unknown) => {
      if (typeof d !== "object" || d === null || !("path" in d) || typeof d.path !== "string") return [];
      const o = document.createElement("option");
      o.value = d.path;
      o.textContent = "name" in d && typeof d.name === "string" ? d.name : d.path;
      o.selected = d.path === (at.file ?? saved);
      return [o];
    }));
    file.disabled = file.options.length === 0;
    await chrome.storage.local.set({ server: server.value.trim() });
    say(file.disabled ? "That editor has no designs yet." : "");
  } catch {
    say("No buni editor answers there. Is buni open running?", true);
  }
}

async function snap(mode: "page" | "pick"): Promise<void> {
  const at = editor(server.value);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!at || file.disabled || !tab?.id) return say("Connect to a buni editor first.", true);
  await chrome.storage.local.set({ file: file.value });
  const request: SnapRequest = { tabId: tab.id, mode, server: at.origin, file: file.value, name: name.value.trim() };
  if (mode === "pick") {
    // The popup closes as the person clicks the page; the background finishes and opens buni.
    void chrome.runtime.sendMessage(request);
    window.close();
    return;
  }
  say("Snapping…");
  $<HTMLButtonElement>("page").disabled = true;
  const answer: SnapAnswer = await chrome.runtime.sendMessage(request);
  $<HTMLButtonElement>("page").disabled = false;
  say(answer.ok ? "Snapped. buni opened in a new tab." : answer.reply, !answer.ok);
}

server.addEventListener("change", () => void connect());
$<HTMLButtonElement>("page").addEventListener("click", () => void snap("page"));
$<HTMLButtonElement>("pick").addEventListener("click", () => void snap("pick"));
void chrome.storage.local.get("server").then((s) => { if (typeof s.server === "string") { server.value = s.server; void connect(); } });
