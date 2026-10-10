import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, type Doc } from "../format/doc.ts";
import { parseDoc, validateDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { sourceRefs } from "../format/sources.ts";
import { layerHtml, parseHtml } from "./html.ts";
import { Workspace } from "./workspace.ts";

const sources = [{ file: "src/components/Panel.tsx", symbol: "Panel", repository: "frontend", line: 12, endLine: 38, url: "https://example.com/settings", selector: "#panel" }];

test("source references validate file and URL context without prescribing a language", () => {
  expect(sourceRefs.safeParse(sources).success).toBe(true);
  for (const file of ["server/main.go", "agent.py", "schema.sql", "infra/main.tf"]) expect(sourceRefs.safeParse([{ file }]).success).toBe(true);
  for (const source of [{}, { url: "javascript:alert(1)" }, { file: " " }, { file: "a.ts", line: 0 }, { url: "https://example.com", line: 2 }, { file: "a.ts", line: 3, endLine: 2 }]) {
    expect(sourceRefs.safeParse([source]).success).toBe(false);
  }
});

test("source context survives HTML round trips, ordinary edits, disk reload and undo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-sources-"));
  const file = join(dir, "design.buni");
  try {
    await writeFile(file, serializeDoc(emptyDoc()));
    const ws = await Workspace.open(file);
    expect((await ws.call("you", "create_page", { name: "Settings", sources })).ok).toBe(true);
    const page = Object.values(ws.view().pages)[0]!;
    expect((await ws.call("you", "write_html", { parent: page.frame, html: "<section layer-name=Panel><h2>Settings</h2></section>", sources })).ok).toBe(true);
    const panel = Object.values(ws.view().nodes).find((n) => n.name === "Panel")!;
    expect(parseHtml(layerHtml(ws.view(), panel.id)).drafts[0]?.sources).toEqual(sources);
    expect((await ws.call("you", "replace_html", { node: panel.id, html: "<section layer-name=Panel><h2>Account settings</h2></section>" })).ok).toBe(true);
    expect(ws.view().nodes[panel.id]?.sources).toEqual(sources);
    expect((await ws.call("you", "read_tree", {})).reply).toContain("src/components/Panel.tsx:12–38");
    expect((await ws.call("you", "read_context", { focus: `page:${page.id}` })).reply).toContain("src/components/Panel.tsx");
    expect((await ws.call("you", "set_agent", { name: "Helper", instructions: "Help the person" })).ok).toBe(true);
    const agent = Object.values(ws.view().agents)[0]!;
    expect((await ws.call("you", "set_sources", { ids: [agent.id], sources: [{ file: "agents/helper.py", symbol: "Helper" }] })).ok).toBe(true);
    expect((await ws.call("you", "set_agent", { agent: agent.id, name: "Helper", instructions: "Ask before making changes" })).ok).toBe(true);
    expect(ws.view().agents[agent.id]?.sources?.[0]?.file).toBe("agents/helper.py");
    expect((await ws.call("you", "read_context", { focus: `page:${page.id}` })).reply).not.toContain("agents/helper.py");
    expect((await ws.call("you", "read_context", {})).reply).toContain("agents/helper.py");
    expect((await ws.call("you", "set_sources", { ids: [panel.id], sources: [] })).ok).toBe(true);
    expect(ws.view().nodes[panel.id]?.sources).toBeUndefined();
    expect((await ws.undo()).ok).toBe(true);
    expect(ws.view().nodes[panel.id]?.sources).toEqual(sources);
    const reloaded = await Workspace.open(file);
    expect(reloaded.view().pages[page.id]?.sources).toEqual(sources);
    expect(reloaded.view().nodes[panel.id]?.sources).toEqual(sources);
    expect(reloaded.view().agents[agent.id]?.sources).toEqual(ws.view().agents[agent.id]?.sources);
    const before = serializeDoc(ws.view());
    expect((await ws.call("you", "set_sources", { ids: [page.id, "missing"], sources: [] })).ok).toBe(false);
    expect(serializeDoc(ws.view())).toBe(before);
    const broken: Doc = JSON.parse(before);
    broken.pages[page.id]!.sources = [{ url: "file:///private/secret" }];
    expect(parseDoc(JSON.stringify(broken)).ok).toBe(false);
    expect(validateDoc(broken).some((e) => e.path.endsWith("sources"))).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("SVG source metadata stays on the design layer and not in its drawing markup", () => {
  const html = `<svg layer-name="Mark" style="width: 24px" data-buni-sources='${JSON.stringify(sources)}' viewBox="0 0 24 24"><path d="M0 0h24" /></svg>`;
  const parsed = parseHtml(html);
  expect(parsed.warnings).toEqual([]);
  const svg = parsed.drafts[0];
  expect(svg?.sources).toEqual(sources);
  expect(svg?.kind).toBe("svg");
  if (svg?.kind === "svg") { expect(svg.markup).not.toContain("data-buni-sources"); expect(svg.markup).not.toContain("layer-name"); expect(svg.markup).not.toContain("style="); }
});
