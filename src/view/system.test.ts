import { expect, test } from "bun:test";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { Workspace } from "../tools/workspace.ts";
import { systemOf } from "./system.ts";

const portal = async () => (await Workspace.open(join(import.meta.dir, "../../examples/portal.buni"))).system();

test("the map draws every part and link, and each part's detail links to what it serves and talks to", async () => {
  const sys = systemOf(await portal());
  const map = sys.views.find((v) => v.id === "map");
  expect(map?.count).toBe(7);
  expect(map?.html).toContain('data-ref="part:quote-api"');
  expect(map?.html.match(/<g class="link/g)?.length).toBe(8);
  const api = sys.details["part:quote-api"] ?? "";
  expect(api).toContain('data-go="call:create-quote"');
  expect(api).toContain('data-go="part:pg"');
  expect(api).toContain("If it fails: Keep the form");
  expect(sys.where["part:quote-api"]).toBe("map");
});

test("a design with no system shows no system views", () => {
  expect(systemOf(emptyDoc()).views).toEqual([]);
});

test("the API lists every call by service, and Data draws tables, keys and shapes", async () => {
  const sys = systemOf(await portal());
  const api = sys.views.find((v) => v.id === "api");
  expect(api?.count).toBe(5);
  expect(api?.html).toContain("emits quote.created");
  const quote = sys.details["call:create-quote"] ?? "";
  expect(quote).toContain("409</b> the plan was retired");
  expect(quote).toContain('data-go="table:quotes"');
  const data = sys.views.find((v) => v.id === "data");
  expect(data?.html).toContain('data-ref="table:plans"');
  expect(data?.html).toContain("→ plans");
  expect(sys.details["table:quotes"]).toContain("email is personal.");
  expect(sys.details["shape:quote-request"]).toContain("Customer portal → Quote API");
});

test("a trace draws one lane per part and each step, and an event shows who publishes and handles it", async () => {
  const sys = systemOf(await portal());
  const traces = sys.views.find((v) => v.id === "traces");
  expect(traces?.html).toContain("170 ms</b> until the person sees it · then 2 async");
  expect(traces?.html.match(/class="lane"/g)?.length).toBe(5);
  expect(sys.details["step:submit-quote:0"]).toContain("Idempotency-Key header");
  const events = sys.views.find((v) => v.id === "events");
  expect(events?.html).toContain('data-go="call:create-quote"');
  expect(events?.html).toContain('data-go="part:mailer"');
  expect(sys.where["step:submit-quote:3"]).toBe("traces");
});

test("places show each environment's clusters and what isn't placed; the plan shows requirements, questions and the doc", async () => {
  const doc = await portal();
  doc.sections.s1 = { id: "s1", heading: "Who it is for", body: "Buyers.\n\nOn phones.", index: "a0" };
  doc.decisions.d1 = { id: "d1", text: "Cache prices for 5 minutes", by: "Jones", at: "2026-10-02T09:00:00Z" };
  const sys = systemOf(doc);
  const places = sys.views.find((v) => v.id === "places");
  expect(places?.html).toContain("prod-use1");
  expect(places?.html).toContain("aren't placed yet");
  expect(sys.details["placement:quote-api-prod"]).toContain("70% CPU");
  expect(sys.views.find((v) => v.id === "requirements")?.html).toContain('data-go="call:create-quote"');
  const questions = sys.views.find((v) => v.id === "questions");
  expect(questions?.count).toBe(2);
  expect(questions?.html).toContain("Cache prices for 5 minutes");
  expect(sys.views.find((v) => v.id === "doc")?.html).toContain("<p>On phones.</p>");
  expect(sys.views.map((v) => v.id)).toEqual(["map", "api", "data", "events", "traces", "places", "requirements", "questions", "doc"]);
});

test("the components view draws each component with where it is used, and lists what is copied but not a component", async () => {
  const { componentsOf } = await import("./components.ts");
  const doc = await portal();
  const { snapshot, uses } = componentsOf(doc);
  const view = snapshot.views.find((v) => v.id === "components");
  expect(view?.group).toBe("screens");
  expect(view?.html).toContain('data-ref="component:nav"');
  expect(view?.html).toContain("srcdoc=");
  expect(uses.nav?.map((u) => u.page).sort()).toEqual(["home", "pricing"]);
  expect(snapshot.details["component:nav"]).toContain('data-go="page:home"');
  expect(snapshot.details["component:nav"]).toContain('data-go="uses:nav"');
});
