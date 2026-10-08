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
