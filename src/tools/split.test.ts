import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withImports } from "../format/doc.ts";
import { parseDoc, validateDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { splitCore } from "./split.ts";

const parsed = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
if (!parsed.ok) throw new Error("example is invalid");
const doc = parsed.doc;

test("a core holds the components and tokens; an id in both files is refused, and references into the core resolve", () => {
  const r = splitCore(doc, "core.buni");
  if (typeof r === "string") throw new Error(r);
  expect(Object.keys(r.moved.shared)).toEqual(["nav"]);
  expect(r.rest.shared).toEqual({});
  expect(r.rest.imports).toEqual(["core.buni"]);
  // Alone, the rest has dangling uses; with its core it is valid.
  expect(validateDoc(r.rest).length).toBeGreaterThan(0);
  expect(validateDoc(r.rest, r.moved)).toEqual([]);
  expect(parseDoc(serializeDoc(r.rest), { context: r.moved }).ok).toBe(true);
  const clash = structuredClone(r.rest);
  clash.shared["nav"] = r.moved.shared["nav"]!;
  expect(validateDoc(clash, r.moved)).toContainEqual({ path: "shared.nav", message: '"nav" is also in an imported file; ids are unique across files' });
  expect(Object.keys(withImports(r.rest, r.moved).shared)).toContain("nav");
});

test("a section's override on a layer its core has since removed is left alone, not an error", () => {
  const r = splitCore(doc, "core.buni");
  if (typeof r === "string") throw new Error(r);
  const use = Object.values(r.rest.nodes).find((n) => n.kind === "instance");
  if (use?.kind !== "instance") throw new Error("portal has no component use");
  use.overrides["gone-layer"] = { text: "x" };
  expect(validateDoc(r.rest, r.moved)).toEqual([]);
});
