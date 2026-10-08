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
