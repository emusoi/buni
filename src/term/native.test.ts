import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("buni open hands the terminal and unmodified arguments to the native renderer", async () => {
  const dir = await mkdtemp("/tmp/buni-native-");
  try {
    const bin = join(dir, "fake-tui");
    await writeFile(bin, '#!/usr/bin/env bun\nconsole.log(JSON.stringify(process.argv.slice(2)));\n');
    await chmod(bin, 0o700);
    for (const args of [[], ["a design.buni", "--halfblocks"]]) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "open", ...args], {
        env: { ...process.env, BUNI_TUI_BIN: bin }, stdout: "pipe", stderr: "pipe",
      });
      const stdout = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(JSON.parse(stdout)).toEqual(["open", ...args]);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("explicit web opening still uses the web editor path", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "open", "missing.buni", "--web", "--port", "invalid"], {
    env: { ...process.env, BUNI_TUI_BIN: "/does-not-exist" }, stdout: "pipe", stderr: "pipe",
  });
  expect(await child.exited).toBe(2);
  expect(await new Response(child.stderr).text()).toContain("usage: buni open");
});
