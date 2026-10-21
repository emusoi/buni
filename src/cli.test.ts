import { expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

test("parallel CLI creates preserve every page and activity entry through file aliases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-parallel-"));
  const file = join(dir, "shop.buni");
  const alias = join(dir, "alias.buni");
  try {
    expect(cli("new", file).code).toBe(0);
    await symlink(file, alias);
    const results = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const p = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "call", i % 2 ? alias : file,
        "create_page", JSON.stringify({ name: `Page ${i}`, route: `/page-${i}` })], { stdout: "pipe", stderr: "pipe" });
      return { code: await p.exited, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() };
    }));
    for (const result of results) {
      expect(result.code).toBe(0);
      expect(result.out).toContain("Created page");
      expect(result.err).toBe("");
    }
    const tree = cli("tree", file);
    for (let i = 0; i < 8; i++) expect(tree.out).toContain(`"Page ${i}" /page-${i}`);
    expect(JSON.parse(await readFile(`${file}.activity`, "utf8"))).toHaveLength(8);
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readdir(dir)).not.toContain("shop.buni.lock");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed CLI calls release the file lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-lock-"));
  const file = join(dir, "shop.buni");
  try {
    expect(cli("new", file).code).toBe(0);
    const original = await readFile(file, "utf8");
    expect(cli("call", file, "create_page", '{}').code).not.toBe(0);
    expect(await readdir(dir)).not.toContain("shop.buni.lock");
    await writeFile(file, "invalid document");
    expect(cli("call", file, "create_page", '{"name":"Home"}').code).not.toBe(0);
    expect(await readdir(dir)).not.toContain("shop.buni.lock");
    await writeFile(file, original);
    expect(cli("call", file, "create_page", '{"name":"Home"}').code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("arch checks the architecture and exports drafts next to the design", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-arch-"));
  try {
    const file = join(dir, "parcel.buni");
    await writeFile(file, await readFile(join(import.meta.dir, "..", "examples", "parcel.buni"), "utf8"));
    const check = cli("arch", file, "check");
    expect(check.code).toBe(0);
    expect(check.out).toContain("Architecture: no findings");
    const out = join(dir, "deploy");
    const exported = cli("arch", file, "export", "manifests", "--env", "prod", "--out", out);
    expect(exported.code).toBe(0);
    expect(exported.out).toContain("draft files to deploy/");
    expect((await readdir(join(out, "prod"))).sort()).toEqual(["jobs", "returns", "worker"]);
    expect(await readFile(join(out, "prod", "returns", "returns-api.yaml"), "utf8")).toContain("kind: Rollout");
    expect(cli("arch", file, "export", "ci", "--out", join(dir, "..")).code).toBe(1);
    expect(cli("arch", file, "export", "helm").code).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("arch text prints the architecture as YAML; write and edit apply a text as one edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-arch-text-"));
  try {
    const file = join(dir, "app.buni");
    expect(cli("new", file).code).toBe(0);
    const yaml = join(dir, "arch.yaml");
    await writeFile(yaml, "parts:\n  api:\n    name: API\n    kind: service\n");
    const wrote = cli("arch", file, "write", yaml);
    expect(wrote.code).toBe(0);
    expect(wrote.out).toContain("Wrote the architecture: added api.");
    const text = cli("arch", file, "text");
    expect(text.code).toBe(0);
    expect(text.out).toContain("parts:\n  api:\n    name: API\n    kind: service\n");
    await writeFile(yaml, "parts:\n  api:\n    name: API\n    kind: servce\n");
    const refused = cli("arch", file, "write", yaml);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("line 4 · parts.api.kind: expected one of");
    const piped = Bun.spawnSync(["bun", join(import.meta.dir, "cli.ts"), "arch", file, "write", "-"], { stdin: Buffer.from("parts:\n  web:\n    name: Web\n    kind: client\n"), stdout: "pipe", stderr: "pipe" });
    expect(`${piped.stdout}`).toContain("added web; removed api");
    expect(cli("arch", file, "write").code).toBe(2);

    // An editor that first saves a broken kind, then (seeing the error on top) fixes it.
    const editor = join(dir, "editor.sh");
    await writeFile(editor, `#!/bin/sh
if grep -q '^# ! ' "$1"; then sed -i.bak 's/kind: servce/kind: service/' "$1"; else printf 'parts:\\n  web:\\n    name: Web\\n    kind: client\\n  api:\\n    name: API\\n    kind: servce\\n' > "$1"; fi
`, { mode: 0o755 });
    const edit = Bun.spawnSync(["bun", join(import.meta.dir, "cli.ts"), "arch", file, "edit"], { env: { ...process.env, VISUAL: "", EDITOR: editor }, stdout: "pipe", stderr: "pipe" });
    expect(edit.exitCode).toBe(0);
    expect(`${edit.stdout}`).toContain("added api");
    expect(cli("arch", file, "text").out).toContain("    kind: service");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
