import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { findBrowser } from "../term/chrome.ts";
import { allPatterns, patternFor, patternHeader, searchPatterns, setLibrary } from "./inspiration.ts";
import { Workspace } from "./workspace.ts";

const was = process.env.BUNI_HOME;
afterEach(() => { if (was === undefined) delete process.env.BUNI_HOME; else process.env.BUNI_HOME = was; });

const pattern = (name: string, tags: string, use: string) => `<!--
name: ${name}
tags: ${tags}
use: ${use}
why: One line,
  continued on the next.
seen in: Somewhere
-->
<!doctype html><html><head><style>:root{--ink:#111}main{padding:24px;color:var(--ink)}</style></head><body><main><h1>${name}</h1><p>Real words here.</p></main></body></html>`;

test("a pattern's header is read from its leading comment, continued lines and all; without the basics it isn't a pattern", () => {
  expect(patternHeader(pattern("Command palette", "navigation, Search", "Jump anywhere"))).toEqual({
    name: "Command palette", tags: ["navigation", "search"], use: "Jump anywhere", why: "One line, continued on the next.", seenIn: "Somewhere",
  });
  expect(patternHeader("<!-- name: x -->")).toBeUndefined();
  expect(patternHeader("<html></html>")).toBeUndefined();
});

test("search ranks a name above a tag above what it is for", () => {
  const p = (name: string, tags: string[], use: string) => ({ name, tags, use, library: "x", file: name });
  const found = searchPatterns([p("Settings sections", [], "x"), p("Account page", ["settings"], "x"), p("Profile", [], "change your settings")], "settings");
  expect(found.map((f) => f.name)).toEqual(["Settings sections", "Account page", "Profile"]);
});

test("a library added in settings joins buni's own, other settings are kept, and use_inspiration brings only library patterns in", async () => {
  const home = await mkdtemp(join(tmpdir(), "buni-insp-"));
  process.env.BUNI_HOME = home;
  try {
    await writeFile(join(home, "settings.json"), JSON.stringify({ model: { id: "m" } }));
    const mine = join(home, "mine");
    await mkdir(join(mine, "forms"), { recursive: true });
    await writeFile(join(mine, "forms/invoice.html"), pattern("Invoice editor", "forms, money", "Write and send an invoice"));
    await writeFile(join(home, "outside.html"), pattern("Outside", "x", "not in a library"));
    expect(await setLibrary(mine, true)).toEqual([mine]);
    expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8"))).toEqual({ model: { id: "m" }, inspiration: [mine] });
    const all = await allPatterns();
    expect(all.find((p) => p.name === "Invoice editor")).toMatchObject({ library: "mine", file: join(mine, "forms/invoice.html") });
    expect(await patternFor(join(home, "outside.html"))).toBeUndefined();
    expect(await patternFor("invoice editor")).toBeDefined();

    if (findBrowser()) {
      const file = join(home, "d.buni");
      await writeFile(file, serializeDoc(emptyDoc()));
      const ws = await Workspace.open(file);
      const used = await ws.call("agent", "use_inspiration", { pattern: "Invoice editor" });
      expect(used.ok).toBe(true);
      expect(Object.values(ws.view().pages).map((p) => p.name)).toEqual(["Inspiration · Invoice editor"]);
      expect((await ws.call("agent", "use_inspiration", { pattern: join(home, "outside.html") })).reply).toContain("No pattern");
      expect((await ws.call("agent", "find_inspiration", { query: "invoice" })).reply).toContain("Invoice editor (mine: forms/invoice.html)");
    }
    expect(await setLibrary(mine, false)).toEqual([]);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60_000);

test("save_inspiration keeps a page as a pattern in the person's own library, which joins the settings, and it comes back in another design", async () => {
  const home = await mkdtemp(join(tmpdir(), "buni-save-"));
  process.env.BUNI_HOME = home;
  try {
    const file = join(home, "d.buni");
    await writeFile(file, serializeDoc(emptyDoc()));
    const ws = await Workspace.open(file);
    await ws.call("agent", "create_page", { name: "Billing" });
    const page = Object.values(ws.view().pages)[0]!;
    await ws.call("agent", "write_html", { parent: page.frame, html: `<section layer-name="Plan card" style="padding:24px;border:1px solid #ddd"><h2>Team plan</h2><p>$12 a seat, billed monthly.</p></section>` });
    const card = Object.values(ws.view().nodes).find((n) => n.name === "Plan card")!;
    const saved = await ws.call("agent", "save_inspiration", { page: page.id, node: card.id, name: "Plan card", use: "Show the current plan and its price", tags: ["billing"] });
    expect(saved.reply).toContain(join(home, "inspiration/plan-card.html"));
    const text = await readFile(join(home, "inspiration/plan-card.html"), "utf8");
    expect(patternHeader(text)).toMatchObject({ name: "Plan card", tags: ["billing"], use: "Show the current plan and its price", seenIn: "Billing · Plan card" });
    expect(text).toContain("$12 a seat, billed monthly.");
    expect((await allPatterns()).some((p) => p.name === "Plan card" && p.library === "inspiration")).toBe(true);
    if (findBrowser()) {
      const other = join(home, "e.buni");
      await writeFile(other, serializeDoc(emptyDoc()));
      const ws2 = await Workspace.open(other);
      expect((await ws2.call("agent", "use_inspiration", { pattern: "Plan card" })).ok).toBe(true);
      expect(Object.values(ws2.view().nodes).some((n) => n.kind === "text" && n.text === "$12 a seat, billed monthly.")).toBe(true);
    }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60_000);
