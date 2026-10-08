// Turns a release's tarballs into Homebrew bottles: bun scripts/bottles.ts <version> <dir>
// A bottle is the installed keg, buni/<version>/bin/buni, as a tarball named for its platform tag (formula.ts).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bottle, PLATFORMS, tarball } from "./formula.ts";

const [version, dir] = process.argv.slice(2);
if (!version || !dir) throw new Error("usage: bun scripts/bottles.ts <version> <dir>");

const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
};

for (const p of PLATFORMS) {
  const work = await mkdtemp(join(tmpdir(), "buni-bottle-"));
  try {
    const bin = join(work, "buni", version, "bin");
    await run(["mkdir", "-p", bin]);
    await run(["tar", "-xzf", join(dir, tarball(version, p)), "-C", bin]);
    await run(["tar", "-czf", join(dir, bottle(version, p)), "-C", work, "buni"]);
    console.log(`bottled ${bottle(version, p)}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
