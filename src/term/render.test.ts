import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser } from "./chrome.ts";
import { renderHeadless } from "./render.ts";

const portal = join(import.meta.dir, "../../examples/portal.buni");

// Runs wherever a Chrome, Chromium or Edge is installed, GitHub's runners included.
test.skipIf(!findBrowser())("a page draws to PNG and PDF with the browser on this machine", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-render-"));
  const png = join(dir, "home.png");
  expect(await renderHeadless({ file: portal, page: "Home", out: png, format: "png", scale: 2 })).toEqual({ ok: true, text: `Saved ${png}.` });
  const bytes = await readFile(png);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(2880); // the page's 1440 CSS px at 2x
  const pdf = join(dir, "home.pdf");
  expect((await renderHeadless({ file: portal, page: "/", out: pdf, format: "pdf" })).ok).toBe(true);
  expect((await readFile(pdf)).subarray(0, 4).toString()).toBe("%PDF");
  expect((await renderHeadless({ file: portal, page: "Nope", out: png, format: "png" })).text).toContain('No page "Nope"');
}, 60_000);

test("without a browser or the app it says what drawing needs", async () => {
  const was = process.env.BUNI_CHROME;
  process.env.BUNI_CHROME = "/nonexistent/chrome";
  try {
    const r = await renderHeadless({ file: portal, page: "home", out: "/tmp/x.png", format: "png" });
    expect(r.ok).toBe(false);
  } finally {
    if (was === undefined) delete process.env.BUNI_CHROME;
    else process.env.BUNI_CHROME = was;
  }
});

const tk = join(import.meta.dir, "../../examples/tk.buni");

test.skipIf(!findBrowser())("a terminal screen reads back as its characters, borders as box drawing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-cells-"));
  const txt = join(dir, "tasks.txt");
  expect((await renderHeadless({ file: tk, page: "Tasks", out: txt, format: "txt" })).ok).toBe(true);
  const lines = (await readFile(txt, "utf8")).split("\n").slice(0, -1);
  expect(lines).toHaveLength(36); // the screen's 36 rows
  expect(lines[0]).toStartWith(" tk · work");
  expect(lines[0]).toEndWith("12 open · 3 due today");
  // A border takes whole cells, and spaces in text are layout: the counts line up, inside a one-cell padding.
  expect(lines[2]).toBe(" ┌──────────────────────┐ ┌" + "─".repeat(91) + "┐");
  expect(lines[3]).toStartWith(" │ Lists                │ │ work");
  expect(lines[4]).toStartWith(" │ › work        12     │ │ [ ] Ship the export fix for Ferro");
  expect(lines[5]).toStartWith(" │   home         4     │");
  expect(lines.at(-2)).toMatch(/└─+┘ └─+┘/);
  expect(lines.at(-1)).toContain("↑↓ move · enter open");

  const ans = join(dir, "tasks.ans");
  expect((await renderHeadless({ file: tk, page: "Tasks", out: ans, format: "ans" })).ok).toBe(true);
  // A 16-colour screen speaks the terminal's palette: the selected task reversed, today in red, borders bright black,
  // and no colour spelled out, so it all follows the reader's theme.
  const coloured = await readFile(ans, "utf8");
  expect(coloured).toContain("\x1b[0;7m[ ]");
  expect(coloured).toContain("\x1b[0;31mtoday");
  expect(coloured).toContain("\x1b[0;7;41mtoday"); // red on the selected bar
  expect(coloured).toContain("\x1b[0;90m┌");
  expect(coloured).not.toContain(";2;");

  const notTerminal = await renderHeadless({ file: portal, page: "Home", out: txt, format: "txt" });
  expect(notTerminal).toEqual({ ok: false, text: "Home isn't a terminal screen; only those draw as text (set_screen makes one)." });
}, 60_000);
