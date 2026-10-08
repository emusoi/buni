// buni open: the design in a browser, read-only and live. A server on this machine renders each page with buni's own
// renderer and sends the whole design again whenever the file changes, whoever wrote it (an agent through buni mcp,
// buni call, an app). Nothing here edits the design: people change it by asking their agent.
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { CELL, pagesInOrder, walkFlow, type Doc } from "../format/doc.ts";
import { embeddedFont } from "../tools/fontdata.ts";
import { fontFaces, renderPage } from "../tools/html.ts";
import { Workspace } from "../tools/workspace.ts";
import { viewerHtml } from "./client.ts";
import { systemOf, type SystemSnapshot } from "./system.ts";

/** One page as the viewer draws it: where it sits, how big it is, and the document a board shows. */
export interface Board {
  id: string;
  name: string;
  route?: string;
  state?: string;
  /** For a terminal screen, its size in cells. */
  terminal?: { cols: number; rows?: number };
  x?: number;
  y?: number;
  width: number;
  /** A fixed height; otherwise the page's own, measured in the browser. */
  height?: number;
  /** The page as a whole HTML document, for a sandboxed frame. */
  html: string;
}

export interface Snapshot {
  name: string;
  folder: string;
  boards: Board[];
  /** Named paths through the pages, each as its pages in order. */
  flows: { id: string; name: string; pages: string[] }[];
  /** Which page leads to which, once each, for the arrows between boards. */
  links: { from: string; to: string }[];
  /** The system behind the pages, view by view. */
  system: SystemSnapshot;
  /** Why the file couldn't be read just now; the last good design is kept. */
  error?: string;
}

const px = (v: string | undefined) => {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * The design as the viewer shows it. Fonts and the design's own files come from this server by URL. The system is
 * read with the files it imports, as the tools check it.
 */
export function snapshotOf(doc: Doc, file: string, system: Doc = doc): Snapshot {
  const boards = pagesInOrder(doc).map((p): Board => {
    const { html, css } = renderPage(doc, p.id, { assetPrefix: "/files/" });
    const frame = doc.nodes[p.frame]?.style ?? {};
    const width = p.terminal ? p.terminal.cols * CELL.w : px(frame.width) ?? 1440;
    const height = p.terminal?.rows !== undefined ? p.terminal.rows * CELL.h : px(frame.height);
    return {
      id: p.id, name: p.name, width,
      ...(p.route !== undefined ? { route: p.route } : {}), ...(p.state !== undefined ? { state: p.state } : {}),
      ...(p.terminal ? { terminal: { cols: p.terminal.cols, ...(p.terminal.rows !== undefined ? { rows: p.terminal.rows } : {}) } } : {}),
      ...(p.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : {}),
      ...(height !== undefined ? { height } : {}),
      html: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}${fontFaces(doc, (f) => `/fonts/${encodeURIComponent(f)}`)}${css}</style></head><body>${html}</body></html>`,
    };
  });
  const flows = Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1)).map((f) => ({ id: f.id, name: f.name, pages: walkFlow(doc, f.start).pages }));
  const seen = new Set<string>();
  const links = Object.values(doc.connections).flatMap((c) => {
    const key = `${c.page}>${c.to}`;
    if (c.page === c.to || seen.has(key) || !doc.pages[c.page] || !doc.pages[c.to]) return [];
    seen.add(key);
    return [{ from: c.page, to: c.to }];
  });
  return { name: basename(file), folder: dirname(file).replace(homedir(), "~"), boards, flows, links, system: systemOf(system) };
}

/** A file in the design's folder, or undefined for anything outside it. */
function inFolder(dir: string, path: string): string | undefined {
  const target = resolve(dir, path);
  return target.startsWith(dir + sep) && !relative(dir, target).startsWith("..") ? target : undefined;
}

/**
 * Serves the viewer for `file` on 127.0.0.1 (port 0 picks a free one) until stopped. Only this machine can reach it,
 * and only by its own address, so a web page elsewhere can't read the design through it.
 */
export async function serveViewer(file: string, port = 0): Promise<{ url: string; stop: () => void }> {
  const path = resolve(file);
  const dir = dirname(path);
  const read = async () => {
    const ws = await Workspace.open(path);
    return snapshotOf(ws.view(), path, ws.system());
  };
  let last = await read();
  const listeners = new Set<(s: Snapshot) => void>();
  const reload = async () => {
    try {
      last = await read();
    } catch (e) {
      // Read mid-write, or broken by hand: keep showing the last good design, and say why.
      last = { ...last, error: e instanceof Error ? e.message : String(e) };
    }
    for (const fn of listeners) fn(last);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void reload(), 80);
  };
  // The folder, not the file: a save writes a temporary file beside it and renames it over, and a watch on the old
  // file would go quiet. How a rename is reported differs by system, so the temporary file's events count too.
  const base = basename(path);
  const watcher = watch(dir, (_event, name) => {
    if (!name || name === base || name.startsWith(`${base}.`)) soon();
  });
  // And in case the system says nothing at all: the file's modification time, once a second.
  let seen = (await stat(path)).mtimeMs;
  const poll = setInterval(() => {
    void stat(path).then((s) => {
      if (s.mtimeMs !== seen) {
        seen = s.mtimeMs;
        soon();
      }
    }, () => undefined);
  }, 1000);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      // DNS rebinding: a page on another site that resolves its name here is refused.
      if (req.headers.get("host") !== `127.0.0.1:${server.port}` && req.headers.get("host") !== `localhost:${server.port}`) return new Response("not here", { status: 403 });
      if (url.pathname === "/") return new Response(viewerHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/design") return Response.json(last);
      if (url.pathname === "/events") {
        let send: ((s: Snapshot) => void) | undefined;
        const stream = new ReadableStream<string>({
          start(c) {
            send = (s) => c.enqueue(`data: ${JSON.stringify(s)}\n\n`);
            listeners.add(send);
            c.enqueue(": open\n\n");
          },
          cancel() {
            if (send) listeners.delete(send);
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
      }
      if (url.pathname.startsWith("/fonts/")) {
        const data = embeddedFont(decodeURIComponent(url.pathname.slice("/fonts/".length))).split(",")[1] ?? "";
        return data ? new Response(Buffer.from(data, "base64"), { headers: { "content-type": "font/woff2", "cache-control": "max-age=3600" } }) : new Response("no such font", { status: 404 });
      }
      if (url.pathname.startsWith("/files/")) {
        const target = inFolder(dir, decodeURIComponent(url.pathname.slice("/files/".length)));
        if (!target) return new Response("not in the design's folder", { status: 404 });
        const f = Bun.file(target);
        return f.exists().then((ok) => (ok ? new Response(f) : new Response("not found", { status: 404 })));
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/`,
    stop: () => {
      watcher.close();
      clearInterval(poll);
      clearTimeout(timer);
      void server.stop(true);
    },
  };
}

