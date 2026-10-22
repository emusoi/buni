import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pagesInOrder, withProject, withUseLinks, type Doc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { fontFaces, renderPage } from "../tools/html.ts";
import { embeddedFont } from "../tools/fontdata.ts";
import { Workspace } from "../tools/workspace.ts";
import { captureWithBrowser, findBrowser, type CaptureTarget } from "./chrome.ts";

export interface CaptureDocument { source: string; page: string; revision: string; doc: Doc; owners: Record<string, string> }

export async function captureDocument(file: string, wanted: string): Promise<CaptureDocument> {
  const source = resolve(file), ws = await Workspace.open(source);
  const imported = ws.imports().map(({ path, doc }) => ({
    ...doc,
    attachments: Object.fromEntries(Object.entries(doc.attachments).map(([id, a]) => [id, { ...a, path: relative(dirname(source), resolve(dirname(path), a.path)).replaceAll("\\", "/") }])),
  }));
  const doc = withUseLinks(withProject(ws.system(), imported));
  const page = doc.pages[wanted] ?? pagesInOrder(doc).find((p) => p.name === wanted || p.route === wanted);
  if (!page) throw new Error(`No page "${wanted}" in ${source}`);
  const owners = Object.fromEntries(ws.imports().flatMap(({ path, doc }) => [...Object.keys(doc.pages), ...Object.keys(doc.nodes)].map((id) => [id, path])));
  for (const id of [...Object.keys(ws.view().pages), ...Object.keys(ws.view().nodes)]) owners[id] = source;
  const revision = createHash("sha256").update(serializeDoc(doc)).digest("hex").slice(0, 16);
  return { source, page: page.id, revision, doc, owners };
}

/** A page drawn at 1×, with how tall it came out and where each of its layers sits: what a native viewer draws. */
export interface Shot { png: Uint8Array; width: number; height: number; targets: CaptureTarget[] }

export async function captureShot(snap: CaptureDocument): Promise<Shot> {
  const browser = findBrowser();
  if (!browser) throw new Error("Preview needs Chrome, Chromium or Edge; set BUNI_CHROME to its executable.");
  const { html, css } = renderPage(snap.doc, snap.page);
  const width = Number.parseInt(snap.doc.nodes[snap.doc.pages[snap.page]?.frame ?? ""]?.style.width ?? "1440", 10) || 1440;
  const drawn = await captureWithBrowser(browser, {
    dir: dirname(snap.source), width,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}${fontFaces(snap.doc, embeddedFont)}${css}</style></head><body>${html}</body></html>`,
  });
  return { png: drawn.png, width, height: drawn.height, targets: drawn.targets.filter((t) => snap.doc.nodes[t.id] !== undefined) };
}

/** A native viewer gets the exact document and bounds that produced its PNG. */
export async function capturePage(file: string, wanted: string, out: string): Promise<void> {
  const snap = await captureDocument(file, wanted);
  const shot = await captureShot(snap);
  await writeFile(out, shot.png);
  const revision = createHash("sha256").update(snap.revision).update(shot.png).digest("hex").slice(0, 16);
  await writeFile(`${out}.json`, JSON.stringify({ ...snap, revision, width: shot.width, height: shot.height, targets: shot.targets }));
}
