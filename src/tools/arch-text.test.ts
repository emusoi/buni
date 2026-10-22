import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { architectureOf, emptyDoc, type Doc } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { architectureText, parseArchitectureText } from "./arch-text.ts";
import { Workspace } from "./workspace.ts";

const parcelPath = new URL("../../examples/parcel.buni", import.meta.url).pathname;

function parcel(): Doc {
  const r = parseDoc(readFileSync(parcelPath, "utf8"));
  if (!r.ok) throw new Error("parcel is invalid");
  return r.doc;
}

/** The message parseArchitectureText refuses `text` with. */
function refusal(text: string): string {
  try {
    parseArchitectureText(text);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the text to be refused");
}

const MINIMAL = `parts:
  web:
    name: Web
    kind: client
  api:
    name: API
    kind: service
    status: live
  db:
    name: DB
    kind: store
    managed: RDS
links:
  web-calls-api: web calls api
  api-writes-db:
    from: api
    to: db
    kind: writes
    carries: Order
plays:
  order:
    name: Order
    kind: request
    steps:
      - name: Web asks
        touches: [web, web-calls-api, api]
      - name: Nothing lit
`;

describe("architecture as text", () => {
  test("parcel reads back as itself, and writes the same text again", () => {
    const arch = architectureOf(parcel());
    const text = architectureText(arch);
    expect(text.startsWith("# buni architecture")).toBe(true);
    expect(text).toContain("  cloudfront-routes-waf: cloudfront routes waf\n");
    expect(text).not.toContain("status: live");
    expect(text).not.toContain("  id:");
    const back = parseArchitectureText(text);
    expect(architectureText(back)).toBe(text);
    for (const c of Object.keys(arch) as (keyof typeof arch)[]) expect(back[c]).toEqual(arch[c]);
  });

  test("a hand-written text: ids from keys, one-line links, live and empty lists left out", () => {
    const a = parseArchitectureText(MINIMAL);
    expect(a.parts.api).toEqual({ id: "api", name: "API", kind: "service" });
    expect(a.links["web-calls-api"]).toEqual({ id: "web-calls-api", from: "web", to: "api", kind: "calls" });
    expect(a.plays.order?.steps[1]).toEqual({ name: "Nothing lit", touches: [] });
    expect(a.clusters).toEqual({});
    expect(architectureText(a)).not.toContain("status: live");
    expect(parseArchitectureText("# nothing yet\n")).toEqual(architectureOf(emptyDoc()));
    expect(parseArchitectureText(architectureText(architectureOf(emptyDoc())))).toEqual(architectureOf(emptyDoc()));
  });

  test("refusals name the line, the path and the rule", () => {
    expect(refusal(MINIMAL.replace("kind: client", "kind: app"))).toContain("line 4 · parts.web.kind: expected one of client, service");
    expect(refusal(MINIMAL.replace("web calls api", "web calls nowhere"))).toContain('line 14 · links.web-calls-api.to: part "nowhere" does not exist');
    expect(refusal(MINIMAL.replace("web calls api", "web calls"))).toContain('links.web-calls-api: a link on one line is "FROM KIND TO"');
    expect(refusal(MINIMAL.replace("touches: [web, web-calls-api, api]", "touches: [web, ghost]"))).toContain('line 26 · plays.order.steps[0].touches: "ghost" is nothing in the architecture');
    expect(refusal(MINIMAL.replace("  db:\n", "  web:\n"))).toContain('line 9 · parts.web: "web" is written twice');
    expect(refusal(`${MINIMAL}tables:\n  t: {}\n`)).toContain("tables: unknown key");
    expect(refusal("parts:\n  api: [\n")).toContain("isn't YAML: line 2");
  });
});

describe("read_architecture_text and write_architecture_text", () => {
  const open = async (from?: string) => {
    const file = join(await mkdtemp(join(tmpdir(), "buni-arch-text-")), "app.buni");
    if (from) await copyFile(from, file);
    else await writeFile(file, serializeDoc(emptyDoc()));
    return Workspace.open(file);
  };

  test("a whole new architecture is one edit, and one undo takes it back", async () => {
    const ws = await open();
    const r = await ws.call("person", "write_architecture_text", { text: MINIMAL });
    expect(r.ok).toBe(true);
    expect(r.reply).toBe("Wrote the architecture: added web, api, db, web-calls-api, api-writes-db, order.");
    expect(Object.keys(architectureOf(ws.view()).parts)).toEqual(["web", "api", "db"]);
    expect((await ws.call("person", "read_architecture_text", {})).reply).toContain("  web-calls-api: web calls api");
    await ws.undo();
    expect(ws.view().architecture).toBeUndefined();
  });

  test("changing parcel's text changes, adds and removes just those things, as one undoable edit", async () => {
    const ws = await open(parcelPath);
    const before = serializeDoc(ws.view());
    const text = (await ws.call("person", "read_architecture_text", {})).reply;
    const edited = text
      .replace("    tech: CDN\n", "    tech: CDN · edge cache\n")
      .replace("  waf-routes-alb: waf routes alb\n", "")
      .replace("groups:\n", "groups:\n  platform:\n    name: Platform\n    kind: team\n\n");
    const r = await ws.call("person", "write_architecture_text", { text: edited });
    expect(r.reply).toBe("Wrote the architecture: added platform; changed cloudfront; removed waf-routes-alb.");
    const a = architectureOf(ws.view());
    expect(a.parts.cloudfront?.tech).toBe("CDN · edge cache");
    expect(a.links["waf-routes-alb"]).toBeUndefined();
    await ws.undo();
    expect(serializeDoc(ws.view())).toBe(before);
  });

  test("writing back what it already says makes no edit, even with status live spelled out", async () => {
    const ws = await open(parcelPath);
    const text = (await ws.call("person", "read_architecture_text", {})).reply;
    const same = await ws.call("person", "write_architecture_text", { text: text.replace("    kind: edge\n", "    kind: edge\n    status: live\n") });
    expect(same.reply).toBe("The architecture already says that: nothing changed.");
    // Nothing to undo: the last edit there is still none.
    expect((await ws.undo()).ok).toBe(false);
  });

  test("an invalid text is refused with its line and path, and changes nothing", async () => {
    const ws = await open(parcelPath);
    const before = serializeDoc(ws.view());
    const r = await ws.call("person", "write_architecture_text", { text: "parts:\n  api:\n    name: API\n    kind: servce\n" });
    expect(r.ok).toBe(false);
    expect(r.reply).toContain("line 4 · parts.api.kind: expected one of");
    expect(serializeDoc(ws.view())).toBe(before);
  });
});

test("a person and an API round-trip through the text, and a broken operation names its line", () => {
  const doc = parcel();
  const a = architectureOf(doc);
  a.parts.buyer = { id: "buyer", name: "Buyer", kind: "person" };
  a.parts["returns-api"] = { ...a.parts["returns-api"]!, api: { kind: "rest", spec: "openapi.yaml", operations: [{ id: "refund", method: "POST", path: "/returns/{id}/refund", responses: ["202 Refund queued", "409 Not scanned yet"] }] } };
  const text = architectureText(a);
  expect(text).toContain("kind: person");
  expect(text).toContain('path: "/returns/{id}/refund"');
  expect(parseArchitectureText(text)).toEqual(a);
  expect(refusal(text.replace("method: POST", "method: FETCH"))).toMatch(/line \d+ · parts\.returns-api\.api\.operations\[0\]\.method: expected one of GET, POST/);
});

