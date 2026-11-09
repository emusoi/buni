import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "./workspace.ts";
import { currentTurn, turnsOf } from "../editor/renderer/TurnCard.tsx";

test("an agent's turn is what it did since the person last acted, and undoing it keeps everyone else's edits", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-turn-")), "portal.buni");
  await copyFile(new URL("../../examples/portal.buni", import.meta.url).pathname, file);
  const ws = await Workspace.open(file);
  const [a, b] = Object.keys(ws.view().pages);
  await ws.call("you", "set_tags", { pages: [a!], add: ["mine"] });
  await Bun.sleep(5);
  await ws.call("claude", "set_tags", { pages: [a!], add: ["one"] });
  await ws.call("codex", "set_tags", { pages: [b!], add: ["theirs"] });
  await ws.call("claude", "set_tags", { pages: [b!], add: ["two"] });

  const turn = currentTurn(ws.edits(), {});
  expect(turn?.author).toBe("claude");
  expect(turn?.edits.map((e) => e.label)).toEqual(["Tags +one", "Tags +two"]);
  // Kept, the turn is over until claude edits again.
  expect(currentTurn(ws.edits(), { claude: turn!.edits.at(-1)!.at })).toBeUndefined();

  expect((await ws.undoTurn("claude", turn!.edits[0]!.at)).ok).toBe(true);
  expect(ws.view().pages[a!]?.tags).toEqual(["mine"]);
  expect(ws.view().pages[b!]?.tags).toEqual(["theirs"]);
  expect((await ws.undoTurn("claude", new Date().toISOString())).ok).toBe(false);
});

test("history reads as turns: each author's run of edits, newest first", () => {
  const e = (author: string, label: string) => ({ author, label, nodes: [], at: label });
  const turns = turnsOf([e("you", "a"), e("claude", "b"), e("claude", "c"), e("codex", "d"), e("claude", "e")]);
  expect(turns.map((t) => `${t.author}:${t.edits.map((x) => x.label).join("")}`)).toEqual(["claude:e", "codex:d", "claude:bc", "you:a"]);
});
