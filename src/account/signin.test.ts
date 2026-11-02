import { afterAll, expect, test } from "bun:test";
import { checkServer, fetchPerson, revokeToken, SignInError, signInWithPassword } from "./signin.ts";

// A small buni server: one account, tokens made by /auth/token, /auth/me for a live one, /auth/signout forgets it.
const tokens = new Set<string>();
const seen: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get("authorization");
    seen.push(`${req.method} ${url.pathname}${auth ? ` ${auth}` : ""}`);
    const person = { id: "u1", username: "ada", name: "Ada", email: "ada@test.example" };
    if (url.pathname === "/auth/token") {
      const body = (await req.json()) as { email?: string; password?: string; name?: string };
      if (body.email !== "ada@test.example" || body.password !== "correct horse battery") return Response.json({ error: "That email and password don't match" }, { status: 401 });
      const token = `buni_${body.name}`;
      tokens.add(token);
      return Response.json({ token, person });
    }
    if (url.pathname === "/auth/me") return Response.json(auth && tokens.has(auth.slice(7)) ? { state: "signed-in", person } : { state: "signed-out" });
    if (url.pathname === "/auth/signout") { if (auth) tokens.delete(auth.slice(7)); return Response.json({}); }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});
const at = `http://localhost:${server.port}`;
afterAll(() => server.stop(true));

test("an email and password buy a token the server then knows, until it is signed out", async () => {
  await expect(signInWithPassword(at, "ada@test.example", "wrong", "laptop")).rejects.toThrow("don't match");
  const { token, person } = await signInWithPassword(at, "ada@test.example", "correct horse battery", "laptop");
  expect(token).toBe("buni_laptop");
  expect(person).toEqual({ id: "u1", username: "ada", name: "Ada", email: "ada@test.example" });
  expect(await fetchPerson(at, token)).toEqual(person);
  await revokeToken(at, token);
  expect(seen).toContain("POST /auth/signout Bearer buni_laptop");
  expect(await fetchPerson(at, token)).toBeUndefined();
});

test("a server without the sign-in route says so, instead of Not Found", async () => {
  const other = Bun.serve({ port: 0, fetch: () => Response.json({ error: "not found" }, { status: 404 }) });
  try {
    await expect(signInWithPassword(`http://localhost:${other.port}`, "a@b.c", "x", "n")).rejects.toThrow("is it a buni server");
  } finally {
    other.stop(true);
  }
});

test("tokens only travel over https, or to this machine", () => {
  expect(checkServer("https://buni.emusoi.app/anything")).toBe("https://buni.emusoi.app");
  expect(checkServer("http://127.0.0.1:7720")).toBe("http://127.0.0.1:7720");
  expect(() => checkServer("http://buni.emusoi.app")).toThrow(SignInError);
  expect(() => checkServer("not a url")).toThrow(SignInError);
});
