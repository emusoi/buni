import type { Program, TermInfo } from "./terminals.ts";
import type { AccountState, BuniApi, Snapshot, SnapshotUpdate, StripApi, ThemeChoice } from "./api.ts";
import { exportSite, pageSvg } from "buni/tools/html.ts";
import { download, iconSet, pagePng, printPage, zip } from "./export.ts";

/** The file this tab shows, from its URL; none on the home screen. It changes when the tab switches to another design. */
let file = new URLSearchParams(location.search).get("file") ?? undefined;
// No window buttons to leave room for, unlike the desktop: the styles key off this.
document.documentElement.dataset.host = "web";
// Browser tabs stand in for the desktop's tab strip, so each is named for its file.
const title = () => { if (file) document.title = `${file.split("/").pop()?.replace(/\.buni$/, "")} · buni`; };
title();
const at = (path: string) => (file ? `${path}?file=${encodeURIComponent(file)}` : path);
/**
 * Opening another design: from one design to another the tab switches in place (its stream moves to the new file,
 * the window draws what it last saw of it at once); to or from the home screen, it goes to the URL.
 */
const go = (path: string | undefined, push = true) => {
  if (path === undefined || !file || !watching) {
    location.href = path === undefined ? "/" : `/?file=${encodeURIComponent(path)}`;
    return;
  }
  if (path === file) return;
  watching.close();
  file = path;
  title();
  if (push) history.pushState(null, "", `/?file=${encodeURIComponent(path)}`);
  window.dispatchEvent(new CustomEvent<string>(SWITCH, { detail: path }));
  watching = watchFile(true);
};
/** Fired on window as the tab switches designs, with the new file's path: the window shows what it has of it. */
export const SWITCH = "buni:switch";
// Back and forward move between the designs this tab switched through.
window.addEventListener("popstate", () => {
  const to = new URLSearchParams(location.search).get("file") ?? undefined;
  if (to !== file) go(to, false);
});

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(at(`/rpc/${method}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  const body: { value?: T; error?: string } = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  // ponytail: trusts our own server's shape; undefined comes back as a missing value
  return body.value as T;
}

/** The dark colours' media rule, found once, before anything changes its query. */
const darkRule = [...document.styleSheets]
  .flatMap((s) => [...s.cssRules])
  .find((r): r is CSSMediaRule => r instanceof CSSMediaRule && r.conditionText.includes("prefers-color-scheme: dark"));
// ponytail: the theme is the browser's own setting, kept per browser; follow the account when there is a server-side profile
function applyTheme(t: ThemeChoice): void {
  // The stylesheet's dark rule holds only colours, so pointing its query at always or never forces a theme.
  if (darkRule) darkRule.media.mediaText = t === "dark" ? "all" : t === "light" ? "not all" : "(prefers-color-scheme: dark)";
}
function savedTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem("buni-theme");
    // Light until the person picks Dark or System.
    return t === "light" || t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light";
  }
}
applyTheme(savedTheme());

/** A hosted buni has accounts (data-accounts names how); on this machine alone there are none. */
const accounts = document.documentElement.dataset.accounts !== undefined;
/** This tab in the file's presence list; the server drops it when the tab's feed closes. */
const TAB = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
/** The person's name for presence: from the account where there is one; the server names the machine's user otherwise. */
const myName: Promise<string> = accounts ? fetch("/auth/me").then((r) => r.json()).then((a: AccountState) => (a.state === "signed-in" ? a.person.name : ""), () => "") : Promise.resolve("");
const desktopOnly = () => Promise.reject(new Error("Only in the desktop app for now."));

/** The open file as it is now. The server leaves out `system` when it is the view itself; it's put back here. */
async function fetchSnapshot(): Promise<Snapshot | undefined> {
  const s = await call<(Omit<Snapshot, "system"> & { system?: Snapshot["system"] }) | undefined>("snapshot");
  return s && { ...s, system: s.system ?? s.view };
}
async function current(): Promise<Snapshot> {
  const s = await fetchSnapshot();
  if (!s) throw new Error("no file is open");
  return s;
}

/**
 * The open file's changes as they happen. The stream carries changes only, so the whole file is fetched, compressed,
 * each time it opens: once it's open the first time (the window's first snapshot, so no edit falls between the two),
 * and again after any reconnect, as a whole update. Changes that arrive while the first fetch is under way follow it.
 */
/** The feed's two events and a way to close it, whichever carries it. */
interface Feed { onopen: (() => void) | null; onmessage: ((e: MessageEvent<string>) => void) | null; close(): void }

/**
 * A WebSocket feed that reconnects like an EventSource does. Used when buni runs on this machine over plain HTTP: an
 * event stream there holds one of the six connections Chrome allows per host, so a seventh tab would never load.
 */
function socketFeed(path: string): Feed {
  const feed: Feed = { onopen: null, onmessage: null, close: () => { closed = true; ws.close(); } };
  let closed = false;
  let ws: WebSocket;
  const connect = () => {
    ws = new WebSocket(new URL(path, location.href.replace(/^http/, "ws")));
    ws.onopen = () => feed.onopen?.();
    ws.onmessage = (e: MessageEvent<string>) => feed.onmessage?.(e);
    // A server restart drops it: try again shortly, as an EventSource would.
    ws.onclose = () => { if (!closed) setTimeout(connect, 1000); };
  };
  connect();
  return feed;
}

/** The feed as an event stream: on an HTTPS host, served over HTTP/2, where streams share one connection. */
function streamFeed(path: string): Feed {
  const es = new EventSource(path);
  const feed: Feed = { onopen: null, onmessage: null, close: () => es.close() };
  es.onopen = () => feed.onopen?.();
  es.onmessage = (e: MessageEvent<string>) => feed.onmessage?.(e);
  return feed;
}

function watchFile(switched = false) {
  const events = location.protocol === "http:" ? socketFeed(`${at("/events")}&tab=${TAB}`) : streamFeed(`${at("/events")}&tab=${TAB}`);
  let waiting: SnapshotUpdate[] | undefined = [];
  let opens = 0;
  let build: string | undefined;
  // A fulfilled promise retains its value; hand off the design separately and release it.
  const first = Promise.withResolvers<void>();
  let initial: Snapshot | undefined;
  events.onopen = () => {
    opens++;
    if (opens === 1 && switched) {
      // A design switched to in the tab: the fresh snapshot replaces what the window drew from its cache.
      waiting = undefined;
      void fetchSnapshot().then((snap) => snap && listeners.forEach((fn) => fn({ kind: "whole", snap })), () => undefined);
    } else if (opens === 1) {
      fetchSnapshot().then((snap) => {
        initial = snap;
        first.resolve();
        // After the window has taken the snapshot, the changes made since it was read.
        setTimeout(() => {
          const queued = waiting ?? [];
          waiting = undefined;
          for (const u of queued) listeners.forEach((fn) => fn(u));
        });
      }, first.reject);
    } else {
      void fetchSnapshot().then((snap) => snap && listeners.forEach((fn) => fn({ kind: "whole", snap })), () => undefined);
    }
    // The stream reconnects on its own after a server restart; new server code means this page is stale.
    void call<string>("build").then((b) => {
      if (build !== undefined && b !== build) location.reload();
      build = b;
    }, () => undefined);
  };
  events.onmessage = (e: MessageEvent<string>) => {
    const u: SnapshotUpdate = JSON.parse(e.data);
    if (waiting) waiting.push(u);
    else listeners.forEach((fn) => fn(u));
  };
  return {
    first: async () => {
      await first.promise;
      const snap = initial;
      initial = undefined;
      return snap;
    },
    close: () => events.close(),
  };
}
/** Who hears the open file's changes; they stay as the tab switches designs. */
const listeners = new Set<(u: SnapshotUpdate) => void>();
let watching = file ? watchFile() : undefined;
let firstServed = false;
const stem = (s: Snapshot) => s.path.split("/").pop()?.replace(/\.buni$/, "") ?? "buni";
/** Where the file's images are served, for drawing its pages. */
const assets = (s: Snapshot) => `${location.origin}/files${s.dir.split("/").map(encodeURIComponent).join("/")}/`;
/** Downloads go where the browser puts them; the toast names the file. */
const saved = (name: string, blob: Blob) => {
  download(name, blob);
  return { path: `Downloads/${name}` };
};
const none = () => () => {};

const base64 = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/** A .buni file the person picks, with any images it uses picked alongside, copied into the server's files. */
function pickFile(): Promise<void> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple: true });
    input.addEventListener("cancel", () => resolve());
    input.addEventListener("change", () => {
      const picked = [...(input.files ?? [])];
      const doc = picked.find((f) => f.name.endsWith(".buni"));
      if (!doc) return reject(new Error("Pick a .buni file, and the images it uses if it has any."));
      const open = async () => {
        const assets = await Promise.all(picked.filter((f) => f !== doc).map(async (f) => ({ name: f.name, base64: await base64(f) })));
        go(await call<string>("import", doc.name, await doc.text(), assets));
      };
      void open().then(resolve, reject);
    });
    input.click();
  });
}

const api: BuniApi = {
  readImportResource: (url, pageUrl) => call("readImportResource", url, pageUrl),
  snapshot: () => {
    if (!watching || firstServed) return fetchSnapshot();
    firstServed = true;
    return watching.first();
  },
  onChange: (fn) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  home: () => call("home"),
  project: () => call("project"),
  ...(accounts ? {
    spaces: async () => (await fetch("/spaces")).json(),
    agentToken: async (name: string) => {
      const res = await fetch("/auth/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const body: { token?: string; error?: string } = await res.json();
      if (!res.ok || typeof body.token !== "string") throw new Error(body.error ?? "The token could not be made");
      return body.token;
    },
  } : {}),
  documents: (paths) => call("documents", paths),
  open: async (path) => (path === undefined ? pickFile() : go(path)),
  create: async (name, options) => go(await call<string>("create", name ?? "Untitled", options)),
  close: async () => go(undefined),
  renameFile: (path, name) => call("renameFile", path, name),
  removeFile: (path) => call("removeFile", path),
  downloadFile: async () => {
    const name = `${file?.split("/").pop() ?? "design.buni"}`;
    return saved(name, new Blob([await call<string>("fileText")], { type: "application/json" }));
  },
  ...(accounts ? {} : { noAccounts: true as const }),
  assetBase: `${location.origin}/files`,
  movePage: (page, x, y) => call("movePage", page, x, y),
  reorderPage: (page, after) => call("reorderPage", page, after),
  edit: (tool, args) => call("edit", tool, args),
  undo: () => call("undo"),
  redo: () => call("redo"),
  onUndoKey: (fn) => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      fn(e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  },
  openExample: async () => go(await call<string>("openExample")),
  exportSite: async () => {
    const s = await current();
    const files = exportSite(s.view, (await import("buni/tools/fontdata.ts")).embeddedFont);
    const name = `${stem(s)} site.zip`;
    download(name, zip(files));
    return { dir: `Downloads/${name}`, files: files.size };
  },
  exportPage: async (pageId, as) => {
    const s = await current();
    const page = s.view.pages[pageId];
    if (!page) throw new Error("exportPage expects a page");
    const name = page.name.replace(/[/\\:*?"<>|]+/g, "-").trim() || "page";
    if (as.format === "svg") {
      const svg = pageSvg(s.view, page.id, (await import("buni/tools/fontdata.ts")).embeddedFont);
      if (!svg) throw new Error("only a graphic made of one svg can be saved as SVG");
      return saved(`${name}.svg`, new Blob([svg], { type: "image/svg+xml" }));
    }
    if (as.format === "png") return saved(`${name}${as.scale === 2 ? "@2x" : ""}.png`, await pagePng(s.view, page.id, assets(s), as.scale));
    if (as.format === "icons") return saved(`${name} icons.zip`, await iconSet(s.view, page.id, assets(s)));
    await printPage(s.view, page.id, assets(s));
    return undefined;
  },
  saveVersion: (name) => call("saveVersion", name),
  answer: (id, text) => call("answer", id, text),
  pauseAgent: (name, paused) => call("pauseAgent", name, paused),
  tellAgent: (name, text) => call("tellAgent", name, text),
  changes: () => call("changes"),
  commit: (message, push) => call("commit", message, push),
  versions: () => call("versions"),
  uploadImage: (name, base64, mime) => call("uploadImage", name, base64, mime),
  restoreVersion: (id) => call("restoreVersion", id),
  // Hosted, the page only loads signed in: signing in happens on the sign-in page before it.
  account: async () => (accounts ? (await fetch("/auth/me")).json() : { state: "signed-out" }),
  onAccount: none,
  signIn: async () => location.assign("/signin"),
  cancelSignIn: async () => {},
  openSignIn: async () => {},
  signOut: async () => {
    await fetch("/auth/signout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    location.assign("/");
  },
  openAccountPage: async () => {
    const a: AccountState = await window.buni.account();
    if (a.state === "signed-in") window.open(`${a.server}/files/settings/account.settings`, "_blank", "noopener");
  },
  tab: TAB,
  presence: async (page, node) => { if (file) await call("presence", TAB, await myName, page, node); },
  theme: async () => savedTheme(),
  setTheme: async (t) => {
    applyTheme(t);
    try {
      localStorage.setItem("buni-theme", t);
    } catch {
      // Storage blocked: the choice holds until the tab closes.
    }
  },
  skills: () => call("skills"),
  skill: (name) => call("skill", name),
  inspiration: () => call("inspiration"),
  sendMarks: (page) => call("sendMarks", page),
  sendViewMarks: (view) => call("sendViewMarks", view),
  // Terminals run on the Mac that runs buni open; a hosted buni has none.
  ...(accounts || location.protocol !== "http:" ? {} : {
    terminals: {
      list: () => fetch(at("/terms")).then((r) => r.json()).then((j: { sessions: TermInfo[] }) => j.sessions),
      start: (program: Program, cols: number, rows: number, ask?: string) =>
        fetch(at("/terms"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ program, cols, rows, ask }) })
          .then((r) => r.json())
          .then((j: { session?: TermInfo; error?: string }) => {
            if (!j.session) throw new Error(j.error ?? "The terminal didn't start");
            return j.session;
          }),
      close: (id: string) => fetch(at("/terms/close"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).then(() => undefined),
      socket: (id: string) => new URL(`${at("/term")}&id=${encodeURIComponent(id)}`, location.href.replace(/^http/, "ws")).href,
    },
  }),
  // A hosted buni has no cable: tablets plug into the Mac that runs buni open.
  ...(accounts ? {} : {
    tablets: () => call("tablets"),
    openOnTablet: (serial: string) => call("openOnTablet", serial),
    installTabletApp: (serial: string) => call("installTabletApp", serial),
    devices: () => call("devices"),
    forgetDevice: (id: string) => call("forgetDevice", id),
  }),
};
window.buni = api;

// ponytail: one file at a time on the web, so the tab strip stays empty
const tabs: StripApi = { onTabs: none, select: async () => {}, close: async () => {}, newTab: async () => {}, move: async () => {} };
window.tabs = tabs;
