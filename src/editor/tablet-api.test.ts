import { expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { layoutFor } from "./renderer/architecture/layout.ts";
import { createEditor } from "./server.ts";
import { DiskStore } from "./store.ts";
import { pageTag, tabletCanvas, tabletDesign, tabletPages } from "./tablet-api.ts";
import { placement } from "./renderer/layout.ts";
import { subtree } from "../tools/kit.ts";
import { Workspace } from "../tools/workspace.ts";
import { Tablets } from "./usb.ts";

const example = new URL("../../examples/parcel.buni", import.meta.url);

test("the tablet gets the map laid out as the editor lays it out, with pages and plans", async () => {
  const parsed = parseDoc(await Bun.file(example).text());
  if (!parsed.ok) throw new Error("example doesn't parse");
  const d = tabletDesign(parsed.doc, "/designs/x/parcel.buni");
  const system = layoutFor(parsed.doc.architecture!, "system", undefined);
  expect(d.levels.system.boxes.map((b) => [b.key, b.x, b.y])).toEqual(system.boxes.map((b) => [b.key, b.x, b.y]));
  expect(d.levels.system.boxes.find((b) => b.key === "credit-ledger")?.tone).toBe("planned");
  expect(d.levels.context.boxes.length).toBeGreaterThan(0);
  expect(d.pages.length).toBeGreaterThan(3);
  expect(d.pages.every((p) => p.width > 0)).toBe(true);
  expect(d.plans).toEqual([expect.objectContaining({ id: "store-credit", changes: expect.arrayContaining([expect.objectContaining({ id: "credit-ledger", change: "add" })]) })]);
  // The same design, the same version; another, another.
  expect(tabletDesign(parsed.doc, "/designs/x/parcel.buni").version).toBe(d.version);
});

test("a flow is laid out for the tablet: its steps in a row, the other screens under the step they leave", async () => {
  const parsed = parseDoc(await Bun.file(example).text());
  if (!parsed.ok) throw new Error("example doesn't parse");
  const f = tabletDesign(parsed.doc, "/designs/x/parcel.buni").flows.find((x) => x.name === "Return an item");
  if (!f) throw new Error("no flow");
  const steps = f.screens.filter((s) => s.step !== null);
  expect(steps.map((s) => s.name)).toEqual(["Find your order", "Choose items", "Return started"]);
  expect(steps.every((s, i) => i === 0 || s.x > (steps[i - 1]?.x ?? 0))).toBe(true);
  // Not found is reached from the first step, under it, labelled with what sends people there.
  const notFound = f.screens.find((s) => s.name === "Not found");
  expect(notFound?.y).toBeGreaterThan((steps[0]?.y ?? 0) + (steps[0]?.h ?? 0));
  expect(f.links.find((l) => l.to === notFound?.page)).toMatchObject({ when: true, label: expect.stringContaining("404") });
  // The usual path's arrow is named by what the person taps.
  expect(f.links.find((l) => l.from === steps[0]?.page && l.to === steps[1]?.page)?.label).toBe("Find my order");
  expect(f.lanes).toContain("Risk");
  expect(f.journey.find((j) => j.page === steps[1]?.page)?.cells.Doing).toBeTruthy();
  expect(f.width).toBeGreaterThan(Math.max(...f.screens.map((s) => s.x + s.w)));
  // The others say what sends people there and where they lead back to; steps carry their journey's card under them.
  expect(notFound).toMatchObject({ when: expect.stringContaining("404"), back: "Choose items" });
  expect(steps.every((st) => st.card && st.card[1] > st.y + st.h && notFound && st.card[1] + st.card[3] < notFound.y)).toBe(true);
  // Walking it offers every way on, the ways back too.
  expect(f.moves).toContainEqual(expect.objectContaining({ from: notFound?.page, to: steps[1]?.page }));
});

test("a page's picture is redrawn when the page changes, not when a mark is drawn or another page changes", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-tag-")), "d.buni");
  await copyFile(example, file);
  const ws = await Workspace.open(file);
  const [a, b] = ["2e00677a", "50094e02"];
  const tagA = pageTag(ws.view(), a), tagB = pageTag(ws.view(), b);
  expect((await ws.call("Tab", "mark", { page: a, strokes: [{ tool: "pen", color: "#c8331f", width: 3, points: [0, 0, 40, 0] }] })).ok).toBe(true);
  expect(pageTag(ws.view(), a)).toBe(tagA);
  // Change a word on the second page: only its picture is out of date.
  const onB = subtree(ws.view(), ws.view().pages[b]?.frame ?? "").find((n) => n.kind === "text");
  if (!onB) throw new Error("no text on the second page");
  expect((await ws.call("claude", "set_text", { node: onB.id, text: "Changed" })).ok).toBe(true);
  expect(pageTag(ws.view(), a)).toBe(tagA);
  expect(pageTag(ws.view(), b)).not.toBe(tagB);
  // Drawn ahead in the order they're seen: Home's pages, then the flows' screens, each once.
  const ahead = tabletPages(ws.view(), tabletDesign(ws.view(), "x"));
  expect(ahead[0]).toBe(a);
  expect(ahead).toContain("8a0bcebd");
  expect(new Set(ahead).size).toBe(ahead.length);
});

test("the Screens canvas is laid out as the editor lays it out, its links leaving from the side of what's tapped", async () => {
  const parsed = parseDoc(await Bun.file(example).text());
  if (!parsed.ok) throw new Error("example doesn't parse");
  const doc = parsed.doc;
  const pages = Object.values(doc.pages);
  // Every page drew 844 tall; each link's layer sits 100 down, 50 in.
  const shots = new Map(pages.map((p) => [p.id, { height: 844, targets: Object.values(doc.connections).filter((c) => c.page === p.id).map((c) => ({ id: c.node, x: 50, y: 100, width: 40, height: 20 })) }]));
  const c = tabletCanvas(doc, shots);
  expect(c.boards).toHaveLength(pages.length);
  const at = placement(doc, new Map(pages.map((p) => [p.id, 844])));
  const [first, second] = c.boards;
  if (!first || !second) throw new Error("no boards");
  // The same layout, moved as one so it starts with room for titles.
  expect(second.x - first.x).toBe((at.get(second.page)?.x ?? 0) - (at.get(first.page)?.x ?? 0));
  expect(second.y - first.y).toBe((at.get(second.page)?.y ?? 0) - (at.get(first.page)?.y ?? 0));
  expect(Math.min(...c.boards.map((b) => b.x))).toBeGreaterThan(0);
  expect(c.titles.map((t) => t.name)).toContain("Return an item");
  const link = c.links.find((l) => l.from === "2e00677a" && l.to === "50094e02");
  const from = c.boards.find((b) => b.page === "2e00677a");
  // It leaves from the layer's right side, halfway down (50 in, 40 wide; 100 down, 20 tall), as on the editor's canvas.
  expect(link?.dot).toEqual([(from?.x ?? 0) + 90, (from?.y ?? 0) + 110]);
  expect(link?.d.startsWith(`M ${(from?.x ?? 0) + 90} ${(from?.y ?? 0) + 110} `)).toBe(true);
  // And its label is the page it opens.
  expect(link?.label).toBe(doc.pages["50094e02"]?.name.replace(/^\s*\d+\s*·\s*/, ""));
  expect(c.width).toBeGreaterThan(Math.max(...c.boards.map((b) => b.x + b.w)));
});

test("a sketch on the canvas gets room, and the tablet knows where the editor's 0, 0 is", async () => {
  const parsed = parseDoc(await Bun.file(example).text());
  if (!parsed.ok) throw new Error("example doesn't parse");
  const doc = { ...parsed.doc, comments: { ...parsed.doc.comments, s1: { id: "s1", node: "screens", state: "open" as const, posts: [{ author: "Tab", body: "x", at: "2026-10-23T00:00:00Z" }], ink: { sketch: true as const, strokes: [{ tool: "pen" as const, color: "#000", width: 2, points: [-900, -700, -600, -400] }] } } } };
  const c = tabletCanvas(doc, new Map());
  // The sketch, moved by the origin, lands inside the canvas with the same room pages get.
  expect(-900 + c.origin[0]).toBeGreaterThanOrEqual(0);
  expect(-700 + c.origin[1]).toBeGreaterThanOrEqual(0);
  expect(tabletDesign(doc, "x").marks.find((m) => m.id === "s1")).toMatchObject({ view: "sketch", onName: "New screen sketch" });
});

test("the app pairs with a code, draws on the system, sends what it showed, and decides on the plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-tablet-api-"));
  try {
    const adb = join(dir, "adb");
    await writeFile(adb, `#!/bin/sh\necho "$@" >> "${join(dir, "adb.log")}"\ncase "$*" in\n  "devices -l") printf 'List of devices attached\\nT1 device model:SM_T738U\\n' ;;\n  *device_name*) echo "Galaxy Tab" ;;\n  *"pm list packages"*) echo "package:app.emusoi.buni" ;;\nesac\n`);
    await chmod(adb, 0o755);
    const tablets = new Tablets(undefined, adb);
    tablets.port = 47200;
    await mkdir(join(dir, "x"));
    await copyFile(example, join(dir, "x/parcel.buni"));
    const editor = await createEditor({ store: new DiskStore(dir), origin: "http://localhost:1", localFile: join(dir, "x/parcel.buni"), assets: () => ({ files: new Map(), client: "", styles: "" }), tablets });
    const file = "/designs/x/parcel.buni";
    // With the app installed, the Mac starts the app (not Chrome) with the code.
    expect(await tablets.open("T1", file)).toEqual({ name: "Galaxy Tab" });
    const log = await readFile(join(dir, "adb.log"), "utf8");
    expect(log).toContain("am start -n app.emusoi.buni/.MainActivity --es url 'http://localhost:47200/tablet/v1?code=");
    const code = log.match(/tablet\/v1\?code=([A-Z0-9]+)/)?.[1] ?? "";

    const host = "localhost:47200";
    const call = (path: string, init: RequestInit & { token?: string } = {}) => editor.tabletFetch(new Request(`http://${host}/tablet/v1/${path}${path.includes("?") ? "&" : "?"}file=${encodeURIComponent(file)}`, {
      ...init, headers: { host, "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    }));
    const paired = await call("pair", { method: "POST", body: JSON.stringify({ code }) });
    const { token, device } = await paired.json();
    expect(device).toBe("Galaxy Tab");
    expect((await call("pair", { method: "POST", body: JSON.stringify({ code }) })).status).toBe(403);
    expect((await call("design")).status).toBe(401);

    const design = await (await call("design", { token })).json();
    expect(design.levels.system.boxes.length).toBeGreaterThan(0);
    const mark = await (await call("marks", { token, method: "POST", body: JSON.stringify({ view: "system", on: "jobs", strokes: [{ tool: "pen", color: "#c8331f", width: 2.5, points: [0, 0, 80, 40] }] }) })).json();
    expect(mark.id).toBeTruthy();
    const after = await (await call("design", { token })).json();
    expect(after.marks).toEqual([expect.objectContaining({ id: mark.id, view: "system", on: "jobs", onName: "Jobs", from: "Galaxy Tab" })]);
    expect(after.version).not.toBe(design.version);
    // A mark on nothing in particular points at the architecture.
    const loose = await (await call("marks", { token, method: "POST", body: JSON.stringify({ view: "context", on: "nope", strokes: [{ tool: "pen", color: "#000", width: 2, points: [1, 1, 2, 2] }] }) })).json();
    expect((await (await call("design", { token })).json()).marks.find((m: { id: string }) => m.id === loose.id).on).toBe("architecture");

    // Send: the request names the picture the tablet showed, and the agent's tool lists the sketch.
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f0c9c80000000049454e44ae426082", "hex").toString("base64");
    const sent = await (await call("send", { token, method: "POST", body: JSON.stringify({ view: "system", picture: png }) })).json();
    expect(sent.count).toBe(1);
    expect(await Bun.file(sent.picture).exists()).toBe(true);
    expect((await call("send", { token, method: "POST", body: JSON.stringify({ view: "system", picture: Buffer.from("not a png").toString("base64") }) })).status).toBe(400);

    expect((await (await call("marks/erase", { token, method: "POST", body: JSON.stringify({ id: loose.id }) })).json()).ok).toBe(true);
    // A merge can leave out an addition the person unticked; one the plan doesn't add is refused.
    expect((await call("plan", { token, method: "POST", body: JSON.stringify({ plan: "store-credit", action: "merge", skip: ["jobs"] }) })).status).toBe(400);
    // Plans: discard one, and a plan that isn't there is said so.
    expect((await call("plan", { token, method: "POST", body: JSON.stringify({ plan: "nope", action: "merge" }) })).status).toBe(404);
    const discarded = await (await call("plan", { token, method: "POST", body: JSON.stringify({ plan: "store-credit", action: "discard" }) })).json();
    expect(discarded.ok).toBe(true);
    expect((await (await call("design", { token })).json()).plans).toEqual([]);

    // The live feed opens; nothing outside the API is reachable with the token.
    const events = await call("events", { token });
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    await events.body?.cancel();
    expect((await call("../rpc/commit", { token, method: "POST", body: "[]" })).status).toBeGreaterThanOrEqual(400);
    expect((await call("write_html", { token, method: "POST", body: "{}" })).status).toBe(404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepting a plan with a change unticked merges the rest and leaves that one out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-tablet-skip-"));
  try {
    const adb = join(dir, "adb");
    await writeFile(adb, `#!/bin/sh\necho "$@" >> "${join(dir, "adb.log")}"\ncase "$*" in\n  "devices -l") printf 'List of devices attached\\nT1 device model:X\\n' ;;\nesac\n`);
    await chmod(adb, 0o755);
    const tablets = new Tablets(undefined, adb);
    tablets.port = 47201;
    await mkdir(join(dir, "x"));
    await copyFile(example, join(dir, "x/parcel.buni"));
    const editor = await createEditor({ store: new DiskStore(dir), origin: "http://localhost:1", localFile: join(dir, "x/parcel.buni"), assets: () => ({ files: new Map(), client: "", styles: "" }), tablets });
    await tablets.open("T1", "/designs/x/parcel.buni");
    const code = (await readFile(join(dir, "adb.log"), "utf8")).match(/code=([A-Z0-9]+)/)?.[1] ?? "";
    const host = "localhost:47201";
    const call = (path: string, body: unknown, token?: string) => editor.tabletFetch(new Request(`http://${host}/tablet/v1/${path}?file=${encodeURIComponent("/designs/x/parcel.buni")}`, {
      method: "POST", body: JSON.stringify(body), headers: { host, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }));
    const { token } = await (await call("pair", { code })).json();
    const before = parseDoc(await readFile(join(dir, "x/parcel.buni"), "utf8"));
    if (!before.ok) throw new Error("doesn't parse");
    const adds = Object.values(before.doc.architecture!.parts).filter((p) => p.plan === "store-credit").map((p) => p.id);
    expect(adds).toContain("credit-ledger");
    const r = await (await call("plan", { plan: "store-credit", action: "merge", skip: ["credit-ledger"] }, token)).json();
    expect(r.ok).toBe(true);
    const after = parseDoc(await readFile(join(dir, "x/parcel.buni"), "utf8"));
    if (!after.ok) throw new Error("doesn't parse");
    expect(after.doc.architecture!.parts["credit-ledger"]).toBeUndefined();
    expect(after.doc.architecture!.plans["store-credit"]).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
