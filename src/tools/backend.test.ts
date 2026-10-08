import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "../format/parse.ts";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { example, matchEndpoint, mockGraphql, openApi, sqlSchema } from "./backend.ts";
import { Workspace } from "./workspace.ts";

const r = parseDoc(readFileSync(new URL("../../examples/parcel.buni", import.meta.url), "utf8"));
if (!r.ok) throw new Error("the Parcel example parses");
const doc = r.doc;

test("OpenAPI carries every endpoint, its errors, access and example bodies, with shapes as components", () => {
  const api = JSON.parse(JSON.stringify(openApi(doc, "returns-api")));
  expect(api.openapi).toBe("3.1.0");
  const refund = api.paths["/returns/{id}/refund"].post;
  expect(Object.keys(refund.responses).sort()).toEqual(["200", "409", "422"]);
  expect(refund.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
  expect(refund["x-access"].who).toBe("roles");
  expect(api.paths["/returns"].get.parameters.map((p: { name: string }) => p.name)).toEqual(["status", "cursor"]);
  expect(api.paths["/orders/lookup"].post.security).toEqual([]);
  expect(api.components.schemas.ReturnStatus.enum).toContain("refunding");
  expect(api.components.schemas.Order.properties.lines).toEqual({ type: "array", items: { $ref: "#/components/schemas/OrderLine" } });
  // Every $ref points at a schema that exists.
  const refs = JSON.stringify(api).match(/#\/components\/schemas\/\w+/g) ?? [];
  for (const ref of refs) expect(api.components.schemas[ref.split("/").at(-1) ?? ""]).toBeDefined();
});

test("SQL creates referenced tables first, with keys, foreign keys and sensitive columns noted", () => {
  const sql = sqlSchema(doc);
  expect(sql.indexOf("CREATE TABLE stores")).toBeLessThan(sql.indexOf("CREATE TABLE returns"));
  expect(sql.indexOf("CREATE TABLE returns")).toBeLessThan(sql.indexOf("CREATE TABLE refunds"));
  expect(sql).toContain("store_id uuid NOT NULL REFERENCES stores (id)");
  expect(sql).toContain("id uuid NOT NULL PRIMARY KEY");
  expect(sql).toContain("COMMENT ON COLUMN stores.shopify_token IS 'secret: never shown or logged';");
});

test("examples fill a shape believably, and a request finds its endpoint by method and path", () => {
  const order = example(doc, "Order");
  expect(order).toMatchObject({ number: "1042", store: { brandColor: "#0f766e" }, lines: [{ price: { amount: 4800, currency: "GBP" } }] });
  expect(example(doc, "ReturnStatus")).toBe("requested");
  expect(matchEndpoint(doc, "post", "/returns/abc/refund")?.id).toBe("post-returns-id-refund");
  expect(matchEndpoint(doc, "GET", "/returns/abc/refund")).toBeUndefined();
});

/** A design with a GraphQL returns service: a query for returns and a mutation that refunds one. */
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "buni-gql-"));
  const file = join(dir, "portal.buni");
  await copyFile(join(import.meta.dir, "../../examples/portal.buni"), file);
  const ws = await Workspace.open(file);
  const ok = async (tool: Parameters<Workspace["call"]>[1], args: unknown) => {
    const r = await ws.call("you", tool, args);
    if (!r.ok) throw new Error(r.reply);
    return r.reply;
  };
  await ok("set_part", { kind: "service", name: "Returns graph", purpose: "Returns and refunds over GraphQL.", api: "graphql" });
  const service = Object.values(ws.view().parts).find((p) => p.name === "Returns graph")?.id ?? "";
  await ok("set_shape", { name: "ReturnStatus", values: ["requested", "received", "refunded"] });
  await ok("set_shape", { name: "Refund", fields: [{ name: "id", type: "id" }, { name: "amountCents", type: "integer" }, { name: "status", type: "ReturnStatus" }] });
  await ok("set_shape", { name: "Return", fields: [{ name: "id", type: "id" }, { name: "status", type: "ReturnStatus" }, { name: "refund", type: "Refund", optional: true }] });
  await ok("set_operation", { service, kind: "query", name: "returns", summary: "Returns, newest first.", args: [{ name: "status", type: "ReturnStatus", optional: true }], returns: "Return[]" });
  await ok("set_operation", { service, kind: "mutation", name: "issueRefund", summary: "Refund a return that arrived back.", args: [{ name: "returnId", type: "id" }, { name: "amountCents", type: "integer" }], returns: "Refund" });
  await ok("set_operation", { service, kind: "subscription", name: "returnChanged", summary: "Each change to a return.", args: [], returns: "Return" });
  return { dir, ws };
}


test("the mock answers GraphQL requests by the field asked for", async () => {
  const { ws } = await setup();
  const doc = ws.view();
  const r = mockGraphql(doc, { query: "mutation Refund($returnId: ID!, $amountCents: Int!) { issueRefund(returnId: $returnId, amountCents: $amountCents) { id amountCents } }", variables: { amountCents: 900 } });
  expect(r.data?.issueRefund).toMatchObject({ amountCents: 900 });
  expect(mockGraphql(doc, { query: "{ returns { id } }" }).data?.returns).toBeDefined();
  expect(mockGraphql(doc, { query: "query { nope { id } }" }).errors?.[0]?.message).toContain("No query nope");
  expect(mockGraphql(doc, { query: "subscription { returnChanged { id } }" }).errors?.[0]?.message).toContain("stream");
});
