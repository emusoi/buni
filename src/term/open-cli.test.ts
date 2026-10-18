import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";

test("default browser opening and the --web alias never launch buni-tui", async () => {
  const dir = await mkdtemp("/tmp/buni-open-");
  try {
    const bin = join(dir, "fake-tui");
    await writeFile(bin, "#!/bin/sh\nexit 53\n");
    await chmod(bin, 0o700);
    for (const opener of ["open", "xdg-open"]) {
      await writeFile(join(dir, opener), "#!/bin/sh\nexit 0\n");
      await chmod(join(dir, opener), 0o700);
    }
    const file = join(dir, "design.buni");
    await writeFile(file, serializeDoc(emptyDoc()));
    for (const args of [[], ["--web"]]) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "open", file, ...args], {
        env: { ...process.env, BUNI_TUI_BIN: bin, PATH: `${dir}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
      });
      try {
        let output = "";
        const reader = child.stdout.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          output += new TextDecoder().decode(chunk.value);
          if (output.includes("(ctrl+c stops)")) break;
        }
        const url = output.match(/at (http:\/\/\S+) \(ctrl\+c stops\)/)?.[1];
        expect(url).toBeDefined();
        const page = await fetch(url!);
        expect(page.ok).toBe(true);
        expect(await page.text()).toContain("<!doctype html>");
      } finally { child.kill("SIGTERM"); await child.exited; }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 15_000);

test("browser opening without a file shows usage instead of waiting in a TUI", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "open"], {
    env: { ...process.env, BUNI_TUI_BIN: "/does-not-exist" }, stdout: "pipe", stderr: "pipe",
  });
  expect(await child.exited).toBe(2);
  expect(await new Response(child.stderr).text()).toContain("open <file.buni|folder>");
});
