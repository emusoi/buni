import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { Workspace } from "./workspace.ts";

test("pages are tagged and untagged in bulk, kept tidy, shown in the tree, and survive the file", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-tags-")), "portal.buni");
  await copyFile(new URL("../../examples/portal.buni", import.meta.url).pathname, file);
  const ws = await Workspace.open(file);
  const ids = Object.keys(ws.view().pages);
  expect((await ws.call("you", "set_tags", { pages: ids, add: ["Next", " #Mobile  web", "next"] })).ok).toBe(true);
  for (const id of ids) expect(ws.view().pages[id]?.tags).toEqual(["next", "mobile-web"]);
  expect((await ws.call("claude", "set_tags", { pages: [ids[0]!], remove: ["NEXT"] })).ok).toBe(true);
  expect(ws.view().pages[ids[0]!]?.tags).toEqual(["mobile-web"]);
  expect((await ws.call("claude", "read_tree", {})).reply).toContain("#next #mobile-web");
  expect((await ws.call("you", "set_tags", { pages: ["nope"], add: ["x"] })).ok).toBe(false);
  // Taking the last one off leaves no empty list behind.
  await ws.call("you", "set_tags", { pages: [ids[0]!], remove: ["mobile-web"] });
  expect(ws.view().pages[ids[0]!]?.tags).toBeUndefined();

  const back = parseDoc(serializeDoc(ws.view()));
  expect(back.ok && back.doc.pages[ids[1]!]?.tags).toEqual(["next", "mobile-web"]);
  // A file with a tag that isn't one is refused, saying why.
  const bad = serializeDoc(ws.view()).replace('"mobile-web"', '"Mobile Web"');
  expect(parseDoc(bad).ok).toBe(false);
});
