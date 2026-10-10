import { expect, test } from "bun:test";
import type { Page } from "buni/format/doc.ts";
import { groupPages } from "./sidebar.ts";

const page = (id: string, route: string): Page => ({ id, name: id, route, frame: `${id}-frame`, index: id });

test("pages sharing a first route segment group together, in order; lone ones stay loose", () => {
  const items = groupPages([page("home", "/"), page("billing", "/settings/billing"), page("pricing", "/pricing"), page("team", "/settings/team"), page("one", "/blog/one")]);
  expect(items.map((i) => (i.kind === "page" ? i.page.id : `${i.name}: ${i.pages.map((p) => p.id).join(",")}`))).toEqual([
    "home", "Settings: billing,team", "pricing", "one",
  ]);
});

test("graphics gather under Graphics, even alone", () => {
  const logo: Page = { id: "logo", name: "Logo", frame: "logo-frame", index: "z" };
  const items = groupPages([page("home", "/"), logo]);
  expect(items.map((i) => (i.kind === "page" ? i.page.id : `${i.name}: ${i.pages.map((p) => p.id).join(",")}`))).toEqual(["home", "Graphics: logo"]);
});

test("terminal screens gather under their client, even alone", () => {
  const screen = (id: string, client: string): Page => ({ id, name: id, frame: `${id}-frame`, index: id, client, terminal: { surface: "app", cols: 120, rows: 36, colors: "16" } });
  const parts = { cli: { id: "cli", kind: "client" as const, name: "steel CLI", purpose: "", index: "a" } };
  const items = groupPages([page("home", "/"), screen("quotes", "cli"), screen("help", "cli")], parts);
  expect(items.map((i) => (i.kind === "page" ? i.page.id : `${i.name}: ${i.pages.map((p) => p.id).join(",")}`))).toEqual(["home", "steel CLI: quotes,help"]);
});
