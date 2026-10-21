import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "buni/tools/workspace.ts";
import { lineRange, refusalLines } from "./TextPane.tsx";

test("a refusal's lines name the line of the text they are about", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-arch-text-")), "parcel.buni");
  await copyFile(new URL(import.meta.resolve("buni/examples/parcel.buni")).pathname, file);
  const ws = await Workspace.open(file);
  const text = (await ws.call("you", "read_architecture_text", {})).reply;
  const broken = text.replace(/kind: service/, "kind: app");
  const r = await ws.call("you", "write_architecture_text", { text: broken });
  expect(r.ok).toBe(false);
  const named = refusalLines(r.reply).find((l) => l.line !== undefined)!;
  expect(named.text).toContain(".kind: expected one of");
  const [a, b] = lineRange(broken, named.line!);
  expect(broken.slice(a, b).trim()).toBe("kind: app");
});

test("line ranges and lines without a number", () => {
  expect(lineRange("a\nbc\nd", 2)).toEqual([2, 4]);
  expect(lineRange("a\nbc\nd", 3)).toEqual([5, 6]);
  expect(lineRange("a", 9)).toEqual([1, 1]);
  expect(refusalLines("That text breaks the format:\nline 4 · parts.web.kind: nope\n")).toEqual([
    { text: "That text breaks the format:" }, { line: 4, text: "line 4 · parts.web.kind: nope" },
  ]);
});
