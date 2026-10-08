import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { childrenOf, emptyDoc, fieldPaths, pagesInOrder, type Doc } from "./doc.ts";
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
    const text = exampleText.replace('"name": "Home", "route"', '"name": "Home", "color": "red", "route"');
    expect(textErrors(text)).toContainEqual({ path: "pages.home.color", message: "unknown key" });
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
    const text = exampleText.replace('"confidence": 4, "cells": { "Does": "Lands', '"confidence": 7, "cells": { "Does": "Lands');
    expect(textErrors(text)).toContainEqual({
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

describe("system checks", () => {
  test("a link to the wrong kind of part, or from a store", () => {
    const errors = errorsAfter((d) => {
      d.links["web-api"]!.kind = "reads";
      d.links["back"] = { id: "back", from: "pg", to: "quote-api", kind: "calls" };
    });
    expect(errors).toContainEqual({ path: "links.web-api.to", message: "reads goes to a store or cache, not a service" });
    expect(errors).toContainEqual({ path: "links.back.from", message: "a store does not start links" });
  });

  test("a table on a part that isn't a store, and a foreign key to a missing column", () => {
    const errors = errorsAfter((d) => {
      d.tables["plans"]!.store = "quote-api";
      d.tables["quotes"]!.columns[1]!.ref = { table: "plans", column: "slug" };
    });
    expect(errors).toContainEqual({ path: "tables.plans.store", message: 'part "quote-api" is a service, not a store' });
    expect(errors).toContainEqual({ path: "tables.quotes.columns[1].ref.column", message: 'table "plans" has no column "slug"' });
  });

  test("an endpoint that writes or emits without the link to do it", () => {
    const errors = errorsAfter((d) => {
      d.links["api-pg"]!.kind = "reads";
      delete d.links["api-jobs"];
    });
    expect(errors).toContainEqual({ path: "endpoints.create-quote.writes", message: 'service "quote-api" has no writes link to store "pg"' });
    expect(errors).toContainEqual({ path: "endpoints.create-quote.emits", message: 'service "quote-api" has no publishes link to queue "jobs"' });
  });

  test("two endpoints on one method and path", () => {
    const errors = errorsAfter((d) => {
      d.endpoints["create-quote"]!.method = "GET";
      d.endpoints["create-quote"]!.path = "/plans";
    });
    expect(errors).toContainEqual({ path: "endpoints.list-plans.path", message: 'GET /plans is also endpoint "create-quote"' });
  });

  test("a page calling a service its client has no link to", () => {
    const errors = errorsAfter((d) => {
      delete d.links["web-api"];
    });
    expect(errors).toContainEqual({ path: "connections.home-to-pricing.endpoint", message: 'client "web" has no calls link to service "quote-api"' });
  });

  test("a node bound to a field the endpoint doesn't return", () => {
    const errors = errorsAfter((d) => {
      d.nodes["pricing-title"]!.bind = { endpoint: "list-plans", field: "title" };
    });
    expect(errors).toContainEqual({ path: "nodes.pricing-title.bind.field", message: '"list-plans" returns no field "title"' });
  });

  test("column types that aren't SQL, and foreign keys of the wrong type or across stores", () => {
    const errors = errorsAfter((d) => {
      d.tables["plans"]!.columns[1]!.type = "text); DROP TABLE plans; --";
      d.tables["quotes"]!.columns[1]!.type = "text";
      d.parts["pg2"] = { id: "pg2", kind: "store", name: "Other", purpose: "x", index: "a9" };
      d.tables["far"] = { id: "far", store: "pg2", name: "far", index: "a0", columns: [{ name: "plan_id", type: "uuid", ref: { table: "plans", column: "id" } }] };
    });
    expect(errors.map((e) => e.path)).toContain("tables.plans.columns[1].type");
    expect(errors).toContainEqual({ path: "tables.quotes.columns[1].type", message: "text does not match plans.id, a uuid" });
    expect(errors.map((e) => e.path)).toContain("tables.far.columns[0].ref.table");
  });

  test("a field typed with something that is neither a primitive nor a shape", () => {
    const errors = errorsAfter((d) => {
      d.endpoints["list-plans"]!.response[1]!.type = "plan[]";
      d.shapes["quote-request"]!.name = "quoteRequest";
    });
    expect(errors.map((e) => e.path)).toContain("endpoints.list-plans.response[1].type");
    expect(errors).toContainEqual({ path: "shapes.quote-request.name", message: "shape names are PascalCase, e.g. Quote" });
  });

  test("a link carrying a shape that doesn't exist", () => {
    const errors = errorsAfter((d) => {
      d.links["web-api"]!.carries = ["ghost"];
    });
    expect(errors).toContainEqual({ path: "links.web-api.carries", message: 'shape "ghost" does not exist' });
  });

  test("caching: only GETs, a positive lifetime, through a linked cache; invalidate only what is cached", () => {
    const errors = errorsAfter((d) => {
      d.endpoints["list-plans"]!.cache!.ttlSeconds = 0;
      delete d.links["api-cache"];
      d.endpoints["create-quote"]!.cache = { part: "edge-cache", ttlSeconds: 60, key: "q" };
      d.endpoints["create-quote"]!.invalidates = ["create-quote"];
    });
    expect(errors).toContainEqual({ path: "endpoints.list-plans.cache.ttlSeconds", message: "a cache entry needs a positive lifetime" });
    expect(errors).toContainEqual({ path: "endpoints.list-plans.cache.part", message: 'service "quote-api" has no link to cache "edge-cache"' });
    expect(errors.map((e) => e.path)).toContain("endpoints.create-quote.cache");
  });

  test("invalidating an endpoint that isn't cached", () => {
    const errors = errorsAfter((d) => {
      d.endpoints["create-quote"]!.invalidates = ["create-quote"];
    });
    expect(errors).toContainEqual({ path: "endpoints.create-quote.invalidates", message: '"create-quote" is not cached' });
  });

  test("files from before the system existed still open", () => {
    const old: Record<string, unknown> = JSON.parse(serializeDoc(emptyDoc()));
    for (const k of ["parts", "links", "tables", "endpoints", "events"]) delete old[k];
    expect(parseDoc(JSON.stringify(old)).ok).toBe(true);
  });
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

describe("GraphQL, enums and traces", () => {
  test("operations live on GraphQL services, endpoints on REST ones", () => {
    const errors = errorsAfter((d) => {
      d.operations["plans-query"]!.service = "quote-api";
      d.endpoints["list-plans"]!.service = "catalog";
    });
    expect(errors).toContainEqual({ path: "operations.plans-query.service", message: 'service "quote-api" is REST; set its API style to GraphQL, or add an endpoint' });
    expect(errors).toContainEqual({ path: "endpoints.list-plans.service", message: 'service "catalog" is GraphQL; add an operation instead' });
  });

  test("an operation returns a real type, and only queries are cached", () => {
    const errors = errorsAfter((d) => {
      d.operations["update-plan"]!.returns = "Plann";
      d.operations["update-plan"]!.cache = { part: "edge-cache", ttlSeconds: 10, key: "x" };
    });
    expect(errors.map((e) => e.path)).toContain("operations.update-plan.returns");
    expect(errors).toContainEqual({ path: "operations.update-plan.cache", message: "only queries are cached; invalidate them from the mutations that change the data" });
  });

  test("a shape is fields or enum values, never both", () => {
    const errors = errorsAfter((d) => {
      d.shapes["quote-status"]!.fields = [{ name: "x", type: "string" }];
      d.shapes["plan"]!.values = ["cheap rate"];
    });
    expect(errors).toContainEqual({ path: "shapes.quote-status.values", message: "a shape has fields or enum values, not both" });
    expect(errors.map((e) => e.path)).toContain("shapes.plan.values[0]");
  });

  test("a trace step follows a link, in either direction, and names real things", () => {
    const errors = errorsAfter((d) => {
      d.traces["submit-quote"]!.steps.push({ from: "web", to: "pg", action: "peek" }, { from: "pg", to: "quote-api", action: "rows", via: "ghost" });
    });
    expect(errors).toContainEqual({ path: "traces.submit-quote.steps[4]", message: 'no link joins "web" and "pg"; link them on the map first' });
    expect(errors).toContainEqual({ path: "traces.submit-quote.steps[5].via", message: 'no endpoint, operation or event "ghost"' });
  });

  test("a page can call and show a GraphQL operation", () => {
    const doc = example();
    doc.connections["home-to-pricing"]!.endpoint = "plans-query";
    doc.nodes["pricing-title"]!.bind = { endpoint: "plans-query", field: "pricePerKg" };
    expect(parseDoc(serializeDoc(doc)).ok).toBe(true);
  });
});

describe("deployment topology", () => {
  test("a runtime has to fit the part: no cronjob database, no StatefulSet client, no placing someone else's service", () => {
    const errors = errorsAfter((d) => {
      d.placements["pg-prod"]!.runtime = "cronjob";
      d.placements["web-prod"]!.runtime = "statefulset";
      d.parts["stripe"] = { id: "stripe", kind: "external", name: "Stripe", purpose: "Payments.", index: "a9" };
      d.placements["stripe-prod"] = { id: "stripe-prod", part: "stripe", environment: "prod", runtime: "managed", regions: ["us-east-1"] };
    });
    expect(errors).toContainEqual({ path: "placements.pg-prod.runtime", message: "a store runs as managed, statefulset, vm, not cronjob" });
    expect(errors.map((e) => e.path)).toContain("placements.web-prod.runtime");
    expect(errors).toContainEqual({ path: "placements.stripe-prod.part", message: "Stripe is external; someone else runs it" });
  });

  test("Kubernetes workloads need a Kubernetes cluster in their environment and region, and a namespace", () => {
    const errors = errorsAfter((d) => {
      delete d.placements["quote-api-prod"]!.namespace;
      d.placements["mailer-prod"]!.cluster = "staging-use1";
      d.placements["catalog-prod"]!.regions = ["eu-west-1"];
    });
    expect(errors).toContainEqual({ path: "placements.quote-api-prod.namespace", message: "Kubernetes workloads need a namespace" });
    expect(errors).toContainEqual({ path: "placements.mailer-prod.cluster", message: "staging-use1 belongs to another environment" });
    expect(errors).toContainEqual({ path: "placements.catalog-prod.regions", message: "prod-use1 runs in us-east-1 only" });
  });

  test("a container runs on a named platform, with no cluster or namespace", () => {
    const doc = structuredClone(example());
    const pl = doc.placements["quote-api-prod"]!;
    doc.placements["quote-api-prod"] = { id: pl.id, part: pl.part, environment: pl.environment, runtime: "container", regions: pl.regions, service: "ECS Fargate" };
    expect(parseDoc(serializeDoc(doc)).ok).toBe(true);
    const errors = errorsAfter((d) => {
      const pl = d.placements["quote-api-prod"]!;
      d.placements["quote-api-prod"] = { id: pl.id, part: pl.part, environment: pl.environment, runtime: "container", regions: pl.regions };
    });
    expect(errors.map((e) => e.path)).toContain("placements.quote-api-prod.service");
  });

  test("regions belong to the environment; scale, resources, schedules and secret names are checked", () => {
    const errors = errorsAfter((d) => {
      d.placements["jobs-prod"]!.regions = ["ap-south-1"];
      d.placements["quote-api-prod"]!.scale = { min: 5, max: 2 };
      d.placements["quote-api-prod"]!.resources = { memory: "256MB" };
      d.placements["quote-api-prod"]!.secrets = ["database-url"];
      d.placements["mailer-prod"]!.schedule = "nightly";
    });
    expect(errors).toContainEqual({ path: "placements.jobs-prod.regions", message: "prod doesn't run in ap-south-1" });
    expect(errors).toContainEqual({ path: "placements.quote-api-prod.scale", message: "scale is whole numbers with 0 ≤ min ≤ max" });
    expect(errors.map((e) => e.path)).toContain("placements.quote-api-prod.resources.memory");
    expect(errors.map((e) => e.path)).toContain("placements.quote-api-prod.secrets[0]");
    expect(errors).toContainEqual({ path: "placements.mailer-prod.schedule", message: "only cronjobs run on a schedule" });
  });

  test("one placement per part per environment; workers take no outside traffic", () => {
    const errors = errorsAfter((d) => {
      d.placements["dup"] = { ...d.placements["pg-prod"]!, id: "dup" };
      d.placements["mailer-prod"]!.ingress = { host: "x.com", path: "/" };
    });
    expect(errors.map((e) => e.message)).toContain('"pg" is already placed in "prod" by "dup"');
    expect(errors).toContainEqual({ path: "placements.mailer-prod.ingress", message: "only clients and services with an API take outside traffic" });
  });
});

describe("the design process around the system", () => {
  test("requirements point at real things and real phases", () => {
    const errors = errorsAfter((d) => {
      d.requirements["req-price"]!.servedBy.push("ghost");
      d.requirements["req-quote"]!.phase = "v9";
    });
    expect(errors).toContainEqual({ path: "requirements.req-price.servedBy", message: 'nothing called "ghost" to serve it' });
    expect(errors).toContainEqual({ path: "requirements.req-quote.phase", message: 'phase "v9" does not exist' });
  });

  test("a decided question names one of its options; an open one hasn't chosen", () => {
    const errors = errorsAfter((d) => {
      d.questions["q-queue"]!.status = "decided";
      d.questions["q-queue"]!.chosen = "Kafka";
    });
    expect(errors).toContainEqual({ path: "questions.q-queue.chosen", message: "a decided question names one of its options" });
  });

  test("access names real roles, only when limited to roles", () => {
    const errors = errorsAfter((d) => {
      d.operations["update-plan"]!.access = { who: "roles", roles: ["owner"] };
      d.endpoints["list-plans"]!.access = { who: "public", roles: ["admin"] };
    });
    expect(errors).toContainEqual({ path: "operations.update-plan.access.roles", message: 'role "owner" does not exist' });
    expect(errors).toContainEqual({ path: "endpoints.list-plans.access.roles", message: 'roles only apply when who is "roles"' });
  });

  test("failure policies, reviews and threads are well formed", () => {
    const errors = errorsAfter((d) => {
      d.links["web-api"]!.failure = { timeoutMs: 0, retries: 1.5 };
      d.reviews["ghost"] = { id: "ghost", state: "approved", by: "x", at: "" };
      d.threads["t-cache"]!.posts = [];
    });
    expect(errors).toContainEqual({ path: "links.web-api.failure.timeoutMs", message: "a timeout is a positive number of ms" });
    expect(errors).toContainEqual({ path: "links.web-api.failure.retries", message: "retries is a whole number, 0 to 20" });
    expect(errors).toContainEqual({ path: "reviews.ghost", message: 'nothing called "ghost" to review' });
    expect(errors).toContainEqual({ path: "threads.t-cache.posts", message: "a thread needs at least one post" });
  });
});

describe("terminal screens", () => {
  /** The example with a Go command-line client: a full-screen dashboard and a help screen behind "?". */
  function withCli(): Doc {
    const doc = example();
    doc.parts.cli = { id: "cli", kind: "client", name: "steel CLI", purpose: "Quotes from the terminal", terminal: { targets: [{ language: "go", framework: "bubbletea" }] }, index: "z0" };
    for (const id of ["dash", "help"]) {
      doc.nodes[`${id}-frame`] = { id: `${id}-frame`, kind: "frame", index: "a0", name: id, style: {} };
      doc.pages[id] = { id, name: id, frame: `${id}-frame`, index: `z${id}`, client: "cli", terminal: { surface: "app", cols: 120, rows: 36, colors: "256" } };
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

  test("a terminal client's screens and key links round-trip", () => {
    const doc = withCli();
    expect(parseDoc(serializeDoc(doc))).toEqual({ ok: true, doc });
  });

  test("the framework has to be the client's language", () => {
    expect(errorsOf((d) => (d.parts.cli = { ...d.parts.cli!, terminal: { targets: [{ language: "rust", framework: "bubbletea" }] } }))).toEqual([
      "parts.cli.terminal.targets[0].framework: bubbletea is a go framework, not rust",
    ]);
  });

  test("the same screens can be built several ways, each once", () => {
    const targets = [{ language: "go" as const, framework: "bubbletea" as const }, { language: "rust" as const, framework: "ratatui" as const }, { language: "typescript" as const, framework: "opentui" as const }];
    expect(errorsOf((d) => (d.parts.cli = { ...d.parts.cli!, terminal: { targets } }))).toEqual([]);
    expect(errorsOf((d) => (d.parts.cli = { ...d.parts.cli!, terminal: { targets: [...targets, targets[0]!] } }))).toEqual(["parts.cli.terminal.targets[3]: bubbletea is already a target"]);
    expect(errorsOf((d) => (d.parts.cli = { ...d.parts.cli!, terminal: { targets: [] } }))).toEqual([
      "parts.cli.terminal.targets: a terminal client is built at least one way: a language, and a framework if it draws full screens",
    ]);
  });

  test("each surface has the shape it really has", () => {
    const screen = (terminal: NonNullable<Doc["pages"][string]["terminal"]>) => (d: Doc) => (d.pages.dash = { ...d.pages.dash!, terminal });
    expect(errorsOf(screen({ surface: "inline", cols: 80, rows: 10, colors: "16" }))).toEqual(["pages.dash.terminal.rows: output printed inline has no fixed height; it grows as it prints"]);
    expect(errorsOf(screen({ surface: "tmux-status", cols: 200, rows: 2, colors: "256" }))).toEqual(["pages.dash.terminal.rows: tmux's status line is one row"]);
    expect(errorsOf(screen({ surface: "picker", cols: 80, colors: "16" }))).toEqual(["pages.dash.terminal.rows: a picker screen needs a height in rows"]);
    expect(errorsOf(screen({ surface: "app", cols: 4, rows: 20, colors: "none" }))).toEqual(["pages.dash.terminal.cols: a terminal is a whole number of columns, 10 to 500"]);
  });

  test("terminal screens belong to terminal clients, and full-screen apps name a framework", () => {
    expect(errorsOf((d) => (d.pages.dash = { ...d.pages.dash!, client: "web" }))).toEqual(["pages.dash.terminal: a terminal screen belongs to a client that runs in a terminal"]);
    expect(errorsOf((d) => delete d.pages.help!.terminal)).toEqual(['pages.help.terminal: "steel CLI" runs in a terminal; say how big its screen is']);
    expect(errorsOf((d) => (d.parts.cli = { ...d.parts.cli!, terminal: { targets: [{ language: "go", framework: "bubbletea" }, { language: "python" }] } }))).toEqual([
      'pages.dash.terminal: a full-screen app needs a framework; "steel CLI" builds it in python without one',
      'pages.help.terminal: a full-screen app needs a framework; "steel CLI" builds it in python without one',
    ]);
    expect(errorsOf((d) => (d.parts["quote-api"] = { ...d.parts["quote-api"]!, terminal: { targets: [{ language: "go" }] } }))).toEqual(["parts.quote-api.terminal: only a client runs in a terminal"]);
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

test("a page can show fields through nested shapes, lists marked [], without looping on a shape inside itself", () => {
  const doc = emptyDoc();
  doc.shapes["money"] = { id: "money", index: "a0", name: "Money", fields: [{ name: "amount", type: "integer" }] };
  doc.shapes["line"] = { id: "line", index: "a1", name: "Line", fields: [{ name: "price", type: "Money" }, { name: "parent", type: "Line", optional: true }] };
  expect(fieldPaths(doc, [{ name: "lines", type: "Line[]" }, { name: "total", type: "Money" }])).toEqual([
    "lines", "lines[].price", "lines[].price.amount", "lines[].parent", "total", "total.amount",
  ]);
});
