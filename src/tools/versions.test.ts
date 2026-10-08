import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkImage } from "./assets.ts";
import { restoreVersion, saveVersion, versionsOf } from "./versions.ts";
import { diskStore, Workspace } from "./workspace.ts";

test("versions are saved beside the design, listed newest first, and restored as one edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-versions-"));
  const file = join(dir, "p.buni");
  await copyFile(new URL("../../examples/portal.buni", import.meta.url).pathname, file);
  const ws = await Workspace.open(file);
  const first = await saveVersion(diskStore, ws, "Before");
  await ws.call("t", "set_text", { node: "home-headline", text: "Changed" });
  await saveVersion(diskStore, ws, "After");
  expect((await versionsOf(diskStore, file)).map((v) => v.name)).toEqual(["After", "Before"]);
  expect((await restoreVersion(diskStore, ws, first.id)).ok).toBe(true);
  expect(ws.view().nodes["home-headline"]).toMatchObject({ text: "Steel that ships in a week." });
  expect((await restoreVersion(diskStore, ws, "nope")).ok).toBe(false);
});

test("an image is kept only when it is an image of a size we take, under a safe name", () => {
  const png = btoa("\\x89PNG");
  expect(checkImage("../My Logo!.png", png, "image/png")).toMatchObject({ stem: "My-Logo", ext: "png" });
  expect(checkImage("x.exe", png, "application/x-msdownload")).toEqual({ error: "Only PNG, JPEG, GIF, WebP, AVIF or SVG images" });
});
