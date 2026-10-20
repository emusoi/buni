import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { answer, slug } from "./native-host.ts";

/** Talks to `buni native-host` the way Chrome does: each message JSON behind its 4-byte little-endian length. */
async function host(home: string, messages: unknown[]): Promise<unknown[]> {
  const child = Bun.spawn(["bun", join(import.meta.dir, "../cli.ts"), "native-host", "chrome-extension://x/"], {
    env: { ...process.env, HOME: home, BUNI_EDIT_CHECKS: "0" }, stdin: "pipe", stdout: "pipe", stderr: "inherit",
  });
  const answers: unknown[] = [];
  const reader = child.stdout.getReader();
  let buffer = Buffer.alloc(0);
  for (const m of messages) {
    const body = Buffer.from(JSON.stringify(m));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([head, body]));
    await child.stdin.flush();
    while (buffer.length < 4 || buffer.length < 4 + buffer.readUInt32LE(0)) {
      const r = await reader.read();
      if (r.done) throw new Error("the host stopped");
      buffer = Buffer.concat([buffer, Buffer.from(r.value)]);
    }
    const size = buffer.readUInt32LE(0);
    answers.push(JSON.parse(buffer.subarray(4, 4 + size).toString()));
    buffer = buffer.subarray(4 + size);
  }
  await child.stdin.end();
  await child.exited;
  return answers;
}

test("slugs make folder names", () => {
  expect(slug("Stripe · Pricing!")).toBe("stripe-pricing");
  expect(slug("···")).toBe("snap");
});

test("the native host saves a snap as a new scratch design, lists it, and adds the next snap to it", async () => {
  const home = await mkdtemp(join(tmpdir(), "buni-host-"));
  try {
    const snapshot = { html: '<main style="padding:24px"><h1>Pricing</h1></main>', count: 2, warnings: [], images: [], url: "https://example.com/pricing", width: 800 };
    const [first, list] = await host(home, [
      { type: "snap", into: { scratch: "Example · Pricing" }, snapshot, page: { name: "Pricing · Now" } },
      { type: "list" },
    ]);
    const file = join(home, "buni/scratch/example-pricing/example-pricing.buni");
    expect(first).toMatchObject({ ok: true, file, name: "example-pricing" });
    expect(list).toMatchObject({ ok: true, scratch: [{ file, name: "example-pricing" }] });
    const [again, bad] = await host(home, [
      { type: "snap", into: { file }, snapshot, page: { name: "Pricing · Now, again" } },
      { type: "snap", into: { file: join(home, "nope.buni") }, snapshot, page: { name: "x" } },
    ]);
    expect(again).toMatchObject({ ok: true, file });
    expect(bad).toMatchObject({ ok: false });
    const doc = parseDoc(await Bun.file(file).text());
    expect(doc.ok && Object.values(doc.doc.pages).map((p) => p.name).sort()).toEqual(["Pricing · Now", "Pricing · Now, again"]);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60_000);

test("the native host keeps a snap as a pattern in the person's inspiration library, its images inside it", async () => {
  const home = await mkdtemp(join(tmpdir(), "buni-host-"));
  try {
    const snapshot = { html: '<main><img src="asset:buni-import-image-1-asset" alt=""><h1>Pricing</h1></main>', url: "https://example.com/pricing", images: [{ id: "buni-import-image-1-asset", base64: "iVBORw0KGgo=", mime: "image/png" }] };
    const [kept] = await host(home, [{ type: "inspire", name: "Example pricing", snapshot }]);
    const file = join(home, ".buni/inspiration/example-pricing.html");
    expect(kept).toMatchObject({ ok: true, file });
    const text = await Bun.file(file).text();
    expect(text).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(text).toContain("seen in: https://example.com/pricing");
    expect(JSON.parse(await Bun.file(join(home, ".buni/settings.json")).text()).inspiration).toEqual([join(home, ".buni/inspiration")]);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60_000);

test("a snap's brief is kept on its page, and buni snaps lists it newest first", async () => {
  const home = await mkdtemp(join(tmpdir(), "buni-host-"));
  try {
    const snapshot = { html: "<main><h1>Plans</h1></main>", count: 2, warnings: [], images: [], url: "https://example.com/plans", width: 800 };
    const [first] = await host(home, [{ type: "snap", into: { scratch: "Example plans" }, snapshot, page: { name: "Plans · Now" }, brief: "Make the plans easier to compare" }]);
    expect(first).toMatchObject({ ok: true });
    const [panel, library] = await host(home, [{ type: "snaps" }, { type: "patterns" }]);
    expect(panel).toMatchObject({ ok: true, snaps: [{ page: "Plans · Now", brief: "Make the plans easier to compare" }] });
    expect(library).toMatchObject({ ok: true, patterns: expect.any(Array) });
    const list = Bun.spawn(["bun", join(import.meta.dir, "../cli.ts"), "snaps", "--json"], { env: { ...process.env, HOME: home }, stdout: "pipe" });
    const snaps: unknown = JSON.parse(await new Response(list.stdout).text());
    expect(snaps).toEqual([expect.objectContaining({ page: "Plans · Now", url: "https://example.com/plans", brief: "Make the plans easier to compare", file: join(home, "buni/scratch/example-plans/example-plans.buni") })]);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60_000);

test("opening a design that's already open answers its editor, on the page asked for, not its MCP address", async () => {
  const tools = { run: async () => ({ ok: true, text: "" }), liveApp: async () => "http://localhost:4100/mcp?file=%2Fdesigns%2Fx%2Fx.buni" };
  expect(await answer({ type: "open", file: "/tmp/x/x.buni", page: "p1" }, tools)).toEqual({ ok: true, url: "http://localhost:4100/?file=%2Fdesigns%2Fx%2Fx.buni&page=p1" });
  const headless = { ...tools, liveApp: async () => "http://localhost:4100/mcp" };
  expect(await answer({ type: "open", file: "/tmp/x/x.buni" }, headless)).toMatchObject({ ok: false });
});
