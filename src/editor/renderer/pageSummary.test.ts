import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { pageSummary } from "./pageSummary.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");
const doc = r.doc;

test("a page reaches across the file: the flows it is in, and the pages it links to and from", () => {
  const s = pageSummary(doc, "home");
  expect({
    flows: s?.flows.map((f) => f.name),
    out: s?.out.map((p) => p.id),
    in: s?.in.map((p) => p.id),
    away: s?.away.length,
  }).toEqual({ flows: ["Get a quote"], out: ["pricing"], in: [], away: 0 });
  expect(pageSummary(doc, "pricing")?.in.map((p) => p.id)).toEqual(["home"]);
  expect(pageSummary(doc, "nope")).toBeUndefined();
});
