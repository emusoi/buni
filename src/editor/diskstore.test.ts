import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStore } from "./store.ts";

test("local designs are files in place: read, written whole, listed one folder down, never moved or removed by folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-disk-"));
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app", "a.buni"), "{}");
  await writeFile(join(root, "app", "notes.md"), "not a design");
  const store = new DiskStore(root);
  expect(await store.read("/designs/app/a.buni")).toBe("{}");
  await store.write("/designs/app/b.buni", '{"b":1}');
  expect(await readFile(join(root, "app", "b.buni"), "utf8")).toBe('{"b":1}');
  expect((await store.list("/designs")).map((f) => f.path).sort()).toEqual(["/designs/app/a.buni", "/designs/app/b.buni"]);
  // Nothing outside the folder, however the path is spelled.
  await expect(store.read("/designs/../secret")).rejects.toThrow("outside your designs");
  await expect(store.read("/elsewhere/app/a.buni")).rejects.toThrow("outside your designs");
  // A design's folder holds other designs on disk, so it is never moved or removed from the editor.
  await expect(store.removeDir("/designs/app")).rejects.toThrow("Finder");
  await expect(store.moveDir("/designs/app", "/designs/x")).rejects.toThrow("Finder");
});
