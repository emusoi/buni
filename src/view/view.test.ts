import { expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../tools/workspace.ts";
import { serveViewer, type Snapshot } from "./server.ts";

const design = async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-view-"));
  await cp(join(import.meta.dir, "../../examples"), dir, { recursive: true });
  return join(dir, "portal.buni");
};

test("buni open serves the design read-only: its pages, its own files, and nothing to anyone else", async () => {
  const file = await design();
  const { url, stop } = await serveViewer(file);
  try {
    expect(await (await fetch(url)).text()).toContain("<title>buni</title>");
    const snap: Snapshot = await (await fetch(`${url}design`)).json();
    expect(snap.name).toBe("portal.buni");
    expect(snap.boards.map((b) => b.name)).toEqual(["Home", "Pricing"]);
    expect(snap.boards[0]?.html).toContain("Steel that ships in a week.");
    expect(snap.links).toEqual([{ from: "home", to: "pricing" }]);
    // The design's images, from its folder; nothing outside it, however the path is spelled.
    expect((await fetch(`${url}files/assets/steel-rack.jpg`)).status).toBe(200);
    expect((await fetch(`${url}files/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${url}fonts/Manrope`)).headers.get("content-type")).toBe("font/woff2");
    // A page elsewhere that points its own name at this machine is refused.
    expect((await fetch(url, { headers: { host: "evil.example" } })).status).toBe(403);
  } finally {
    stop();
  }
});

test("an edit from anywhere reaches the open viewer, with the page as it is now", async () => {
  const file = await design();
  const { url, stop } = await serveViewer(file);
  const reader = (await fetch(`${url}events`)).body?.getReader();
  try {
    if (!reader) throw new Error("no event stream");
    await reader.read(); // the stream is open
    const ws = await Workspace.open(file);
    const frame = ws.view().pages.pricing?.frame ?? "";
    expect((await ws.call("test", "write_html", { parent: frame, html: "<p>Plans from $49</p>" })).ok).toBe(true);
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n\n")) {
      const r = await reader.read();
      if (r.done) break;
      text += decoder.decode(r.value);
    }
    const snap: Snapshot = JSON.parse(text.slice(text.indexOf("data: ") + 6, text.indexOf("\n\n")));
    expect(snap.boards.find((b) => b.id === "pricing")?.html).toContain("Plans from $49");
  } finally {
    await reader?.cancel();
    stop();
  }
}, 15_000);

test("edits shared beside the file show where each agent works: a layer on a page, or a part of the system", async () => {
  const file = await design();
  const ws = await Workspace.open(file);
  await ws.shareActivity();
  const frame = ws.view().pages.pricing?.frame ?? "";
  expect((await ws.call("claude", "write_html", { parent: frame, html: '<section layer-name="Plans"><p>Mild</p></section>' })).ok).toBe(true);
  expect((await ws.call("codex", "set_part", { part: "catalog", kind: "service", name: "Catalog", purpose: "Plans and prices.", api: "graphql" })).ok).toBe(true);
  // A one-shot buni call adds to what is there.
  const again = await Workspace.open(file);
  await again.shareActivity();
  expect(again.edits().map((e) => e.author)).toEqual(["claude", "codex"]);
  const { url, stop } = await serveViewer(file);
  try {
    const snap: Snapshot = await (await fetch(`${url}design`)).json();
    const [claude, codex] = snap.activity;
    expect(claude?.page).toBe("pricing");
    expect(snap.boards.find((b) => b.id === "pricing")?.html).toContain(`b-${claude?.node}`);
    expect(codex?.ref).toBe("part:catalog");
  } finally {
    stop();
  }
});
