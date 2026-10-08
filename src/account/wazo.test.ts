import { afterAll, expect, test } from "bun:test";
import { checkServer, fetchPerson, revokeToken, startSignIn, waitForApproval, WazoError } from "./wazo.ts";

// A small Wazo: device sign-in approves on the second poll, /me answers for one token, /tokens/self records sign-outs.
const seen: string[] = [];
let polls = 0;
const wazo = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get("authorization");
    seen.push(`${req.method} ${url.pathname}${auth ? ` ${auth}` : ""}`);
    const reply = (data: unknown, status = 200) => Response.json(status === 200 ? { success: true, data } : { success: false, error: String(data) }, { status });
    if (url.pathname === "/api/auth/device/start") {
      const body = (await req.json()) as { clientName?: string };
      return reply({ deviceCode: `dev-${body.clientName}`, userCode: "ABCD-EFGH", expiresIn: 900, verificationUri: `${url.origin}/link`, interval: 0.01 });
    }
    if (url.pathname === "/api/auth/device/token") {
      const body = (await req.json()) as { deviceCode?: string };
      if (body.deviceCode === "dev-old") return reply("That sign-in expired. Start again.", 410);
      polls += 1;
      return reply(polls < 2 ? { state: "pending" } : { state: "approved", token: "wazo_pat_buni", tokenId: "t1" });
    }
    if (url.pathname === "/api/auth/me") {
      if (auth !== "Bearer wazo_pat_buni") return reply("Invalid or expired token", 401);
      return reply({ id: "u1", username: "jones", name: "Jones Kim", email: "space@workspace.invalid", avatar: "data:image/png;base64,AAAA" });
    }
    if (url.pathname === "/api/tokens/self") return reply({ id: "t1" });
    return reply("not found", 404);
  },
});
const server = `http://localhost:${wazo.port}`;
afterAll(() => wazo.stop(true));

test("sign in with Wazo: a code to compare, a page to approve it, then a token and who it belongs to", async () => {
  const started = await startSignIn(server, "buni on this Mac");
  expect(started.userCode).toBe("ABCD-EFGH");
  expect(started.url).toBe(`${server}/link?code=ABCD-EFGH`);
  const token = await waitForApproval(server, started, new AbortController().signal);
  expect(token).toBe("wazo_pat_buni");
  expect(polls).toBe(2);
  // A workspace's reserved .invalid address is not shown as an email.
  expect(await fetchPerson(server, token)).toEqual({ id: "u1", username: "jones", name: "Jones Kim", avatar: "data:image/png;base64,AAAA" });
  await revokeToken(server, token);
  expect(seen).toContain("DELETE /api/tokens/self Bearer wazo_pat_buni");
});

test("an expired code, a revoked token and a cancelled wait each say so", async () => {
  const old = { deviceCode: "dev-old", userCode: "X", url: "", intervalMs: 5, expiresAt: Date.now() + 60_000 };
  await expect(waitForApproval(server, old, new AbortController().signal)).rejects.toThrow("expired");
  expect(await fetchPerson(server, "wazo_pat_revoked")).toBeUndefined();
  const stop = new AbortController();
  stop.abort();
  await expect(waitForApproval(server, { ...old, deviceCode: "dev-new" }, stop.signal)).rejects.toThrow("cancelled");
});

test("a Wazo without device sign-in says so, instead of Not Found", async () => {
  const old = Bun.serve({ port: 0, fetch: () => Response.json({ success: false, error: "Not Found" }, { status: 404 }) });
  try {
    await expect(startSignIn(`http://localhost:${old.port}`, "buni")).rejects.toThrow("can't sign other apps in yet");
  } finally {
    old.stop(true);
  }
});

test("tokens only travel over https, or to this machine", () => {
  expect(checkServer("https://wazo.emusoi.app/anything")).toBe("https://wazo.emusoi.app");
  expect(checkServer("http://127.0.0.1:3899")).toBe("http://127.0.0.1:3899");
  expect(() => checkServer("http://wazo.emusoi.app")).toThrow(WazoError);
  expect(() => checkServer("not a url")).toThrow(WazoError);
});
