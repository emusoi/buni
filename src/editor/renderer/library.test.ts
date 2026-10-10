import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { libraryGroups, libraryItems } from "./library.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");

test("components group by their 'Group / Name', count uses and pages, and filter", () => {
  const doc = structuredClone(r.doc);
  const nav = Object.values(doc.shared)[0];
  if (!nav) throw new Error("example has a component");
  nav.name = "Navigation / Public nav";
  doc.shared.extra = { id: "extra", name: "Old banner", root: nav.root };
  const items = libraryItems(doc);
  const navItem = items.find((i) => i.id === nav.id);
  expect([navItem?.name, navItem?.group, navItem?.uses, [...(navItem?.pages ?? [])].sort()]).toEqual(["Public nav", "Navigation", 2, ["home", "pricing"]]);
  expect(libraryGroups(items, "", "all", undefined).map((g) => g.name)).toEqual(["Navigation", "Unsorted"]);
  expect(libraryGroups(items, "", "unused", undefined).map((g) => g.items.map((i) => i.id))).toEqual([["extra"]]);
  expect(libraryGroups(items, "nav", "here", "pricing").map((g) => g.items.map((i) => i.id))).toEqual([[nav.id]]);
});
