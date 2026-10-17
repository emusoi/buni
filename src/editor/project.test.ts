import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "buni/format/doc.ts";
import { serializeDoc } from "buni/format/serialize.ts";
import { DiskStore } from "./store.ts";
import { ProjectIndex, summaries } from "./project.ts";

test("the project index reads a design once, again only when it changes, and sums uses across designs", async () => {
  const root = await mkdtemp(join(tmpdir(), "buni-index-"));
  await mkdir(join(root, "app"));
  const core = emptyDoc();
  core.nodes.b = { id: "b", kind: "frame", index: "a0", name: "Button", style: {} };
  core.shared.btn = { id: "btn", name: "Buttons / Primary", root: "b" };
  const site = emptyDoc();
  site.imports = ["core.buni"];
  site.nodes.f = { id: "f", kind: "frame", index: "a0", name: "Home", style: {} };
  site.nodes.i = { id: "i", kind: "instance", parent: "f", index: "a0", name: "Button", style: {}, shared: "btn", overrides: {} };
  site.pages.home = { id: "home", name: "Home", route: "/", frame: "f", index: "a0" };
  await writeFile(join(root, "app", "core.buni"), serializeDoc(core));
  await writeFile(join(root, "app", "site.buni"), serializeDoc(site));
  const store = new DiskStore(root);
  const reads: string[] = [];
  const read = store.read.bind(store);
  store.read = async (path) => { reads.push(path); return read(path); };
  const index = new ProjectIndex(store);
  const files = await index.docs("/designs");
  expect(reads.length).toBe(2);
  const list = summaries(files, () => "/designs/app");
  expect(list.find((f) => f.name === "core")?.components).toEqual([{ id: "btn", name: "Buttons / Primary", usedElsewhere: 1 }]);
  expect(list.find((f) => f.name === "site")?.pages).toEqual([{ id: "home", name: "Home", route: "/" }]);
  // Asked again with nothing changed: nothing is read.
  await index.docs("/designs");
  expect(reads.length).toBe(2);
  // One changes: only it is read again.
  await new Promise((r) => setTimeout(r, 15));
  await writeFile(join(root, "app", "site.buni"), serializeDoc({ ...site, pages: {}, nodes: {} }));
  await index.docs("/designs");
  expect(reads.length).toBe(3);
  expect(reads.filter((p) => p.endsWith("core.buni")).length).toBe(1);
});
