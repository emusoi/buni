import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { renderPage } from "./html.ts";
import { Workspace } from "./workspace.ts";

/** A page, a Nav item component (an icon tile and a label), and a Sidebar component holding two Nav items. */
async function design() {
  const file = join(await mkdtemp(join(tmpdir(), "buni-nested-")), "app.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  const ws = await Workspace.open(file);
  const id = (reply: string, re: RegExp) => reply.match(re)?.[1] ?? "";
  const created = (await ws.call("t", "create_page", { name: "Home", route: "/" })).reply;
  const frame = id(created, /root frame (\S+)\./);
  const home = id(created, /Created page (\S+) /);
  const item = await ws.call("t", "create_component", { name: "Navigation / Item", html: '<div style="display:flex;gap:8px"><span layer-name="Tile" style="width:12px;height:12px;background:#ccc"></span><span layer-name="Label">Item</span></div>' });
  const itemId = id(item.reply, /Component (\S+) /);
  const itemRoot = id(item.reply, /with root (\S+)\./);
  const label = Object.values(ws.view().nodes).find((n) => n.name === "Label")?.id ?? "";
  // The Sidebar is drawn on the page from two Nav item uses, then made a component.
  const aside = id((await ws.call("t", "write_html", { parent: frame, html: '<aside layer-name="Sidebar" style="width:200px"></aside>' })).reply, /Created \d+ nodes?: (\S+?)[,.]/);
  const first = id((await ws.call("t", "place_component", { component: itemId, parent: aside })).reply, /instance (\S+) of/);
  const second = id((await ws.call("t", "place_component", { component: itemId, parent: aside })).reply, /instance (\S+) of/);
  await ws.call("t", "override", { instance: first, node: label, text: "Today" });
  await ws.call("t", "override", { instance: second, node: label, text: "Inbox" });
  const made = await ws.call("t", "make_component", { node: aside, name: "Navigation / Sidebar" });
  expect(made.ok).toBe(true);
  const sidebarId = id(made.reply, /Component (\S+) /);
  const use = id(made.reply, /instance (\S+) is/);
  return { ws, home, frame, itemId, itemRoot, label, first, second, sidebarId, use };
}

test("a component can hold other components, and a use reaches into them by path", async () => {
  const { ws, home, label, first, use } = await design();
  const html = () => renderPage(ws.view(), home).html;
  expect(html()).toContain("Today");
  expect(html()).toContain("Inbox");
  // This page's Sidebar renames its first item; the component itself, and the second item, are unchanged.
  const r = await ws.call("t", "override", { instance: use, node: `${first}/${label}`, text: "Now" });
  expect(r.ok).toBe(true);
  expect(html()).toContain("Now");
  expect(html()).not.toContain("Today");
  expect(html()).toContain("Inbox");
  expect((await ws.call("t", "override", { instance: use, node: `${first}/nope` , text: "x" })).ok).toBe(false);
});

test("a component can't hold itself, however far down", async () => {
  const { ws, itemRoot, itemId, sidebarId } = await design();
  // The Sidebar holds Nav items; a Nav item holding the Sidebar would draw forever.
  const r = await ws.call("t", "place_component", { component: sidebarId, parent: itemRoot });
  expect(r.ok).toBe(false);
  expect(r.reply).toContain("can't hold themselves");
  expect((await ws.call("t", "place_component", { component: itemId, parent: itemRoot })).reply).toContain("can't hold itself");
});

test("detaching a use keeps what it set inside the components it holds", async () => {
  const { ws, home, label, first, use } = await design();
  await ws.call("t", "override", { instance: use, node: `${first}/${label}`, text: "Now" });
  expect((await ws.call("t", "detach_instance", { instance: use })).ok).toBe(true);
  expect(renderPage(ws.view(), home).html).toContain("Now");
});

test("copies holding component uses become one component, their different overrides kept by path", async () => {
  const { ws, home, frame, itemId, label } = await design();
  const id = (reply: string, re: RegExp) => reply.match(re)?.[1] ?? "";
  const copies: string[] = [];
  for (const word of ["Alpha", "Beta"]) {
    const box = id((await ws.call("t", "write_html", { parent: frame, html: `<section layer-name="Group"><h3 style="margin:0">Group</h3><p style="margin:0">A</p><p style="margin:0">B</p><p style="margin:0">C</p><p style="margin:0">D</p><p style="margin:0">E</p><p style="margin:0">F</p></section>` })).reply, /Created \d+ nodes?: (\S+?)[,.]/);
    const it = id((await ws.call("t", "place_component", { component: itemId, parent: box })).reply, /instance (\S+) of/);
    await ws.call("t", "override", { instance: it, node: label, text: word });
    copies.push(box);
  }
  const r = await ws.call("t", "componentize", { nodes: copies, name: "Lists / Group" });
  expect(r.ok).toBe(true);
  const html = renderPage(ws.view(), home).html;
  expect(html).toContain("Alpha");
  expect(html).toContain("Beta");
});

test("a copy whose nested part changes less than the first copy's still becomes a use that looks the same", async () => {
  const { ws, home, frame, itemId, label } = await design();
  const id = (reply: string, re: RegExp) => reply.match(re)?.[1] ?? "";
  const copies: string[] = [];
  for (const word of ["Renamed", undefined]) {
    const box = id((await ws.call("t", "write_html", { parent: frame, html: `<section layer-name="Group"><h3 style="margin:0">G</h3><p style="margin:0">A</p><p style="margin:0">B</p><p style="margin:0">C</p><p style="margin:0">D</p><p style="margin:0">E</p><p style="margin:0">F</p></section>` })).reply, /Created \d+ nodes?: (\S+?)[,.]/);
    const it = id((await ws.call("t", "place_component", { component: itemId, parent: box })).reply, /instance (\S+) of/);
    if (word) await ws.call("t", "override", { instance: it, node: label, text: word, style: { color: "#d9480f" } });
    copies.push(box);
  }
  expect((await ws.call("t", "componentize", { nodes: copies, name: "Lists / Group" })).ok).toBe(true);
  const html = renderPage(ws.view(), home);
  expect(html.html.match(/>Renamed</g)?.length).toBe(1);
  // The second copy's item shows the component's own word again, and its colour is put back.
  expect(html.html).toContain(">Item<");
  expect(html.css).toContain("color: initial");
});

test("a use can swap an icon inside a nested part, and the file still reads", async () => {
  const { ws, use, first } = await design();
  const tile = Object.values(ws.view().nodes).find((n) => n.name === "Tile")?.id ?? "";
  // The tile isn't an svg: an icon there is refused, as on the part itself.
  expect((await ws.call("t", "override", { instance: use, node: `${first}/${tile}`, markup: "<svg></svg>" })).ok).toBe(false);
  const icon = await ws.call("t", "create_component", { name: "Navigation / Icon item", html: '<div><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg><span>Item</span></div>' });
  const iconId = icon.reply.match(/Component (\S+) /)?.[1] ?? "";
  const holder = icon.reply.match(/with root (\S+)\./)?.[1] ?? "";
  // The component's root holds the <div>, which holds the icon.
  const svg = Object.values(ws.view().nodes).find((n) => n.kind === "svg" && ws.view().nodes[n.parent ?? ""]?.parent === holder)?.id ?? "";
  const frame = Object.values(ws.view().pages)[0]?.frame ?? "";
  const box = (await ws.call("t", "write_html", { parent: frame, html: "<div></div>" })).reply.match(/Created \d+ nodes?: (\S+?)[,.]/)?.[1] ?? "";
  const inner = (await ws.call("t", "place_component", { component: iconId, parent: box })).reply.match(/instance (\S+) of/)?.[1] ?? "";
  const made = await ws.call("t", "make_component", { node: box, name: "Navigation / Bar" });
  const bar = made.reply.match(/instance (\S+) is/)?.[1] ?? "";
  const r = await ws.call("t", "override", { instance: bar, node: `${inner}/${svg}`, markup: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><rect width="20" height="20"/></svg>' });
  expect(r.reply).toBe("Override set.");
  expect((await Workspace.open(ws.path)).view().nodes[bar]).toBeDefined();
});
