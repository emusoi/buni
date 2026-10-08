import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withImports } from "../format/doc.ts";
import { parseDoc, validateDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { splitPart } from "./split.ts";

const parsed = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
if (!parsed.ok) throw new Error("example is invalid");
const doc = parsed.doc;

test("a part moves with its operations, links, placements and shapes; each half checks clean against the other", () => {
  const r = splitPart(doc, "catalog", "portal.buni", "catalog.buni");
  if (typeof r === "string") throw new Error(r);
  expect(Object.keys(r.moved.parts)).toEqual(["catalog"]);
  expect(Object.keys(r.moved.operations).sort()).toEqual(["plan-changed", "plans-query", "update-plan"]);
  expect(Object.keys(r.moved.links).sort()).toEqual(["catalog-cache", "catalog-pg"]);
  expect(Object.keys(r.moved.placements)).toEqual(["catalog-prod"]);
  expect(Object.keys(r.moved.shapes)).toEqual(["plan"]);
  expect(r.rest.parts["catalog"]).toBeUndefined();
  expect(r.rest.imports).toEqual(["catalog.buni"]);
  expect(r.moved.imports).toEqual(["portal.buni"]);
  // Alone, each half has dangling references; together they are one valid system.
  expect(validateDoc(r.rest).length).toBeGreaterThan(0);
  expect(validateDoc(r.rest, r.moved)).toEqual([]);
  expect(validateDoc(r.moved, r.rest)).toEqual([]);
  expect(parseDoc(serializeDoc(r.moved), { context: r.rest }).ok).toBe(true);
});

test("an id in two files is refused; references into the other file resolve", () => {
  const r = splitPart(doc, "catalog", "portal.buni", "catalog.buni");
  if (typeof r === "string") throw new Error(r);
  const clash = structuredClone(r.rest);
  clash.shapes["plan"] = r.moved.shapes["plan"]!;
  expect(validateDoc(clash, r.moved)).toContainEqual({ path: "shapes.plan", message: '"plan" is also in an imported file; ids are unique across files' });
  expect(Object.keys(withImports(r.rest, r.moved).operations)).toContain("update-plan");
});

test("splitting a part that doesn't exist says so", () => {
  expect(splitPart(doc, "ghost", "a.buni", "b.buni")).toBe('part "ghost" does not exist');
});
