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

test("terminal screens gather under Terminal, even alone", () => {
  const screen = (id: string): Page => ({ id, name: id, frame: `${id}-frame`, index: id, terminal: { surface: "app", cols: 120, rows: 36, colors: "16" } });
  const items = groupPages([page("home", "/"), screen("quotes"), screen("help")]);
  expect(items.map((i) => (i.kind === "page" ? i.page.id : `${i.name}: ${i.pages.map((p) => p.id).join(",")}`))).toEqual(["home", "Terminal: quotes,help"]);
});

test("a take is listed right under its page, never among the graphics", () => {
  const page = (id: string, extra: Partial<Page> = {}) => ({ id, name: id, frame: id, index: id, ...extra }) as Page;
  const items = groupPages([page("home", { route: "/" }), page("logo"), page("home-b", { option: { of: "home", idea: "b" } })]);
  expect(items.map((i) => (i.kind === "page" ? i.page.id : `${i.name}:${i.pages.map((p) => p.id).join(",")}`))).toEqual(["home", "home-b", "Graphics:logo"]);
});

test("with flows, pages list under each flow in walking order; states fold into their screen; the rest after", () => {
  const p = (id: string, extra: Partial<Page>): Page => ({ id, name: id, frame: `${id}-f`, index: id, ...extra });
  const items = groupPages([
    p("find", { route: "/" }), p("find-closed", { route: "/", state: "Window closed" }), p("items", { route: "/items" }),
    p("label", { route: "/label" }), p("find-next", { option: { of: "find", idea: "b" } }), p("about", { route: "/about" }), p("logo", {}),
  ], [{ id: "f1", name: "Return an item", pages: ["find", "items", "find-closed"] }, { id: "f2", name: "Again", pages: ["items", "label"] }]);
  expect(items.map((i) => (i.kind === "page" ? i.page.id : `${i.name}: ${i.pages.map((x) => x.id).join(",")}`))).toEqual([
    "Return an item: find,find-next,items", "Again: label", "Not in a flow: about", "Graphics: logo",
  ]);
});
