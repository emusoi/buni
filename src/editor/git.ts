// The design folder's place in git: which branch, what changed, and committing those changes from the editor.
// Only ever the folder's own files: a commit here never takes along anything else staged in the repository.
import type { GitStatus } from "buni/tools/protocol.ts";

async function git(dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const p = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  // Only the end: a status line starts with a space that says where the change is.
  return { ok: code === 0, out: code === 0 ? out.trimEnd() : (err || out).trim() };
}

/** The folder, less the marker a running editor leaves beside a design (its address on this machine). */
const HERE = ["--", ".", ":(exclude,glob)**/*.live"];

const STATE: Record<string, GitStatus["changes"][number]["state"]> = { M: "modified", A: "added", D: "deleted", R: "renamed", "?": "new" };

/** The branch and the changed files under `dir`, by their path inside it; undefined outside a repository. */
export async function gitStatus(dir: string): Promise<GitStatus | undefined> {
  if (!(await git(dir, ["rev-parse", "--is-inside-work-tree"])).ok) return undefined;
  // Works before the first commit too; empty when detached.
  const branch = await git(dir, ["branch", "--show-current"]);
  // Porcelain paths are from the repository's root; the list reads as the folder's own designs.
  const prefix = (await git(dir, ["rev-parse", "--show-prefix"])).out;
  const status = await git(dir, ["status", "--porcelain=v1", "--untracked-files=all", ...HERE]);
  if (!status.ok) return undefined;
  const changes = status.out.split("\n").filter(Boolean).map((line) => {
    const code = line.slice(0, 2).trim()[0] ?? "M";
    const full = line.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "");
    const path = full.startsWith(prefix) ? full.slice(prefix.length) : full;
    return { path, state: STATE[code] ?? "modified" };
  });
  return { branch: branch.out || "detached", changes };
}

/** Commits what changed under `dir` (new files too) and, if asked, pushes the branch. */
export async function gitCommit(dir: string, message: string, push: boolean): Promise<{ ok: boolean; reply: string }> {
  const text = message.trim();
  if (!text) return { ok: false, reply: "Say what changed in a few words." };
  if (!(await gitStatus(dir))?.changes.length) return { ok: false, reply: "Nothing has changed since the last commit." };
  const add = await git(dir, ["add", "-A", ...HERE]);
  if (!add.ok) return { ok: false, reply: add.out };
  // The pathspec keeps the commit to this folder, whatever else is staged.
  const commit = await git(dir, ["commit", "-m", text, ...HERE]);
  if (!commit.ok) return { ok: false, reply: commit.out };
  if (!push) return { ok: true, reply: "Committed." };
  const pushed = await git(dir, ["push"]);
  return pushed.ok ? { ok: true, reply: "Committed and pushed." } : { ok: false, reply: `Committed; the push failed: ${pushed.out.split("\n").at(-1) ?? ""}` };
}
