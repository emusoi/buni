import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "../format/parse.ts";
import { example, matchEndpoint, openApi, sqlSchema } from "./backend.ts";

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
