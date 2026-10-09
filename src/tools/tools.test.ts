import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { childrenOf, emptyDoc, pagesInOrder, pickVariant, reviewOf, setOf, variantProperties, walkFlow, type Node } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { contextText } from "./context.ts";
import { designNotes } from "./notes.ts";
import type { ToolName } from "./tools.ts";
import { createMcpServer } from "../mcp/server.ts";
import { exportSite, fontFaces, layerHtml, layerJsx, pageSvg, parseHtml, parseStyle, renderComponent, renderPage } from "./html.ts";
import { Workspace } from "./workspace.ts";
import { embeddedFont } from "./fontdata.ts";

const example = new URL("../../examples/portal.buni", import.meta.url).pathname;
const pi = "pi";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "buni-"));
  file = join(dir, "portal.buni");
  await copyFile(example, file);
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "usability-0917.md"), "3 of 5 testers stalled on tolerance.\n");
});

function idsIn(reply: string): string[] {
  return reply.match(/Created \d+ nodes: (.*)\./)?.[1]?.split(", ") ?? [];
}

describe("html in", () => {
  test("style parsing keeps semicolons inside url() and quotes", () => {
    expect(parseStyle("color: red; background: url(data:a;b) no-repeat; font-family: 'A;B'")).toEqual({
      color: "red",
      background: "url(data:a;b) no-repeat",
      fontFamily: "'A;B'",
    });
  });

  test("elements become frames, text leaves become text, unknown attributes are reported", () => {
    const { drafts, warnings } = parseHtml('<section layer-name="Features" style="display:flex"><h3>Upload a DXF</h3><p onclick="x()">Or sketch it.</p></section>');
    expect(drafts).toEqual([
      {
        kind: "frame", name: "Features", tag: "section", style: { display: "flex" },
        children: [
          { kind: "text", name: "Upload a DXF", tag: "h3", style: {}, text: "Upload a DXF" },
          { kind: "text", name: "Or sketch it.", tag: "p", style: {}, text: "Or sketch it." },
        ],
      },
    ]);
    expect(warnings).toEqual(['<p> attribute "onclick" was dropped']);
  });

  test("a canvas is dropped with a reason, and the saved design reopens", async () => {
    const html = '<section layer-name="Pad"><canvas width="10" height="10"></canvas><p>Draw here.</p></section>';
    const { drafts, warnings } = parseHtml(html);
    expect(drafts[0]).toMatchObject({ kind: "frame", name: "Pad", children: [{ kind: "text", text: "Draw here." }] });
    expect(warnings).toContain('<canvas> was dropped: designs hold static markup only');
    const ws = await Workspace.open(file);
    const result = await ws.call(pi, "write_html", { parent: "home-frame", html });
    expect(result.ok).toBe(true);
    expect(result.reply).toContain('<canvas> was dropped');
    const reopened = await Workspace.open(file);
    expect(Object.values(reopened.view().nodes).some((n) => n.kind === "text" && n.text === "Draw here.")).toBe(true);
    expect(Object.values(reopened.view().nodes).some((n) => n.tag === "canvas")).toBe(false);
  });

  test("each edit is logged with its author and the layers it made, so an editor can show agents' work", async () => {
    const ws = await Workspace.open(file);
    await ws.call("claude-code", "write_html", { parent: "home-frame", html: '<section layer-name="Proof"><p>Trusted</p></section>' });
    await ws.call("claude-code", "read_tree", {});
    const last = ws.edits().at(-1);
    expect(last?.author).toBe("claude-code");
    expect(last?.nodes.map((id) => ws.view().nodes[id]?.name)).toEqual(["Proof", "Trusted"]);
    expect(Number.isNaN(Date.parse(last?.at ?? ""))).toBe(false);
    // Reads change nothing, so they log nothing.
    expect(ws.edits().filter((e) => e.author === "claude-code")).toHaveLength(1);
  });

  test("fonts the design names are embedded, only those, and travel with the exported site", async () => {
    const ws = await Workspace.open(file);
    expect(fontFaces(ws.view(), embeddedFont)).not.toContain("Inter");
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<p style="font-family:Inter, sans-serif">Hi</p>' });
    const faces = fontFaces(ws.view(), embeddedFont);
    expect(faces).toContain('font-family:"Inter"');
    expect(faces).toContain("data:font/woff2;base64,");
    expect(exportSite(ws.view(), embeddedFont).get("styles/tokens.css")).toContain('font-family:"Inter"');
  });

  test("changing one thing about an endpoint keeps the rest", async () => {
    const ws = await Workspace.open(file);
    const e = ws.view().endpoints["create-quote"];
    if (!e) throw new Error("the example has POST /quotes");
    await ws.call("codex", "set_endpoint", { endpoint: e.id, service: e.service, method: e.method, path: e.path, summary: "Price a quote." });
    const after = ws.view().endpoints[e.id];
    expect([after?.summary, after?.request, after?.writes, after?.emits, after?.errors, after?.access]).toEqual(["Price a quote.", e.request, e.writes, e.emits, e.errors, e.access]);
    await ws.call("codex", "set_endpoint", { endpoint: e.id, service: e.service, method: e.method, path: e.path, summary: "Price a quote.", emits: [] });
    expect(ws.view().endpoints[e.id]?.emits).toEqual([]);
  });

  test("an approval covers the piece as it was: a later change shows, in the board, the brief and the notes", async () => {
    const ws = await Workspace.open(file);
    const e = ws.view().endpoints["create-quote"];
    if (!e) throw new Error("the example has POST /quotes");
    await ws.call("reviewer", "review", { id: e.id, state: "approved" });
    expect(reviewOf(ws.view(), e.id)?.changed).toBe(false);
    await ws.call("codex", "set_endpoint", { endpoint: e.id, service: e.service, method: e.method, path: e.path, summary: "Price a quote, now with discounts.", request: e.request, response: e.response });
    expect(reviewOf(ws.view(), e.id)?.changed).toBe(true);
    const brief = contextText(ws.view(), { endpoint: e.id });
    expect(brief.ok && brief.text).toContain("then changed (summary): not approved as it stands");
    expect(reviewOf(ws.view(), e.id)?.changes).toEqual([{ field: "summary", was: e.summary, now: "Price a quote, now with discounts." }]);
    expect(designNotes(ws.view()).some((n) => n.startsWith("1 piece was approved, then changed"))).toBe(true);
    // The whole-system brief tells an author what waits and what nobody has proposed yet.
    const all = contextText(ws.view());
    expect(all.ok && all.text).toContain("- POST /quotes: approved by reviewer, then changed (summary); review it again");
    expect(all.ok && all.text).toMatch(/- Not reviewed yet \(\d+\): .*Pricing/);
    // Proposed again, it still shows what changed since that approval, until someone approves it.
    await ws.call("codex", "review", { id: e.id, state: "proposed" });
    expect(reviewOf(ws.view(), e.id)).toMatchObject({ state: "proposed", approved: { by: "reviewer" }, changes: [{ field: "summary" }] });
    await ws.call("reviewer", "review", { id: e.id, state: "approved" });
    expect(reviewOf(ws.view(), e.id)).toMatchObject({ changed: false, changes: [] });
    expect(reviewOf(ws.view(), e.id)?.approved).toBeUndefined();
    // A named list (errors by code, fields and columns by name) changes item by item.
    await ws.call("codex", "set_endpoint", { endpoint: e.id, service: e.service, method: e.method, path: e.path, summary: "Price a quote, now with discounts.", errors: [...(e.errors ?? []), { code: "418", when: "Teapot" }] });
    expect(reviewOf(ws.view(), e.id)?.changes).toEqual([{ field: "errors 418", was: "nothing", now: '{"when":"Teapot"}' }]);
  });

  test("a layer reads as JSX: style objects, data as {data.field}, components by name", async () => {
    const ws = await Workspace.open(file);
    const jsx = layerJsx(ws.view(), "home-frame");
    expect(jsx).toContain('<h1 style={{ fontSize: "44px", color: "var(--color-ink)" }}>');
    expect(jsx).toContain("<PublicNav />");
    expect(jsx).not.toContain("class=");
    const bound = Object.values(ws.view().nodes).find((n) => n.bind);
    if (bound) expect(layerJsx(ws.view(), bound.id)).toContain(`{data.${bound.bind?.field}}`);
  });

  test("a layer's own HTML written back changes nothing; an edited word changes only that, keeping ids, links and data", async () => {
    const ws = await Workspace.open(file);
    const sorted = (_: string, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x);
    const snapshot = () => JSON.stringify(Object.values(ws.view().nodes).sort((x, y) => (x.id < y.id ? -1 : 1)), sorted);
    const hero = (await ws.call(pi, "layer_html", { node: "home-hero" })).reply;
    expect(hero).toContain("<");
    const before = snapshot();
    const same = await ws.call(pi, "replace_html", { node: "home-hero", html: hero });
    expect(same.ok).toBe(true);
    expect(snapshot()).toBe(before);
    // The CTA links to Pricing; rewording the headline keeps the link and every id.
    const headline = ws.view().nodes["home-headline"];
    if (headline?.kind !== "text") throw new Error("the example has a headline");
    await ws.call(pi, "replace_html", { node: "home-hero", html: hero.replace(`>${headline.text}<`, ">Steel that ships tomorrow<") });
    expect(ws.view().nodes["home-headline"]).toMatchObject({ kind: "text", text: "Steel that ships tomorrow" });
    expect(ws.view().connections["home-to-pricing"]?.node).toBe("home-cta");
    // A page's root takes its contents as HTML.
    const page = await ws.call(pi, "replace_html", { node: "pricing-frame", html: "<h1>Plans</h1>" });
    expect(page.ok).toBe(true);
    expect(childrenOf(ws.view(), "pricing-frame").map((n) => n.kind === "text" && n.text)).toEqual(["Plans"]);
  });

  test("every layer of the Parcel example survives being written back as its own HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buni-html-"));
    const parcel = join(dir, "parcel.buni");
    await copyFile(new URL("../../examples/parcel.buni", import.meta.url).pathname, parcel);
    const ws = await Workspace.open(parcel);
    const sorted = (_: string, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x);
    const nodes = () => JSON.stringify(Object.values(ws.view().nodes).sort((x, y) => (x.id < y.id ? -1 : 1)), sorted);
    const before = nodes();
    for (const page of Object.values(ws.view().pages)) {
      const r = await ws.call(pi, "replace_html", { node: page.frame, html: childrenOf(ws.view(), page.frame).map((c) => layerHtml(ws.view(), c.id)).join("\n") });
      expect(r.reply).not.toContain("Warning");
    }
    expect(nodes()).toBe(before);
  });

  test("a <style> block is dropped with what to use instead, so the file still opens and screenshots", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "write_html", { parent: "home-frame", html: "<section><style>@media(max-width:800px){.x{display:none}}</style><p>Kept</p></section>" });
    expect(r.reply).toContain("<style> was dropped");
    expect(Object.values(ws.view().nodes).some((n) => n.tag === "style" || (n.kind === "text" && n.text.includes("@media")))).toBe(false);
    expect(parseDoc(serializeDoc(ws.view())).ok).toBe(true);
  });

  test("a line of text with inline pieces renders as one line: no space inside a word, real spaces kept", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<p layer-name="Line">it\'s to <span style="background:yellow">shape the gro</span>und, <b>bold</b> <i>italic</i></p>' });
    const html = renderPage(ws.view(), "home").html;
    // Pieces touch ("gro" + "und" is one word); the space between bold and italic is its own piece.
    expect(html).toMatch(/shape the gro<\/span><span[^>]*>und, <\/span><b[^>]*>bold<\/b><span[^>]*> <\/span><i[^>]*>italic<\/i><\/p>/);
    // Written back for an edit, the same line comes back unchanged.
    const line = Object.values(ws.view().nodes).find((n) => n.name === "Line");
    const before = Object.keys(ws.view().nodes).length;
    const again = await ws.call(pi, "replace_html", { node: line?.id ?? "", html: layerHtml(ws.view(), line?.id ?? "") });
    expect(again.reply).not.toContain("Warning");
    expect(Object.keys(ws.view().nodes).length).toBe(before);
    expect(renderPage(ws.view(), "home").html).toMatch(/shape the gro<\/span><span[^>]*>und, /);
  });

  test("pages, boards and the exported site measure boxes with border-box", async () => {
    const ws = await Workspace.open(file);
    expect(renderPage(ws.view(), "home").css.startsWith("*, *::before, *::after {\n  box-sizing: border-box;")).toBe(true);
    expect(exportSite(ws.view(), embeddedFont).get("styles/tokens.css")).toContain("box-sizing: border-box");
  });

  test("an icon inside a paragraph or link stays inside it", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<p style="display:flex;gap:6px"><buni-icon name="check" size="14"></buni-icon>Paper</p><div><buni-icon name="check" size="14"></buni-icon></div>' });
    const html = renderPage(ws.view(), "home").html;
    expect(html).toMatch(/<p class="[^"]*">\s*<span class="[^"]*"><svg/);
    // Outside text it keeps its block holder.
    expect(html).toMatch(/<div class="[^"]*">\s*<div class="[^"]*"><svg/);
  });

  test("several elements written after a layer stay together, before its next sibling", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: "<p>A</p><p>Z</p>" });
    const a = childrenOf(ws.view(), "home-frame").find((n) => n.kind === "text" && n.text === "A");
    await ws.call(pi, "write_html", { parent: "home-frame", after: a?.id ?? "", html: "<p>B</p><p>C</p>" });
    expect(childrenOf(ws.view(), "home-frame").flatMap((n) => (n.kind === "text" ? [n.text] : [])).slice(-4).join("")).toBe("ABCZ");
  });

  test("duplicate copies layers right after themselves, with new ids; wrap puts siblings in a frame laid out like their parent", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<div layer-name="Card" style="display:flex;flex-direction:column"><p>Title</p><p>Body</p></div><p layer-name="After">After</p>' });
    const kids = () => childrenOf(ws.view(), "home-frame").map((n) => n.name);
    const card = childrenOf(ws.view(), "home-frame").find((n) => n.name === "Card");
    if (!card) throw new Error("card");
    const dup = await ws.call(pi, "duplicate_nodes", { nodes: [card.id] });
    const copy = dup.reply.match(/Copied: (\S+)\./)?.[1] ?? "";
    expect(kids().slice(-3)).toEqual(["Card", "Card", "After"]);
    expect(childrenOf(ws.view(), copy).map((n) => n.kind === "text" && n.text)).toEqual(["Title", "Body"]);
    expect(childrenOf(ws.view(), copy).every((n) => !childrenOf(ws.view(), card.id).some((o) => o.id === n.id))).toBe(true);
    const wrapped = await ws.call(pi, "wrap_nodes", { nodes: [copy, card.id], name: "Cards" });
    const frame = wrapped.reply.match(/Frame (\S+) holds/)?.[1] ?? "";
    expect(kids().slice(-2)).toEqual(["Cards", "After"]);
    expect(childrenOf(ws.view(), frame).map((n) => n.id)).toEqual([card.id, copy]);
    expect((await ws.call(pi, "wrap_nodes", { nodes: [frame, childrenOf(ws.view(), card.id)[0]?.id ?? ""] })).ok).toBe(false);
  });

  test("a text layer's own name follows its text; a name someone gave stays, and rename_layer sets one", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<p>Order #1042 is past its return window</p><p layer-name="Lede">Hello</p>' });
    // Found by their words: object key order isn't creation order once an id is all digits.
    const auto = Object.values(ws.view().nodes).find((n) => n.kind === "text" && n.text === "Order #1042 is past its return window");
    const named = Object.values(ws.view().nodes).find((n) => n.kind === "text" && n.text === "Hello");
    if (!auto || !named) throw new Error("two paragraphs");
    await ws.call(pi, "set_text", { node: auto.id, text: "Too many tries" });
    await ws.call(pi, "set_text", { node: named.id, text: "Bye" });
    expect([ws.view().nodes[auto.id]?.name, ws.view().nodes[named.id]?.name]).toEqual(["Too many tries", "Lede"]);
    await ws.call(pi, "rename_layer", { node: auto.id, name: "Rate limit notice" });
    expect(ws.view().nodes[auto.id]?.name).toBe("Rate limit notice");
  });

  test("asking for changes with a note leaves the builder a thread saying which", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call("reviewer", "review", { id: "create-quote", state: "changes", note: "Return the quote's expiry too" });
    expect(r.reply).toStartWith("POST /quotes is sent back for changes. Thread ");
    const brief = contextText(ws.view(), { endpoint: "create-quote" });
    expect(brief.ok && brief.text).toContain("reviewer: Return the quote's expiry too");
  });

  test("an approved screen is approved no longer once its layers, or a state's, change", async () => {
    const ws = await Workspace.open(file);
    const page = Object.values(ws.view().pages).find((p) => p.route === "/pricing");
    const under = (id: string): Node[] => childrenOf(ws.view(), id).flatMap((c) => [c, ...under(c.id)]);
    const text = page && under(page.frame).find((n) => n.kind === "text");
    if (!page || !text) throw new Error("the example has a /pricing page with text");
    await ws.call("reviewer", "review", { id: page.id, state: "approved" });
    expect(reviewOf(ws.view(), page.id)?.changed).toBe(false);
    await ws.call("codex", "set_text", { node: text.id, text: "Something else" });
    expect(reviewOf(ws.view(), page.id)?.changed).toBe(true);
    // Its states are part of the screen: changing one shows on the screen's approval.
    await ws.call(pi, "duplicate_page", { page: page.id, state: "Sold out" });
    await ws.call("reviewer", "review", { id: page.id, state: "approved" });
    const state = Object.values(ws.view().pages).find((p) => p.state === "Sold out");
    const copy = state && under(state.frame).find((n) => n.kind === "text");
    if (!copy) throw new Error("the state copies the text");
    await ws.call("codex", "set_text", { node: copy.id, text: "Sold out" });
    expect(reviewOf(ws.view(), page.id)?.changed).toBe(true);
  });

  test("a page's brief says how you arrive, where its links go, and outlines the screen", async () => {
    const ws = await Workspace.open(file);
    const pricing = Object.values(ws.view().pages).find((p) => p.route === "/pricing");
    const r = contextText(ws.view(), { page: pricing?.id ?? "" });
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toContain("## Arrives from\n- Home: click on");
    expect(r.text).toContain("## Screen\n```\nframe");
  });

  test("a route parameter in braces is a file in its parent folder, as \":id\" is", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "create_page", { name: "Quote", route: "/quotes/{id}" });
    const id = Object.values(ws.view().pages).find((p) => p.route === "/quotes/{id}")?.id;
    const files = [...exportSite(ws.view(), embeddedFont).keys()];
    expect(files).toContain(`quotes/${id}.html`);
    expect(files.some((f) => f.includes("{"))).toBe(false);
  });

  test("duplicating a page as a state copies its layers and links into a page of its own", async () => {
    const ws = await Workspace.open(file);
    const before = ws.view();
    const pricing = Object.values(before.pages).find((p) => p.route === "/pricing" && !p.state);
    if (!pricing) throw new Error("the example has a pricing page");
    const r = await ws.call(pi, "duplicate_page", { page: "home", state: "Loading" });
    expect(r.ok).toBe(true);
    const doc = ws.view();
    const copy = Object.values(doc.pages).find((p) => p.state === "Loading");
    expect([copy?.route, copy?.name]).toEqual(["/", "Home, loading"]);
    const layers = (id: string) => Object.values(doc.nodes).filter((n) => { let x = n; while (x.parent) x = doc.nodes[x.parent] ?? x; return x.id === id; }).length;
    expect(layers(copy?.frame ?? "")).toBe(layers(doc.pages["home"]?.frame ?? ""));
    expect(Object.values(doc.connections).filter((c) => c.page === copy?.id).map((c) => c.to)).toEqual(Object.values(before.connections).filter((c) => c.page === "home").map((c) => c.to));
    expect((await ws.call(pi, "duplicate_page", { page: "home" })).ok).toBe(false);
  });

  test("an endpoint's body can be a shape whole, named in briefs, never both a shape and fields", async () => {
    const ws = await Workspace.open(file);
    const e = ws.view().endpoints["create-quote"];
    if (!e) throw new Error("the example has POST /quotes");
    const r = await ws.call(pi, "set_endpoint", { endpoint: e.id, service: e.service, method: e.method, path: e.path, summary: e.summary, request: "QuoteRequest", response: "quote" });
    expect(r.ok).toBe(true);
    const saved = ws.view().endpoints[e.id];
    expect([saved?.requestShape, saved?.responseShape, saved?.request, saved?.response]).toEqual(["quote-request", "quote", [], []]);
    const brief = contextText(ws.view(), { endpoint: e.id });
    expect(brief.ok && brief.text).toContain("request QuoteRequest (the whole body)");
    expect(brief.ok && brief.text).toContain("shape **QuoteRequest**");
    expect((await ws.call(pi, "set_endpoint", { endpoint: e.id, service: e.service, method: e.method, path: e.path, summary: e.summary, request: "Nope" })).reply).toContain('no shape "Nope"');
    if (!saved) throw new Error("the endpoint was saved");
    const doc = structuredClone(ws.view());
    doc.endpoints[e.id] = { ...saved, request: [{ name: "x", type: "string" }] };
    expect(parseDoc(serializeDoc(doc)).ok).toBe(false);
  });

  test("a link with a condition is an alternative path, next to the usual one, and flows walk the usual path first", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "create_page", { name: "Pricing, busy", route: "/pricing", state: "Busy" });
    const doc0 = ws.view();
    const busy = Object.values(doc0.pages).find((p) => p.state === "Busy")?.id ?? "";
    const pricing = Object.values(doc0.pages).find((p) => p.route === "/pricing" && !p.state)?.id ?? "";
    const link = Object.values(doc0.connections).find((c) => c.page === "home" && c.to === pricing);
    if (!link) throw new Error("the example links home to pricing");
    const r = await ws.call(pi, "connect", { node: link.node, to: busy, condition: "Plans are still loading" });
    expect(r.reply).toContain("Created");
    const doc = ws.view();
    expect(Object.values(doc.connections).filter((c) => c.node === link.node).map((c) => c.to).sort()).toEqual([busy, pricing].sort());
    const walk = walkFlow(doc, "home");
    expect(walk.alternatives).toEqual([busy]);
    expect(walk.pages.indexOf(pricing)).toBeLessThan(walk.pages.indexOf(busy));
  });

  test('after: "" puts new and moved layers first', async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<p layer-name="Top">Top</p>', after: "" });
    const first = () => ws.view().nodes[Object.values(ws.view().nodes).filter((n) => n.parent === "home-frame").sort((x, y) => (x.index < y.index ? -1 : 1))[0]?.id ?? ""]?.name;
    expect(first()).toBe("Top");
    const last = Object.values(ws.view().nodes).filter((n) => n.parent === "home-frame").sort((x, y) => (x.index < y.index ? -1 : 1)).at(-1);
    await ws.call(pi, "move_nodes", { nodes: [last?.id ?? ""], parent: "home-frame", after: "" });
    expect(first()).toBe(last?.name);
  });

  test("a form field keeps its placeholder, as text that draws as a real field", async () => {
    const { drafts, warnings } = parseHtml('<input layer-name="Email" placeholder="you@example.com"><textarea placeholder="Tell us more"></textarea>');
    expect(warnings).toEqual([]);
    expect(drafts.map((d) => [d.kind, d.kind === "text" ? d.text : ""])).toEqual([["text", "you@example.com"], ["text", "Tell us more"]]);
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<input layer-name="Email" placeholder="you@example.com">' });
    const html = renderPage(ws.view(), "home").html;
    expect(html).toMatch(/<input class="[^"]+" placeholder="you@example.com">/);
  });

  test("a space between words survives; a space or line break between elements is not a layer", () => {
    const { drafts } = parseHtml('<p><b>Late.</b><span> Try again</span></p> <p>B</p>\n  <p>C</p>');
    expect(drafts.map((d) => d.kind)).toEqual(["frame", "text", "text"]);
    const first = drafts[0];
    expect(first?.kind === "frame" && first.children.map((c) => c.kind === "text" && c.text)).toEqual(["Late.", " Try again"]);
  });

  test("a page with other widths fills the window, and a layer's style at one is a media query that way", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call(pi, "update_styles", { nodes: ["home-headline"], style: { fontSize: "28px" }, width: 768 })).ok).toBe(false);
    await ws.call(pi, "duplicate_page", { page: "home", state: "Signed in" });
    await ws.call(pi, "set_widths", { page: "home", widths: [768, 390, 1920] });
    expect(ws.view().pages["home"]?.widths).toEqual([390, 768, 1920]);
    // Its state is the same screen, so it shares the widths.
    expect(Object.values(ws.view().pages).find((p) => p.state === "Signed in")?.widths).toEqual([390, 768, 1920]);
    await ws.call(pi, "update_styles", { nodes: ["home-headline"], style: { fontSize: "28px" }, width: 768 });
    await ws.call(pi, "update_styles", { nodes: ["home-headline"], style: { fontSize: "22px" }, width: 390 });
    await ws.call(pi, "update_styles", { nodes: ["home-headline"], style: { fontSize: "56px" }, width: 1920 });
    expect(ws.view().nodes["home-headline"]?.style.fontSize).toBe("44px");
    const css = renderPage(ws.view(), "home").css;
    // Desktop-first below the design width (widest first, so the narrowest wins), mobile-first above it.
    const at = (q: string) => css.indexOf(q);
    expect(at("@media (max-width: 768px)")).toBeGreaterThan(-1);
    expect(at("@media (max-width: 768px)")).toBeLessThan(at("@media (max-width: 390px)"));
    expect(css).toMatch(/@media \(min-width: 1920px\) \{\n\.b-home-headline \{\n  font-size: 56px;/);
    expect(css).toMatch(/\.b-home-frame \{[^}]*width: 100%;/);
    // An HTML rewrite keeps them; taking a width away takes its style.
    await ws.call(pi, "replace_html", { node: "home-hero", html: layerHtml(ws.view(), "home-hero") });
    expect(Object.keys(ws.view().nodes["home-headline"]?.at ?? {}).sort()).toEqual(["1920", "390", "768"]);
    await ws.call(pi, "set_widths", { page: "home", widths: [390] });
    expect(ws.view().nodes["home-headline"]?.at).toEqual({ "390": { fontSize: "22px" } });
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.nodes["home-headline"]?.at).toEqual({ "390": { fontSize: "22px" } });
  });

  test("a component use's layers take styles at one of the page's widths, for that use only", async () => {
    const ws = await Workspace.open(file);
    const nav = ws.view().nodes["home-nav"];
    if (nav?.kind !== "instance") throw new Error("the example's nav is a component use");
    const inner = childrenOf(ws.view(), ws.view().shared[nav.shared]?.root ?? "")[0];
    if (!inner) throw new Error("the nav has layers");
    expect((await ws.call(pi, "override", { instance: "home-nav", node: inner.id, style: { display: "none" }, width: 768 })).ok).toBe(false);
    await ws.call(pi, "set_widths", { page: "home", widths: [768] });
    await ws.call(pi, "override", { instance: "home-nav", node: inner.id, style: { display: "none" }, width: 768 });
    const css = renderPage(ws.view(), "home").css;
    expect(css).toMatch(new RegExp(`@media \\(max-width: 768px\\) \\{\\n\\.b-home-nav-${inner.id} \\{\\n  display: none;`));
    // Not a style for every width, and not for the component's other uses.
    const ov = ws.view().nodes["home-nav"];
    expect(ov?.kind === "instance" && ov.overrides[inner.id]).toEqual({ at: { "768": { display: "none" } } });
  });

  test("a style change on a screen's layer reaches the same layer in its states; their words stay their own", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "duplicate_page", { page: "home", state: "Signed in" });
    const state = Object.values(ws.view().pages).find((p) => p.state === "Signed in");
    const twin = Object.values(ws.view().nodes).find((n) => n.twin === "home-headline");
    if (!state || !twin) throw new Error("the state copies the headline and links it");
    await ws.call(pi, "set_text", { node: twin.id, text: "Welcome back" });
    const r = await ws.call(pi, "update_styles", { nodes: ["home-headline"], style: { color: "red" } });
    expect(r.reply).toContain("1 layer in its states");
    expect(ws.view().nodes[twin.id]).toMatchObject({ text: "Welcome back", style: { color: "red" } });
    // States made another way link with link_states.
    await ws.call(pi, "create_page", { name: "Home, empty", route: "/", state: "Empty" });
    const empty = Object.values(ws.view().pages).find((p) => p.state === "Empty");
    await ws.call(pi, "replace_html", { node: empty?.frame ?? "", html: layerHtml(ws.view(), "home-hero") });
    // Linking is bookkeeping: an approval of the screen still covers it.
    await ws.call("reviewer", "review", { id: "home", state: "approved" });
    const linked = await ws.call(pi, "link_states", { page: "home" });
    expect(linked.ok).toBe(true);
    expect(reviewOf(ws.view(), "home")?.changed).toBe(false);
    const copy = Object.values(ws.view().nodes).find((n) => n.twin === "home-headline" && n.id !== twin.id);
    expect(copy).toBeDefined();
  });

  test("a hidden layer leaves the page and its exports but stays in the file, through an HTML rewrite too", async () => {
    const ws = await Workspace.open(file);
    const headline = ws.view().nodes["home-headline"];
    if (headline?.kind !== "text") throw new Error("the example has a headline");
    await ws.call(pi, "set_layer", { nodes: ["home-headline"], hidden: true, locked: true });
    expect(renderPage(ws.view(), "home").html).not.toContain(headline.text);
    expect(ws.view().nodes["home-headline"]).toMatchObject({ hidden: true, locked: true });
    await ws.call(pi, "replace_html", { node: "home-hero", html: layerHtml(ws.view(), "home-hero") });
    expect(ws.view().nodes["home-headline"]).toMatchObject({ hidden: true, locked: true });
    await ws.call(pi, "set_layer", { nodes: ["home-headline"], hidden: false });
    expect(renderPage(ws.view(), "home").html).toContain(headline.text);
    expect(ws.view().nodes["home-headline"]?.hidden).toBeUndefined();
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.nodes["home-headline"]?.locked).toBe(true);
  });

  test("a file in the design's folder is attached once, and an image layer can use it", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "add_attachment", { path: "assets/logo.png", mime: "image/png" });
    const id = r.reply.match(/Attachment (\S+) is/)?.[1] ?? "";
    expect(ws.view().attachments[id]).toEqual({ id, path: "assets/logo.png", mime: "image/png" });
    expect((await ws.call(pi, "add_attachment", { path: "assets/logo.png", mime: "image/png" })).reply).toContain(id);
    expect((await ws.call(pi, "add_attachment", { path: "../elsewhere.png", mime: "image/png" })).ok).toBe(false);
    await ws.call(pi, "write_html", { parent: "home-frame", html: `<img src="asset:${id}" alt="Logo">` });
    expect(Object.values(ws.view().nodes).some((n) => n.kind === "image" && n.asset === id)).toBe(true);
  });

  test("a filled-in field keeps what was typed, drawn as its value, and survives a save", async () => {
    const { warnings } = parseHtml('<input value="£48.00"><textarea>Fits small</textarea>');
    expect(warnings).toEqual([]);
    const ws = await Workspace.open(file);
    await ws.call(pi, "write_html", { parent: "home-frame", html: '<input layer-name="Amount" value="£48.00" placeholder="0.00"><textarea layer-name="Note">Fits small</textarea>' });
    const html = renderPage(ws.view(), "home").html;
    expect(html).toMatch(/<input class="[^"]+" value="£48.00">/);
    expect(html).toMatch(/<textarea class="[^"]+">Fits small<\/textarea>/);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && Object.values(saved.doc.nodes).filter((n) => n.kind === "text" && n.filled).length).toBe(2);
  });

  test("an <svg> is kept whole, viewBox and all, without warnings", () => {
    const { drafts, warnings } = parseHtml('<svg viewBox="0 0 512 512" width="512"><circle r="4"/></svg>');
    expect(drafts[0]).toMatchObject({ kind: "svg", markup: expect.stringContaining('viewBox="0 0 512 512"') });
    expect(warnings).toEqual([]);
  });
});

describe("icons", () => {
  test("<buni-icon> becomes a Lucide SVG layer coloured by CSS", () => {
    const { drafts, warnings } = parseHtml('<buni-icon name="ArrowUp" size="20" stroke-width="1.5" style="color:red"></buni-icon>');
    expect(warnings).toEqual([]);
    const [icon] = drafts;
    expect(icon?.kind === "svg" && [icon.name, icon.style]).toEqual(["ArrowUp", { display: "inline-flex", flexShrink: "0", color: "red" }]);
    expect(icon?.kind === "svg" && icon.markup).toContain('width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"');
    expect(icon?.kind === "svg" && icon.markup).toContain("<path ");
  });

  test("an unknown icon is dropped with close names, and find_icons searches", async () => {
    const { drafts, warnings } = parseHtml('<buni-icon name="serch"></buni-icon><buni-icon name="search-x"></buni-icon>');
    expect(drafts.length).toBe(1);
    expect(warnings[0]).toContain('<buni-icon name="serch"> is not a Lucide icon');
    const ws = await Workspace.open(file);
    expect((await ws.call("pi", "find_icons", { query: "arrow up" })).reply.split(", ")[0]).toBe("arrow-up");
  });
});

describe("tools through a workspace", () => {
  test("an edit is written to the file at once, canonically, and marks where its author works", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "write_html", { parent: "home-frame", html: '<section layer-name="Features"><h3>Upload a DXF</h3></section>' });
    expect(r.ok).toBe(true);
    const [section, heading] = idsIn(r.reply);
    expect(ws.view().nodes[heading ?? ""]?.parent).toBe(section);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.nodes[heading ?? ""]?.name).toBe("Upload a DXF");
    expect(ws.recent()[pi]).toContain(section ?? "");
  });

  test("work left in a <file>.pending from older versions is kept on open", async () => {
    const cta = { ...JSON.parse(readFileSync(example, "utf8")).nodes["home-cta"], text: "See plans" };
    const sets = [{ id: "pi-1", author: "pi", changes: [{ id: "c1", label: "Edit", ops: [{ kind: "put", collection: "nodes", value: cta }] }] }];
    await writeFile(`${file}.pending`, JSON.stringify(sets));
    const ws = await Workspace.open(file);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.nodes["home-cta"]?.kind === "text" && saved.doc.nodes["home-cta"].text).toBe("See plans");
    expect(ws.view().nodes["home-cta"]).toMatchObject({ text: "See plans" });
    expect(await readFile(`${file}.pending`, "utf8").catch(() => "gone")).toBe("gone");
  });

  test("a refused edit explains which rule it broke and changes nothing", async () => {
    const ws = await Workspace.open(file);
    const before = await readFile(file, "utf8");
    const r = await ws.call(pi, "write_html", { parent: "home-frame", html: '<buni-instance shared="footer"></buni-instance>' });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain('shared section "footer" does not exist');
    expect(await readFile(file, "utf8")).toBe(before);
  });

  test("bad arguments are refused before anything runs", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "update_styles", { nodes: [], style: {} });
    expect(r.ok).toBe(false);
    expect(r.reply).toStartWith("Invalid arguments");
  });

  test("update_styles merges and removes; set_text only on text", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "update_styles", { nodes: ["home-headline"], style: { "font-size": "34px", color: "" } });
    expect(ws.view().nodes["home-headline"]?.style).toEqual({ fontSize: "34px" });
    const r = await ws.call(pi, "set_text", { node: "home-hero", text: "x" });
    expect(r.reply).toBe('"home-hero" is a frame, not text');
  });

  test("delete_nodes takes the subtree and anything attached to it", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "delete_nodes", { nodes: ["home-hero"] });
    expect(r.reply).toBe("Deleted 4 nodes.");
    const doc = ws.view();
    expect(doc.nodes["home-cta"]).toBeUndefined();
    expect(doc.connections["home-to-pricing"]).toBeUndefined();
    expect(doc.comments.c1).toBeUndefined();
  });

  test("move_nodes reorders and refuses to create cycles", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "move_nodes", { nodes: ["home-photo"], parent: "home-hero", after: "home-headline" });
    const order = Object.values(ws.view().nodes)
      .filter((n) => n.parent === "home-hero")
      .sort((a, b) => (a.index < b.index ? -1 : 1))
      .map((n) => n.id);
    expect(order).toEqual(["home-headline", "home-photo", "home-cta"]);
    const cycle = await ws.call(pi, "move_nodes", { nodes: ["home-hero"], parent: "home-hero" });
    expect(cycle.ok).toBe(false);
  });

  test("agents can mark a thread addressed but the state stays reviewable", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "comment", { node: "pricing-title", body: "Is this the final name?" });
    const thread = Object.values(ws.view().comments).find((c) => c.node === "pricing-title");
    await ws.call(pi, "comment", { thread: thread?.id, body: "Renamed.", addressed: true });
    expect(ws.view().comments[thread?.id ?? ""]?.state).toBe("addressed");
  });

  test("read_attachment reads listed text files and nothing outside the folder", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call(pi, "read_attachment", { id: "usability" })).reply).toBe("3 of 5 testers stalled on tolerance.\n");
    expect((await ws.call(pi, "read_attachment", { id: "brief" })).reply).toContain("only text attachments");

    const text = (await readFile(file, "utf8")).replace('"path": "assets/usability-0917.md"', '"path": "../../etc/passwd"');
    await writeFile(file, text);
    const escaped = await (await Workspace.open(file)).call(pi, "read_attachment", { id: "usability" });
    expect(escaped.reply).toBe('attachment path "../../etc/passwd" leaves the document\'s folder');
  });

  test("create_page then write into it", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "create_page", { name: "Checkout", route: "/app/checkout" });
    const frame = r.reply.match(/root frame (\w+)/)?.[1] ?? "";
    expect((await ws.call(pi, "write_html", { parent: frame, html: "<h1>Checkout</h1>" })).ok).toBe(true);
    const dup = await ws.call(pi, "create_page", { name: "Again", route: "/app/checkout" });
    expect(dup.reply).toContain('route "/app/checkout" is also used');
    const logo = await ws.call(pi, "create_page", { name: "Logo", route: "/logo", width: 512, height: 512 });
    const logoFrame = logo.reply.match(/root frame (\w+)/)?.[1] ?? "";
    expect(ws.view().nodes[logoFrame]?.style).toEqual({ width: "512px", height: "512px", overflow: "hidden" });
  });

  test("a graphic that is one svg saves as a standalone svg file; anything else doesn't", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "create_page", { name: "Mark", width: 64, height: 64 });
    const [, page, frame] = r.reply.match(/Created page (\S+) with root frame (\S+)\./) ?? [];
    await ws.call(pi, "write_html", { parent: frame ?? "", html: '<svg layer-name="Mark" viewBox="0 0 64 64" style="display:block"><circle cx="32" cy="32" r="20"/></svg>' });
    const svg = pageSvg(ws.view(), page ?? "", embeddedFont);
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">');
    expect(svg).not.toContain("layer-name");
    expect(pageSvg(ws.view(), "home", embeddedFont)).toBeUndefined();
  });

  test("a page without a route is a graphic: labelled by size, kept out of the site, and saved as such", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "create_page", { name: "Icon", width: 1024, height: 1024 });
    const id = r.reply.match(/Created page (\S+) /)?.[1] ?? "";
    expect((await ws.call(pi, "read_tree", {})).reply).toContain(`page ${id} "Icon" 1024×1024`);
    expect([...exportSite(ws.view(), embeddedFont).keys()].some((f) => f.includes(id))).toBe(false);
    const again = (await Workspace.open(file)).view().pages[id];
    expect(again?.name).toBe("Icon");
    expect(again && "route" in again).toBe(false);
  });
});

describe("set_svg", () => {
  test("replaces an svg's markup in place; refuses other nodes, several elements and unsafe markup", async () => {
    const ws = await Workspace.open(file);
    const id = idsIn((await ws.call(pi, "write_html", { parent: "home-frame", html: '<svg layer-name="Logo" viewBox="0 0 10 10"><circle r="4"/></svg>' })).reply)[0] ?? "";
    expect((await ws.call(pi, "set_svg", { node: id, markup: '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>' })).ok).toBe(true);
    const n = ws.view().nodes[id];
    expect(n?.kind === "svg" && n.markup).toContain("<rect");
    expect(n?.name).toBe("Logo");
    expect((await ws.call(pi, "set_svg", { node: "home-frame", markup: "<svg></svg>" })).reply).toContain("not an svg");
    expect((await ws.call(pi, "set_svg", { node: id, markup: "<svg></svg><svg></svg>" })).reply).toContain("exactly one <svg>");
    expect((await ws.call(pi, "set_svg", { node: id, markup: '<svg onload="alert(1)"></svg>' })).ok).toBe(false);
    const after = ws.view().nodes[id];
    expect(after?.kind === "svg" && after.markup).not.toContain("onload");
  });
});

describe("delete_page", () => {
  test("takes its layers, links and journey steps; the flow starting there goes too; the file stays valid", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call(pi, "delete_page", { page: "pricing" })).ok).toBe(true);
    let doc = ws.view();
    expect(doc.pages.pricing).toBeUndefined();
    expect(doc.nodes["pricing-frame"]).toBeUndefined();
    expect(doc.connections["home-to-pricing"]).toBeUndefined();
    expect(doc.journeys["get-a-quote-journey"]?.steps.map((s) => s.page)).toEqual(["home"]);

    expect((await ws.call(pi, "delete_page", { page: "home" })).reply).toContain("1 flow starting there");
    doc = (await Workspace.open(file)).view();
    expect(Object.keys(doc.pages)).toEqual([]);
    expect(doc.flows).toEqual({});
    expect(doc.journeys).toEqual({});
    expect((await ws.call(pi, "delete_page", { page: "nope" })).reply).toContain('page "nope" does not exist');
  });
});

describe("flows", () => {
  test("connect a new page into a flow, write its journey, read it back", async () => {
    const ws = await Workspace.open(file);
    const created = await ws.call(pi, "create_page", { name: "Quote", route: "/quote" });
    const quote = created.reply.match(/page (\S+) with root frame/)?.[1] ?? "";
    const cta = idsIn((await ws.call(pi, "write_html", { parent: "pricing-frame", html: "<a>Start a quote</a>" })).reply)[0] ?? "";

    expect((await ws.call(pi, "connect", { node: cta, to: quote, transition: "fade" })).ok).toBe(true);
    const link = Object.values(ws.view().connections).find((c) => c.node === cta);
    expect(link).toMatchObject({ page: "pricing", to: quote, trigger: "click", transition: "fade", durationMs: 200 });

    // Same node and trigger again updates the link instead of adding a second.
    await ws.call(pi, "connect", { node: cta, to: "home" });
    expect(Object.values(ws.view().connections).filter((c) => c.node === cta).map((c) => c.to)).toEqual(["home"]);
    await ws.call(pi, "connect", { node: cta, to: quote });

    const flow = await ws.call(pi, "set_flow", { flow: "get-a-quote", name: "Get a quote" });
    expect(flow.reply).toContain("Home → Pricing → Quote");

    const journey = await ws.call(pi, "set_journey", {
      flow: "get-a-quote",
      lanes: ["Does", "Thinks"],
      steps: [{ page: "home", confidence: 4, cells: { Does: "Lands" } }, { page: quote, confidence: 2, cells: { Thinks: "Is this binding?" } }],
    });
    expect(journey.ok).toBe(true);
    const read = (await ws.call(pi, "read_flows", {})).reply;
    expect(read).toContain(`Pricing (pricing) Start a quote --click--> Quote (${quote}) [none 200ms]`);
    expect(read).toContain(`Quote (${quote}) confidence 2 — Thinks: Is this binding?`);
    expect(read).not.toContain("pages in no flow");
  });

  test("links and journeys are checked against the document", async () => {
    const ws = await Workspace.open(file);
    const before = await readFile(file, "utf8");
    expect((await ws.call(pi, "connect", { node: "ghost", to: "pricing" })).ok).toBe(false);
    expect((await ws.call(pi, "connect", { node: "home-cta", to: "nowhere" })).reply).toContain('page "nowhere" does not exist');
    expect((await ws.call(pi, "set_flow", { name: "Orphan" })).reply).toContain("needs a name and a start page");
    const bad = await ws.call(pi, "set_journey", { flow: "get-a-quote", lanes: ["Does"], steps: [{ page: "home", cells: { Feels: "x" } }] });
    expect(bad.ok).toBe(false);
    expect(bad.reply).toContain('lane "Feels" is not in this journey');
    expect((await ws.call(pi, "set_journey", { flow: "get-a-quote", lanes: ["Does"], steps: [{ page: "home", confidence: 7 }] })).ok).toBe(false);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  test("removing a flow takes its journey; disconnect removes links", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "set_flow", { flow: "get-a-quote", remove: true });
    await ws.call(pi, "disconnect", { connections: ["home-to-pricing"] });
    const doc = ws.view();
    expect(Object.keys(doc.flows)).toEqual([]);
    expect(Object.keys(doc.journeys)).toEqual([]);
    expect(Object.keys(doc.connections)).toEqual([]);
    expect((await ws.call(pi, "read_flows", {})).reply).toBe("pages in no flow: Home (home), Pricing (pricing)");
  });
});

describe("canvas positions", () => {
  test("moves by a person or an agent are written at once", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call("you", "move_page", { page: "pricing", x: 0, y: 1400 })).ok).toBe(true);
    await ws.call(pi, "move_page", { page: "home", x: 40, y: 40 });
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && [saved.doc.pages.pricing, saved.doc.pages.home]).toMatchObject([{ x: 0, y: 1400 }, { x: 40, y: 40 }]);
    expect((await ws.call("you", "move_page", { page: "nowhere", x: 0, y: 0 })).ok).toBe(false);
  });

  test("reorder_page moves a page first or after another", async () => {
    const ws = await Workspace.open(file);
    const quote = (await ws.call(pi, "create_page", { name: "Quote", route: "/quote" })).reply.match(/page (\S+) with/)?.[1] ?? "";
    const order = () => pagesInOrder(ws.view()).map((p) => p.name);
    expect(order()).toEqual(["Home", "Pricing", "Quote"]);
    await ws.call(pi, "reorder_page", { page: quote });
    expect(order()).toEqual(["Quote", "Home", "Pricing"]);
    await ws.call(pi, "reorder_page", { page: quote, after: "home" });
    expect(order()).toEqual(["Home", "Quote", "Pricing"]);
    await ws.call(pi, "reorder_page", { page: "home", after: "pricing" });
    expect(order()).toEqual(["Quote", "Pricing", "Home"]);
    expect((await ws.call(pi, "reorder_page", { page: "home", after: "home" })).ok).toBe(false);
  });

  test("a position needs both coordinates and finite numbers", () => {
    const base = JSON.parse(readFileSync(example, "utf8"));
    base.pages.home.x = 10;
    expect(parseDoc(JSON.stringify(base)).ok).toBe(false);
    base.pages.home.y = 20;
    expect(parseDoc(JSON.stringify(base)).ok).toBe(true);
    base.pages.home.y = "20";
    expect(parseDoc(JSON.stringify(base)).ok).toBe(false);
  });
});

describe("component variants", () => {
  test("a use swaps to another component, keeping overrides on same-named layers; detached, it is plain layers with its overrides", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    const [, big, inst] = made.reply.match(/Component (\S+) "Heroes \/ Big"; instance (\S+) is/) ?? [];
    await ws.call(pi, "override", { instance: inst, node: "home-headline", text: "Override me" });
    // A second variant: the same layers, so the override finds its layer by name.
    await ws.call(pi, "write_html", { parent: "pricing-frame", html: '<section layer-name="Small hero"><h1 layer-name="Headline">Small</h1></section>' });
    const small = Object.values(ws.view().nodes).find((n) => n.name === "Small hero");
    const made2 = await ws.call(pi, "make_component", { node: small?.id ?? "", name: "Heroes / Small" });
    const smallId = made2.reply.match(/Component (\S+) "Heroes \/ Small"/)?.[1] ?? "";
    const swapped = await ws.call(pi, "swap_component", { instance: inst, component: smallId });
    expect(swapped.ok).toBe(true);
    const use = ws.view().nodes[inst ?? ""];
    const smallHead = Object.values(ws.view().nodes).find((n) => n.name === "Headline" && n.id !== "home-headline");
    expect(use?.kind === "instance" && use.shared).toBe(smallId);
    expect(use?.kind === "instance" && use.overrides[smallHead?.id ?? ""]?.text).toBe("Override me");
    // Small has no CTA, so the link Home set on Big's CTA went with the swap, and the reply said so.
    expect(swapped.reply).toContain("1 link has no layer of that name there");
  });

  test("a new variant is a copy in the same group, its own from then on, and a use can switch to it", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    const [, big, inst] = made.reply.match(/Component (\S+) "Heroes \/ Big"; instance (\S+) is/) ?? [];
    const added = await ws.call(pi, "add_variant", { component: big, name: "Quiet" });
    const quiet = added.reply.match(/Component (\S+) "Heroes \/ Quiet"/)?.[1] ?? "";
    expect(ws.view().shared[quiet]?.name).toBe("Heroes / Quiet");
    expect((await ws.call(pi, "add_variant", { component: big, name: "Quiet" })).ok).toBe(false);
    // Its own layers: changing the copy leaves the original alone.
    const copyHead = Object.values(ws.view().nodes).find((n) => n.name === "Headline" && n.id !== "home-headline");
    await ws.call(pi, "update_styles", { nodes: [copyHead?.id ?? ""], style: { fontSize: "24px" } });
    expect(ws.view().nodes["home-headline"]?.style.fontSize).toBe("44px");
    expect((await ws.call(pi, "swap_component", { instance: inst, component: quiet })).ok).toBe(true);
  });

  test("variants carry properties; a use picks by them, and the library doesn't call them duplicates", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    const big = made.reply.match(/Component (\S+) "Heroes \/ Big"/)?.[1] ?? "";
    await ws.call(pi, "set_variant", { component: big, props: { Size: "Large", Tone: "Bold" } });
    const quiet = (await ws.call(pi, "add_variant", { component: big, name: "Quiet", props: { Tone: "Quiet" } })).reply.match(/Component (\S+) "/)?.[1] ?? "";
    expect(ws.view().shared[quiet]?.variant).toEqual({ Size: "Large", Tone: "Quiet" });
    expect((await ws.call(pi, "set_variant", { component: quiet, props: { Tone: "Bold" } })).ok).toBe(false);
    const set = setOf(ws.view(), big);
    expect(variantProperties(set)).toEqual([["Size", ["Large"]], ["Tone", ["Bold", "Quiet"]]]);
    expect(pickVariant(set, { Size: "Large", Tone: "Quiet" })?.id).toBe(quiet);
    const report = (await ws.call(pi, "library_report", {})).reply;
    expect(report).not.toContain("Near-duplicates");
    expect(report).toContain("Set Heroes: Size (Large); Tone (Bold, Quiet)");
  });

  test("set_motion keeps one motion per trigger, matches effects to triggers, and survives a save", async () => {
    const ws = await Workspace.open(file);
    const set = (motion: unknown[]) => ws.call(pi, "set_motion", { node: "home-hero", motion });
    expect((await set([{ trigger: "scroll", effect: "rise", durationMs: 600, staggerMs: 80 }, { trigger: "hover", effect: "lift", durationMs: 150 }])).ok).toBe(true);
    expect(ws.view().nodes["home-hero"]?.motion).toEqual([
      { trigger: "scroll", effect: "rise", durationMs: 600, easing: "out", staggerMs: 80 },
      { trigger: "hover", effect: "lift", durationMs: 150, easing: "out" },
    ]);
    expect((await set([{ trigger: "hover", effect: "rise", durationMs: 150 }])).reply).toContain("hover takes a response");
    expect((await set([{ trigger: "load", effect: "fade", durationMs: 300 }, { trigger: "load", effect: "rise", durationMs: 300 }])).reply).toContain("one motion per trigger");
    expect((await ws.call(pi, "read_tree", {})).reply).toContain("moves: scroll rise 600ms, hover lift 150ms");
    const saved = parseDoc(serializeDoc(ws.view()));
    expect(saved.ok && saved.doc.nodes["home-hero"]?.motion).toHaveLength(2);
    await set([]);
    expect(ws.view().nodes["home-hero"]?.motion).toBeUndefined();
  });

  test("a component placed on another page brings its links there, except a link to that page itself", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    const section = made.reply.match(/Component (\S+) "Heroes \/ Big"/)?.[1] ?? "";
    await ws.call(pi, "create_page", { name: "Settings", route: "/settings" });
    const settings = Object.values(ws.view().pages).find((p) => p.route === "/settings");
    expect((await ws.call(pi, "place_component", { component: section, parent: settings?.frame ?? "" })).reply).toContain("with its 1 link");
    expect(Object.values(ws.view().connections).filter((c) => c.node === "home-cta" && c.page === settings?.id).map((c) => c.to)).toEqual(["pricing"]);
    await ws.call(pi, "place_component", { component: section, parent: "pricing-frame" });
    expect(Object.values(ws.view().connections).some((c) => c.node === "home-cta" && c.page === "pricing" && c.to === "pricing")).toBe(false);
  });

  test("get_node takes a component's id, and node tools say what a page or component id is", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    const big = made.reply.match(/Component (\S+) "Heroes \/ Big"/)?.[1] ?? "";
    const quiet = (await ws.call(pi, "add_variant", { component: big, name: "Quiet", props: { Tone: "Quiet" } })).reply.match(/Component (\S+) "/)?.[1] ?? "";
    const got = await ws.call(pi, "get_node", { id: quiet });
    expect(got.ok).toBe(true);
    expect(JSON.parse(got.reply).component).toEqual({ id: quiet, name: "Heroes / Quiet", variant: { Tone: "Quiet" } });
    const styled = await ws.call(pi, "set_text", { node: "home", text: "x" });
    expect(styled.reply).toContain('"home" is the page');
  });

  test("making a screen's layer a component makes its copies in the states uses too, keeping their words and links", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "duplicate_page", { page: "home", state: "Signed in" });
    const state = Object.values(ws.view().pages).find((p) => p.state === "Signed in");
    const copyHead = Object.values(ws.view().nodes).find((n) => n.twin === "home-headline");
    await ws.call(pi, "set_text", { node: copyHead?.id ?? "", text: "Welcome back" });
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    expect(made.reply).toContain("Its 1 copy in the screen's states became uses too.");
    const use = Object.values(ws.view().nodes).find((n) => n.kind === "instance" && n.name === "Heroes / Big" && n.id !== made.reply.match(/instance (\S+) is/)?.[1]);
    expect(use?.kind === "instance" && use.overrides["home-headline"]?.text).toBe("Welcome back");
    expect(ws.view().nodes[copyHead?.id ?? ""]).toBeUndefined();
    // The state's own link from the CTA now sits on the component's CTA, for the state's page.
    expect(Object.values(ws.view().connections).some((c) => c.page === state?.id && c.node === "home-cta")).toBe(true);
  });

  test("a detached use is plain layers with its overrides, keeping the links its page set", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Heroes / Big" });
    const inst = made.reply.match(/instance (\S+) is/)?.[1] ?? "";
    await ws.call(pi, "override", { instance: inst, node: "home-headline", text: "Override me" });
    const detached = await ws.call(pi, "detach_instance", { instance: inst });
    const root = detached.reply.match(/Detached: (\S+) is/)?.[1] ?? "";
    expect(ws.view().nodes[inst]).toBeUndefined();
    expect(childrenOf(ws.view(), root).some((n) => n.kind === "text" && n.text === "Override me")).toBe(true);
    const cta = childrenOf(ws.view(), root).find((n) => n.kind === "text" && n.tag === "a");
    expect(Object.values(ws.view().connections).some((c) => c.node === cta?.id && c.page === "home" && c.to === "pricing")).toBe(true);
  });
});

describe("components", () => {
  test("make a component from a layer, use it elsewhere, override one use", async () => {
    const ws = await Workspace.open(file);
    const made = await ws.call(pi, "make_component", { node: "home-hero", name: "Hero" });
    expect(made.ok).toBe(true);
    const [, section, inst] = made.reply.match(/Component (\S+) "Hero"; instance (\S+) is/) ?? [];
    let doc = ws.view();
    expect(doc.shared[section ?? ""]?.root).toBe("home-hero");
    expect(doc.nodes["home-hero"]?.parent).toBeUndefined();
    expect(doc.nodes[inst ?? ""]).toMatchObject({ kind: "instance", parent: "home-frame" });
    // The hero held the Home -> Pricing link; it keeps working because Home uses the component.
    expect(doc.connections["home-to-pricing"]?.node).toBe("home-cta");
    expect(renderPage(doc, "home", { hrefFor: () => "pricing/" }).html).toContain('href="pricing/"');
    expect(renderPage(doc, "home").html).toContain("Steel that ships");

    // A component layer can only link on a page that uses it.
    expect((await ws.call(pi, "connect", { node: "home-cta", page: "pricing", to: "home" })).ok).toBe(false);
    const placed = await ws.call(pi, "place_component", { component: section, parent: "pricing-frame" });
    const copy = placed.reply.match(/instance (\S+) of/)?.[1] ?? "";
    // Its link to Pricing came along from Home, except on Pricing itself, where it would point at its own page.
    expect(Object.values(ws.view().connections).some((c) => c.node === "home-cta" && c.page === "pricing" && c.to === "pricing")).toBe(false);
    expect((await ws.call(pi, "connect", { node: "home-cta", page: "pricing", to: "home" })).ok).toBe(true);
    expect(Object.values(ws.view().connections).filter((c) => c.node === "home-cta").map((c) => c.page).sort()).toEqual(["home", "pricing"]);
    // Navigation links stay out of flows: a sidebar would otherwise make every flow the whole app.
    await ws.call(pi, "create_page", { name: "Account", route: "/account" });
    const account = Object.values(ws.view().pages).find((p) => p.route === "/account")?.id ?? "";
    await ws.call(pi, "connect", { node: "home-cta", page: "pricing", to: account, nav: true });
    expect(walkFlow(ws.view(), "home").pages).not.toContain(account);
    await ws.call(pi, "connect", { node: "home-cta", page: "pricing", to: account, nav: false });
    expect(walkFlow(ws.view(), "home").pages).toContain(account);
    // Without a page, a component layer (a nav item) links on every page that uses the component, except the one it goes to.
    await ws.call(pi, "connect", { node: "home-cta", to: "pricing", condition: "signed in" });
    expect(Object.values(ws.view().connections).filter((c) => c.node === "home-cta" && c.condition === "signed in").map((c) => c.page)).toEqual(["home"]);
    await ws.call(pi, "override", { instance: copy, node: "home-headline", text: "Plans that ship" });
    doc = ws.view();
    expect(renderPage(doc, "pricing").html).toContain("Plans that ship");
    expect(renderPage(doc, "home").html).not.toContain("Plans that ship");

    // Editing the component changes every use that has not overridden it.
    await ws.call(pi, "set_text", { node: "home-cta", text: "See plans" });
    doc = ws.view();
    expect(renderPage(doc, "home").html).toContain("See plans");
    expect(renderPage(doc, "pricing").html).toContain("See plans");
    await ws.call(pi, "override", { instance: copy, node: "home-headline", reset: true });
    expect(renderPage(ws.view(), "pricing").html).toContain("Steel that ships");

    // Removing Pricing's use takes its link on the component with it; Home's stays.
    expect((await ws.call(pi, "delete_nodes", { nodes: [copy] })).ok).toBe(true);
    expect([...new Set(Object.values(ws.view().connections).filter((c) => c.node === "home-cta").map((c) => c.page))]).toEqual(["home"]);
  });

  test("create a component from HTML and refuse what cannot work", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "create_component", { name: "Card", html: "<div><h3>Title</h3><p>Body</p></div>" });
    const section = r.reply.match(/Component (\S+) "Card"/)?.[1] ?? "";
    expect(renderComponent(ws.view(), section).html).toContain("Title");
    expect((await ws.call(pi, "make_component", { node: "home-frame" })).reply).toContain("root frame");
    expect((await ws.call(pi, "make_component", { node: "pricing-frame" })).ok).toBe(false);
    expect((await ws.call(pi, "override", { instance: "home-nav", node: "home-headline", text: "x" })).reply).toContain("not inside");
    await ws.call(pi, "move_component", { component: section, x: 0, y: -1200 });
    expect(ws.view().shared[section]).toMatchObject({ x: 0, y: -1200 });
  });
});

describe("design doc", () => {
  test("sections and decisions from agents and people all land in the file", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call(pi, "read_doc", {})).reply).toContain("no design doc yet");
    const made = await ws.call(pi, "write_section", { heading: "Who it is for", body: "Metal shops that need parts fast." });
    const section = made.reply.match(/Section (\S+) saved/)?.[1] ?? "";
    await ws.call(pi, "decide", { text: "8px spacing grid" });
    const text = (await ws.call(pi, "read_doc", {})).reply;
    expect(text).toContain("## Who it is for");
    expect(text).toContain("- 8px spacing grid (pi,");

    await ws.call("you", "write_section", { section, heading: "Who it is for", body: "Metal shops and fabricators." });
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && Object.values(saved.doc.sections).map((x) => x.body)).toEqual(["Metal shops and fabricators."]);
    expect(saved.ok && Object.values(saved.doc.decisions).map((d) => [d.text, d.by])).toEqual([["8px spacing grid", "pi"]]);
  });

  test("files from before the design doc still open", () => {
    const old = JSON.parse(readFileSync(example, "utf8"));
    delete old.sections;
    delete old.decisions;
    const r = parseDoc(JSON.stringify(old));
    expect(r.ok && r.doc.sections).toEqual({});
  });
});

describe("undo", () => {
  const text = (ws: Workspace, id: string) => {
    const n = ws.view().nodes[id];
    return n?.kind === "text" ? n.text : undefined;
  };

  test("undo and redo a person's edits to the file, newest first", async () => {
    const ws = await Workspace.open(file);
    const before = await readFile(file, "utf8");
    await ws.call("you", "set_text", { node: "home-cta", text: "See plans" });
    await ws.call("you", "move_page", { page: "pricing", x: 0, y: 1400 });
    expect((await ws.undo()).reply).toBe("Undid Move Pricing.");
    expect(ws.view().pages.pricing?.x).toBeUndefined();
    expect((await ws.undo()).ok).toBe(true);
    expect(parseDoc(await readFile(file, "utf8"))).toEqual(parseDoc(before));
    expect((await ws.undo()).ok).toBe(false);
    await ws.redo();
    expect(text(ws, "home-cta")).toBe("See plans");
    // A new edit clears what could be redone.
    await ws.call("you", "set_text", { node: "home-cta", text: "Plans" });
    expect((await ws.redo()).ok).toBe(false);
  });

  test("undo takes back an agent's edit too", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "set_text", { node: "home-headline", text: "Agent headline" });
    expect((await ws.undo()).reply).toContain("Undid");
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.nodes["home-headline"]?.kind === "text" && saved.doc.nodes["home-headline"].text).not.toBe("Agent headline");
  });

  test("invert restores tokens and removes what was new", async () => {
    const ws = await Workspace.open(file);
    const before = await readFile(file, "utf8");
    await ws.call("you", "tokens", { set: { "--color-ink": "#000", "--new": "1px" } });
    await ws.call("you", "create_page", { name: "Quote", route: "/quote" });
    await ws.undo();
    await ws.undo();
    expect(parseDoc(await readFile(file, "utf8"))).toEqual(parseDoc(before));
  });
});

describe("html out", () => {
  test("export writes one file per route with relative links and shared styles once", async () => {
    const ws = await Workspace.open(file);
    const files = exportSite(ws.view(), embeddedFont);
    expect([...files.keys()].sort()).toEqual(["index.html", "pricing/index.html", "styles/pages.css", "styles/shared.css", "styles/tokens.css"]);
    const home = files.get("index.html") ?? "";
    expect(home).toContain('<a class="b-home-cta" href="pricing/index.html">See pricing</a>');
    expect(home).toContain('<img class="b-home-photo" src="assets/steel-rack.jpg" alt="Steel brackets on a rack">');
    const pricing = files.get("pricing/index.html") ?? "";
    expect(pricing).toContain('href="../styles/tokens.css"');
    expect(pricing).toContain(">Start a quote</p>");
    expect(files.get("styles/shared.css")?.match(/\.b-nav-cta \{/g)?.length).toBe(1);
    expect(files.get("styles/tokens.css")).toContain("--color-accent: #3346D3;");
  });
});

describe("mcp", () => {
  test("a client lists the design tools and its edits are made under its name", async () => {
    const ws = await Workspace.open(file);
    const server = createMcpServer(ws);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("write_html");
    expect(tools.map((t) => t.name)).not.toContain("settle");

    const res = await client.callTool({ name: "write_html", arguments: { parent: "pricing-frame", html: "<p>Yearly saves 20%</p>" } });
    expect(res.isError).toBe(false);
    expect(ws.recent()["claude-code"]?.length).toBe(1);
    expect(await readFile(file, "utf8")).toContain("Yearly saves 20%");
    await client.close();
  });
});

describe("library health", () => {
  test("near-duplicates are reported and merge keeps each use's overrides and links", async () => {
    const ws = await Workspace.open(file);
    const make = async (name: string, pad: string) =>
      (await ws.call("pi", "create_component", { name, html: `<a style="padding:${pad};background:#111;color:#fff">Get started</a>` })).reply.match(/Component (\S+)/)?.[1] ?? "";
    const primary = await make("Buttons / Primary", "12px 20px");
    const copy = await make("CTA button", "12px 22px");
    const place = async (component: string) => (await ws.call("pi", "place_component", { component, parent: "home-frame" })).reply.match(/instance (\S+) of/)?.[1] ?? "";
    await place(primary);
    await place(primary);
    const use = await place(copy);
    const layers = (id: string) => {
      const out: string[] = [];
      const walk = (n: string) => {
        out.push(n);
        for (const c of Object.values(ws.view().nodes)) if (c.parent === n) walk(c.id);
      };
      walk(ws.view().shared[id]?.root ?? "");
      return out;
    };
    const copyText = layers(copy)[1] ?? "";
    await ws.call("you", "override", { instance: use, node: copyText, text: "Start free" });
    await ws.call("you", "connect", { node: copyText, page: "home", to: "pricing" });

    const report = (await ws.call("pi", "library_report", {})).reply;
    expect(report).toContain(`Buttons / Primary (${primary}, 2 uses) <- CTA button (${copy}, 1 use): padding 12px 22px`);
    expect((await ws.call("pi", "delete_component", { component: copy })).reply).toContain("is used 1 time");

    const r = await ws.call("pi", "merge_components", { into: primary, from: [copy] });
    expect(r.reply).toBe("Merged 1 component into Buttons / Primary; 1 use moved.");
    const doc = ws.view();
    const primaryText = layers(primary)[1] ?? "";
    const moved = doc.nodes[use];
    expect(moved?.kind === "instance" && [moved.shared, moved.overrides[primaryText]?.text]).toEqual([primary, "Start free"]);
    expect(Object.values(doc.connections).some((c) => c.node === primaryText && c.to === "pricing")).toBe(true);
    expect(doc.shared[copy]).toBeUndefined();
    expect(doc.nodes[copyText]).toBeUndefined();
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok).toBe(true);
  });
});

describe("context", () => {
  test("an endpoint's brief carries its tables, the tables they point at, its events and who hears them", async () => {
    const ws = await Workspace.open(file);
    const reply = (await ws.call(pi, "read_context", { focus: "endpoint:create-quote" })).reply;
    expect(reply).toStartWith("# Context: POST /quotes");
    expect(reply).toContain("plan_id: uuid, not null → plans.id");
    expect(reply).toContain("table **plans**");
    expect(reply).toContain("heard by Mailer");
  });

  test("a page's brief is what it calls and shows, not the whole system", async () => {
    const ws = await Workspace.open(file);
    const reply = (await ws.call(pi, "read_context", { focus: "page:pricing" })).reply;
    expect(reply).toContain("GET /plans");
    expect(reply).toContain('"Title" (pricing-title) shows headline');
    expect(reply).not.toContain("**POST /quotes**");
  });

  test("a focus naming nothing is refused", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "read_context", { focus: "part:ghost" });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain('part "ghost" does not exist');
  });
});

describe("system tools", () => {
  test("design a system from nothing: parts, links, a table, an endpoint, a page that calls it", async () => {
    const ws = await Workspace.open(file);
    const call = async (name: Parameters<Workspace["call"]>[1], args: unknown) => {
      const r = await ws.call(pi, name, args);
      if (!r.ok) throw new Error(r.reply);
      return r.reply;
    };
    await call("set_part", { kind: "service", name: "Billing", purpose: "Charges for quotes." });
    await call("set_part", { kind: "store", name: "Ledger", purpose: "Every charge.", tech: "Postgres 16" });
    await call("link_parts", { from: "billing", to: "ledger", kind: "writes" });
    await call("set_table", { store: "ledger", name: "charges", columns: [{ name: "id", type: "uuid", primary: true }, { name: "quote_id", type: "uuid" }] });
    await call("set_endpoint", { id: "charge", service: "billing", method: "POST", path: "/charges", summary: "Charges a quote.", request: [{ name: "quoteId", type: "string" }], response: [{ name: "receipt", type: "string" }], writes: ["charges"] });
    await call("link_parts", { from: "web", to: "billing", kind: "calls" });
    await call("connect", { node: "home-cta", to: "pricing", endpoint: "charge" });
    await call("bind", { node: "home-headline", endpoint: "charge", field: "receipt" });

    const saved = parseDoc(await readFile(file, "utf8"));
    if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
    expect(saved.doc.endpoints["charge"]?.writes).toEqual(["charges"]);
    expect(saved.doc.connections["home-to-pricing"]?.endpoint).toBe("charge");
    expect(saved.doc.nodes["home-headline"]?.bind).toEqual({ endpoint: "charge", field: "receipt" });
    expect((await call("read_context", { focus: "part:billing" }))).toContain("table **charges**");
  });

  test("an endpoint writing a store its service has no link to is refused with the reason", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "set_endpoint", { service: "mailer", method: "POST", path: "/send", summary: "Sends.", writes: ["quotes"] });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain('service "mailer" has no writes link to store "pg"');
  });

  test("relinking a trigger keeps the endpoint it calls", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "connect", { node: "home-cta", to: "pricing", transition: "fade" });
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.connections["home-to-pricing"]?.endpoint).toBe("list-plans");
  });

  test("deleting a part takes its links; deleting a table still in use is refused", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "set_part", { kind: "service", name: "Audit", purpose: "Keeps a log." });
    await ws.call(pi, "link_parts", { from: "audit", to: "jobs", kind: "subscribes" });
    expect((await ws.call(pi, "delete_system", { what: "part", id: "audit" })).ok).toBe(true);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && Object.values(saved.doc.links).some((l) => l.from === "audit")).toBe(false);
    expect((await ws.call(pi, "delete_system", { what: "part", id: "mailer" })).ok).toBe(false);
    const r = await ws.call(pi, "delete_system", { what: "table", id: "plans" });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain('table "plans" does not exist');
  });
});


describe("shapes and caching", () => {
  test("renaming a shape carries through to every field typed with it", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "set_shape", { shape: "plan", name: "PricePlan", fields: [{ name: "id", type: "string" }] });
    expect(r.ok).toBe(true);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.endpoints["list-plans"]?.response[1]?.type).toBe("PricePlan[]");
  });

  test("a shape still in use can't be deleted; relinking keeps what it carries", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call(pi, "delete_system", { what: "shape", id: "plan" })).ok).toBe(false);
    await ws.call(pi, "link_parts", { from: "web", to: "quote-api", kind: "calls", note: "HTTPS" });
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.links["web-api"]).toMatchObject({ id: "web-api", from: "web", to: "quote-api", kind: "calls", note: "HTTPS", carries: ["quote-request", "plan"] });
  });

  test("a brief says what is cached, for how long, and what makes it stale", async () => {
    const ws = await Workspace.open(file);
    const e = parseDoc(await readFile(file, "utf8"));
    if (!e.ok) throw new Error("bad example");
    const q = e.doc.endpoints["create-quote"]!;
    const r = await ws.call(pi, "set_endpoint", { endpoint: q.id, service: q.service, method: q.method, path: q.path, summary: q.summary, request: q.request, response: q.response, reads: q.reads, writes: q.writes, emits: q.emits, invalidates: ["list-plans"] });
    expect(r.ok).toBe(true);
    const brief = (await ws.call(pi, "read_context", { focus: "part:edge-cache" })).reply;
    expect(brief).toContain('cached in Plan cache for 300s under key "plans"');
    expect(brief).toContain("made stale by: POST /quotes");
    expect(brief).toContain("carrying Plan");
  });
});

describe("editing a link in place", () => {
  test("a link keeps its id when it gets a new kind, and a blank note clears", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "link_parts", { from: "mailer", to: "jobs", kind: "subscribes", note: "retries 3 times" });
    const r = await ws.call(pi, "link_parts", { link: "mailer-jobs", from: "mailer", to: "jobs", kind: "publishes", note: "" });
    expect(r.ok).toBe(true);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && saved.doc.links["mailer-jobs"]).toEqual({ id: "mailer-jobs", from: "mailer", to: "jobs", kind: "publishes" });
  });
});

describe("GraphQL and traces through the tools", () => {
  test("a service switches to GraphQL and gets an operation, an enum and a trace; the brief shows them", async () => {
    const ws = await Workspace.open(file);
    const call = async (name: Parameters<Workspace["call"]>[1], args: unknown) => {
      const r = await ws.call(pi, name, args);
      if (!r.ok) throw new Error(r.reply);
      return r.reply;
    };
    await call("set_part", { kind: "service", name: "Admin API", purpose: "Back office.", api: "graphql" });
    await call("link_parts", { from: "admin-api", to: "pg", kind: "reads" });
    await call("set_shape", { name: "Tier", values: ["basic", "pro"] });
    expect(await call("set_operation", { service: "admin-api", kind: "query", name: "quotes", summary: "All quotes.", returns: "Quote[]", reads: ["quotes"], errors: [{ code: "FORBIDDEN", when: "not an admin" }] })).toBe("Operation quotes-query saved.");
    await call("link_parts", { from: "web", to: "admin-api", kind: "calls" });
    expect(await call("set_trace", { name: "Review quotes", steps: [{ from: "web", to: "admin-api", action: "list", via: "quotes-query", ms: 80 }, { from: "admin-api", to: "pg", action: "select quotes", ms: 20 }] })).toBe("Trace review-quotes saved.");
    const brief = await call("read_context", { focus: "part:admin-api" });
    expect(brief).toContain("service, GraphQL **Admin API**");
    expect(brief).toContain("**query quotes** (quotes-query)");
    expect(brief).toContain("fails FORBIDDEN when not an admin");
    expect(brief).toContain("trace **Review quotes** (review-quotes), ~100 ms before the response");
    expect(await call("read_context", { focus: "trace:review-quotes" })).toContain("1. Customer portal → Admin API: list (via query quotes, 80 ms)");
  });

  test("an operation on a REST service is refused with the fix", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.call(pi, "set_operation", { service: "quote-api", kind: "query", name: "x", summary: "x", returns: "string" });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain("set its API style to GraphQL");
  });
});


describe("deployment topology through the tools", () => {
  test("place a part, read where it runs in its brief, and see what isn't placed yet", async () => {
    const ws = await Workspace.open(file);
    const call = async (name: Parameters<Workspace["call"]>[1], args: unknown) => {
      const r = await ws.call(pi, name, args);
      if (!r.ok) throw new Error(r.reply);
      return r.reply;
    };
    expect(await call("place", { part: "mailer", environment: "staging", runtime: "cronjob", regions: ["us-east-1"], cluster: "staging-use1", namespace: "quotes", schedule: "*/5 * * * *", secrets: ["RESEND_API_KEY"] })).toBe("Placement mailer-staging saved.");
    const brief = await call("read_context", { focus: "part:mailer" });
    expect(brief).toContain("- staging: CronJob on staging-use1/quotes in us-east-1, runs \"*/5 * * * *\", secrets RESEND_API_KEY");
    expect(brief).toContain("- prod: Deployment on prod-use1/quotes in us-east-1, 1–3 pods");
    const whole = await call("read_context", {});
    expect(whole).toContain("staging: Customer portal, Main database, Jobs, Plan cache, Catalog aren't placed yet.");
  });

  test("placing again replaces the placement; a bad runtime is refused with the reason", async () => {
    const ws = await Workspace.open(file);
    await ws.call(pi, "place", { part: "pg", environment: "prod", runtime: "statefulset", regions: ["us-east-1"], cluster: "prod-use1", namespace: "data", replicas: 2 });
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && Object.values(saved.doc.placements).filter((p) => p.part === "pg" && p.environment === "prod").map((p) => [p.id, p.runtime])).toEqual([["pg-prod", "statefulset"]]);
    const r = await ws.call(pi, "place", { part: "web", environment: "prod", runtime: "cronjob", regions: ["us-east-1"] });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain("a client runs as static, function, container, deployment, not cronjob");
  });

  test("deleting an environment takes its clusters and placements", async () => {
    const ws = await Workspace.open(file);
    expect((await ws.call(pi, "delete_system", { what: "environment", id: "staging" })).ok).toBe(true);
    const saved = parseDoc(await readFile(file, "utf8"));
    expect(saved.ok && [Object.keys(saved.doc.clusters), Object.keys(saved.doc.placements).filter((p) => p.endsWith("staging"))]).toEqual([["prod-use1"], []]);
  });
});

describe("systems across files", () => {
  test("split moves a part into a new file; both open, and the brief still sees everything", async () => {
    const ws = await Workspace.open(file);
    const r = await ws.split("catalog", "catalog.buni");
    expect(r.reply).toStartWith("Moved Catalog to catalog.buni with 3 calls, 0 tables, 0 events and 1 shapes");
    const main = parseDoc(await readFile(file, "utf8"), { refs: false });
    expect(main.ok && [main.doc.imports, main.doc.parts["catalog"]]).toEqual([["catalog.buni"], undefined]);
    const again = await Workspace.open(file);
    expect(again.owners()["update-plan"]).toBe("catalog.buni");
    expect((await again.call(pi, "read_context", { focus: "part:catalog" })).reply).toContain("**mutation updatePlan**");
    const other = await Workspace.open(join(dir, "catalog.buni"));
    expect(other.owners()["quote-api"]).toBe("portal.buni");
  });

  test("an edit here can point at a part in the imported file, and can't reuse its ids", async () => {
    const ws = await Workspace.open(file);
    await ws.split("catalog", "catalog.buni");
    const ok = await ws.call(pi, "link_parts", { from: "quote-api", to: "catalog", kind: "calls" });
    expect(ok.ok).toBe(true);
    const clash = await ws.call(pi, "set_shape", { name: "Plan", fields: [{ name: "id", type: "id" }] });
    expect(clash.ok).toBe(false);
  });

  test("import_file brings another file in and can be undone; dropping an import still in use is refused", async () => {
    const ws = await Workspace.open(file);
    const shared = emptyDoc();
    shared.shapes["money"] = { id: "money", name: "Money", fields: [{ name: "amount", type: "integer" }], index: "a0" };
    await writeFile(join(dir, "shared.buni"), serializeDoc(shared));
    expect((await ws.call(pi, "import_file", { path: "shared.buni" })).ok).toBe(true);
    expect(ws.owners()["money"]).toBe("shared.buni");
    expect((await ws.call(pi, "set_shape", { shape: "quote", name: "Quote", fields: [{ name: "id", type: "id" }, { name: "total", type: "Money" }] })).ok).toBe(true);
    expect((await ws.call(pi, "import_file", { path: "shared.buni", remove: true })).ok).toBe(false);
    await ws.undo();
    await ws.undo();
    expect(ws.imports()).toEqual([]);
  });
});

describe("the design process", () => {
  test("requirements, questions, roles, access and review round-trip through the tools", async () => {
    const ws = await Workspace.open(file);
    const call = async (tool: ToolName, args: object) => { const r = await ws.call(pi, tool, args); if (!r.ok) throw new Error(`${tool}: ${r.reply}`); return r; };
    await call("set_phase", { name: "v2", goal: "Accounts" });
    await call("set_requirement", { title: "Buyers see past quotes", priority: "should", phase: "v2" });
    let doc = parseDoc(await readFile(file, "utf8"));
    const req = doc.ok ? Object.values(doc.doc.requirements).find((q) => q.title === "Buyers see past quotes") : undefined;
    expect(req?.phase).toBe("v2");
    await call("serve", { requirement: req!.id, id: "create-quote" });
    await call("set_role", { name: "Reviewer", description: "Checks quotes." });
    await call("set_access", { call: "create-quote", who: "roles", roles: ["reviewer"], rule: "own quotes only" });
    // Editing the endpoint without access keeps it.
    await call("set_endpoint", { endpoint: "create-quote", service: "quote-api", method: "POST", path: "/quotes", summary: "Records a quote.", reads: ["plans"], writes: ["quotes"], emits: ["quote-created"] });
    await call("decide_question", { question: "q-queue", option: "SQS", why: "No ops" });
    await call("review", { id: "catalog", state: "approved" });
    await call("discuss", { thread: "t-cache", body: "Yes, prices are read on every page.", state: "resolved", decision: "Cache prices for a minute" });
    await call("link_parts", { from: "web", to: "quote-api", kind: "calls", failure: { timeoutMs: 1000 } });
    doc = parseDoc(await readFile(file, "utf8"));
    if (!doc.ok) throw new Error("bad doc");
    const d = doc.doc;
    expect(d.requirements[req!.id]!.servedBy).toEqual(["create-quote"]);
    expect(d.endpoints["create-quote"]!.access).toEqual({ who: "roles", roles: ["reviewer"], rule: "own quotes only" });
    expect(d.questions["q-queue"]).toMatchObject({ status: "decided", chosen: "SQS" });
    expect(Object.values(d.decisions).some((x) => x.text.includes("SQS: No ops"))).toBe(true);
    expect(d.reviews["catalog"]!.state).toBe("approved");
    expect(d.threads["t-cache"]).toMatchObject({ state: "resolved" });
    expect(d.threads["t-cache"]!.posts.at(-1)!.body).toBe("Decided: Cache prices for a minute");
    // The outcome joins the doc's decisions, named after the piece it was about.
    expect(Object.values(d.decisions).some((x) => x.text.endsWith(": Cache prices for a minute") && !x.text.startsWith(":"))).toBe(true);
    expect((await ws.call(pi, "discuss", { target: "catalog", body: "Hm", decision: "No" })).ok).toBe(false);
    expect(Object.values(d.links).find((l) => l.from === "web" && l.to === "quote-api")!.failure).toEqual({ timeoutMs: 1000 });
    // A link carries shapes by name, as every other tool names them.
    const shape = Object.values(d.shapes)[0];
    if (!shape) throw new Error("the example has shapes");
    await call("link_parts", { from: "web", to: "quote-api", kind: "calls", carries: [shape.name] });
    expect(Object.values(ws.view().links).find((l) => l.from === "web" && l.to === "quote-api")?.carries).toEqual([shape.id]);
    // A question can only be decided with one of its options; deleting a role takes it off every call.
    expect((await ws.call(pi, "decide_question", { question: "q-queue", option: "Kafka" })).ok).toBe(false);
    await call("delete_system", { what: "role", id: "reviewer" });
    const after = parseDoc(await readFile(file, "utf8"));
    expect(after.ok && after.doc.endpoints["create-quote"]!.access).toEqual({ who: "signed-in", rule: "own quotes only" });
  });

  test("the brief says why a piece exists and what is open about it", async () => {
    const doc = parseDoc(readFileSync(file, "utf8"));
    if (!doc.ok) throw new Error("bad doc");
    const t = contextText(doc.doc, { part: "jobs" });
    expect(t.ok && t.text).toContain("## Open questions\n- OPEN: SQS or a Redis queue for Jobs?");
    const e = contextText(doc.doc, { endpoint: "create-quote" });
    expect(e.ok && e.text).toContain("who may call: public; rate limited");
    expect(e.ok && e.text).toContain("## Why\n- [must] A buyer sends a quote in under a minute");
  });
});

describe("terminal screens", () => {
  test("an agent makes a terminal client, its screens on a grid, and key links between them", async () => {
    const ws = await Workspace.open(file);
    const ok = async (name: ToolName, args: unknown) => {
      const r = await ws.call(pi, name, args);
      if (!r.ok) throw new Error(`${name}: ${r.reply}`);
      return r.reply;
    };
    await ok("set_part", { kind: "client", name: "steel CLI", purpose: "Quotes from the terminal", terminal: { targets: [{ language: "rust", framework: "ratatui" }] } });
    const cli = Object.values(ws.view().parts).find((p) => p.name === "steel CLI");
    expect(cli?.terminal).toEqual({ targets: [{ language: "rust", framework: "ratatui" }] });

    await ok("create_page", { name: "Quotes", client: cli?.id, terminal: { surface: "app", cols: 120, rows: 36, colors: "256" } });
    await ok("create_page", { name: "Help", client: cli?.id, terminal: { surface: "tmux-popup", cols: 60, rows: 20 } });
    const [quotes, help] = ["Quotes", "Help"].map((n) => Object.values(ws.view().pages).find((p) => p.name === n));
    if (!quotes || !help) throw new Error("screens missing");
    // The frame is the grid: 120 columns of 9px, 36 rows of 18px.
    expect(ws.view().nodes[quotes.frame]?.style).toMatchObject({ width: "1080px", height: "648px", fontSize: "15px" });
    expect(help.terminal).toEqual({ surface: "tmux-popup", cols: 60, rows: 20, colors: "16" });

    await ok("connect", { node: quotes.frame, to: help.id, trigger: "key", key: "?" });
    await ok("connect", { node: quotes.frame, to: help.id, trigger: "key", key: "f1" });
    const keys = Object.values(ws.view().connections).filter((c) => c.page === quotes.id).map((c) => c.key);
    expect(keys.sort()).toEqual(["?", "f1"]);
    expect((await ws.call(pi, "connect", { node: quotes.frame, to: help.id, trigger: "key" })).reply).toContain('needs key');

    // Printed inline, it grows: no height.
    await ok("set_screen", { page: quotes.id, surface: "inline", cols: 80 });
    expect(ws.view().nodes[quotes.frame]?.style.height).toBeUndefined();
    expect(ws.view().nodes[quotes.frame]?.style.width).toBe("720px");
    // A web page can't become a screen of a web client.
    expect((await ws.call(pi, "set_screen", { page: "home", surface: "app", cols: 120, rows: 36 })).reply).toContain("runs in a terminal");
  });
});

test("on a terminal screen runs of spaces in text are layout and stay; elsewhere they collapse", () => {
  const html = "<div>\n  <p>›  work        12</p>\n  <p>   home</p>\n</div>";
  const text = (keepSpaces: boolean) => {
    const [d] = parseHtml(html, { keepSpaces }).drafts;
    return d?.kind === "frame" ? d.children.map((c) => (c.kind === "text" ? c.text : "")) : [];
  };
  expect(text(true)).toEqual(["›  work        12", "   home"]);
  expect(text(false)).toEqual(["› work 12", " home"]);
});
