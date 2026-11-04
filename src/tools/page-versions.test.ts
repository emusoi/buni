import { beforeEach, expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageVersionsOf } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { pagesChanged } from "./areas/page-versions.ts";
import { Workspace } from "./workspace.ts";

const example = new URL("../../examples/portal.buni", import.meta.url).pathname;
let file: string;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-versions-"));
  file = join(dir, "portal.buni");
  await copyFile(example, file);
});

test("a page's versions: saved with a note, restored as one edit, branched into a take, forgotten; the file keeps them", async () => {
  const ws = await Workspace.open(file);
  const before = ws.view();
  const layersBefore = Object.keys(before.nodes).length;
  expect((await ws.call("you", "versions", { page: "pricing" })).reply).toContain("no versions yet");
  const v1 = await ws.call("you", "save_version", { page: "pricing", note: "As designed" });
  expect(v1.ok).toBe(true);
  const id1 = v1.reply.match(/\((\w+)\)/)?.[1] ?? "";
  expect(pageVersionsOf(ws.view(), "pricing").map((v) => [v.n, v.by, v.note])).toEqual([[1, "you", "As designed"]]);

  // Change the page, then put v1 back: the added layer goes, as one undoable edit.
  const frame = ws.view().pages.pricing!.frame;
  const added = await ws.call("claude", "write_html", { parent: frame, html: "<p>Plans from $49</p>" });
  expect(added.ok).toBe(true);
  expect(Object.keys(ws.view().nodes).length).toBe(layersBefore + 1);
  expect(pagesChanged(before, ws.view())).toEqual(["pricing"]);
  const back = await ws.call("you", "restore_version", { version: id1 });
  expect(back.ok).toBe(true);
  expect(back.reply).toContain("v1 again");
  expect(Object.keys(ws.view().nodes).length).toBe(layersBefore);
  await ws.undo();
  expect(Object.keys(ws.view().nodes).length).toBe(layersBefore + 1);

  // A take from v1: its own layers, an option of the page, with the version named as its idea.
  const branched = await ws.call("you", "branch_version", { version: id1, name: "Pricing · as designed" });
  expect(branched.ok).toBe(true);
  const take = Object.values(ws.view().pages).find((p) => p.option?.of === "pricing");
  expect(take?.name).toBe("Pricing · as designed");
  expect(take?.option?.idea).toBe("From v1: As designed");
  expect(ws.view().nodes[take!.frame]).toBeDefined();
  expect(take!.frame).not.toBe(frame);

  const saved = parseDoc(serializeDoc(ws.view()));
  expect(saved.ok && Object.keys(saved.doc.versions).length).toBe(1);
  expect((await ws.call("you", "delete_version", { version: id1 })).ok).toBe(true);
  expect(pageVersionsOf(ws.view(), "pricing")).toEqual([]);
  // A file without versions is written as it was.
  expect(serializeDoc(ws.view())).not.toContain('"versions"');
});
