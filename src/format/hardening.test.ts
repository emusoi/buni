import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "./parse.ts";
import { svgProblem } from "./svg.ts";

// A .buni file can come from anyone, and its ids, styles, routes and markup go into exported HTML, CSS and file
// paths. Each case here once got through.
const base = (): Record<string, any> => JSON.parse(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
const refused = (edit: (d: Record<string, any>) => void): string => {
  const d = base();
  edit(d);
  const r = parseDoc(JSON.stringify(d));
  return r.ok ? "" : r.errors.map((e) => `${e.path}: ${e.message}`).join("\n");
};

test("the example itself is fine", () => {
  expect(refused(() => {})).toBe("");
});

test("ids are plain words, never markup or built-in names", () => {
  expect(refused((d) => { d.nodes['x"><img src=x onerror=alert(1)>'] = { ...d.nodes["home-headline"], id: 'x"><img src=x onerror=alert(1)>' }; })).toContain("must be letters, digits");
  expect(refused((d) => { d.flows.f = { id: "f", name: "F", start: "toString", index: "a9" }; })).not.toBe("");
});

test("style names, width styles and token names can't break out of their rule", () => {
  expect(refused((d) => { d.nodes["home-headline"].style["color:red}</style><script>alert(1)</script><style>x"] = "red"; })).toContain("a style property is a CSS name");
  expect(refused((d) => { d.nodes["home-headline"].at = { "390": { color: "red}</style><script>alert(1)" } }; })).toContain("CSS values cannot contain");
  expect(refused((d) => { d.tokens["--a:1}</style><script>x"] = "1"; })).toContain("token names");
});

test("a route can't climb out of the exported site", () => {
  expect(refused((d) => { d.pages.home.route = "/../../../tmp/pwn"; })).toContain('no "." or ".." segments');
  expect(refused((d) => { d.pages.home.route = "/a\\..\\b"; })).toContain("backslashes");
});

test("deep nesting is refused quickly instead of stalling the parser", () => {
  const start = performance.now();
  const message = refused((d) => {
    let parent = "home-frame";
    for (let i = 0; i < 20_000; i++) {
      d.nodes[`n${i}`] = { id: `n${i}`, kind: "frame", parent, index: "a0", name: "deep", style: {} };
      parent = `n${i}`;
    }
  });
  expect(message).toContain("layers nest at most");
  expect(performance.now() - start).toBeLessThan(5_000);
});

test("layers are layout, text and form elements only", () => {
  expect(refused((d) => { d.nodes["home-headline"].tag = "plaintext"; })).toContain("isn't a layout, text or form element");
  expect(refused((d) => { d.nodes["home-headline"].tag = "section"; })).toBe("");
});

test("svg loads nothing from elsewhere, however the CSS is spelled", () => {
  for (const bad of [
    '<svg><rect fill="url(https://evil.example/x.svg#a)"/></svg>',
    '<svg><rect style="fill:u\\72l(https://evil.example/t.png)"/></svg>',
    "<svg><rect style=\"background:image-set('https://evil.example/t.png' 1x)\"/></svg>",
    '<svg><rect><animate attributeName="fill" to="url(https://evil.example/x)"/></rect></svg>',
  ]) expect(svgProblem(bad), bad).toBeDefined();
  expect(svgProblem('<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)" style="fill:url(\'#g\')"/></svg>')).toBeUndefined();
});

test("what parses also saves and reads back: nulls, review snapshots, width styles", async () => {
  const { serializeDoc } = await import("./serialize.ts");
  const d = base();
  d.evals = { e: { id: "e", agent: "buni", ask: "Quote 10 kg", must: ["shows a price"], given: { tool: { item: null } }, index: "a0" } };
  const withNull = parseDoc(JSON.stringify(d));
  if (!withNull.ok) throw new Error(withNull.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
  expect(() => serializeDoc(withNull.doc)).not.toThrow();
  expect(refused((x) => { x.reviews = { home: { id: "home", state: "changed", by: "a", at: "2026-10-07", was: "not json" } }; })).toContain("expected a JSON object");
  expect(refused((x) => { x.nodes["home-headline"].at = { "390": { color: "red" } }; })).toContain("isn't one of the page's widths");
});
