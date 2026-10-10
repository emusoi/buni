import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

// The core is open source and stands alone: the file format, the tools, the skills, MCP, drawing pages, the account
// and the shared browser editor. The hosted web builds on it; it never reaches back into the hosted product,
// nor loads Electron, so it can be published and contributed to on its own.
const ENGINE = ["format", "tools", "skills", "mcp", "oplog", "term", "account", "editor"];
// from "…", import "…" and import("…"): every way a module is loaded.
const LOAD = String.raw`(?:from\s*|import\s*\(?\s*)["']`;
const PRODUCT = new RegExp(`${LOAD}(?:\\.\\.?/)+(?:app|web)/`);
const ELECTRON = new RegExp(`${LOAD}electron["']`);

test("the engine imports nothing from the hosted app or Electron", async () => {
  const src = import.meta.dir;
  const files = ["cli.ts", "command.ts"];
  for (const dir of ENGINE) for await (const f of new Glob(`${dir}/**/*.{ts,tsx}`).scan(src)) files.push(f);
  const leaks: string[] = [];
  for (const f of files) {
    const text = await Bun.file(join(src, f)).text();
    text.split("\n").forEach((line, i) => {
      if (PRODUCT.test(line) || ELECTRON.test(line)) leaks.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(leaks).toEqual([]);
  expect(files.length).toBeGreaterThan(50);
});

test("a product installs the engine and imports its modules by path", () => {
  expect(import.meta.resolve("buni/format/doc.ts")).toBe(Bun.pathToFileURL(join(import.meta.dir, "format/doc.ts")).href);
  expect(import.meta.resolve("buni/examples/portal.buni")).toBe(Bun.pathToFileURL(join(import.meta.dir, "../examples/portal.buni")).href);
  expect(import.meta.resolve("buni/package.json")).toBe(Bun.pathToFileURL(join(import.meta.dir, "../package.json")).href);
});
