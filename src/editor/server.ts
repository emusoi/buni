/// <reference path="./raw.d.ts" />
import { exampleBody, matchEndpoint, mockGraphql } from "buni/tools/backend.ts";
import { MockStore } from "buni/tools/mockstore.ts";
import { restoreVersion, saveVersion, versionsOf } from "buni/tools/versions.ts";
import { checkImage } from "buni/tools/assets.ts";
import { fontSlug } from "buni/tools/html.ts";
import { FONT_FAMILIES } from "buni/tools/fonts.gen.ts";
import { tmpdir } from "node:os";
import { allowedCall, allowedOrigin, isDesignFile, isDesignPath, localOrigins, mockOrigin } from "./guard.ts";
import { rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { renderHeadless } from "buni/term/render.ts";
import { basename, dirname, join, resolve } from "node:path";
import { emptyDoc, pagesInOrder, type Doc } from "buni/format/doc.ts";
import { parseDoc } from "buni/format/parse.ts";
import { diffDoc } from "buni/format/patch.ts";
import { serializeDoc } from "buni/format/serialize.ts";
import { systemChanges } from "buni/tools/changes.ts";
import { Workspace } from "buni/tools/workspace.ts";
import { EDIT_TOOLS, type HomeFile, type Snapshot, type SnapshotUpdate } from "./api.ts";
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

export interface EditorOptions {
  store: EditorStore;
  origin: string;
  localFile?: string;
  assets?: () => Built;
}

/** The same editor and design API, with the host choosing storage and who may reach it. */
export interface Editor {
  fetch(req: Request, dir?: string): Promise<Response>;
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
    /** The mock API for this design, remembering writes until the server stops. */
    mock: MockStore;
  }
  /** This run of the server: a tab that reconnects to a different one reloads, so it never runs yesterday's code. */
  const BUILD = Date.now().toString(36);
  // ponytail: an opened file stays loaded until the server stops; evict idle ones if memory matters
  const opened = new Map<string, Promise<Open>>();
  /** The .live markers this server wrote, removed when it stops. */
  const lives = new Set<string>();

  function load(path: string): Promise<Open> {
    let o = opened.get(path);
    if (!o) {
      o = Workspace.open(path, within(store, dirname(dirname(path)))).then(async (ws) => {
        const file: Open = { ws, listeners: new Set(), mcp: new Map(), mock: new MockStore() };
        if (disk) {
          // On disk, buni open shows who is editing, and the buni command and coding agents send their edits here
          // (through <file>.live) so this editor stays the one writer of the file.
          await ws.shareActivity();
          const live = `${disk.real(path)}.live`;
          await writeFile(live, `${JSON.stringify({ pid: process.pid, mcp: mcpUrl(path) })}\n`, "utf8");
          lives.add(live);
        }
        ws.onChange(() => file.listeners.forEach((fn) => fn()));
        return file;
      });
      // A file that failed to open is tried again next time.
      o.catch(() => opened.delete(path));
      opened.set(path, o);
    }
    return o;
  }

  const mcpUrl = (path: string) => `${origin}/mcp?file=${encodeURIComponent(path)}`;
  const snapshot = ({ ws, mcp }: Open): Snapshot => ({
    path: ws.path, dir: dirname(ws.path), view: ws.view(), system: ws.system(), owners: ws.owners(), recent: ws.recent(), mcpUrl: mcpUrl(ws.path),
    // An agent that quits or crashes rarely says so: one heard from in the last ten minutes counts as here.
    // ponytail: "gone" shows on the next change after that, not the moment it lapses
    edits: ws.edits(),
    connected: [...new Set([...mcp.values()].filter((m) => Date.now() - m.seen < 10 * 60_000).map((m) => m.server.server.getClientVersion()?.name ?? "agent"))],
  });

  /** Coding agents edit the file through MCP here; their edits reach every tab like the person's own. */
  async function mcp(file: string, req: Request): Promise<Response> {
    const o = await load(file);
    const body: unknown = req.method === "POST" ? await req.json() : undefined;
    const sid = req.headers.get("mcp-session-id");
    let t = sid ? o.mcp.get(sid)?.transport : undefined;
    // Tabs hear when an agent joins or leaves, so the editor can show who is connected.
    const tell = () => o.listeners.forEach((fn) => fn());
    if (!t && req.method === "POST" && isInitializeRequest(body)) {
      // Screenshots use the browser available to this host.
      const server = createMcpServer(o.ws, { screenshot: (page) => renderAway(o, page) });
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

  /**
   * A file name the person typed, as a path of its own that isn't taken yet. Each file gets its own
   * folder, so the images beside it never collide with another file's.
   */
  async function freePath(name: string, dir: string): Promise<string> {
    // Letters, digits, spaces and dashes only: a name never reaches another folder.
    const stem = name.trim().replace(/\.buni$/, "").replace(/[^\w -]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
    if (LOCAL_PATH) {
      // On disk, a new design goes beside the one opened, in the folder it already shares with others.
      const files = new Set((await store.list(dir)).map((f) => f.path));
      for (let n = 1; ; n++) {
        const p = join(dirname(LOCAL_PATH), `${n === 1 ? stem : `${stem} ${n}`}.buni`);
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
    const files = await store.list(dir);
    const notes = await Promise.all(files.map((f) => working(f.path)));
    return files.flatMap(({ path, text, modified }, i) => {
      const r = parseDoc(text);
      if (!r.ok) return [];
      const first = pagesInOrder(r.doc)[0];
      const agentNote = notes[i];
      // Every file has a folder of its own, so they're shown together rather than one folder each.
      // Hosted, every design has a folder of its own, so they're shown together; on disk, by the folder they're in.
      return [{ path, name: basename(path, ".buni"), folder: LOCAL ? dirname(path) : dir, modified: modified.toISOString(), pages: Object.keys(r.doc.pages).length, doc: r.doc, ...(first ? { preview: first.id } : {}), ...(agentNote ? { agentNote } : {}) }];
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
  /** One draw at a time: a burst of agent screenshots shouldn't start a browser each at once. */
  function renderAway(o: Open, page: string): Promise<string> {
    const next = drawing.then(() => drawAway(o, page));
    drawing = next.catch(() => undefined);
    return next;
  }

  async function drawAway(o: Open, page: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "buni-draw-"));
    try {
      const file = join(dir, "design.buni");
      const out = join(dir, "page.png");
      await writeFile(file, serializeDoc(o.ws.view()), "utf8");
      // The agent reads layout and type at 1×; 2× sends four times the pixels for nothing it can use.
      const r = await renderHeadless({ file, page, out, format: "png", scale: 1 }, undefined);
      if (!r.ok) throw new Error(r.text);
      return (await readFile(out)).toString("base64");
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
      const s = snapshot(await load(file));
      // Usually the system is the view itself; sent once, the tab puts it back (bridge.ts).
      return s.system === s.view ? { ...s, system: undefined } : s;
    },
    build: async () => BUILD,
    home: () => home(dir),
    /** A .buni file the person picked in the browser, with the images it uses, copied in; returns where it now lives. */
    import: async (_file, name, text, assets) => {
      const given = new Map(Array.isArray(assets) ? assets.filter(isUpload).map((a) => [a.name, a.base64] as const) : []);
      return addFile(str(name, "import"), str(text, "import"), async (n) => {
        const b64 = given.get(n);
        return b64 === undefined ? undefined : Uint8Array.fromBase64(b64);
      }, dir);
    },
    create: async (_file, name) => {
      const path = await freePath(str(name, "create"), dir);
      await store.write(path, serializeDoc(emptyDoc()));
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
    // Versions sit in the design's folder, so moving or deleting the folder takes them along. The newest is also the
    // .version Review compares against.
    saveVersion: async (file, name) => saveVersion(store, await need(file), name),
    versions: async (file) => versionsOf(store, (await need(file)).path),
    restoreVersion: async (file, id) => restoreVersion(store, await need(file), id),
    // An image from the person's computer or clipboard, kept in the design's assets/ folder and attached.
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
    systemChanges: async (file) => {
      const ws = await need(file);
      const text = await store.read(`${ws.path}.version`).catch(() => undefined);
      if (text === undefined) return { error: "No version is saved yet. Save one, and the changes from then on show here." };
      const before = parseDoc(text);
      if (!before.ok) return { error: "The saved version doesn't read as a .buni file." };
      return { changes: systemChanges(before.doc, ws.view()) };
    },
    /** The file as written, to download: the .buni text a repo or the editor can open. */
    fileText: async (file) => serializeDoc((await need(file)).view()),
    undo: async (file) => (await need(file)).undo(),
    redo: async (file) => (await need(file)).redo(),
  });

  /** A tab's live feed of its file: the whole snapshot first, then only what each change changed. */
  /**
   * The designed API, answering before it is built: any endpoint by method and path returns an example of its
   * response, or with ?status=409 one of its designed errors. CORS is open so a front end on another port can call it.
   */
  async function mock(file: string, req: Request, url: URL): Promise<Response> {
    // Pages on this machine only: a front end in development on any local port, never another site.
    const local = mockOrigin(req);
    if (req.headers.get("origin") !== null && !local) return new Response("forbidden origin", { status: 403 });
    const cors = { "access-control-allow-origin": local ?? "null", "vary": "Origin", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const doc = (await need(file)).view();
    const path = url.pathname.slice("/mock".length);
    // The design's GraphQL operations, at one endpoint as GraphQL servers have it.
    if (path === "/graphql" && req.method === "POST") return Response.json(mockGraphql(doc, await req.json().catch(() => undefined)), { headers: cors });
    const e = matchEndpoint(doc, req.method, path);
    if (!e) return Response.json({ error: `No ${req.method} ${path} in this design` }, { status: 404, headers: cors });
    const status = url.searchParams.get("status");
    if (status && status !== "200") {
      const err = (e.errors ?? []).find((x) => x.code === status);
      if (!err) return Response.json({ error: `${e.method} ${e.path} has no designed ${status}; it has ${(e.errors ?? []).map((x) => x.code).join(", ") || "none"}` }, { status: 400, headers: cors });
      const code = Number(err.code);
      return Response.json({ error: err.when }, { status: Number.isInteger(code) && code >= 400 && code < 600 ? code : 400, headers: cors });
    }
    // What the call sent: its path parameters, then its JSON body (or its query); the mock remembers what it changes.
    const params = Object.fromEntries(e.path.split("/").filter(Boolean).flatMap((seg, i) => (/^\{.+\}$/.test(seg) ? [[seg.slice(1, -1), decodeURIComponent(path.split("/").filter(Boolean)[i] ?? "")]] : [])));
    const given: unknown = req.method === "GET" || req.method === "DELETE" ? Object.fromEntries([...url.searchParams].filter(([k]) => k !== "file")) : await req.json().catch(() => ({}));
    const sent = { ...params, ...(typeof given === "object" && given !== null ? given : {}) };
    return Response.json((await load(file)).mock.answer(doc, e, sent), { headers: cors });
  }

  /** The agent's events for a tab, as they happen; the panel replays the log it fetched first. */
  async function events(file: string): Promise<Response> {
    const o = await load(file);
    let stop = () => {};
    const stream = new ReadableStream<string>({
      start(c) {
        const send = (u: SnapshotUpdate) => c.enqueue(`data: ${JSON.stringify(u)}\n\n`);
        // Changes only, from the file as it is now: the tab fetches the whole file (compressed) once this stream is
        // open, so nothing between the two is missed and the file isn't sent twice. The comment opens the stream at once.
        let sent: { view: Doc; system: Doc } = snapshot(o);
        c.enqueue(": open\n\n");
        const changed = () => {
          const s = snapshot(o);
          send({ kind: "patch", view: diffDoc(sent.view, s.view), ...(s.system !== s.view ? { system: diffDoc(sent.system, s.system) } : {}), owners: s.owners, recent: s.recent, ...(s.connected ? { connected: s.connected } : {}), ...(s.edits ? { edits: s.edits } : {}) });
          sent = s;
        };
        o.listeners.add(changed);
        stop = () => o.listeners.delete(changed);
      },
      cancel: () => stop(),
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
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

  const FONTS: Record<string, string> = Object.fromEntries(FONT_FAMILIES.map((family) => [`/fonts/${fontSlug(family)}.woff2`, family]));
  async function fetch(req: Request, dir = "/designs"): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("forbidden host", { status: 403 });
    const file = url.searchParams.get("file") ?? undefined;
    const asset = assets().files.get(url.pathname);
    if (asset) return serveAsset(asset, req);
    const font = Object.hasOwn(FONTS, url.pathname) ? FONTS[url.pathname] : undefined;
    if (font) return new Response(Buffer.from(embeddedFont(font).split(",")[1] ?? "", "base64"), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=604800" } });
    if (url.pathname === "/") return page(editorHtml, assets());
    if (url.pathname === "/signin") return new Response(null, { status: 303, headers: { location: "/" } });
    // A file in the URL is one of the caller's own designs, or it isn't found.
    if (file !== undefined && !isDesignPath(file, dir)) return Response.json({ error: "No such design" }, { status: 404 });
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      const path = decodeURIComponent(url.pathname.slice("/files".length));
      if (!isDesignFile(path, dir)) return new Response("not found", { status: 404 });
      const bytes = await store.readBytes(path).catch(() => undefined);
      if (!bytes) return new Response("not found", { status: 404 });
      // Uploaded files are shown, never run: an SVG or HTML among them gets no scripts and no access to this origin.
      return new Response(bytes, { headers: { "content-type": Bun.file(path).type, "content-security-policy": "sandbox", "x-content-type-options": "nosniff" } });
    }
    try {
      if (url.pathname === "/events" && file) return await events(file);
      if (url.pathname === "/mcp" && file) {
        if (!allowedOrigin(req, OWN)) return new Response("forbidden origin", { status: 403 });
        return await mcp(file, req);
      }
      if (url.pathname.startsWith("/mock/") && file) return await mock(file, req, url);
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
  return { fetch, stop };
}

/** The full editor on files in place, served only on this machine. */
export async function serveEditor(file: string, port = 0): Promise<{ url: string; stop: () => void }> {
  const localFile = resolve(file);
  const assets = await buildAssets();
  const ready = Promise.withResolvers<Editor>();
  const server = Bun.serve({
    port, hostname: "127.0.0.1", idleTimeout: 0, maxRequestBodySize: 16 * 1024 * 1024,
    fetch: async (req) => (await ready.promise).fetch(req),
  });
  try {
    const editor = await createEditor({ store: new DiskStore(dirname(dirname(localFile))), origin: `http://localhost:${server.port}`, localFile, assets: () => assets });
    ready.resolve(editor);
    const url = `http://localhost:${server.port}/?file=${encodeURIComponent(`/designs/${basename(dirname(localFile))}/${basename(localFile)}`)}`;
    const stop = () => { editor.stop(); void server.stop(true); };
    return { url, stop };
  } catch (error) {
    void server.stop(true);
    throw error;
  }
}
