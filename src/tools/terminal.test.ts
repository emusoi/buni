import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, type Doc } from "../format/doc.ts";
import { contextText } from "./context.ts";
import { forTarget, gridProblems, terminalNotes } from "./terminal.ts";
import { renderPage } from "./html.ts";
import { Workspace } from "./workspace.ts";

function cli(): Doc {
  const doc = emptyDoc();
  doc.parts.tui = { id: "tui", kind: "client", name: "crew TUI", purpose: "Watch agents", terminal: { targets: [{ language: "go", framework: "bubbletea" }, { language: "rust", framework: "ratatui" }, { language: "typescript", framework: "opentui" }] }, index: "a" };
  const screen = (id: string, terminal: NonNullable<Doc["pages"][string]["terminal"]>) => {
    doc.nodes[`${id}-f`] = { id: `${id}-f`, kind: "frame", index: "a0", name: id, style: {} };
    doc.pages[id] = { id, name: id, frame: `${id}-f`, index: id, client: "tui", terminal };
  };
  screen("Agents", { surface: "app", cols: 120, rows: 36, colors: "truecolor" });
  screen("Keys", { surface: "tmux-popup", cols: 48, rows: 12, colors: "16" });
  doc.connections.k = { id: "k", page: "Agents", node: "Agents-f", to: "Keys", trigger: "key", key: "?", transition: "none", durationMs: 0 };
  doc.connections.m = { id: "m", page: "Keys", node: "Keys-f", to: "Agents", trigger: "click", transition: "none", durationMs: 0 };
  return doc;
}

test("terminal screens are checked for keys, colour and the 80-column case", () => {
  expect(terminalNotes(cli())).toEqual([
    "Keys has no keys linked; say how to move, act and leave.",
    "Keys reaches Agents only with the mouse; give it a key.",
    "crew TUI is designed for more than 16 colours (Agents); say what it looks like with 16 colours and with colour off.",
    "crew TUI's screens are all wider than 80 columns; design what it shows at 80×24.",
  ]);
});

test("the brief lists every build, or speaks one framework's words for one target", () => {
  const all = contextText(cli(), { part: "tui" });
  if (!all.ok) throw new Error(all.error);
  expect(all.text).toContain("the same screens are built 3 ways, to compare:\n    - Go with Bubble Tea");
  expect(all.text).toContain("- Agents (Agents): full-screen app (alternate screen), 120×36, designed for full colour; keys: ? → Keys");
  const one = forTarget(cli(), "ratatui");
  if (!one) throw new Error("ratatui is a target");
  const r = contextText(one, { part: "tui" });
  if (!r.ok) throw new Error(r.error);
  expect(r.text).toContain("runs in a terminal, written in Rust with Ratatui (a Block per bordered box");
  expect(r.text).not.toContain("Bubble Tea");
  expect(forTarget(cli(), "textual")).toBeUndefined();
});

test("a flow's brief is its pages in order, how they link, and what they call", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseDoc } = await import("../format/parse.ts");
  const r = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
  if (!r.ok) throw new Error("example does not parse");
  const t = contextText(r.doc, { flow: "get-a-quote" });
  if (!t.ok) throw new Error(t.error);
  expect(t.text).toContain("## Pages, in order\n1. Home (home) /\n2. Pricing (pricing) /pricing");
  expect(t.text).toContain("- Home → Pricing: click See pricing");
  expect(t.text).toContain("**GET /plans** (list-plans)");
  expect(contextText(r.doc, { flow: "nope" })).toEqual({ ok: false, error: 'flow "nope" does not exist' });
});

const copy = async (name: string) => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-grid-")), name);
  await copyFile(join(import.meta.dir, "../../examples", name), file);
  return Workspace.open(file);
};

test("the terminal example keeps to the grid", async () => {
  const ws = await copy("tk.buni");
  expect(gridProblems(ws.view(), Object.keys(ws.view().nodes))).toEqual([]);
});

test("an edit on a terminal screen says what a terminal can't draw; a clean one and web pages say nothing", async () => {
  const ws = await copy("tk.buni");
  const frame = Object.values(ws.view().pages)[0]?.frame ?? "";
  const bad = await ws.call("test", "write_html", {
    parent: frame,
    html: '<div layer-name="Bad" style="padding:10px 9px;font-size:13px;color:#ff0000;box-shadow:0 1px 2px black;border:1px dashed var(--term-red)"><buni-icon name="search"></buni-icon></div>',
  });
  expect(bad.ok).toBe(true);
  expect(bad.reply).toContain("On the terminal grid:");
  for (const rule of ["10px isn't whole rows (18px)", "sets fontSize", "#ff0000", "boxShadow", "1px dashed isn't a box-drawing border", '"search" is a picture']) expect(bad.reply).toContain(rule);

  const good = await ws.call("test", "write_html", { parent: frame, html: '<div layer-name="Good" style="padding:0 9px;gap:18px 9px;color:var(--term-green);border:1px solid var(--term-bright-black)"><p style="margin:0">ok</p></div>' });
  expect(good.reply).not.toContain("On the terminal grid");

  const web = await copy("portal.buni");
  const page = Object.values(web.view().pages)[0]?.frame ?? "";
  expect((await web.call("test", "write_html", { parent: page, html: '<div style="padding:10px;font-size:13px">web</div>' })).reply).not.toContain("terminal grid");
});

test("a component placed on a terminal screen draws in cells there, like the screen's own layers", async () => {
  const ws = await copy("tk.buni");
  const page = Object.values(ws.view().pages)[0];
  const lists = Object.values(ws.view().nodes).find((n) => n.name === "Lists");
  if (!page || !lists) throw new Error("tk.buni has a Lists box");
  expect((await ws.call("test", "make_component", { node: lists.id, name: "Panels / Lists" })).ok).toBe(true);
  const { css } = renderPage(ws.view(), page.id);
  // The shared rule is for web pages; the screen's own rule, under its frame, gives the border whole cells.
  expect(css).toContain(`.b-${page.frame} .b-${lists.id} {`);
  expect(css).toContain(`.b-${page.frame} .b-${lists.id}::before {`);
});
