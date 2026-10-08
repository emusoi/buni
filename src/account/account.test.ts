import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Secrets } from "./keychain.ts";
import { forgetAccount, loadAccount, saveAccount } from "./account.ts";
import { designs, download, findDesign } from "./remote.ts";

const memory = (): Secrets & { saved: Map<string, string> } => {
  const saved = new Map<string, string>();
  return { saved, get: async (n) => saved.get(n), set: async (n, v) => void saved.set(n, v), remove: async (n) => void saved.delete(n) };
};
const noKeychain: Secrets = { get: async () => undefined, set: async () => { throw new Error("no keychain"); }, remove: async () => {} };
const person = { id: "u1", name: "Ada", username: "ada" };

test("an account is kept in the keychain, or in a file only you can read when there is none", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-account-")), "buni", "account.json");
  const keys = memory();
  expect(await saveAccount({ server: "https://buni.example", token: "t1", person }, keys, file)).toBe("keychain");
  expect(await loadAccount(keys, file)).toEqual({ server: "https://buni.example", token: "t1", person });

  expect(await saveAccount({ server: "https://buni.example", token: "t2" }, noKeychain, file)).toBe("file");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await loadAccount(noKeychain, file)).toEqual({ server: "https://buni.example", token: "t2" });

  await forgetAccount(keys, file);
  expect(await loadAccount(keys, file)).toBeUndefined();
  await expect(readFile(file)).rejects.toThrow();
});

test("$BUNI_TOKEN stands in for a sign-in", async () => {
  process.env.BUNI_TOKEN = "from-env";
  try {
    expect((await loadAccount(memory(), "/nonexistent"))?.token).toBe("from-env");
  } finally {
    delete process.env.BUNI_TOKEN;
  }
});

// A buni server that knows one token and one design.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.headers.get("authorization") !== "Bearer good") return Response.json({ error: "sign in first" }, { status: 401 });
    const url = new URL(req.url);
    if (url.pathname === "/rpc/home") return Response.json({ value: [{ path: "/people/u1/Shop/Shop.buni", name: "Shop", folder: "/people/u1", modified: "2026-10-07T00:00:00Z", pages: 3, doc: {} }] });
    if (url.pathname === "/rpc/fileText" && url.searchParams.get("file") === "/people/u1/Shop/Shop.buni") return Response.json({ value: '{"buni":1}' });
    return new Response("not found", { status: 404 });
  },
});
afterAll(() => void server.stop());
const at = `http://localhost:${server.port}`;

test("designs on the server are listed, found by name and read, with the token", async () => {
  const account = { server: at, token: "good" };
  expect((await designs(account)).map((d) => d.name)).toEqual(["Shop"]);
  expect(await findDesign(account, "shop")).toBe("/people/u1/Shop/Shop.buni");
  await expect(findDesign(account, "Nope")).rejects.toThrow("you have: Shop");
  expect(await download(account, "/people/u1/Shop/Shop.buni")).toBe('{"buni":1}');
  await expect(designs({ server: at, token: "bad" })).rejects.toThrow("sign in first");
});
