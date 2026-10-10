import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { pageOfNode, search } from "./search.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");
const doc = r.doc;

test("finds pages by route, layers by text, and ranks word starts first", () => {
  expect(search(doc, "/pric")[0]).toMatchObject({ kind: "page", id: "pricing" });
  const hits = search(doc, "ships");
  expect(hits[0]).toMatchObject({ kind: "layer", id: "home-headline", page: "home" });
  expect(search(doc, "quote").map((h) => h.kind)).toContain("flow");
  expect(search(doc, "zzz")).toEqual([]);
});

test("an empty query lists pages and flows, never layers; shared sources have no page", () => {
  expect(search(doc, "").every((h) => h.kind !== "layer")).toBe(true);
  expect(pageOfNode(doc, "nav-cta")).toBeUndefined();
  expect(pageOfNode(doc, "home-cta")).toBe("home");
});

test("with the system, search finds parts, calls, tables, requirements and questions, each opening its view", () => {
  const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
  if (!r.ok) throw new Error("bad example");
  const hits = search(r.doc, "quote", 40, r.doc).filter((h) => h.kind === "system");
  const views = new Map(hits.map((h) => [h.title, h.kind === "system" ? h.view : undefined]));
  expect(views.get("Quote API")).toBe("map");
  expect(views.get("POST /quotes")).toBe("api");
  expect(views.get("quotes")).toBe("data");
  expect(views.get("A buyer sends a quote in under a minute")).toBe("requirements");
  expect(search(r.doc, "quote").some((h) => h.kind === "system")).toBe(false);
});
