import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, optionsOf } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { parseDoc } from "../format/parse.ts";
import { findBrowser } from "../term/chrome.ts";
import { Workspace } from "./workspace.ts";

async function design() {
  const dir = await mkdtemp(join(tmpdir(), "buni-options-"));
  const file = join(dir, "d.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  return { dir, ws: await Workspace.open(file) };
}

test("explore_page makes unlinked options with no route; pick_option swaps one in, links and flows follow, the old page becomes an option", async () => {
  const { dir, ws } = await design();
  try {
    await ws.call("agent", "create_page", { name: "Home", route: "/" });
    await ws.call("agent", "create_page", { name: "Pricing", route: "/pricing" });
    const home = Object.values(ws.view().pages).find((p) => p.name === "Home")!;
    const pricing = Object.values(ws.view().pages).find((p) => p.name === "Pricing")!;
    await ws.call("agent", "write_html", { parent: pricing.frame, html: `<a layer-name="Back">Home</a>` });
    const back = Object.values(ws.view().nodes).find((n) => n.name === "Back")!;
    await ws.call("agent", "connect", { node: back.id, to: home.id });
    await ws.call("agent", "set_flow", { name: "Visit", start: home.id });
    await ws.call("agent", "write_html", { parent: home.frame, html: `<h1 layer-name="Title">Hello</h1>` });

    const made = await ws.call("agent", "explore_page", { page: home.id, options: [{ name: "Proof first", idea: "Trust before price" }, { name: "Form first", idea: "Ask up front" }] });
    expect(made.ok).toBe(true);
    const options = optionsOf(ws.view(), home.id);
    expect(options.map((p) => [p.name, p.route, p.option?.idea])).toEqual([["Home · Proof first", undefined, "Trust before price"], ["Home · Form first", undefined, "Ask up front"]]);
    // Not linked: a change on an option stays there.
    const title = (pageFrame: string) => Object.values(ws.view().nodes).find((n) => n.name === "Title" && n.parent === pageFrame)!;
    await ws.call("agent", "update_styles", { nodes: [title(options[0]!.frame).id], style: { color: "red" } });
    expect(title(home.frame).style.color).toBeUndefined();
    expect(title(options[0]!.frame).twin).toBeUndefined();
    expect((await ws.call("agent", "explore_page", { page: options[0]!.id, options: [{ name: "x", idea: "y" }] })).reply).toContain("is itself an option");

    const picked = await ws.call("agent", "pick_option", { option: options[0]!.id, why: "Buyers trust lead times first" });
    expect(picked.reply).toContain("Home · Proof first is live at /");
    const doc = ws.view();
    expect(doc.pages[options[0]!.id]).toMatchObject({ route: "/" });
    expect(doc.pages[options[0]!.id]!.option).toBeUndefined();
    expect(doc.pages[home.id]!.route).toBeUndefined();
    expect(doc.pages[home.id]!.option?.of).toBe(options[0]!.id);
    expect(doc.pages[options[1]!.id]!.option?.of).toBe(options[0]!.id);
    expect(Object.values(doc.connections).find((c) => c.node === back.id)?.to).toBe(options[0]!.id);
    expect(Object.values(doc.flows)[0]!.start).toBe(options[0]!.id);
    expect(Object.values(doc.decisions).at(-1)!.text).toContain("Buyers trust lead times first");
    expect(parseDoc(serializeDoc(doc)).ok).toBe(true);

    // Deleting the live page leaves its options as pages of their own.
    await ws.call("agent", "delete_page", { page: options[0]!.id });
    expect(Object.values(ws.view().pages).every((p) => !p.option)).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("pick_option with others: delete keeps only the chosen one; an option with a route doesn't load", async () => {
  const { dir, ws } = await design();
  try {
    await ws.call("agent", "create_page", { name: "Home", route: "/" });
    const home = Object.values(ws.view().pages)[0]!;
    await ws.call("agent", "explore_page", { page: home.id, options: [{ name: "A", idea: "a" }, { name: "B", idea: "b" }] });
    const [a] = optionsOf(ws.view(), home.id);
    expect((await ws.call("agent", "pick_option", { option: a!.id, why: "clearer", others: "delete" })).reply).toContain("Deleted Home · B");
    expect(Object.values(ws.view().pages).map((p) => p.name).sort()).toEqual(["Home", "Home · A"]);
    const doc = ws.view();
    const routed = { ...doc, pages: { ...doc.pages, [a!.id]: { ...doc.pages[a!.id]!, option: { of: home.id, idea: "a" } } } };
    const bad = parseDoc(serializeDoc(routed));
    expect(bad.ok ? [] : bad.errors.map((e) => e.message)).toContain("an option has no route of its own while it is one; pick_option gives it its page's");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test.skipIf(!findBrowser())("compare_options reviews the page and its options, best first", async () => {
  const { dir, ws } = await design();
  try {
    await ws.call("agent", "create_page", { name: "Home", route: "/" });
    const home = Object.values(ws.view().pages)[0]!;
    await ws.call("agent", "write_html", { parent: home.frame, html: `<p style="color:#ccc;font-size:10px">Faint</p>` });
    await ws.call("agent", "explore_page", { page: home.id, options: [{ name: "Clear", idea: "Readable words" }] });
    const [clear] = optionsOf(ws.view(), home.id);
    const p = Object.values(ws.view().nodes).find((n) => n.parent === clear!.frame)!;
    await ws.call("agent", "update_styles", { nodes: [p.id], style: { color: "#222", fontSize: "16px" } });
    const r = await ws.call("agent", "compare_options", { page: clear!.id });
    expect(r.reply).toMatch(/^Home and its 1 option, best first:\nHome · Clear \(\w+\): 100\/100[^\n]*\n  bets on: Readable words\nLIVE Home/);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);
