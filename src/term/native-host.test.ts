import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import { slug } from "./native-host.ts";

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
