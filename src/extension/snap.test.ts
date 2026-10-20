import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { createEditor } from "../editor/server.ts";
import { DiskStore } from "../editor/store.ts";
import { EXTENSION_ORIGIN } from "../editor/guard.ts";
import { evaluateWithBrowser, findBrowser } from "../term/chrome.ts";
import { extensionFiles } from "../term/extension-build.ts";

const browser = findBrowser();

test.skipIf(!browser)("the extension's capture snaps a page in the browser, and the editor imports it for the extension but not for another site", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-snap-"));
  await mkdir(join(root, "Shop"), { recursive: true });
  const store = new DiskStore(root, "/designs");
  await store.write("/designs/Shop/Shop.buni", serializeDoc(emptyDoc()));
  const editor = await createEditor({ store, origin: "http://localhost:4999", assets: () => ({ files: new Map(), client: "", styles: "", xyflow: "" }) });
  const files = await extensionFiles();
  try {
    expect(JSON.parse(files["manifest.json"]!).key).toBeString();
    // The page side of a snap, as the extension injects it: content.js, then buniSnap.
    const page = `<style>.card{display:flex;gap:12px;padding:24px;background:#f4f4f1}</style><main class="card"><h1>Quotes</h1><p>Send a part, get a price.</p></main>`;
    const snapped: unknown = JSON.parse(await evaluateWithBrowser(browser!, { html: `<!doctype html><html><head><title>Quotes</title></head><body>${page}</body></html>`, dir: ".", width: 800 },
      `${files["content.js"]};window.buniSnap("page").then((s) => JSON.stringify(s))`));
    expect(snapped).toMatchObject({ title: "Quotes", width: 800 });
    const s = snapped as { html: string; count: number; warnings: string[]; images: unknown[]; url: string; width: number };
    const body = JSON.stringify({ snapshot: { html: s.html, count: s.count, warnings: s.warnings, images: s.images, width: s.width }, page: { name: "Quotes · Now" } });
    const post = (origin: string) => editor.fetch(new Request("http://localhost:4999/snap?file=%2Fdesigns%2FShop%2FShop.buni", {
      method: "POST", headers: { host: "localhost:4999", origin, "content-type": "application/json" }, body,
    }));
    expect((await post("https://evil.example")).status).toBe(403);
    const list = await editor.fetch(new Request("http://localhost:4999/snap", { headers: { host: "localhost:4999", origin: EXTENSION_ORIGIN } }));
    expect(await list.json()).toEqual([expect.objectContaining({ path: "/designs/Shop/Shop.buni", name: "Shop" })]);
    const ok = await post(EXTENSION_ORIGIN);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, open: expect.stringMatching(/^http:\/\/localhost:4999\/\?file=%2Fdesigns%2FShop%2FShop\.buni&page=\w+$/) });
    const saved = parseDoc(await store.read("/designs/Shop/Shop.buni"));
    if (!saved.ok) throw new Error("the design didn't parse");
    const now = Object.values(saved.doc.pages).find((p) => p.name === "Quotes · Now")!;
    expect(now).toBeDefined();
    expect(Object.values(saved.doc.nodes).some((n) => n.kind === "text" && n.text === "Send a part, get a price.")).toBe(true);
  } finally {
    editor.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
