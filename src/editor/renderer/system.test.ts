import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { apiGraph, cacheGraph, callArgs, callOf, callWires, erLayout, shapesGraph, linkKindFor, positionOf, stalenessGrid, systemLayout, topologyLayout, traceLanes } from "./system.ts";

const parsed = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!parsed.ok) throw new Error("example is invalid");
const doc = parsed.doc;

test("parts start in columns a request travels through: client, services, queue, stores", () => {
  const { cards } = systemLayout(doc);
  const x = (id: string) => cards.get(id)?.x ?? -1;
  expect(x("web")).toBe(0);
  expect(x("quote-api")).toBe(x("mailer"));
  expect(x("web") < x("quote-api") && x("quote-api") < x("jobs") && x("jobs") < x("pg")).toBe(true);
  expect(x("edge-cache")).toBe(x("pg"));
});

test("a part someone placed stays where they put it", () => {
  const { cards } = systemLayout(doc);
  expect(positionOf({ ...doc.parts["pg"]!, x: 7, y: 9 }, cards)).toEqual({ x: 7, y: 9 });
  expect(positionOf(doc.parts["pg"]!, cards)).toEqual({ x: cards.get("pg")!.x, y: cards.get("pg")!.y });
});

test("a drag between parts becomes the link it most likely means, or none", () => {
  const p = doc.parts;
  expect(linkKindFor(p["web"]!, p["quote-api"]!)).toBe("calls");
  expect(linkKindFor(p["quote-api"]!, p["edge-cache"]!)).toBe("writes");
  expect(linkKindFor(p["quote-api"]!, p["jobs"]!)).toBe("publishes");
  expect(linkKindFor(p["pg"]!, p["quote-api"]!)).toBeUndefined();
  expect(linkKindFor(p["web"]!, p["web"]!)).toBeUndefined();
});

test("the staleness grid: set where a write names the read, missing where it writes what the read reads", () => {
  const { reads, writes, cell } = stalenessGrid(doc);
  const r = (id: string) => reads.find((c) => c.value.id === id)!;
  const w = (id: string) => writes.find((c) => c.value.id === id)!;
  expect(reads.map((c) => c.value.id)).toEqual(["list-plans", "plans-query"]);
  expect(cell(w("update-plan"), r("plans-query"))).toBe("set");
  expect(cell(w("create-quote"), r("list-plans"))).toBe("none");
  const d = structuredClone(doc);
  d.operations["update-plan"]!.invalidates = ["plans-query"];
  const g = stalenessGrid(d);
  expect(g.cell(g.writes.find((c) => c.value.id === "update-plan")!, g.reads.find((c) => c.value.id === "list-plans")!)).toBe("missing");
});

test("a call saves back through its own tool with one field changed", () => {
  const { tool, args } = callArgs(callOf(doc, "update-plan")!, { invalidates: [] });
  expect(tool).toBe("set_operation");
  expect(args).toMatchObject({ operation: "update-plan", kind: "mutation", name: "updatePlan", returns: "Plan", invalidates: [] });
  expect(callArgs(callOf(doc, "create-quote")!).args).toMatchObject({ endpoint: "create-quote", method: "POST", errors: doc.endpoints["create-quote"]!.errors });
});

test("tables sit right of the tables their foreign keys point at", () => {
  const at = erLayout(doc, "pg");
  expect(at.get("quotes")!.x).toBeGreaterThan(at.get("plans")!.x);
});

test("a trace's lanes are its parts in the order it reaches them", () => {
  expect(traceLanes(doc.traces["submit-quote"]!)).toEqual(["web", "quote-api", "pg", "jobs", "mailer"]);
});

test("topology: clusters with their namespaces per region, managed parts beside them, and what isn't placed", () => {
  const { regions, unplaced } = topologyLayout(doc, "prod");
  const use1 = regions.find((r) => r.region === "us-east-1")!;
  expect(use1.clusters.map((c) => [c.cluster.name, c.namespaces.map((n) => [n.namespace, n.placements.map((p) => p.part)])])).toEqual([["prod-use1", [["catalog", ["catalog"]], ["quotes", ["quote-api", "mailer"]]]]]);
  expect(use1.other.map((p) => p.part)).toEqual(["web", "pg", "jobs", "edge-cache"]);
  expect(regions.find((r) => r.region === "eu-west-1")!.clusters).toEqual([]);
  expect(unplaced).toEqual([]);
  expect(topologyLayout(doc, "staging").unplaced.map((p) => p.id)).toEqual(["web", "pg", "jobs", "mailer", "edge-cache", "catalog"]);
});

test("API canvas: a column per kind of call, then the types, tables and events they use", () => {
  const g = apiGraph(doc, "catalog");
  const lanes = g.filter((n) => n.kind === "lane").map((n) => n.label);
  expect(lanes).toEqual(["Query · 1", "Mutation · 1", "Subscription · 1", "Types · 1", "Data · 1"]);
  expect(g.find((n) => n.id === "plans-query")!.x).toBeLessThan(g.find((n) => n.id === "update-plan")!.x);
  expect(callWires(doc, callOf(doc, "update-plan")!)).toEqual([
    { to: "plan", kind: "returns" }, { to: "plans", kind: "writes" }, { to: "plans-query", kind: "invalidates" }, { to: "list-plans", kind: "invalidates" },
  ]);
});

test("shapes sit right of the shapes they use; cache puts writes left of cached reads", () => {
  const g = shapesGraph(doc);
  expect(g.find((n) => n.id === "quote")!.x).toBeGreaterThan(g.find((n) => n.id === "quote-status")!.x);
  const c = cacheGraph(doc);
  expect(c.find((n) => n.id === "update-plan")!.x).toBeLessThan(c.find((n) => n.id === "plans-query")!.x);
});
