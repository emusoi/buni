import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "cli.ts"), ...args], { env: { ...process.env, BUNI_TOKEN: "" }, stderr: "pipe", stdout: "pipe" });
  return { code: p.exitCode, out: `${p.stdout}${p.stderr}` };
};

test("login takes --server either way, and refuses anything else before signing in", () => {
  // Plain http to another machine is refused before any request: the token would travel unencrypted.
  for (const form of [["--server", "http://buni.example"], ["--server=http://buni.example"]]) {
    const r = cli("login", ...form);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("only signs in to Wazo over https");
  }
  const r = cli("login", "something-else");
  expect(r.code).toBe(2);
  expect(r.out).toContain("usage: buni login");
});

test("new starts an empty design the tools can work on, and never writes over one", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-new-")), "shop.buni");
  expect(cli("new", file).code).toBe(0);
  expect(cli("call", file, "create_page", '{"name":"Home","route":"/"}').code).toBe(0);
  const again = cli("new", file);
  expect(again.code).not.toBe(0);
  expect(cli("tree", file).out).toContain("Home");
});
