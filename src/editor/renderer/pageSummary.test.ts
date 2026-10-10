import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { pageSummary } from "./pageSummary.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");
const doc = r.doc;

test("a page reaches across to the system: its client, flows, links, calls, the parts behind them and what it serves", () => {
  const s = pageSummary(doc, "home");
  expect({
    client: s?.client?.name,
    flows: s?.flows.map((f) => f.name),
    out: s?.out.map((p) => p.id),
    in: s?.in.map((p) => p.id),
    calls: s?.calls.map((c) => c.value.id),
    parts: s?.parts.map((p) => p.name),
    // Served through the call it makes, not named directly.
    requirements: s?.requirements.map((q) => q.title),
  }).toEqual({
    client: "Customer portal", flows: ["Get a quote"], out: ["pricing"], in: [], calls: ["list-plans"], parts: ["Quote API"],
    requirements: ["A buyer sees every plan's price without signing in"],
  });
  expect(pageSummary(doc, "pricing")?.in.map((p) => p.id)).toEqual(["home"]);
  expect(pageSummary(doc, "nope")).toBeUndefined();
});
