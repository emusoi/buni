import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { captureDocument } from "./capture.ts";

test("a capture owns an immutable document and rebases imported image attachments", async () => {
  const dir = await mkdtemp("/tmp/buni-capture-");
  try {
  await mkdir(join(dir, "shared"));
  const core = emptyDoc();
  core.attachments.pic = { id: "pic", path: "photo.png", mime: "image/png" };
  core.nodes.image = { id: "image", index: "a0", kind: "image", name: "Photo", style: {}, asset: "pic", alt: "A photo" };
  core.shared.photo = { id: "photo", name: "Media / Photo", root: "image" };
  await writeFile(join(dir, "shared/core.buni"), serializeDoc(core));
  const doc = emptyDoc();
  doc.imports = ["shared/core.buni"];
  doc.pages.home = { id: "home", name: "Home", frame: "root", index: "a0" };
  doc.nodes.root = { id: "root", kind: "frame", index: "a0", name: "Root", style: { width: "1440px" } };
  doc.nodes.use = { id: "use", kind: "instance", parent: "root", index: "a0", name: "Photo", style: {}, shared: "photo", overrides: {} };
  await writeFile(join(dir, "app.buni"), serializeDoc(doc));
  const snap = await captureDocument(join(dir, "app.buni"), "home");
  expect(snap.doc.attachments.pic?.path).toBe("shared/photo.png");
  expect(snap.owners.home).toBe(join(dir, "app.buni"));
  expect(snap.owners.image).toBe(join(dir, "shared/core.buni"));
  expect(snap.revision).toMatch(/^[a-f0-9]{16}$/);
  doc.pages.home.name = "Changed";
  await writeFile(join(dir, "app.buni"), serializeDoc(doc));
  expect(snap.doc.pages.home?.name).toBe("Home");
  expect((await captureDocument(join(dir, "app.buni"), "home")).revision).not.toBe(snap.revision);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
