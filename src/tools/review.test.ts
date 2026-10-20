import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { findBrowser } from "../term/chrome.ts";
import { Workspace } from "./workspace.ts";

const browser = findBrowser();
async function design() {
  const dir = await mkdtemp(join(tmpdir(), "buni-review-"));
  const file = join(dir, "design.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  return { dir, ws: await Workspace.open(file) };
}

test.skipIf(!browser)("a review finds motion a careful reviewer sends back, on its layers, worst first; fixing it raises the score; pins aren't repeated", async () => {
  const { dir, ws } = await design();
  try {
    expect((await ws.call("agent", "create_page", { name: "Home" })).ok).toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    const html = `<main style="display:flex;flex-direction:column;gap:16px;padding:24px">
      <button layer-name="Buy" style="transition: all 600ms cubic-bezier(0.34, 1.56, 0.64, 1)">Buy</button>
      <div layer-name="Panel" style="transition: height 200ms ease-in; height: 40px">Panel</div>
      <p layer-name="Body">Plain words that stay put.</p>
    </main>`;
    expect((await ws.call("agent", "write_html", { parent: page.frame, html })).ok).toBe(true);
    const named = (name: string) => Object.values(ws.view().nodes).find((n) => n.name === name)!;
    const first = await ws.call("agent", "review_page", { page: page.id });
    expect(first.ok).toBe(true);
    for (const rule of ["bounce-easing", "slow-feedback", "transition-all", "layout-transition", "ease-in"]) expect(first.reply).toContain(rule);
    expect(first.reply).toContain(`(${named("Buy").id})`);
    expect(first.reply.indexOf("P2")).toBeLessThan(first.reply.indexOf("P3"));
    const before = Number(first.reply.match(/(\d+)\/100/)![1]);

    expect((await ws.call("agent", "review_page", { page: page.id, pin: true })).reply).toContain("Pinned 5 as comments.");
    expect((await ws.call("agent", "review_page", { page: page.id, pin: true })).reply).toContain("Already pinned.");
    expect(Object.values(ws.view().comments).find((c) => c.node === named("Panel").id)?.posts[0]?.body).toStartWith("[review: layout-transition] P2");

    await ws.call("agent", "update_styles", { nodes: [named("Buy").id], style: { transition: "background-color 150ms cubic-bezier(0.22, 1, 0.36, 1)" } });
    await ws.call("agent", "update_styles", { nodes: [named("Panel").id], style: { transition: "" } });
    const after = await ws.call("agent", "review_page", { page: page.id });
    expect(after.reply).toContain("100/100");
    expect(before).toBeLessThan(100);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(!browser)("motion on every section, and content left invisible are found; one hero entrance is not", async () => {
  const { dir, ws } = await design();
  try {
    expect((await ws.call("agent", "create_page", { name: "Landing" })).ok).toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    const sections = [1, 2, 3, 4, 5].map((i) => `<section layer-name="S${i}" style="padding:24px;min-height:320px"><h2>Section ${i}</h2></section>`).join("");
    const html = `<div layer-name="Root" style="display:flex;flex-direction:column">${sections}<p layer-name="Ghost" style="opacity:0">${"Hidden words. ".repeat(40)}</p></div>`;
    expect((await ws.call("agent", "write_html", { parent: page.frame, html })).ok).toBe(true);
    const named = (name: string) => Object.values(ws.view().nodes).find((n) => n.name === name)!;
    for (const i of [1, 2, 3, 4, 5]) await ws.call("agent", "set_motion", { node: named(`S${i}`).id, motion: [{ trigger: "load", effect: "rise", durationMs: 400, delayMs: i * 100 }] });
    const busy = await ws.call("agent", "review_page", { page: page.id });
    expect(busy.reply).toContain("motion-everywhere");
    expect(busy.reply).toContain("P1 hidden-at-rest");
    expect(busy.reply).not.toContain("no-reduced-motion");

    for (const i of [2, 3, 4, 5]) await ws.call("agent", "set_motion", { node: named(`S${i}`).id, motion: [] });
    await ws.call("agent", "update_styles", { nodes: [named("Ghost").id], style: { opacity: "" } });
    const calm = await ws.call("agent", "review_page", { page: page.id });
    expect(calm.reply).not.toContain("motion-everywhere");
    expect(calm.reply).not.toContain("hidden-at-rest");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);
