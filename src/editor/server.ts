/// <reference path="./raw.d.ts" />
import { readImportResource } from "./import-resource.ts";
import { restoreVersion, saveVersion, versionsOf } from "buni/tools/versions.ts";
import { checkImage } from "buni/tools/assets.ts";
import { fontSlug } from "buni/tools/html.ts";
import { FONT_FAMILIES } from "buni/tools/fonts.gen.ts";
import { homedir, tmpdir, userInfo } from "node:os";
import { allowedCall, allowedOrigin, EXTENSION_ORIGIN, isDesignFile, isDesignPath, localOrigins } from "./guard.ts";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { renderHeadless } from "buni/term/render.ts";
import { basename, dirname, join, resolve } from "node:path";
import { emptyDoc, pagesInOrder, type Doc } from "buni/format/doc.ts";
import { parseDoc } from "buni/format/parse.ts";
import { diffDoc } from "buni/format/patch.ts";
import { serializeDoc } from "buni/format/serialize.ts";
import { Workspace } from "buni/tools/workspace.ts";
import { ProjectIndex, summaries, withImportsFrom } from "./project.ts";
import { allPatterns } from "../tools/inspiration.ts";
import { EDIT_TOOLS, type HomeFile, type Snapshot, type SnapshotUpdate } from "./api.ts";
import type { Asking, Presence } from "buni/tools/protocol.ts";
import { gitCommit, gitStatus } from "./git.ts";
import { loadSkills, readSkill } from "buni/skills/skills.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "buni/mcp/server.ts";
import { pageOfNode } from "./renderer/search.ts";

import { DiskStore, within, type EditorStore } from "./store.ts";
import { buildAssets, page, serveAsset, type Built } from "./assets.ts";
import { editorHtml } from "./page.ts";
import { embeddedFont } from "../tools/fontdata.ts";
import example from "../../examples/portal.buni" with { type: "text" };
import exampleImage from "../../examples/assets/steel-rack.jpg" with { type: "file" };
import exampleNotes from "../../examples/assets/usability-0917.md" with { type: "file" };
import { keepBrowserWarm } from "buni/term/chrome.ts";
import { DEVICE_COOKIE, Tablets } from "./usb.ts";
import { marksOn, marksOnFlow, marksOnView, sketchesOpen } from "buni/tools/ink.ts";
import { pageTag, tabletCanvas, tabletDesign, tabletPages } from "./tablet-api.ts";
import { captureDocument, captureShot, type Shot } from "buni/term/capture.ts";
import { ARCH_COLLECTIONS, architectureOf, INK_VIEWS, type InkView } from "buni/format/doc.ts";
import type { Device } from "./usb.ts";
import { spawn } from "node:child_process";

export interface EditorOptions {
  store: EditorStore;
  origin: string;
  localFile?: string;
  assets?: () => Built;
  /** Tablets on a USB cable: only `buni open` on this machine offers them. */
  tablets?: Tablets;
}

/** The same editor and design API, with the host choosing storage and who may reach it. */
/** A place designs live, as the host names it: an MCP client connected to /mcp without a file may roam these. */
export interface SpaceRoot { root: string; name: string }

export interface Editor {
  /** `spaces`: for /mcp without a file, the spaces the client may list, use and create designs in; `dir` alone otherwise. */
  fetch(req: Request, dir?: string, spaces?: readonly SpaceRoot[]): Promise<Response>;
  /** The design a WebSocket upgrade for the live feed may watch, or undefined when it isn't allowed. */
  socketFile(req: Request, dir?: string): string | undefined;
  /** A request on the listener only a tablet on the cable reaches; everything a tablet may do goes through here. */
  tabletFetch(req: Request, dir?: string): Promise<Response>;
  /** The design a tablet's WebSocket may watch, or undefined. */
  tabletSocket(req: Request, dir?: string): string | undefined;
  /** Sends `file`'s changes to `send` as they happen; returns how to stop. */
  watch(file: string, send: (data: string) => void, tab?: string): Promise<() => void>;
  /** Calls `fn` on each change to `file`, without counting as a tab; returns how to stop. */
  onChange(file: string, fn: () => void): Promise<() => void>;
  /** The file as it would be written now. */
  text(file: string): Promise<string>;
  stop(): void;
}

export async function createEditor(options: EditorOptions): Promise<Editor> {
  const { store, origin } = options;
  const LOCAL = options.localFile;
  const disk = LOCAL && store instanceof DiskStore ? store : undefined;
  const DIR = "/designs";
  const LOCAL_PATH = LOCAL ? `${DIR}/${basename(dirname(LOCAL))}/${basename(LOCAL)}` : undefined;
  const address = new URL(origin);
  const loopback = address.hostname === "localhost" || address.hostname === "127.0.0.1";
  const HOSTS = loopback ? new Set([`localhost:${address.port}`, `127.0.0.1:${address.port}`]) : new Set([address.host]);
  const OWN = loopback ? localOrigins(Number(address.port)) : new Set([origin]);
  const assets: () => Built = options.assets ?? await buildAssets().then((built) => () => built);
  /** A file some tab has open, and the tabs listening to it. */
  interface Open {
    ws: Workspace;
    listeners: Set<() => void>;
    /** Coding agents' MCP sessions on this file, by session id, with the server each talks to. */
    mcp: Map<string, { transport: WebStandardStreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer>; seen: number }>;
    /** Agents' questions waiting on the person, each with how to hand back the answer. */
    asking: Map<string, Asking & { answer: (text: string | undefined) => void }>;
    /** The tabs on the file and where each person is, by tab; gone when the tab's feed closes. */
    present: Map<string, Presence>;
  }
  /** This run of the server: a tab that reconnects to a different one reloads, so it never runs yesterday's code. */
  const BUILD = Date.now().toString(36);
  // ponytail: an opened file stays loaded until the server stops; evict idle ones if memory matters
  const opened = new Map<string, Promise<Open>>();
  /** The project's designs, parsed once: what Home, lists and pickers read. */
  const index = new ProjectIndex(store);
  /** The .live markers this server wrote, removed when it stops. */
  const lives = new Set<string>();

  function load(path: string): Promise<Open> {
    let o = opened.get(path);
    if (!o) {
      o = Workspace.open(path, within(store, dirname(dirname(path)), loopback && store.localImports === true)).then(async (ws) => {
        const file: Open = { ws, listeners: new Set(), mcp: new Map(), asking: new Map(), present: new Map() };
        if (disk) {
          // On disk, buni open shows who is editing, and the buni command and coding agents send their edits here
          // (through <file>.live) so this editor stays the one writer of the file.
          await ws.shareActivity();
          const live = `${disk.real(path)}.live`;
          await writeFile(live, `${JSON.stringify({ pid: process.pid, mcp: mcpUrl(path) })}\n`, "utf8");
          lives.add(live);
        }
        ws.onChange(() => {
          file.listeners.forEach((fn) => fn());
          // A core file changed: the open files built on it draw its components and tokens afresh.
          for (const [other, o] of opened) if (other !== path) void o.then(async (x) => { if (x.ws.imports().some((f) => f.path === path)) { await x.ws.refreshImports(); x.listeners.forEach((fn) => fn()); } }, () => undefined);
        });
        return file;
      });
      // A file that failed to open is tried again next time.
      o.catch(() => opened.delete(path));
      opened.set(path, o);
    }
    return o;
  }

  const mcpUrl = (path: string) => `${origin}/mcp?file=${encodeURIComponent(path)}`;
  const snapshot = ({ ws, mcp, asking, present }: Open): Snapshot => ({
    asking: [...asking.values()].map(({ answer: _answer, ...q }) => q),
    present: [...present.values()],
    path: ws.path, dir: dirname(ws.path), view: ws.view(), system: ws.system(), owners: ws.owners(), recent: ws.recent(), mcpUrl: mcpUrl(ws.path),
    // An agent that quits or crashes rarely says so: one heard from in the last ten minutes counts as here.
    // ponytail: "gone" shows on the next change after that, not the moment it lapses
    edits: ws.edits(),
    connected: [...new Set([...mcp.values()].filter((m) => Date.now() - m.seen < 10 * 60_000).map((m) => m.server.server.getClientVersion()?.name ?? "agent"))],
  });

  /** Coding agents edit the file through MCP here; their edits reach every tab like the person's own. */
  /**
   * The design as it was when an agent started a stretch of work, kept as a version: Versions can take back a whole
   * session at once. A stretch ends after ten quiet minutes; the buni command's calls, each a session of its own,
   * count as one stretch.
   */
  /** An agent's question, shown in every tab of the design until someone answers it or ten minutes pass. */
  function askPerson(o: Open, author: string, q: { question: string; options: string[]; node?: string }): Promise<string | undefined> {
    const id = crypto.randomUUID();
    const tell = () => o.listeners.forEach((fn) => fn());
    return new Promise((resolve) => {
      const timer = setTimeout(() => answer(undefined), 10 * 60_000);
      const answer = (text: string | undefined) => {
        clearTimeout(timer);
        if (!o.asking.delete(id)) return;
        tell();
        resolve(text);
      };
      o.asking.set(id, { id, author, ...q, answer });
      tell();
    });
  }

  const lastEdit = new Map<string, number>();
  function keepBefore(o: Open, author: string, before: Doc): void {
    const key = `${o.ws.path} ${author}`, now = Date.now(), last = lastEdit.get(key) ?? 0;
    lastEdit.set(key, now);
    if (now - last < 10 * 60_000) return;
    void saveVersion(store, o.ws, `Before ${author}'s changes`, author, before).then(() => o.listeners.forEach((fn) => fn()), () => undefined);
  }

  async function mcp(file: string, req: Request): Promise<Response> {
    const o = await load(file);
    const body: unknown = req.method === "POST" ? await req.json() : undefined;
    const sid = req.headers.get("mcp-session-id");
    let t = sid ? o.mcp.get(sid)?.transport : undefined;
    // Tabs hear when an agent joins or leaves, so the editor can show who is connected.
    const tell = () => o.listeners.forEach((fn) => fn());
    if (!t && req.method === "POST" && isInitializeRequest(body)) {
      // Screenshots use the browser available to this host.
      const server = createMcpServer(o.ws, { screenshot: (page, marks) => renderAway(o, page, marks), edited: (author, before) => keepBefore(o, author, before), ask: (author, q) => askPerson(o, author, q) });
      const made = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => void o.mcp.set(id, { transport: made, server, seen: Date.now() }) });
      made.onclose = () => {
        if (made.sessionId) o.mcp.delete(made.sessionId);
        tell();
      };
      await server.connect(made);
      const res = await made.handleRequest(req, { parsedBody: body });
      tell();
      return res;
    }
    if (!t) return Response.json({ error: "start with an initialize request" }, { status: 400 });
    const session = sid ? o.mcp.get(sid) : undefined;
    if (session) session.seen = Date.now();
    return t.handleRequest(req, { parsedBody: body });
  }

  /** MCP sessions connected to spaces rather than one design, by session id. */
  const roaming = new Map<string, { transport: WebStandardStreamableHTTPServerTransport; seen: number }>();

  /**
   * An MCP client on the person's spaces: it lists their designs, picks one and works on it, or starts one. While it
   * is on a design, that design's tabs see it as connected, and its edits land there as any agent's do.
   */
  async function mcpSpaces(req: Request, spaces: readonly SpaceRoot[]): Promise<Response> {
    const body: unknown = req.method === "POST" ? await req.json() : undefined;
    const sid = req.headers.get("mcp-session-id");
    const known = sid ? roaming.get(sid) : undefined;
    if (!known && req.method === "POST" && isInitializeRequest(body)) {
      let on: Open | undefined;
      let session = "";
      const entry = { transport: undefined as unknown as WebStandardStreamableHTTPServerTransport, server: undefined as unknown as ReturnType<typeof createMcpServer>, seen: Date.now() };
      const list = async () => {
        const out: { space: string; name: string; path: string; pages: number }[] = [];
        for (const sp of spaces) for (const [path, d] of await index.docs(sp.root)) out.push({ space: sp.name, name: basename(path, ".buni"), path, pages: Object.keys(d.doc.pages).length });
        return out;
      };
      const moveTo = async (path: string) => {
        const o = await load(path);
        if (on && on !== o) { on.mcp.delete(session); on.listeners.forEach((fn) => fn()); }
        on = o;
        if (session) { o.mcp.set(session, entry); o.listeners.forEach((fn) => fn()); }
        return o.ws;
      };
      const server = createMcpServer(undefined, {
        screenshot: async (page, marks, ws) => renderAway(await load(ws.path), page, marks),
        edited: (author, before, ws) => void load(ws.path).then((o) => keepBefore(o, author, before)),
        ask: async (author, q, ws) => askPerson(await load(ws.path), author, q),
        designs: {
          list,
          use: moveTo,
          create: async (name, space) => {
            const sp = space === undefined ? spaces[0] : spaces.find((x) => x.name === space) ?? spaces.find((x) => x.name.toLowerCase() === space.toLowerCase());
            if (!sp) throw new Error(`No space "${space}"; you have: ${spaces.map((x) => x.name).join(", ")}`);
            const path = await freePath(name, sp.root);
            await store.write(path, serializeDoc(emptyDoc()));
            return moveTo(path);
          },
        },
      });
      const made = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => { session = id; roaming.set(id, entry); } });
      entry.transport = made;
      entry.server = server;
      made.onclose = () => {
        if (session) roaming.delete(session);
        if (on) { on.mcp.delete(session); on.listeners.forEach((fn) => fn()); }
      };
      await server.connect(made);
      return made.handleRequest(req, { parsedBody: body });
    }
    if (!known) return Response.json({ error: "start with an initialize request" }, { status: 400 });
    known.seen = Date.now();
    return known.transport.handleRequest(req, { parsedBody: body });
  }

  /**
   * A file name the person typed, as a path of its own that isn't taken yet. Each file gets its own
   * folder, so the images beside it never collide with another file's.
   */
  async function freePath(name: string, dir: string, beside?: string): Promise<string> {
    // Letters, digits, spaces and dashes only: a name never reaches another folder.
    const stem = name.trim().replace(/\.buni$/, "").replace(/[^\w -]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
    if (LOCAL_PATH) {
      // On disk, a new design joins the project of the one open (else the one buni started with), in the folder they share.
      const files = new Set((await store.list(dir)).map((f) => f.path));
      const near = beside && files.has(beside) ? beside : LOCAL_PATH;
      for (let n = 1; ; n++) {
        const p = join(dirname(near), `${n === 1 ? stem : `${stem} ${n}`}.buni`);
        if (!files.has(p)) return p;
      }
    }
    const taken = new Set((await store.list(dir)).map((f) => dirname(f.path)));
    for (let n = 1; ; n++) {
      const s = n === 1 ? stem : `${stem} ${n}`;
      if (!taken.has(join(dir, s))) return join(dir, s, `${s}.buni`);
    }
  }

  /** Where an attachment of the file at `path` lives; never outside the file's folder. */
  function besideFile(path: string, rel: string): string {
    const target = join(dirname(path), rel);
    if (!target.startsWith(`${dirname(path)}/`)) throw new Error(`attachment path "${rel}" leaves the file's folder`);
    return target;
  }

  /** Copies in a new file with whichever of its attachments came with it, matched by file name. */
  async function addFile(name: string, text: string, assets: (name: string) => Promise<Uint8Array | undefined>, dir: string): Promise<string> {
    const r = parseDoc(text, { refs: false });
    if (!r.ok) throw new Error(`${name} is not a valid .buni file`);
    const path = await freePath(name, dir);
    for (const a of Object.values(r.doc.attachments)) {
      const bytes = await assets(basename(a.path));
      if (bytes) await store.writeBytes(besideFile(path, a.path), bytes);
    }
    await store.write(path, text);
    return path;
  }

  /** "claude-code is editing Payment": who is connected to a file right now and where they last worked; undefined when no one is. */
  async function working(path: string): Promise<string | undefined> {
    const o = await opened.get(path)?.catch(() => undefined);
    const [name, ...others] = o ? snapshot(o).connected ?? [] : [];
    if (!o || !name) return undefined;
    const at = o.ws.recent()[name]?.[0];
    const page = at ? o.ws.view().pages[pageOfNode(o.ws.view(), at) ?? ""]?.name : undefined;
    const more = others.length ? ` and ${others.length} more` : "";
    return page ? `${name} is editing ${page}${more}` : `${name} is connected${more}`;
  }

  async function home(dir: string): Promise<HomeFile[]> {
    // From the index: a design is read and parsed only when it changed, and drawn with its imports from the others.
    const indexed = await index.docs(dir);
    const files = [...indexed].map(([path, f]) => ({ path, modified: f.modified })).sort((a, b) => b.modified.getTime() - a.modified.getTime());
    const notes = await Promise.all(files.map((f) => working(f.path)));
    const docs = files.map(({ path }) => withImportsFrom(indexed, path));
    return files.flatMap(({ path, modified }, i) => {
      const doc = docs[i];
      if (!doc) return [];
      const first = pagesInOrder(doc)[0];
      const agentNote = notes[i];
      // Every file has a folder of its own, so they're shown together rather than one folder each.
      // Hosted, every design has a folder of its own, so they're shown together; on disk, by the folder they're in.
      return [{ path, name: basename(path, ".buni"), folder: LOCAL ? dirname(path) : dir, modified: modified.toISOString(), pages: Object.keys(doc.pages).length, doc, ...(first ? { preview: first.id } : {}), ...(agentNote ? { agentNote } : {}) }];
    });
  }

  /** A file the browser sent along with a .buni file, by name, its bytes as base64. */
  interface Upload {
    name: string;
    base64: string;
  }
  const isUpload = (v: unknown): v is Upload => typeof v === "object" && v !== null && "name" in v && typeof v.name === "string" && "base64" in v && typeof v.base64 === "string";

  const str = (v: unknown, what: string): string => {
    if (typeof v !== "string") throw new Error(`${what} expects text`);
    return v;
  };

  /** An edit by the person in the tab; a refused one is an error the window shows. */
  async function act(file: string | undefined, tool: "move_page" | "reorder_page", args: Record<string, unknown>): Promise<void> {
    const r = await (await need(file)).call("you", tool, args);
    if (!r.ok) throw new Error(r.reply);
  }
  async function need(file: string | undefined): Promise<Workspace> {
    if (!file) throw new Error("no file is open");
    return (await load(file)).ws;
  }


  /**
   * A page drawn for an agent with the Chromium beside the server (BUNI_CHROME), from a copy of the design on disk.
   * ponytail: images the design uploaded aren't copied alongside, so they draw as empty boxes.
   */
  let drawing: Promise<unknown> = Promise.resolve();
  /**
   * One draw at a time. Tabs of the one warm browser drawing at once come out wrong (a page's top repeated down it),
   * and a burst of agent screenshots shouldn't start a browser each.
   */
  function queued<T>(work: () => Promise<T>): Promise<T> {
    const next = drawing.then(work);
    drawing = next.catch(() => undefined);
    return next;
  }
  function renderAway(o: Open, page: string, marks = false): Promise<string> {
    return queued(() => onDisk(o, async (file, dir) => {
      // The agent reads layout and type at 1×; 2× sends four times the pixels for nothing it can use.
      const out = join(dir, "page.png");
      const r = await renderHeadless({ file, page, out, format: "png", scale: 1, ...(marks ? { marks } : {}) }, undefined);
      if (!r.ok) throw new Error(r.text);
      return (await readFile(out)).toString("base64");
    }));
  }
  /** A page for the tablet: its picture, how tall it is, and where its layers sit, so links start where they're tapped. */
  function shootAway(o: Open, page: string): Promise<Shot> {
    return queued(() => onDisk(o, async (file) => captureShot(await captureDocument(file, page))));
  }

  /**
   * `work` on the design as a file. A design on this disk is drawn where it is (every edit is already written), so its
   * images are found; one in a store is copied out, laid out as on disk with its imports beside it, so relative imports
   * resolve.
   */
  async function onDisk<T>(o: Open, work: (file: string, dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "buni-draw-"));
    try {
      const file = disk ? disk.real(o.ws.path) : join(dir, o.ws.path);
      if (!disk) for (const f of [{ path: o.ws.path, doc: o.ws.view() }, ...o.ws.imports()]) {
        await mkdir(dirname(join(dir, f.path)), { recursive: true });
        await writeFile(join(dir, f.path), serializeDoc(f.doc), "utf8");
      }
      return await work(file, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }


  /**
   * What the browser can ask for, by name, for the file in its URL; arguments come as a JSON list and are checked here.
   * `dir` is the caller's designs: files are made, listed, renamed and removed only there.
   */
  const rpcFor = (dir: string): Record<string, (file: string | undefined, ...args: unknown[]) => Promise<unknown>> => ({
    snapshot: async (file) => {
      if (!file) return undefined;
      const o = await load(file);
      // A tab opening the file reads its imports again: a core may have been edited outside this server.
      await o.ws.refreshImports();
      const s = snapshot(o);
      // Usually `system` is the view itself; sent once, the tab puts it back (bridge.ts).
      return s.system === s.view ? { ...s, system: undefined } : s;
    },
    build: async () => BUILD,
    home: () => home(dir),
    /** The project's designs as summaries: what lists and pickers need, not their documents. */
    project: async () => {
      const indexed = await index.docs(dir);
      const notes = await Promise.all([...indexed.keys()].map(async (p) => [p, await working(p)] as const));
      const note = new Map(notes);
      return summaries(indexed, (p) => (LOCAL ? dirname(p) : dir)).map((f) => ({ ...f, ...(note.get(f.path) ? { agentNote: note.get(f.path) } : {}) }));
    },
    /** Designs in full, each with its imports, for Play and flows across the project; only those asked for. */
    documents: async (_file, paths) => {
      if (!Array.isArray(paths)) throw new Error("documents expects a list of paths");
      const indexed = await index.docs(dir);
      return Object.fromEntries(paths.filter((p): p is string => typeof p === "string").flatMap((p) => { const d = withImportsFrom(indexed, p); return d ? [[p, d]] : []; }));
    },
    /** A .buni file the person picked in the browser, with the images it uses, copied in; returns where it now lives. */
    import: async (_file, name, text, assets) => {
      const given = new Map(Array.isArray(assets) ? assets.filter(isUpload).map((a) => [a.name, a.base64] as const) : []);
      return addFile(str(name, "import"), str(text, "import"), async (n) => {
        const b64 = given.get(n);
        return b64 === undefined ? undefined : Uint8Array.fromBase64(b64);
      }, dir);
    },
    /**
     * A design mirrored from a machine where `buni open` runs: the one here with that name takes the text as one
     * change (so tabs on it follow), with whichever attachments came along; a name not here yet is added.
     */
    sync: async (_file, name, text, assets) => {
      const given = new Map(Array.isArray(assets) ? assets.filter(isUpload).map((a) => [a.name, a.base64] as const) : []);
      const bytes = async (n: string) => { const b64 = given.get(n); return b64 === undefined ? undefined : Uint8Array.fromBase64(b64); };
      const want = str(name, "sync");
      const existing = [...(await index.docs(dir)).keys()].find((p) => basename(p, ".buni") === want);
      if (!existing) return addFile(want, str(text, "sync"), bytes, dir);
      const r = parseDoc(str(text, "sync"), { refs: false });
      if (!r.ok) throw new Error(`${want} is not a valid .buni file`);
      for (const a of Object.values(r.doc.attachments)) {
        const b = await bytes(basename(a.path));
        if (b) await store.writeBytes(besideFile(existing, a.path), b);
      }
      const res = await (await load(existing)).ws.restore("sync", "Synced from the machine it is edited on", r.doc);
      if (!res.ok) throw new Error(res.reply);
      return existing;
    },
    create: async (file, name, options) => {
      // From Home: beside a design of the chosen project, building on the design it names as its core.
      const opts = typeof options === "object" && options !== null ? options : {};
      const beside = "beside" in opts && typeof opts.beside === "string" && isDesignFile(opts.beside, dir) ? opts.beside : undefined;
      const core = "core" in opts && typeof opts.core === "string" && isDesignFile(opts.core, dir) ? opts.core : undefined;
      const path = await freePath(str(name, "create"), dir, beside ?? file);
      const doc = emptyDoc();
      if (core && dirname(core) === dirname(path)) doc.imports = [basename(core)];
      // A new section of a project builds on what the open design does: its imports, and the design itself when it
      // has components (a core, maybe with a page showing them off); so it starts with the project's tokens and components.
      const from = typeof file === "string" && isDesignFile(file, dir) ? await opened.get(file)?.then((o) => o.ws.view(), () => undefined) : undefined;
      if (from && dirname(file ?? "") === dirname(path)) {
        const core = Object.keys(from.shared).length > 0;
        const imports = [...(from.imports ?? []), ...(core ? [basename(file ?? "")] : [])];
        if (imports.length) doc.imports = [...new Set(imports)];
      }
      await store.write(path, serializeDoc(doc));
      return path;
    },
    openExample: async () => {
      const path = join(dir, "Example", "Example.buni");
      // An existing copy keeps whatever was tried in it.
      if (await store.read(path).then(() => true, () => false)) return path;
      const text = example;
      const files = new Map([["steel-rack.jpg", exampleImage], ["usability-0917.md", exampleNotes]]);
      return addFile("Example", text, async (n) => {
        const f = files.get(n);
        return f && (await Bun.file(f).exists()) ? Bun.file(f).bytes() : undefined;
      }, dir);
    },
    renameFile: async (_file, from, name) => {
      const old = str(from, "renameFile");
      if (!isDesignPath(old, dir) || !(await store.list(dir)).some((f) => f.path === old)) throw new Error("No such design");
      const fresh = await freePath(str(name, "renameFile"), dir);
      // The whole folder moves, images and all; then the file itself takes the new name.
      await store.moveDir(dirname(old), dirname(fresh));
      const moved = join(dirname(fresh), basename(old));
      if (moved !== fresh) {
        for (const [m, f] of [[moved, fresh], [`${moved}.version`, `${fresh}.version`]] as const) {
          const bytes = await store.readBytes(m).catch(() => undefined);
          if (!bytes) continue;
          await store.writeBytes(f, bytes);
          await store.remove(m);
        }
      }
      // ponytail: tabs still on the old name keep their copy in memory until reloaded
      opened.delete(old);
      return fresh;
    },
    removeFile: async (_file, path) => {
      // Only a design's own folder goes, and only for a design that exists: never /designs itself or anything above.
      if (!isDesignPath(path, dir) || !(await store.list(dir)).some((f) => f.path === path)) throw new Error("No such design");
      await store.removeDir(dirname(str(path, "removeFile")));
      opened.delete(str(path, "removeFile"));
    },
    movePage: (file, page, x, y) => act(file, "move_page", { page, x, y }),
    reorderPage: (file, page, after) => act(file, "reorder_page", after === undefined ? { page } : { page, after }),
    edit: async (file, tool, args) => {
      const name = EDIT_TOOLS.find((t) => t === tool);
      if (!name) throw new Error(`${String(tool)} is not something the window can edit with`);
      return (await need(file)).call("you", name, args);
    },
    /** Where a tab's person is: the page they look at and the layer they picked. Other tabs see it on the canvas. */
    presence: async (file, tab, who, page, node) => {
      if (!file || typeof tab !== "string" || !/^[\w-]{1,32}$/.test(tab)) throw new Error("presence expects a tab id");
      const o = await load(file);
      const name = typeof who === "string" && who.trim() ? who.trim().slice(0, 80) : userInfo().username;
      o.present.set(tab, { tab, who: name, ...(typeof page === "string" ? { page } : {}), ...(typeof node === "string" ? { node } : {}) });
      o.listeners.forEach((fn) => fn());
    },
    // Versions sit in the design's folder, so moving or deleting the folder takes them along. The newest is also the
    // .version Review compares against.
    saveVersion: async (file, name) => saveVersion(store, await need(file), name),
    versions: async (file) => versionsOf(store, (await need(file)).path),
    restoreVersion: async (file, id) => restoreVersion(store, await need(file), id),
    /** buni's design guides and the person's own, by name; then one guide's text. */
    skills: async () => (await loadSkills()).map(({ name, description, source }) => ({ name, description, source })),
    skill: async (_file, name) => (typeof name === "string" ? (await readSkill(name))?.body : undefined),
    /** The inspiration libraries' patterns, for the sidebar; use_inspiration brings one in. */
    inspiration: async () => (await allPatterns()).map(({ name, library, use, tags, file }) => ({ name, library, use, tags, file })),
    /** The design folder in git, on this machine only. */
    changes: async (file) => (disk && file ? gitStatus(dirname(disk.real(file))) : undefined),
    commit: async (file, message, push) => {
      if (!disk || !file) throw new Error("Commit from the desktop app or buni open on your machine.");
      return gitCommit(dirname(disk.real(file)), typeof message === "string" ? message : "", push === true);
    },
    /** The person's answer to an agent's question; an empty one dismisses it. */
    answer: async (file, id, text) => {
      if (!file || typeof id !== "string") throw new Error("answer expects a question id");
      (await load(file)).asking.get(id)?.answer(typeof text === "string" && text.trim() ? text.trim() : undefined);
    },
    // An image from the person's computer or clipboard, kept in the design's assets/ folder and attached.
    readImportResource: async (file, url, pageUrl) => { await need(file); return readImportResource(str(url, "URL"), str(pageUrl, "Page URL"), loopback); },
    uploadImage: async (file, name, base64, mime) => {
      const ws = await need(file);
      const img = checkImage(name, base64, mime);
      if ("error" in img) throw new Error(img.error);
      let rel = `assets/${img.stem}.${img.ext}`;
      for (let i = 2; await store.readBytes(join(dirname(ws.path), rel)).then(() => true, () => false); i++) rel = `assets/${img.stem}-${i}.${img.ext}`;
      await store.writeBytes(join(dirname(ws.path), rel), img.bytes);
      const r = await ws.call("you", "add_attachment", { path: rel, mime: str(mime, "uploadImage") });
      const id = r.reply.match(/Attachment (\S+) is/)?.[1];
      if (!r.ok || !id) throw new Error(r.reply);
      return id;
    },
    /** The file as written, to download: the .buni text a repo or the editor can open. */
    fileText: async (file) => serializeDoc((await need(file)).view()),
    undo: async (file) => (await need(file)).undo(),
    redo: async (file) => (await need(file)).redo(),
    /** Tablets on the cable, or why there are none. */
    tablets: async () => options.tablets?.list() ?? { error: "Tablets connect to buni open on your Mac, with a USB cable." },
    /** Opens this design on a tablet on the cable, in its Chrome. */
    openOnTablet: async (file, serial) => {
      if (!options.tablets) throw new Error("Tablets connect to buni open on your Mac, with a USB cable.");
      return options.tablets.open(str(serial, "openOnTablet"), str(file, "openOnTablet"));
    },
    /** Builds the buni app and installs it on a tablet on the cable. */
    installTabletApp: async (_file, serial) => {
      if (!options.tablets) throw new Error("Tablets connect to buni open on your Mac, with a USB cable.");
      return options.tablets.install(str(serial, "installTabletApp"));
    },
    devices: async () => options.tablets?.paired() ?? [],
    forgetDevice: async (_file, id) => { options.tablets?.forget(str(id, "forgetDevice")); },
    /**
     * The page's marks as a request for the coding agent: on this Mac's clipboard, ready to paste into Claude Code or
     * Codex, so sending from the tablet needs nothing more on the Mac.
     */
    sendMarks: async (file, page) => marksRequest(await need(file), { page: str(page, "sendMarks") }),
    sendViewMarks: async (file, view) => {
      const v = INK_VIEWS.find((x) => x === view);
      if (!v) throw new Error("view is context, system or api");
      return marksRequest(await need(file), { view: v });
    },
  });

  /**
   * A page's or an architecture view's marks as a request for the coding agent, on this Mac's clipboard (only on the
   * person's own Mac: a hosted buni's clipboard isn't theirs). `picture` is what the tablet showed, ink and all.
   */
  async function marksRequest(ws: Workspace, where: { page: string } | { view: InkView } | { flow: string } | { screens: true }, picture?: string): Promise<{ count: number; copied: boolean; request: string }> {
    const doc = ws.view();
    const file = LOCAL ?? ws.path;
    const design = basename(ws.path, ".buni");
    const seeIt = (shot: string) => (picture ? `look at them in ${picture} (what the tablet showed; the handwriting is only in the picture)` : shot);
    let request: string, n: number;
    if ("page" in where) {
      const p = doc.pages[where.page];
      if (!p) throw new Error("No such page");
      n = marksOn(doc, p.id).length;
      request = `On ${p.name} in ${design} I drew ${n} mark${n === 1 ? "" : "s"} with a pen. Read them with buni call ${file} read_marks '{"page":"${p.id}"}' and ${seeIt(`look at them with buni shot ${file} ${p.id} marks.png --marks (handwriting is only in the picture)`)}. Make the changes, ask me about anything unclear, and reply on each mark's thread with comment {thread, body, addressed: true} when it's handled.`;
    } else if ("screens" in where) {
      // The Screens canvas: every page with open marks, in one request.
      const marked = pagesInOrder(doc).filter((p) => marksOn(doc, p.id).length);
      const sketches = sketchesOpen(doc).filter((c) => c.state === "open").length;
      n = marked.reduce((k, p) => k + marksOn(doc, p.id).length, 0) + sketches;
      const what = [marked.length ? `marks on ${marked.map((p) => p.name).join(", ")}` : "", sketches ? `${sketches} sketch${sketches === 1 ? "" : "es"} of new screens on the canvas` : ""].filter(Boolean).join(", and ");
      request = `On the screens of ${design} I drew with a pen: ${what}. Read them with buni call ${file} read_marks and ${seeIt(`look at each page with buni shot ${file} PAGE marks.png --marks (handwriting is only in the picture)`)}. ${sketches ? "Build each sketched screen as a real page where I drew it, in the design's style, and link it as my arrows show; make the other changes too. " : "Make the changes, "}Ask me about anything unclear, and reply on each thread with comment {thread, body, addressed: true} when it's handled.`;
    } else if ("flow" in where) {
      const f = doc.flows[where.flow];
      if (!f) throw new Error("No such flow");
      n = marksOnFlow(doc, f.id).length;
      request = `On the flow ${f.name} in ${design} I drew ${n} mark${n === 1 ? "" : "s"} with a pen, about how people move through it. Read them with buni call ${file} read_marks and the flow with buni call ${file} read_flows, and ${seeIt("ask me to send a picture from the tablet")}. Change the screens, links and journey to answer them, ask me about anything unclear, and reply on each mark's thread with comment {thread, body, addressed: true} when it's handled.`;
    } else {
      n = marksOnView(doc, where.view).length;
      request = `On the ${where.view} view of ${design}'s architecture I sketched ${n} mark${n === 1 ? "" : "s"} with a pen. Read them with buni call ${file} read_marks and ${seeIt("ask me to send a picture from the tablet")}. Answer with a plan, not edits: set_plan {name, about} (about says how you read my sketch), then the parts and links it adds with status planned and that plan. I accept or discard it on the tablet. Reply on each mark's thread with comment {thread, body, addressed: true}.`;
    }
    if (!n) return { count: 0, copied: false, request: "" };
    return { count: n, copied: options.tablets ? await toClipboard(request) : false, request };
  }

  /**
   * A tab's live feed of its file: changes only, from the file as it is now. The tab fetches the whole file (compressed)
   * once the feed is open, so nothing between the two is missed and the file isn't sent twice. Returns how to stop it.
   */
  async function watch(file: string, send: (data: string) => void, tab?: string): Promise<() => void> {
    const o = await load(file);
    let sent: { view: Doc; system: Doc } = snapshot(o);
    const changed = () => {
      const s = snapshot(o);
      // ponytail: a presence change diffs the whole doc too (nothing changed, so it's quick); split the feed if it shows
      const u: SnapshotUpdate = { kind: "patch", view: diffDoc(sent.view, s.view), ...(s.system !== s.view ? { system: diffDoc(sent.system, s.system) } : {}), owners: s.owners, recent: s.recent, ...(s.connected ? { connected: s.connected } : {}), ...(s.edits ? { edits: s.edits } : {}), ...(s.asking ? { asking: s.asking } : {}), ...(s.present ? { present: s.present } : {}) };
      send(JSON.stringify(u));
      sent = s;
    };
    o.listeners.add(changed);
    tabs.set(file, (tabs.get(file) ?? 0) + 1);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      o.listeners.delete(changed);
      tabs.set(file, (tabs.get(file) ?? 1) - 1);
      if (tab !== undefined && o.present.delete(tab)) o.listeners.forEach((fn) => fn());
    };
  }
  /** How many tabs have each design open: buni open shows the one that's there instead of opening another. */
  const tabs = new Map<string, number>();

  /** The feed as a server-sent event stream, for hosts that serve the editor over HTTP/2 (no per-host socket limit). */
  async function events(file: string, tab?: string): Promise<Response> {
    let stop = () => {};
    const stream = new ReadableStream<string>({
      async start(c) {
        // The comment opens the stream at once.
        c.enqueue(": open\n\n");
        stop = await watch(file, (data) => c.enqueue(`data: ${data}\n\n`), tab);
      },
      cancel: () => stop(),
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  /**
   * The design a WebSocket for the feed may watch, or undefined. A socket isn't held back by CORS the way a fetch is, so
   * the host and origin are checked here: otherwise any site open in the browser could read the design through it.
   */
  function socketFile(req: Request, dir = "/designs"): string | undefined {
    const url = new URL(req.url);
    const file = url.searchParams.get("file") ?? undefined;
    if (url.pathname !== "/events" || !isDesignPath(file, dir)) return undefined;
    if (!HOSTS.has(req.headers.get("host") ?? "") || !allowedOrigin(req, new Set([...OWN, EXTENSION_ORIGIN]))) return undefined;
    return file;
  }

  /**
   * A JSON answer, gzipped when it's big and the browser takes it: a design runs to hundreds of KB, and a hosted buni
   * sends everything up a home connection.
   */
  function json(value: unknown, req: Request): Response {
    const text = JSON.stringify(value);
    if (text.length < 1024 || !(req.headers.get("accept-encoding") ?? "").includes("gzip")) return new Response(text, { headers: { "content-type": "application/json" } });
    return new Response(Bun.gzipSync(text, { level: 6 }), { headers: { "content-type": "application/json", "content-encoding": "gzip", vary: "accept-encoding" } });
  }

  /** Pages drawn for the tablet, by design and page, with the version they show. */
  /** The tablet's page pictures, by file and page, at the tag they were drawn for; a draw under way is shared. */
  const drawn = new Map<string, { tag: string; shot: Promise<Shot> }>();
  function pageShot(o: Open, file: string, page: string): { tag: string; shot: Promise<Shot> } {
    const tag = pageTag(o.ws.view(), page), key = `${file}#${page}`;
    const kept = drawn.get(key);
    if (kept?.tag === tag) return kept;
    const shot = shootAway(o, page);
    drawn.set(key, { tag, shot });
    // A failed draw isn't kept: the next ask tries again.
    shot.catch(() => { if (drawn.get(key)?.shot === shot) drawn.delete(key); });
    return { tag, shot };
  }
  const PICTURE_BYTES = 4 * 1024 * 1024;

  /** The tablet app's API (docs/tablet-api.md): read the design, draw marks, send them, decide on plans. Nothing else. */
  async function tabletV1(req: Request, url: URL, device: Device, file: string | undefined): Promise<Response> {
    const route = url.pathname.slice("/tablet/v1/".length);
    if (!file) return Response.json({ error: "Which design? Pass ?file=." }, { status: 400 });
    const o = await load(file);
    const get = req.method === "GET", post = req.method === "POST";
    const body = async (): Promise<Record<string, unknown>> => {
      const b: unknown = await req.json().catch(() => undefined);
      return typeof b === "object" && b !== null && !Array.isArray(b) ? Object.fromEntries(Object.entries(b)) : {};
    };
    const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const fail = (error: string, status = 400) => Response.json({ error }, { status });
    try {
      if (route === "design" && get) {
        const d = tabletDesign(o.ws.view(), file);
        // Draw its pictures now, while the app reads this, so they're ready when it asks for them.
        for (const page of tabletPages(o.ws.view(), d)) pageShot(o, file, page).shot.catch(() => undefined);
        return json(d, req);
      }
      if (route === "page.png" && get) {
        const page = url.searchParams.get("page") ?? "";
        if (!o.ws.view().pages[page]) return fail("No such page", 404);
        const tag = pageTag(o.ws.view(), page);
        if (req.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { etag: tag } });
        const drawing = pageShot(o, file, page);
        return new Response(new Uint8Array((await drawing.shot).png), { headers: { "content-type": "image/png", etag: drawing.tag, "cache-control": "no-cache" } });
      }
      if (route === "canvas" && get) {
        // The Screens canvas as the editor lays it out, from every page's drawing: their heights place the rows.
        const doc = o.ws.view();
        const shots = new Map<string, Shot>();
        for (const p of pagesInOrder(doc)) shots.set(p.id, await pageShot(o, file, p.id).shot);
        return json(tabletCanvas(doc, shots), req);
      }
      if (route === "events" && get) {
        let stop: (() => void) | undefined, ping: ReturnType<typeof setInterval> | undefined;
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(enc.encode(": open\n\n"));
            stop = await watch(file, () => c.enqueue(enc.encode("data: changed\n\n")));
            ping = setInterval(() => c.enqueue(enc.encode(": ping\n\n")), 15_000);
          },
          cancel() { stop?.(); clearInterval(ping); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      if (route === "marks" && post) {
        const b = await body();
        const view = text(b.view);
        const where = view === "page" ? { page: text(b.page) } : view === "flow" ? { flow: text(b.flow) } : view === "sketch" ? { sketch: true } : INK_VIEWS.find((v) => v === view) ? { view } : undefined;
        if (!where) return fail("view is context, system, api, page, flow or sketch");
        const on = text(b.on), said = text(b.body);
        const r = await o.ws.call(device.name, "mark", { ...where, ...(on ? { node: on } : {}), strokes: b.strokes, ...(said ? { body: said } : {}), from: device.name });
        if (!r.ok) return fail(r.reply);
        return Response.json({ id: r.reply.match(/thread (\S+)\)/)?.[1] ?? null });
      }
      if (route === "marks/erase" && post) {
        const id = text((await body()).id);
        const r = await o.ws.call(device.name, "mark", { remove: id ?? "" });
        return r.ok ? Response.json({ ok: true }) : fail(r.reply);
      }
      if (route === "send" && post) {
        const b = await body();
        const view = text(b.view);
        const where = view === "page" ? { page: text(b.page) ?? "" } : view === "flow" ? { flow: text(b.flow) ?? "" } : view === "screens" ? { screens: true as const } : INK_VIEWS.find((v) => v === view) ? { view: INK_VIEWS.find((v) => v === view) ?? "system" } : undefined;
        if (!where) return fail("view is context, system, api, page, flow or screens");
        // What the tablet showed, kept beside the other drawings buni makes, for the agent to look at.
        let picture: string | undefined;
        const b64 = text(b.picture);
        if (b64) {
          const bytes = Buffer.from(b64, "base64");
          if (bytes.length > PICTURE_BYTES || bytes.subarray(1, 4).toString() !== "PNG") return fail("The picture is a PNG of up to 4 MB.");
          const at = join(tmpdir(), "buni-marks");
          await mkdir(at, { recursive: true });
          picture = join(at, `${basename(file, ".buni")}-${"page" in where ? where.page : "flow" in where ? where.flow : "screens" in where ? "screens" : where.view}-${Date.now()}.png`);
          await writeFile(picture, bytes);
        }
        const r = await marksRequest(o.ws, where, picture);
        return Response.json({ count: r.count, copied: r.copied, ...(picture ? { picture } : {}) });
      }
      if (route === "plan" && post) {
        const b = await body();
        const plan = text(b.plan) ?? "";
        const arch = architectureOf(o.ws.view());
        if (!arch.plans[plan]) return fail("No such plan", 404);
        // Changes the person unticked are left out of a merge: what they would add is dropped first.
        const skip = Array.isArray(b.skip) ? b.skip.filter((x): x is string => typeof x === "string") : [];
        if (b.action === "merge" && skip.length) {
          const mine = (id: string) => ARCH_COLLECTIONS.map((c) => (arch[c] as Record<string, { plan?: string; status?: string }>)[id]).find((x) => x?.plan === plan);
          const wrong = skip.find((id) => mine(id)?.status !== "planned");
          if (wrong) return fail(`"${wrong}" isn't something this plan adds; only additions can be left out.`);
          const dropped = await o.ws.call(device.name, "delete_architecture", { ids: skip });
          if (!dropped.ok) return fail(dropped.reply);
        }
        const r = b.action === "merge" ? await o.ws.call(device.name, "merge_plan", { plan })
          : b.action === "discard" ? await o.ws.call(device.name, "delete_architecture", { ids: [plan] })
          : undefined;
        if (!r) return fail("action is merge or discard");
        return r.ok ? Response.json({ ok: true, reply: r.reply }) : fail(r.reply);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    return fail("Not part of the tablet API.", 404);
  }

  /** The tablet listener's own names and origins: what its requests carry, over the cable's tunnel. */
  const tabletHosts = () => { const p = options.tablets?.port; return p ? [`localhost:${p}`, `127.0.0.1:${p}`] : []; };

  /** What a paired tablet may reach: the editor, its files, the feed, and drawing marks. Anything else is refused. */
  const TABLET_RPC = new Set(["snapshot", "build", "edit", "sendMarks", "documents"]);
  const TABLET_TOOLS = ["mark", "comment"] as const;
  async function tabletFetch(req: Request, dir = "/designs"): Promise<Response> {
    const url = new URL(req.url);
    const pairing = options.tablets;
    const host = req.headers.get("host") ?? "";
    if (!pairing || !tabletHosts().includes(host)) return new Response("forbidden host", { status: 403 });
    if (url.pathname === "/pair" && req.method === "GET") {
      const got = pairing.redeem(url.searchParams.get("code") ?? "");
      if (!got) return notice("This link was used already or is too old. On your Mac, choose Open on tablet again.", 403);
      return new Response(null, { status: 303, headers: {
        location: `/?file=${encodeURIComponent(got.file)}&tablet=1`,
        // Lax, not Strict: the page opens from outside the browser (adb), and Chrome holds a Strict cookie back from the
        // navigation that follows. Other sites still can't send it with their requests.
        "set-cookie": `${DEVICE_COOKIE}=${got.token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      } });
    }
    // The app trades its code for a token (docs/tablet-api.md); a browser, above, for a cookie.
    if (url.pathname === "/tablet/v1/pair" && req.method === "POST") {
      const code: unknown = await req.json().then((b: unknown) => (typeof b === "object" && b !== null && "code" in b ? b.code : undefined), () => undefined);
      const got = typeof code === "string" ? pairing.redeem(code) : undefined;
      if (!got) return Response.json({ error: "This code was used already or is too old. On your Mac, choose Open on tablet again." }, { status: 403 });
      return Response.json({ token: got.token, file: got.file, device: got.name });
    }
    const device = pairing.device(req);
    const api = url.pathname.startsWith("/tablet/v1/");
    if (!device) {
      const why = "This tablet isn't connected. Plug it into your Mac with a USB cable, then choose Open on tablet there.";
      return api ? Response.json({ error: why }, { status: 401 }) : notice(why, 401);
    }
    const file = url.searchParams.get("file") ?? undefined;
    if (file !== undefined && !isDesignPath(file, dir)) return Response.json({ error: "No such design" }, { status: 404 });
    if (api) return tabletV1(req, url, device, file);
    const own = new Set(tabletHosts().map((h) => `http://${h}`));
    const name = url.pathname.startsWith("/rpc/") ? url.pathname.slice(5) : "";
    if (name) {
      if (!TABLET_RPC.has(name) || req.method !== "POST" || !allowedCall(req, own)) return Response.json({ error: "forbidden" }, { status: 403 });
      try {
        const args: unknown = await req.json();
        if (!Array.isArray(args)) return Response.json({ error: "arguments are a list" }, { status: 400 });
        const a = args.map((x: unknown) => (x === null ? undefined : x));
        if (name === "edit") {
          const tool = TABLET_TOOLS.find((t) => t === a[0]);
          if (!tool) return Response.json({ error: "A tablet draws marks and leaves notes; edit the design on your Mac." }, { status: 403 });
          // A mark says which tablet drew it, as the cable knows it, whatever the page sent.
          const args = tool === "mark" && typeof a[1] === "object" && a[1] !== null && !("remove" in a[1]) ? { ...a[1], from: device.name } : a[1];
          return json({ value: await (await need(file)).call(device.name, tool, args) }, req);
        }
        return json({ value: await rpcFor(dir)[name]?.(file, ...a) }, req);
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    }
    const asset = assets().files.get(url.pathname);
    if (asset) return serveAsset(asset, req);
    if (url.pathname === "/events" && file && req.method === "GET") return await events(file);
    if (url.pathname === "/" || Object.hasOwn(FONTS, url.pathname) || url.pathname.startsWith("/files/")) {
      // The same answers this Mac gets: the editor page, fonts, and the design's own files.
      const here = [...HOSTS][0] ?? "localhost";
      return fetch(new Request(new URL(url.pathname + url.search, `http://${here}`), { headers: { host: here, "accept-encoding": req.headers.get("accept-encoding") ?? "" } }), dir);
    }
    return new Response("not found", { status: 404 });
  }

  const FONTS: Record<string, string> = Object.fromEntries(FONT_FAMILIES.map((family) => [`/fonts/${fontSlug(family)}.woff2`, family]));
  async function fetch(req: Request, dir = "/designs", spaces?: readonly SpaceRoot[]): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("forbidden host", { status: 403 });
    const file = url.searchParams.get("file") ?? undefined;
    const asset = assets().files.get(url.pathname);
    if (asset) return serveAsset(asset, req);
    const font = Object.hasOwn(FONTS, url.pathname) ? FONTS[url.pathname] : undefined;
    if (font) return new Response(Buffer.from(embeddedFont(font).split(",")[1] ?? "", "base64"), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=604800" } });
    if (url.pathname === "/") {
      // Shown in buni's own Chrome side panel; no other page may frame the editor.
      const shown = page(editorHtml, assets());
      shown.headers.set("content-security-policy", `frame-ancestors 'self' ${EXTENSION_ORIGIN}`);
      return shown;
    }
    if (url.pathname === "/signin") return new Response(null, { status: 303, headers: { location: "/" } });
    // A file in the URL is one of the caller's own designs, or it isn't found.
    if (file !== undefined && !isDesignPath(file, dir)) return Response.json({ error: "No such design" }, { status: 404 });
    if (url.pathname.startsWith("/files/") && (req.method === "GET" || req.method === "HEAD")) {
      const path = decodeURIComponent(url.pathname.slice("/files".length));
      if (!isDesignFile(path, dir)) return new Response("not found", { status: 404 });
      const bytes = await store.readBytes(path).catch(() => undefined);
      if (!bytes) return new Response("not found", { status: 404 });
      // Uploaded files are shown, never run: an SVG or HTML among them gets no scripts and no access to this origin.
      // HEAD answers with the size alone (an image's picker shows it without fetching the file again).
      return new Response(req.method === "HEAD" ? null : bytes, { headers: { "content-type": Bun.file(path).type, "content-length": String(bytes.length), "content-security-policy": "sandbox", "x-content-type-options": "nosniff" } });
    }
    try {
      // The Chrome extension: which designs it can snap into, and the snap itself, imported as the person sees it.
      if (url.pathname === "/snap") {
        const snappers = new Set([...OWN, EXTENSION_ORIGIN]);
        if (req.method === "GET" && allowedOrigin(req, snappers)) return Response.json((await home(dir)).map((f) => ({ path: f.path, name: f.name, folder: f.folder })));
        if (req.method === "POST" && file && allowedCall(req, snappers)) {
          const r = await (await need(file)).call("chrome extension", "import_snapshot", await req.json());
          const page = r.reply.match(/^Created page (\S+)\./)?.[1];
          return Response.json({ ok: r.ok, reply: r.reply, ...(page ? { page } : {}), open: `${origin}/?file=${encodeURIComponent(file)}${page ? `&page=${page}` : ""}` }, { status: r.ok ? 200 : 400 });
        }
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      if (url.pathname === "/events" && file) return await events(file, url.searchParams.get("tab") ?? undefined);
      if (url.pathname === "/tabs" && file && req.method === "GET") return Response.json({ tabs: tabs.get(file) ?? 0 });
      if (url.pathname === "/mcp") {
        if (!allowedOrigin(req, OWN)) return new Response("forbidden origin", { status: 403 });
        // Without a file, the client is connected to the person's spaces and picks a design with use_design.
        return file ? await mcp(file, req) : await mcpSpaces(req, spaces ?? [{ root: dir, name: "Designs" }]);
      }
      const name = url.pathname.startsWith("/rpc/") ? url.pathname.slice(5) : "";
      const rpc = rpcFor(dir);
      const method = Object.hasOwn(rpc, name) ? rpc[name] : undefined;
      if (method && req.method === "POST") {
        // Only buni's own page, or a tool on this machine, may call in: never another site open in the browser.
        if (!allowedCall(req, OWN)) return Response.json({ error: "forbidden" }, { status: 403 });
        const args: unknown = await req.json();
        if (!Array.isArray(args)) return Response.json({ error: "arguments are a list" }, { status: 400 });
        // JSON turns an undefined argument into null; inside, absent is undefined.
        return json({ value: await method(file, ...args.map((a: unknown) => (a === null ? undefined : a))) }, req);
      }
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    return new Response("not found", { status: 404 });
  }

  if (LOCAL_PATH) await load(LOCAL_PATH);
  const stop = () => { for (const live of lives) rmSync(live, { force: true }); lives.clear(); };
  /** A tablet's live feed: its own host, its cookie, and a design. */
  function tabletSocket(req: Request, dir = "/designs"): string | undefined {
    const url = new URL(req.url);
    const file = url.searchParams.get("file") ?? undefined;
    if (url.pathname !== "/events" || !isDesignPath(file, dir)) return undefined;
    if (!tabletHosts().includes(req.headers.get("host") ?? "") || !options.tablets?.device(req)) return undefined;
    return allowedOrigin(req, new Set(tabletHosts().map((h) => `http://${h}`))) ? file : undefined;
  }

  const onChange = async (file: string, fn: () => void): Promise<() => void> => {
    const o = await load(file);
    o.listeners.add(fn);
    return () => o.listeners.delete(fn);
  };
  const text = async (file: string): Promise<string> => serializeDoc((await load(file)).ws.view());
  return { fetch, socketFile, tabletFetch, tabletSocket, watch, onChange, text, stop };
}

/** A short page a tablet sees when it can't come in, saying what to do. */
function notice(text: string, status: number): Response {
  const safe = text.replace(/[<>&]/g, "");
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>buni</title><body style="font:17px/1.5 -apple-system,system-ui,sans-serif;max-width:440px;margin:20vh auto;padding:0 24px;color:#18181b">${safe}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Puts text on this Mac's clipboard; false where there is no pbcopy (not a Mac). */
function toClipboard(text: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((done) => {
    const p = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
    p.once("error", () => done(false));
    p.once("exit", (code) => done(code === 0));
    p.stdin.end(text);
  });
}

/** The full editor on files in place, served only on this machine. */
export async function serveEditor(file: string, port = 0): Promise<{ url: string; stop: () => void; editor: Editor; design: string }> {
  const localFile = resolve(file);
  // Edit checks run on every visible edit: one browser kept warm beats starting Chrome each time.
  keepBrowserWarm();
  const assets = await buildAssets();
  const ready = Promise.withResolvers<Editor>();
  // Each tab's live feed is a WebSocket here: an event stream holds one of the six HTTP/1.1 connections Chrome allows
  // per host, so with six tabs open on this buni a seventh never loads. Sockets don't count against that limit.
  type Feed = { file: string; tab?: string; stop?: () => void; closed?: boolean };
  const server = Bun.serve<Feed>({
    port, hostname: "127.0.0.1", idleTimeout: 0, maxRequestBodySize: 16 * 1024 * 1024,
    fetch: async (req, srv) => {
      const editor = await ready.promise;
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const file = editor.socketFile(req);
        if (!file) return new Response("forbidden", { status: 403 });
        return srv.upgrade(req, { data: { file, tab: new URL(req.url).searchParams.get("tab") ?? undefined } }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      return editor.fetch(req);
    },
    websocket: feeds(),
  });
  // The tablet's own door, also only on 127.0.0.1: adb reverse brings a tablet on the cable here, and nothing else
  // does. Everything through it goes through the tablet's guard (tabletFetch), never the Mac's.
  const tabletServer = Bun.serve<Feed>({
    port: 0, hostname: "127.0.0.1", idleTimeout: 0, maxRequestBodySize: 4 * 1024 * 1024,
    fetch: async (req, srv) => {
      const editor = await ready.promise;
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const file = editor.tabletSocket(req);
        if (!file) return new Response("forbidden", { status: 403 });
        return srv.upgrade(req, { data: { file } }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      return editor.tabletFetch(req);
    },
    websocket: feeds(),
  });
  function feeds(): Bun.WebSocketHandler<Feed> {
    return {
      async open(ws) {
        const stop = await (await ready.promise).watch(ws.data.file, (data) => ws.send(data), ws.data.tab);
        // Closed while the file was loading: stop at once rather than feed a socket that's gone.
        if (ws.data.closed) stop();
        else ws.data.stop = stop;
      },
      message() {},
      close(ws) {
        ws.data.closed = true;
        ws.data.stop?.();
      },
    };
  }
  try {
    const tablets = new Tablets(join(homedir(), ".buni", "devices.json"));
    tablets.port = tabletServer.port ?? 0;
    const editor = await createEditor({ store: new DiskStore(dirname(dirname(localFile))), origin: `http://localhost:${server.port}`, localFile, assets: () => assets, tablets });
    ready.resolve(editor);
    const design = `/designs/${basename(dirname(localFile))}/${basename(localFile)}`;
    const url = `http://localhost:${server.port}/?file=${encodeURIComponent(design)}`;
    const stop = () => { editor.stop(); tablets.stop(); void server.stop(true); void tabletServer.stop(true); };
    return { url, stop, editor, design };
  } catch (error) {
    void server.stop(true);
    void tabletServer.stop(true);
    throw error;
  }
}
