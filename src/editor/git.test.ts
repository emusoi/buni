import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCommit, gitStatus } from "./git.ts";

const run = (dir: string, ...args: string[]) => Bun.spawnSync(["git", "-C", dir, ...args]);

test("status lists the folder's own changes; a commit takes only those, never other staged work", async () => {
  const repo = await mkdtemp(join(tmpdir(), "buni-git-"));
  run(repo, "init", "-q", "-b", "main");
  run(repo, "config", "user.email", "t@t"); run(repo, "config", "user.name", "t");
  const designs = join(repo, "designs");
  await mkdir(designs);
  await writeFile(join(designs, "shop.buni"), "{}");
  await writeFile(join(designs, "shop.buni.live"), "{}");
  await writeFile(join(repo, "app.ts"), "x");
  run(repo, "add", "app.ts");

  expect(await gitStatus(designs)).toEqual({ branch: "main", changes: [{ path: "shop.buni", state: "new" }] });
  expect(await gitCommit(designs, "  ", false)).toEqual({ ok: false, reply: "Say what changed in a few words." });
  expect(await gitCommit(designs, "Shop design", false)).toEqual({ ok: true, reply: "Committed." });
  expect((await gitStatus(designs))?.changes).toEqual([]);
  // app.ts was staged before, outside the folder: still staged, not committed.
  expect(new TextDecoder().decode(run(repo, "diff", "--cached", "--name-only").stdout).trim()).toBe("app.ts");
  // A modified file's status line starts with a space; its path still comes through whole.
  await writeFile(join(designs, "shop.buni"), "{ }");
  expect((await gitStatus(designs))?.changes).toEqual([{ path: "shop.buni", state: "modified" }]);
  expect(await gitCommit(designs, "Edit", false)).toEqual({ ok: true, reply: "Committed." });
  expect(await gitCommit(designs, "Again", false)).toEqual({ ok: false, reply: "Nothing has changed since the last commit." });
  expect(await gitStatus(await mkdtemp(join(tmpdir(), "buni-nogit-")))).toBeUndefined();
});
