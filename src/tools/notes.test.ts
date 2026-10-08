import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "../format/parse.ts";
import { designNotes } from "./notes.ts";

const parsed = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
if (!parsed.ok) throw new Error("example is invalid");
const doc = parsed.doc;

test("notes flag the gaps a reviewer would ask about", () => {
  const notes = designNotes(doc);
  expect(notes).toContain("What happens when Jobs is down isn't written down.");
  expect(notes).toContain("1 open question: SQS or a Redis queue for Jobs?");
  expect(notes).toContain("2 calls don't say who may call them: query plans, subscription planChanged.");
  expect(notes.some((n) => n.includes("Main database is down"))).toBe(false);
});

test("retries without an idempotency key and request paths without timeouts are flagged", () => {
  const d = structuredClone(doc);
  d.links["web-api"]!.failure = { retries: 3 };
  const notes = designNotes(d);
  expect(notes).toContain("Customer portal → Quote API is on a request path with no timeout.");
  expect(notes).toContain("Customer portal → Quote API retries without an idempotency key; a retried write can happen twice.");
});

test("personal data in a shared cache is flagged", () => {
  const d = structuredClone(doc);
  d.endpoints["list-plans"]!.reads.push("quotes");
  d.links["api-pg"]!.kind = "writes";
  expect(designNotes(d)).toContain("GET /plans caches quotes, which holds personal data (email), without the viewer in its key.");
});

test("a requirement nothing serves is a gap only when it is due: the phase being built now, or a must", () => {
  const phases = { v1: { id: "v1", index: "a0", name: "v1" }, later: { id: "later", index: "a1", name: "later" } };
  const req = (id: string, phase: string, priority: "must" | "should" | "could") => ({ id, index: "a0", title: id, priority, phase, servedBy: [] });
  const notes = designNotes({ ...doc, phases, requirements: { now: req("now", "v1", "could"), soon: req("soon", "later", "could"), key: req("key", "later", "must") } });
  expect(notes).toContain("Nothing serves the requirement “now” yet.");
  expect(notes).toContain("Nothing serves the requirement “key” yet.");
  expect(notes.some((n) => n.includes("“soon”"))).toBe(false);
});

test("a public write is flagged until its rule says how abuse is stopped", () => {
  const quotes = Object.values(doc.endpoints).find((e) => e.path === "/quotes" && e.method === "POST");
  if (!quotes?.access) throw new Error("the example's POST /quotes is public");
  const withRule = (rule: string | undefined) => {
    const { rule: _, ...access } = quotes.access ?? { who: "public" as const };
    return designNotes({ ...doc, endpoints: { ...doc.endpoints, [quotes.id]: { ...quotes, access: rule ? { ...access, rule } : access } } });
  };
  expect(withRule(undefined)).toContain("POST /quotes is public and writes quotes; say how abuse is stopped.");
  expect(withRule("5 quotes an hour per IP, with a captcha").some((n) => n.startsWith("POST /quotes is public"))).toBe(false);
});

test("a call no page, trace or requirement uses is flagged", () => {
  const unused = { ...doc, connections: {}, traces: {}, requirements: {}, nodes: Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => { const { bind: _, ...rest } = n; return [id, rest]; })) };
  expect(designNotes(unused).some((n) => n.endsWith("no page, trace or requirement uses them yet."))).toBe(true);
});

test("Parcel, a design built end to end with buni, reads clean: a check that review doesn't cry wolf on real work", () => {
  const parcel = parseDoc(readFileSync(new URL("../../examples/parcel.buni", import.meta.url), "utf8"));
  if (!parcel.ok) throw new Error(parcel.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  expect(designNotes(parcel.doc)).toEqual([]);
});
