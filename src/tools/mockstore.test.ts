import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "./workspace.ts";
import { MockStore } from "./mockstore.ts";

const example = new URL("../../examples/portal.buni", import.meta.url).pathname;

test("the mock remembers: adds, reads, changes, actions, sub-lists and removals show in later reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-mockstore-"));
  const file = join(dir, "portal.buni");
  await copyFile(example, file);
  const ws = await Workspace.open(file);
  const ok = async (tool: Parameters<Workspace["call"]>[1], args: unknown) => {
    const r = await ws.call("you", tool, args);
    if (!r.ok) throw new Error(r.reply);
  };
  await ok("set_part", { kind: "service", name: "Plants API", purpose: "Plants.", api: "rest" });
  const service = Object.values(ws.view().parts).find((p) => p.name === "Plants API")?.id ?? "";
  await ok("set_shape", { name: "Plant", fields: [{ name: "id", type: "id", example: "p1" }, { name: "name", type: "string", example: "Monstera" }, { name: "snoozedUntil", type: "string", optional: true }] });
  await ok("set_shape", { name: "Log", fields: [{ name: "id", type: "id" }, { name: "wateredAt", type: "datetime" }] });
  const ep = (method: string, path: string, request: unknown[], response: unknown) => ok("set_endpoint", { service, method, path, summary: `${method} ${path}`, request, response });
  await ep("GET", "/plants", [], [{ name: "items", type: "Plant[]" }]);
  await ep("POST", "/plants", [{ name: "name", type: "string" }], "Plant");
  await ep("GET", "/plants/{id}", [], "Plant");
  await ep("PUT", "/plants/{id}/snooze", [{ name: "snoozedUntil", type: "string" }], "Plant");
  await ep("GET", "/plants/{id}/logs", [], [{ name: "items", type: "Log[]" }]);
  await ep("POST", "/plants/{id}/logs", [{ name: "wateredAt", type: "datetime" }], [{ name: "log", type: "Log" }]);
  await ep("DELETE", "/plants/{id}", [], []);
  const doc = ws.view();
  const e = (method: string, path: string) => {
    const found = Object.values(doc.endpoints).find((x) => x.method === method && x.path === path);
    if (!found) throw new Error(`${method} ${path}`);
    return found;
  };
  const m = new MockStore();
  // Seeded from the example, then a POST adds one with a new id.
  expect(m.answer(doc, e("GET", "/plants"), {})).toEqual({ items: [{ id: "p1", name: "Monstera" }] });
  const made = m.answer(doc, e("POST", "/plants"), { name: "Pothos" });
  const pothos = typeof made === "object" && made !== null && !Array.isArray(made) ? String(made.id) : "";
  expect(made).toMatchObject({ name: "Pothos" });
  expect(m.answer(doc, e("GET", "/plants"), {})).toMatchObject({ items: [{ name: "Monstera" }, { name: "Pothos" }] });
  // An action writes onto the record; reading it back shows it.
  m.answer(doc, e("PUT", "/plants/{id}/snooze"), { id: "p1", snoozedUntil: "2026-10-06" });
  expect(m.answer(doc, e("GET", "/plants/{id}"), { id: "p1" })).toMatchObject({ name: "Monstera", snoozedUntil: "2026-10-06" });
  // A sub-list belongs to its plant.
  m.answer(doc, e("POST", "/plants/{id}/logs"), { id: "p1", wateredAt: "2026-10-04T09:00:00Z" });
  expect(m.answer(doc, e("GET", "/plants/{id}/logs"), { id: "p1" })).toMatchObject({ items: [expect.anything(), { wateredAt: "2026-10-04T09:00:00Z" }] });
  // A removal is gone from the list; a reset starts again from the example.
  m.answer(doc, e("DELETE", "/plants/{id}"), { id: pothos });
  expect(m.answer(doc, e("GET", "/plants"), {})).toMatchObject({ items: [{ name: "Monstera" }] });
  m.reset();
  expect(m.answer(doc, e("GET", "/plants"), {})).toEqual({ items: [{ id: "p1", name: "Monstera" }] });
});

test("a single record (GET /me answers one object) remembers what PATCH set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-mockme-"));
  const file = join(dir, "portal.buni");
  await copyFile(example, file);
  const ws = await Workspace.open(file);
  const ok = async (tool: Parameters<Workspace["call"]>[1], args: unknown) => {
    const r = await ws.call("you", tool, args);
    if (!r.ok) throw new Error(r.reply);
  };
  await ok("set_part", { kind: "service", name: "Me API", purpose: "Settings.", api: "rest" });
  const service = Object.values(ws.view().parts).find((p) => p.name === "Me API")?.id ?? "";
  await ok("set_endpoint", { service, method: "GET", path: "/me", summary: "Read settings", request: [], response: [{ name: "digestLocalTime", type: "string", example: "08:00" }, { name: "paused", type: "boolean", example: false }] });
  await ok("set_endpoint", { service, method: "PATCH", path: "/me", summary: "Set settings", request: [{ name: "digestLocalTime", type: "string" }], response: [{ name: "digestLocalTime", type: "string", example: "08:00" }, { name: "paused", type: "boolean", example: false }] });
  const doc = ws.view();
  const get = Object.values(doc.endpoints).find((x) => x.method === "GET" && x.path === "/me");
  const patch = Object.values(doc.endpoints).find((x) => x.method === "PATCH" && x.path === "/me");
  if (!get || !patch) throw new Error("no /me");
  const m = new MockStore();
  expect(m.answer(doc, get, {})).toEqual({ digestLocalTime: "08:00", paused: false });
  expect(m.answer(doc, patch, { digestLocalTime: "18:30" })).toEqual({ digestLocalTime: "18:30", paused: false });
  expect(m.answer(doc, get, {})).toEqual({ digestLocalTime: "18:30", paused: false });
});
