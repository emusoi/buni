import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { applyChange } from "../oplog/oplog.ts";
import type { Doc } from "./doc.ts";
import { parseDoc } from "./parse.ts";
import { applyPatch, diffDoc } from "./patch.ts";

function example(): Doc {
  const r = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
  if (!r.ok) throw new Error("example is invalid");
  return r.doc;
}

test("a patch carries one version to the next, and only what changed", () => {
  const a = example();
  const headline = a.nodes["home-headline"];
  if (!headline) throw new Error("no headline");
  const r = applyChange(a, {
    id: "c", label: "edit",
    ops: [
      { kind: "put", collection: "nodes", value: { ...headline, style: { ...headline.style, color: "#000" } } },
      { kind: "delete", collection: "comments", id: "c1" },
      { kind: "token", name: "--color-accent", value: "#2433A6" },
    ],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const b = { ...r.doc, imports: ["other.buni"] };

  const patch = diffDoc(a, b);
  expect(Object.keys(patch.bags).sort()).toEqual(["comments", "nodes", "tokens"]);
  expect(Object.keys(patch.bags.nodes?.put ?? {})).toEqual(["home-headline"]);
  expect(patch.bags.comments?.removed).toEqual(["c1"]);

  const got = applyPatch(a, patch);
  expect(got).toEqual(b);
  expect(got.pages).toBe(a.pages);
  expect(got.nodes["home-frame"]).toBe(a.nodes["home-frame"]);
  // And back: the import list goes away again.
  expect(applyPatch(got, diffDoc(b, a))).toEqual(a);
});
