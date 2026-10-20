import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { colorKey } from "./find.ts";
import { Workspace } from "./workspace.ts";

test("a colour is the same however it is written", () => {
  expect(colorKey("#ccc")).toBe(colorKey("rgb(204, 204, 204)"));
  expect(colorKey("#CCCCCCFF")).toBe(colorKey("rgba(204 204 204 / 1)"));
  expect(colorKey("white")).toBe(colorKey("#fff"));
  expect(colorKey("#ccd")).not.toBe(colorKey("#ccc"));
  expect(colorKey("16px")).toBeUndefined();
});

test("find_nodes finds a colour inside longer values, through tokens, by words; replace_with swaps it everywhere in one edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-find-"));
  const file = join(dir, "d.buni");
  await writeFile(file, serializeDoc(emptyDoc()));
  const ws = await Workspace.open(file);
  try {
    await ws.call("agent", "create_page", { name: "Home" });
    const page = Object.values(ws.view().pages)[0]!;
    await ws.call("agent", "tokens", { set: { "--muted": "#999999" } });
    await ws.call("agent", "write_html", { parent: page.frame, html: `<div layer-name="Card" style="border: 1px solid rgb(153, 153, 153); padding: 16px">
      <p layer-name="Time" style="color: #999">12:01 PM</p><p layer-name="Tokened" style="color: var(--muted)">Already a token</p><p layer-name="Other" style="color: #111">Send files</p></div>` });
    const id = (name: string) => Object.values(ws.view().nodes).find((n) => n.name === name)!.id;

    const grey = await ws.call("agent", "find_nodes", { style: [{ value: "#999" }] });
    expect(grey.reply).toStartWith("3 layers:");
    expect(grey.reply).toContain(`Card (${id("Card")}) on Home: border: rgb(153, 153, 153)`);
    expect(grey.reply).toContain("color: var(--muted)");
    expect((await ws.call("agent", "find_nodes", { style: [{ prop: "color", value: "--muted" }] })).reply).toStartWith("1 layer:");
    expect((await ws.call("agent", "find_nodes", { text: "send" })).reply).toContain(id("Other"));
    expect((await ws.call("agent", "find_nodes", { style: [{ prop: "border*" }], text: "nothing" })).reply).toBe("Nothing matches.");

    const swap = await ws.call("agent", "find_nodes", { style: [{ value: "#999" }], replace_with: "var(--muted)" });
    expect(swap.reply).toStartWith("Replaced on 2 layers:");
    expect(ws.view().nodes[id("Card")]!.style.border).toBe("1px solid var(--muted)");
    expect(ws.view().nodes[id("Time")]!.style.color).toBe("var(--muted)");
    expect(ws.view().nodes[id("Other")]!.style.color).toBe("#111");
    expect((await ws.call("agent", "find_nodes", { style: [{ value: "#999" }, { prop: "color" }], replace_with: "red" })).ok).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
