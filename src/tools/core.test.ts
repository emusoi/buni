import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, walkFlow, withProject } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { exportSite, renderPage } from "./html.ts";
import { embeddedFont } from "./fontdata.ts";
import { Workspace } from "./workspace.ts";

test("a core file shares its components and tokens; sections place them, override tokens, and can't edit them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-core-"));
  await mkdir(join(dir, "checkout"));
  for (const f of ["core.buni", "checkout/checkout.buni"]) await writeFile(join(dir, f), serializeDoc(emptyDoc()));
  const core = await Workspace.open(join(dir, "core.buni"));
  const ok = async (ws: Workspace, tool: Parameters<Workspace["call"]>[1], args: object) => {
    const r = await ws.call("pi", tool, args);
    if (!r.ok) throw new Error(`${tool}: ${r.reply}`);
    return r.reply;
  };
  await ok(core, "tokens", { set: { "--ink": "#111111", "--accent": "#0055ff" } });
  await ok(core, "create_component", { name: "Buttons / Primary", html: '<button style="color: var(--accent)">Pay now</button>' });
  const button = Object.values(core.view().shared)[0]!;

  const section = await Workspace.open(join(dir, "checkout/checkout.buni"));
  await ok(section, "import_file", { path: "../core.buni" });
  expect(section.owners()[button.id]).toBe("../core.buni");
  const page = (await ok(section, "create_page", { name: "Pay", route: "/pay" })).match(/root frame (\S+?)[;.]/)?.[1];
  await ok(section, "place_component", { component: button.id, parent: page });
  await ok(section, "tokens", { set: { "--accent": "#ff3300" } });

  // Drawn with the core's component and tokens, the section's own token winning.
  const html = renderPage(section.system(), Object.keys(section.view().pages)[0]!);
  expect(html.html).toContain("Pay now");
  expect(html.css).toContain("#ff3300");
  expect(html.css).toContain("#111111");
  // The core's component stays in the core: not copied in, and not editable from here.
  const saved = await readFile(join(dir, "checkout/checkout.buni"), "utf8");
  expect(saved).not.toContain("Pay now");
  const r = await section.call("pi", "update_styles", { nodes: [button.root], style: { color: "red" } });
  expect(r.ok).toBe(false);
  expect(r.reply).toContain("imported file");
  // An edit to the core reaches the section once it reads its imports again.
  await ok(core, "tokens", { set: { "--ink": "#222222" } });
  expect(section.system().tokens["--ink"]).toBe("#111111");
  await section.refreshImports();
  expect(section.system().tokens["--ink"]).toBe("#222222");
});

test("buni split core moves components and tokens out, ids kept, and the design draws the same", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-split-core-"));
  const file = join(dir, "portal.buni");
  await writeFile(file, await readFile(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
  const ws = await Workspace.open(file);
  const before = Object.keys(ws.view().pages).map((p) => renderPage(ws.system(), p).html);
  const components = Object.keys(ws.view().shared);
  expect(components.length).toBeGreaterThan(0);
  const r = await ws.splitCore("core.buni");
  expect(r.ok).toBe(true);
  expect(ws.view().shared).toEqual({});
  expect(ws.view().imports).toEqual(["core.buni"]);
  expect(Object.keys((await Workspace.open(join(dir, "core.buni"))).view().shared).sort()).toEqual(components.sort());
  // Reopened from disk, every page renders exactly as before.
  const again = await Workspace.open(file);
  expect(Object.keys(again.view().pages).map((p) => renderPage(again.system(), p).html)).toEqual(before);
});

test("sections link to each other's pages: checked, exported by route, and flows stay in their file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-links-"));
  for (const f of ["checkout.buni", "account.buni"]) await writeFile(join(dir, f), serializeDoc(emptyDoc()));
  const checkout = await Workspace.open(join(dir, "checkout.buni"));
  const account = await Workspace.open(join(dir, "account.buni"));
  const ok = async (ws: Workspace, tool: Parameters<Workspace["call"]>[1], args: object) => {
    const r = await ws.call("pi", tool, args);
    if (!r.ok) throw new Error(`${tool}: ${r.reply}`);
    return r.reply;
  };
  const orders = (await ok(account, "create_page", { name: "Orders", route: "/account/orders" })).match(/page (\S+) /)![1]!;
  const payFrame = (await ok(checkout, "create_page", { name: "Paid", route: "/paid" })).match(/root frame (\S+?)[;.]/)![1]!;
  await ok(checkout, "write_html", { parent: payFrame, html: '<a layer-name="See orders">See your orders</a>' });
  const link = Object.values(checkout.view().nodes).find((n) => n.name === "See orders")!.id;
  // Not imported yet: the other file's page is unknown here.
  expect((await checkout.call("pi", "connect", { node: link, to: orders })).ok).toBe(false);
  await ok(checkout, "import_file", { path: "account.buni" });
  expect(await ok(checkout, "connect", { node: link, to: orders })).toContain("Orders");
  expect(checkout.owners()[orders]).toBe("account.buni");
  // Reopened, it still checks; export links the page by its route; the flow from Paid doesn't wander into account.
  const again = await Workspace.open(join(dir, "checkout.buni"));
  const paid = Object.keys(again.view().pages)[0]!;
  const site = exportSite(again.system(), embeddedFont);
  expect([...site.values()].join("")).toContain('href="/account/orders"');
  expect(walkFlow(again.system(), paid).pages).toEqual([paid]);
});

test("rename_page renames a page and its frame, moves its route and its states with it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-rename-"));
  await writeFile(join(dir, "a.buni"), serializeDoc(emptyDoc()));
  const ws = await Workspace.open(join(dir, "a.buni"));
  const id = (await ws.call("pi", "create_page", { name: "Untitled 1", route: "/untitled-1" })).reply.match(/page (\S+) /)![1]!;
  expect((await ws.call("pi", "duplicate_page", { page: id, state: "Empty" })).ok).toBe(true);
  expect((await ws.call("pi", "rename_page", { page: id, name: "Orders", route: "/orders" })).ok).toBe(true);
  const pages = Object.values(ws.view().pages);
  expect(pages.map((p) => p.route)).toEqual(["/orders", "/orders"]);
  expect(ws.view().nodes[ws.view().pages[id]!.frame]!.name).toBe("Orders");
  await ws.call("pi", "create_page", { name: "Other", route: "/other" });
  expect((await ws.call("pi", "rename_page", { page: id, route: "/other" })).ok).toBe(false);
});

test("create_component with root makes the one top element the component, so it hugs where it's placed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-root-"));
  await writeFile(join(dir, "a.buni"), serializeDoc(emptyDoc()));
  const ws = await Workspace.open(join(dir, "a.buni"));
  const r = await ws.call("pi", "create_component", { name: "Buttons / Go", root: true, html: '<a style="padding:12px;width:fit-content">Go</a>' });
  expect(r.ok).toBe(true);
  const section = Object.values(ws.view().shared)[0]!;
  const root = ws.view().nodes[section.root]!;
  expect(root.parent).toBeUndefined();
  expect(root.kind !== "instance" && root.kind !== "svg" ? root.tag : undefined).toBe("a");
  expect((await ws.call("pi", "create_component", { name: "Two", root: true, html: "<a>1</a><a>2</a>" })).ok).toBe(false);
});

test("a core's nav links once, on every use: each section's pages follow it, and a page's own link wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-every-"));
  for (const f of ["core.buni", "site.buni", "shop.buni"]) await writeFile(join(dir, f), serializeDoc(emptyDoc()));
  const ok = async (ws: Workspace, tool: Parameters<Workspace["call"]>[1], args: object) => {
    const r = await ws.call("pi", tool, args);
    if (!r.ok) throw new Error(`${tool}: ${r.reply}`);
    return r.reply;
  };
  const shop = await Workspace.open(join(dir, "shop.buni"));
  const boxes = (await ok(shop, "create_page", { name: "Boxes", route: "/boxes" })).match(/page (\S+) /)![1]!;
  const core = await Workspace.open(join(dir, "core.buni"));
  await ok(core, "import_file", { path: "shop.buni" });
  const nav = (await ok(core, "create_component", { name: "Nav", root: true, html: '<nav><a layer-name="Boxes link">Our boxes</a></nav>' })).match(/Component (\S+) /)![1]!;
  const link = Object.values(core.view().nodes).find((n) => n.name === "Boxes link")!.id;
  await ok(core, "connect", { node: link, page: nav, to: boxes });
  const site = await Workspace.open(join(dir, "site.buni"));
  await ok(site, "import_file", { path: "core.buni" });
  const home = (await ok(site, "create_page", { name: "Home", route: "/" })).match(/root frame (\S+?)[;.]/)![1]!;
  const homePage = Object.keys(site.view().pages)[0]!;
  await ok(site, "place_component", { component: nav, parent: home });
  // Drawn onto Home from the core's every-use link; exported as a link by route.
  const drawn = Object.values(site.system().connections).filter((c) => c.page === homePage && c.node === link);
  expect(drawn.map((c) => c.to)).toEqual([boxes]);
  expect([...exportSite(site.system(), embeddedFont).values()].join("")).toContain('href="/boxes"');
  // Nothing was written into site for it; a link of Home's own replaces it there.
  expect(Object.keys(site.view().connections)).toEqual([]);
  await ok(site, "connect", { node: link, page: homePage, to: homePage });
  expect(Object.values(site.system().connections).filter((c) => c.page === homePage && c.node === link).map((c) => c.to)).toEqual([homePage]);
});

test("a flow walks the whole project: from a page here into the next design's pages, and on through their links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-flow-"));
  for (const f of ["site.buni", "shop.buni"]) await writeFile(join(dir, f), serializeDoc(emptyDoc()));
  const ok = async (ws: Workspace, tool: Parameters<Workspace["call"]>[1], args: object) => {
    const r = await ws.call("pi", tool, args);
    if (!r.ok) throw new Error(`${tool}: ${r.reply}`);
    return r.reply;
  };
  const page = async (ws: Workspace, name: string, route: string, html: string) => {
    const reply = await ok(ws, "create_page", { name, route });
    const [id, frame] = [reply.match(/page (\S+) /)![1]!, reply.match(/root frame (\S+?)[;.]/)![1]!];
    await ok(ws, "write_html", { parent: frame, html });
    return id;
  };
  const shop = await Workspace.open(join(dir, "shop.buni"));
  const pay = await page(shop, "Pay", "/pay", "<p>Paid</p>");
  const boxes = await page(shop, "Boxes", "/boxes", '<a layer-name="Pick">Pick</a>');
  await ok(shop, "connect", { node: Object.values(shop.view().nodes).find((n) => n.name === "Pick")!.id, to: pay });
  const site = await Workspace.open(join(dir, "site.buni"));
  await ok(site, "import_file", { path: "shop.buni" });
  const home = await page(site, "Home", "/", '<a layer-name="Go">Go</a>');
  await ok(site, "connect", { node: Object.values(site.view().nodes).find((n) => n.name === "Go")!.id, to: boxes });
  // On its own, the flow stops where it leaves the design; with the project alongside, it walks on.
  expect(walkFlow(site.system(), home).pages).toEqual([home]);
  expect(walkFlow(withProject(site.system(), [shop.system()]), home).pages).toEqual([home, boxes, pay]);
});
