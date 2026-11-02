import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { childrenOf, emptyDoc, pagesInOrder, type Doc } from "./doc.ts";
import { parseDoc, type FormatError } from "./parse.ts";
import { serializeDoc } from "./serialize.ts";
import { exportSite } from "../tools/html.ts";
import { embeddedFont } from "../tools/fontdata.ts";

const exampleText = readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8");

function example(): Doc {
  const r = parseDoc(exampleText);
  if (!r.ok) throw new Error(`example is invalid: ${JSON.stringify(r.errors, null, 2)}`);
  return r.doc;
}

/** Break the example in one way and return the parser's errors. */
function errorsAfter(change: (doc: Doc) => void): FormatError[] {
  const doc = structuredClone(example());
  change(doc);
  const r = parseDoc(serializeDoc(doc));
  if (r.ok) throw new Error("expected the change to be rejected");
  return r.errors;
}

function textErrors(text: string): FormatError[] {
  const r = parseDoc(text);
  if (r.ok) throw new Error("expected the text to be rejected");
  return r.errors;
}

describe("round trip", () => {
  test("the example is valid", () => {
    expect(parseDoc(exampleText).ok).toBe(true);
  });

  test("parse → serialize → parse keeps the same document", () => {
    const doc = example();
    const again = parseDoc(serializeDoc(doc));
    expect(again).toEqual({ ok: true, doc });
  });

  test("serializing is canonical: stable bytes regardless of key order", () => {
    const a = emptyDoc();
    a.tokens = { "--b": "2", "--a": "1" };
    const b = emptyDoc();
    b.tokens = { "--a": "1", "--b": "2" };
    expect(serializeDoc(a)).toBe(serializeDoc(b));
    const once = serializeDoc(example());
    const r = parseDoc(once);
    expect(r.ok && serializeDoc(r.doc)).toBe(once);
  });

  test("equal parsed styles stay independently editable", () => {
    const original = example();
    const [first, second] = Object.values(original.nodes);
    if (!first || !second) throw new Error("example needs two layers");
    first.style = { color: "#123456", padding: "12px" };
    second.style = { ...first.style };
    const result = parseDoc(serializeDoc(original));
    if (!result.ok) throw new Error("expected a valid design");
    const a = result.doc.nodes[first.id]!;
    const b = result.doc.nodes[second.id]!;
    expect(a.style).toEqual(b.style);
    expect(a.style).not.toBe(b.style);
    a.style.color = "#654321";
    expect(b.style.color).toBe("#123456");
    expect(original.nodes[first.id]!.style.color).toBe("#123456");
  });

  test("an empty document is valid", () => {
    expect(parseDoc(serializeDoc(emptyDoc())).ok).toBe(true);
  });
});

describe("rejects documents it can't keep intact", () => {
  test("invalid JSON", () => {
    expect(textErrors("{")[0]?.message).toStartWith("not valid JSON");
  });

  test("unsupported version", () => {
    expect(textErrors(exampleText.replace('"buni": 1', '"buni": 2'))).toContainEqual({
      path: "buni",
      message: "unsupported format version (expected 1)",
    });
  });

  test("unknown keys, so saving never drops data", () => {
    const raw = JSON.parse(exampleText);
    raw.pages.home.color = "red";
    expect(textErrors(JSON.stringify(raw))).toContainEqual({ path: "pages.home.color", message: "unknown key" });
  });

  test("a __proto__ key instead of silently dropping it", () => {
    const text = exampleText.replace('"--color-ink": "#10131A"', '"__proto__": "#10131A"');
    expect(textErrors(text)).toContainEqual({ path: "tokens.__proto__", message: "reserved key" });
  });

  test("element tags that would run or embed code", () => {
    const errors = errorsAfter((d) => {
      d.nodes["home-headline"]!.tag = "script";
    });
    expect(errors).toContainEqual({ path: "nodes.home-headline.tag", message: '"script" elements are not allowed' });
  });

  test("svg markup with scripts or handlers", () => {
    const errors = errorsAfter((d) => {
      d.nodes.icon = { id: "icon", kind: "svg", parent: "home-hero", index: "a3", name: "Icon", style: {}, markup: '<svg onload="alert(1)"></svg>' };
    });
    expect(errors).toContainEqual({ path: "nodes.icon.markup", message: "event handlers (onload) aren't allowed in svg markup" });
  });

  test("css values that would break out of their rule", () => {
    const errors = errorsAfter((d) => {
      d.nodes["home-hero"]!.style.color = "red} body { display: none";
      d.tokens["--color-ink"] = "</style><script>";
    });
    expect(errors).toContainEqual({ path: "nodes.home-hero.style.color", message: "CSS values cannot contain {, } or <" });
    expect(errors).toContainEqual({ path: "tokens.--color-ink", message: "CSS values cannot contain {, } or <" });
  });

  test("an entry whose id doesn't match its key", () => {
    const errors = errorsAfter((d) => {
      d.pages.home!.id = "house";
    });
    expect(errors).toContainEqual({ path: "pages.home.id", message: 'id "house" does not match its key "home"' });
  });

  test("a confidence outside 1–5", () => {
    const raw = JSON.parse(exampleText);
    raw.journeys["get-a-quote-journey"].steps[0].confidence = 7;
    expect(textErrors(JSON.stringify(raw))).toContainEqual({
      path: "journeys.get-a-quote-journey.steps[0].confidence",
      message: "expected one of 1, 2, 3, 4, 5",
    });
  });
});

describe("reference checks", () => {
  test("a parent that doesn't exist", () => {
    const errors = errorsAfter((d) => {
      d.nodes["home-headline"]!.parent = "ghost";
    });
    expect(errors).toContainEqual({ path: "nodes.home-headline.parent", message: 'parent "ghost" does not exist' });
  });

  test("children of a non-frame", () => {
    const errors = errorsAfter((d) => {
      d.nodes["home-photo"]!.parent = "home-headline";
    });
    expect(errors).toContainEqual({
      path: "nodes.home-photo.parent",
      message: 'parent "home-headline" is a text, only frames have children',
    });
  });

  test("a parent cycle", () => {
    const errors = errorsAfter((d) => {
      d.nodes["home-hero"]!.parent = "home-hero";
    });
    expect(errors).toContainEqual({ path: "nodes.home-hero", message: "node is part of a parent cycle" });
  });

  test("a node under no page or shared section", () => {
    const errors = errorsAfter((d) => {
      d.nodes.stray = { id: "stray", kind: "frame", index: "a0", name: "Stray", style: {} };
    });
    expect(errors).toContainEqual({ path: "nodes.stray", message: "node is not under any page or shared section" });
  });

  test("two pages on one route", () => {
    const errors = errorsAfter((d) => {
      d.pages.pricing!.route = "/";
    });
    expect(errors).toContainEqual({ path: "pages.pricing.route", message: 'route "/" is also used by page "home"' });
  });

  test("an override that targets a node outside its shared section", () => {
    const errors = errorsAfter((d) => {
      const nav = d.nodes["pricing-nav"]!;
      if (nav.kind === "instance") nav.overrides["pricing-title"] = { text: "x" };
    });
    expect(errors).toContainEqual({
      path: "nodes.pricing-nav.overrides.pricing-title",
      message: '"pricing-title" is not a layer in shared section "nav" or in a component it uses',
    });
  });

  test("a component that holds itself", () => {
    const errors = errorsAfter((d) => {
      d.nodes.nested = { id: "nested", kind: "instance", parent: "nav-root", index: "a2", name: "Nested", style: {}, shared: "nav", overrides: {} };
    });
    expect(errors).toContainEqual({ path: "shared.nav", message: "components can't hold themselves: Public nav → Public nav" });
  });

  test("a connection from a node on another page", () => {
    const errors = errorsAfter((d) => {
      d.connections["home-to-pricing"]!.node = "pricing-title";
    });
    expect(errors).toContainEqual({
      path: "connections.home-to-pricing.node",
      message: 'node "pricing-title" is not on page "home"',
    });
  });

  test("journey cells and evidence must exist", () => {
    const errors = errorsAfter((d) => {
      const step = d.journeys["get-a-quote-journey"]!.steps[1]!;
      step.cells.Feels = "anxious";
      step.evidence.push("missing");
    });
    expect(errors).toContainEqual({
      path: "journeys.get-a-quote-journey.steps[1].cells.Feels",
      message: 'lane "Feels" is not in this journey',
    });
    expect(errors).toContainEqual({
      path: "journeys.get-a-quote-journey.steps[1].evidence",
      message: 'attachment "missing" does not exist',
    });
  });
});

test("files with system data from before still open; the system data is dropped", () => {
  const raw = JSON.parse(exampleText);
  // What a file held when buni also designed the system behind the screens, its plan and its agents, and the doc's decisions.
  Object.assign(raw, {
    parts: { api: { id: "api", kind: "service", name: "Quote API", purpose: "Quotes", index: "a0" } },
    links: {}, tables: {}, endpoints: { "list-plans": { id: "list-plans", service: "api", method: "GET", path: "/plans" } }, operations: {}, events: {}, shapes: {},
    traces: {}, environments: {}, clusters: {}, placements: {}, positions: { "api:list-plans": { id: "api:list-plans", x: 1, y: 2 } },
    phases: {}, requirements: {}, questions: {}, roles: {}, reviews: {}, threads: {}, agents: {}, evals: {},
    decisions: { d1: { id: "d1", text: "8px spacing grid", by: "pi", at: "2026-01-01T00:00:00Z" } },
  });
  raw.pages.home.client = "api";
  raw.nodes["home-headline"].bind = { endpoint: "list-plans", field: "headline" };
  raw.connections["home-to-pricing"].endpoint = "list-plans";
  const r = parseDoc(JSON.stringify(raw));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  expect(r.doc).toEqual(example());
  const saved: Record<string, unknown> = JSON.parse(serializeDoc(r.doc));
  for (const k of ["parts", "endpoints", "positions", "agents", "evals", "decisions"]) expect(saved[k]).toBeUndefined();
  expect(serializeDoc(r.doc)).not.toContain("list-plans");
});

describe("ordering", () => {
  test("children sort by index, then id", () => {
    const doc = example();
    expect(childrenOf(doc, "home-hero").map((n) => n.id)).toEqual(["home-headline", "home-cta", "home-photo"]);
    // Changes make a new version of the document; the index follows each version.
    const moved = structuredClone(doc);
    moved.nodes["home-photo"]!.index = "a0";
    expect(childrenOf(moved, "home-hero").map((n) => n.id)).toEqual(["home-headline", "home-photo", "home-cta"]);
    expect(childrenOf(doc, "home-hero").map((n) => n.id)).toEqual(["home-headline", "home-cta", "home-photo"]);
  });

  test("pages come back in sitemap order", () => {
    expect(pagesInOrder(example()).map((p) => p.route)).toEqual(["/", "/pricing"]);
  });
});

describe("terminal screens", () => {
  /** The example with terminal screens: a full-screen dashboard and a help screen behind "?". */
  function withCli(): Doc {
    const doc = example();
    for (const id of ["dash", "help"]) {
      doc.nodes[`${id}-frame`] = { id: `${id}-frame`, kind: "frame", index: "a0", name: id, style: {} };
      doc.pages[id] = { id, name: id, frame: `${id}-frame`, index: `z${id}`, terminal: { surface: "app", cols: 120, rows: 36, colors: "256" } };
    }
    doc.connections["dash-help"] = { id: "dash-help", page: "dash", node: "dash-frame", to: "help", trigger: "key", key: "?", transition: "none", durationMs: 0 };
    return doc;
  }
  const errorsOf = (change: (doc: Doc) => void): string[] => {
    const doc = withCli();
    change(doc);
    const r = parseDoc(serializeDoc(doc));
    return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`);
  };

  test("terminal screens and key links round-trip, with no client to belong to", () => {
    const doc = withCli();
    expect(parseDoc(serializeDoc(doc))).toEqual({ ok: true, doc });
  });

  test("each surface has the shape it really has", () => {
    const screen = (terminal: NonNullable<Doc["pages"][string]["terminal"]>) => (d: Doc) => (d.pages.dash = { ...d.pages.dash!, terminal });
    expect(errorsOf(screen({ surface: "inline", cols: 80, rows: 10, colors: "16" }))).toEqual(["pages.dash.terminal.rows: output printed inline has no fixed height; it grows as it prints"]);
    expect(errorsOf(screen({ surface: "tmux-status", cols: 200, rows: 2, colors: "256" }))).toEqual(["pages.dash.terminal.rows: tmux's status line is one row"]);
    expect(errorsOf(screen({ surface: "picker", cols: 80, colors: "16" }))).toEqual(["pages.dash.terminal.rows: a picker screen needs a height in rows"]);
    expect(errorsOf(screen({ surface: "app", cols: 4, rows: 20, colors: "none" }))).toEqual(["pages.dash.terminal.cols: a terminal is a whole number of columns, 10 to 500"]);
  });

  test("a key link says which key, and only key links have one", () => {
    expect(errorsOf((d) => delete d.connections["dash-help"]!.key)).toEqual(['connections.dash-help.key: a "key" trigger says which key, e.g. "ctrl+k"']);
    expect(errorsOf((d) => (d.connections["home-to-pricing"] = { ...d.connections["home-to-pricing"]!, key: "enter" }))).toEqual(['connections.home-to-pricing.key: only a "key" trigger has a key']);
  });
});

describe("screen states", () => {
  test("a screen's states share its route; each needs a name, a screen to belong to and a route", () => {
    const doc = structuredClone(example());
    const home = Object.values(doc.pages).find((p) => p.route === "/");
    if (!home) throw new Error("the example has a home page");
    doc.nodes["empty-frame"] = { id: "empty-frame", kind: "frame", index: "a0", name: "Home, empty", style: {} };
    doc.pages["home-empty"] = { id: "home-empty", name: "Home, empty", route: "/", state: "Empty", frame: "empty-frame", index: "z9" };
    expect(parseDoc(serializeDoc(doc)).ok).toBe(true);
    expect([...exportSite(doc, embeddedFont).keys()].filter((f) => f.endsWith(".html"))).toEqual([...exportSite({ ...doc, pages: Object.fromEntries(Object.entries(doc.pages).filter(([id]) => id !== "home-empty")) }, embeddedFont).keys()].filter((f) => f.endsWith(".html")));
    const twice = errorsAfter((d) => {
      Object.assign(d.nodes, { "e2": { id: "e2", kind: "frame", index: "a0", name: "again", style: {} }, "e1": { id: "e1", kind: "frame", index: "a0", name: "empty", style: {} } });
      d.pages["s1"] = { id: "s1", name: "Empty", route: "/", state: "Empty", frame: "e1", index: "z8" };
      d.pages["s2"] = { id: "s2", name: "Empty again", route: "/", state: "Empty", frame: "e2", index: "z9" };
    });
    expect(twice.map((e) => e.path)).toContain("pages.s2.state");
    const orphan = errorsAfter((d) => {
      d.nodes["e3"] = { id: "e3", kind: "frame", index: "a0", name: "nowhere", style: {} };
      d.pages["s3"] = { id: "s3", name: "Nowhere, empty", route: "/nowhere", state: "Empty", frame: "e3", index: "z9" };
    });
    expect(orphan).toContainEqual({ path: "pages.s3.route", message: 'no screen has route "/nowhere" for this to be a state of' });
  });
});

test("token modes: parsed, checked, kept through serialize, and drawn as CSS for <html data-mode> and the system's dark", () => {
  const doc = { ...emptyDoc(), tokens: { "--bg": "#fff", "--ink": "#111" }, modes: { dark: { "--bg": "#111", "--ink": "#eee" } } };
  const again = parseDoc(serializeDoc(doc));
  if (!again.ok) throw new Error(again.errors.map((e) => e.message).join("; "));
  expect(again.doc.modes).toEqual({ dark: { "--bg": "#111", "--ink": "#eee" } });
  const css = exportSite(again.doc, embeddedFont).get("styles/tokens.css") ?? "";
  expect(css).toContain(':root[data-mode="dark"] {');
  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain(":root:not([data-mode]) {");
  const bad = parseDoc(serializeDoc({ ...doc, modes: { "Dark Mode": { "--bg": "#000" }, dark: { bg: "url(javascript:1)" } } }));
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.errors.map((e) => e.path).sort()).toEqual(["modes.Dark Mode", "modes.dark.bg"]);
});
