import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../tools/workspace.ts";

test("restoring a saved version is one edit back to it, and undo returns to where you were", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-restore-"));
  const file = join(dir, "p.buni");
  await copyFile(new URL("../../examples/portal.buni", import.meta.url).pathname, file);
  const ws = await Workspace.open(file);
  const saved = structuredClone(ws.view());
  await ws.call("t", "set_text", { node: "home-headline", text: "Changed" });
  await ws.call("t", "tokens", { set: { "--new": "#123456" } });
  await ws.call("t", "write_html", { parent: "home-frame", html: "<p>Extra</p>" });
  const edited = JSON.stringify(ws.view());
  const r = await ws.restore("you", "Restore saved version", saved);
  expect(r.ok).toBe(true);
  expect(JSON.stringify(ws.view())).toBe(JSON.stringify(saved));
  await ws.undo();
  expect(JSON.stringify(ws.view())).toBe(edited);
});
