import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { applyChange } from "../oplog/oplog.ts";
import { emptyDoc, type Doc } from "./doc.ts";
import { parseDoc } from "./parse.ts";
import { applyPatch, diffDoc, sharing } from "./patch.ts";

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

test("sharing keeps the objects of unchanged entries, and whole bags when nothing in them changed", () => {
  const prev = emptyDoc();
  prev.nodes.a = { id: "a", kind: "frame", index: "a0", name: "A", style: {} };
  prev.nodes.b = { id: "b", kind: "frame", index: "a1", name: "B", style: {} };
  const next: Doc = JSON.parse(JSON.stringify(prev));
  next.nodes.b = { id: "b", kind: "frame", index: "a1", name: "B2", style: {} };
  const out = sharing(prev, next);
  expect(out.nodes.a).toBe(prev.nodes.a);
  expect(out.nodes.b).not.toBe(prev.nodes.b);
  expect(out.nodes.b?.name).toBe("B2");
  expect(out.pages).toBe(prev.pages);
});
