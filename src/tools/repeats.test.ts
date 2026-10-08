import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { renderPage } from "./html.ts";
import { findRepeats } from "./library.ts";
import { Workspace } from "./workspace.ts";

const icon = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>`;
/** A sidebar of 11 layers, the active item and the icon size different per page. */
const sidebar = (active: string, size: number) =>
  `<aside layer-name="Sidebar" style="width:200px"><p style="margin:0">Notes</p>${["Today", "Inbox", "Places"].map((t) => `<div style="display:flex">${icon(size)}<span style="font-weight:${t === active ? 700 : 400}">${t}</span></div>`).join("")}</aside>`;

async function design() {
  const file = join(await mkdtemp(join(tmpdir(), "buni-repeats-")), "app.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  const ws = await Workspace.open(file);
  const frames: string[] = [];
  for (const [name, route] of [["Today", "/"], ["Inbox", "/inbox"], ["Places", "/places"]] as const) {
    const r = await ws.call("test", "create_page", { name, route });
    frames.push(r.reply.match(/root frame (\S+)\./)?.[1] ?? "");
  }
  return { ws, frames };
}

test("copies of the same layers across pages are found, and componentize makes them one component without changing a pixel", async () => {
  const { ws, frames } = await design();
  await ws.call("test", "write_html", { parent: frames[0], html: sidebar("Today", 15) });
  // The second copy is pointed out the moment it is written.
  const second = await ws.call("test", "write_html", { parent: frames[1], html: sidebar("Inbox", 15) });
  expect(second.reply).toContain("Copied, not reused");
  expect(second.reply).toContain("componentize");
  await ws.call("test", "write_html", { parent: frames[2], html: sidebar("Places", 17) });
  const [group] = findRepeats(ws.view());
  expect(group?.nodes.length).toBe(3);
  expect(group?.layers).toBe(11);
  const before = Object.values(ws.view().pages).map((p) => renderPage(ws.view(), p.id).html.replace(/ class="[^"]*"/g, ""));
  const r = await ws.call("test", "componentize", { nodes: group?.nodes, name: "Navigation / Sidebar" });
  expect(r.ok).toBe(true);
  const doc = ws.view();
  expect(Object.values(doc.shared).map((s) => s.name)).toEqual(["Navigation / Sidebar"]);
  expect(Object.values(doc.nodes).filter((n) => n.kind === "instance").length).toBe(3);
  expect(findRepeats(doc)).toEqual([]);
  // The words and icon sizes each page had are kept as that use's overrides (the weights too; the screenshots of a
  // real design were checked pixel for pixel).
  const after = Object.values(doc.pages).map((p) => renderPage(doc, p.id).html.replace(/ class="[^"]*"/g, ""));
  expect(after.map((h) => h.replace(/\s+/g, ""))).toEqual(before.map((h) => h.replace(/\s+/g, "")));
  expect(after[2]).toContain('width="17"');
  expect(JSON.stringify(Object.values(doc.nodes).flatMap((n) => (n.kind === "instance" ? [n.overrides] : [])))).toContain('"fontWeight":"700"');
});

test("componentize refuses copies that are not the same layers, and an override's icon must be a safe svg", async () => {
  const { ws, frames } = await design();
  await ws.call("test", "write_html", { parent: frames[0], html: sidebar("Today", 15) });
  await ws.call("test", "write_html", { parent: frames[1], html: `<aside><p>Other</p></aside>` });
  const ids = Object.values(ws.view().nodes).filter((n) => n.tag === "aside").map((n) => n.id);
  expect((await ws.call("test", "componentize", { nodes: ids })).reply).toContain("doesn't have the same layers");
  const made = await ws.call("test", "make_component", { node: ids[0], name: "Navigation / Sidebar" });
  const use = made.reply.match(/instance (\S+) is/)?.[1] ?? "";
  const svg = Object.values(ws.view().nodes).find((n) => n.kind === "svg")?.id ?? "";
  expect((await ws.call("test", "override", { instance: use, node: svg, markup: icon(20) })).ok).toBe(true);
  expect((await ws.call("test", "override", { instance: use, node: svg, markup: `<svg onload="alert(1)"></svg>` })).ok).toBe(false);
});
