import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "../format/parse.ts";
import { reportNotes, systemReport } from "./report.ts";

const parsed = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
if (!parsed.ok) throw new Error("example is invalid");
const doc = parsed.doc;

test("the report has every part of the system, in order", () => {
  const html = systemReport(doc, { title: "portal", date: "29 Sep 2026" });
  const at = (s: string) => html.indexOf(s);
  for (const s of [">Map<", ">Parts<", "API · Quote API", "API · Catalog", "Data · Main database", "Shapes", "Cache", "Traces", "Topology", "Pages", "Worth a look"]) expect(at(s)).toBeGreaterThan(-1);
  expect(at(">Map<")).toBeLessThan(at(">Parts<"));
  expect(html).toContain("<svg class=\"map\"");
  expect(html).toContain("Submit a quote");
  expect(html).toContain("prod-use1");
});

test("design text can't break out of the document", () => {
  const d = structuredClone(doc);
  d.parts["web"]!.purpose = '<script>alert("x")</script>';
  const html = systemReport(d, { title: "<b>", date: "" });
  expect(html).not.toContain("<script>alert");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("<title>&lt;b&gt;</title>");
});

test("worth a look lists what the views flag, and imported things say where they live", () => {
  expect(reportNotes(doc)).toContain("staging: Customer portal, Main database, Jobs, Mailer, Plan cache, Catalog aren't placed yet.");
  expect(systemReport(doc, { title: "p", date: "", owners: { catalog: "catalog.buni" } })).toContain('<span class="from">catalog.buni</span>');
});
