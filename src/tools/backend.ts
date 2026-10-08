// What a backend engineer takes from a design into their own tools: an OpenAPI document for the REST endpoints, the
// tables as Postgres DDL, and example values for any shape, which also answer the mock API.
import { bodyFields, type Doc, type Endpoint, type Field, type Id, type Operation, type Table } from "../format/doc.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A believable value for a field, from its name first and its type second, so mock data reads like the product. */
function guess(name: string, type: string): Json {
  const n = name.toLowerCase();
  if (type === "id") return n.includes("line") ? "line_7f3a" : "3f2c9b1e-8d4a-4e6b-9a1c-5b7e2d0f4a61";
  if (type === "datetime") return "2026-10-03T10:42:00Z";
  if (type === "boolean") return true;
  if (type === "integer") return /amount|price|total|cents/.test(n) ? 4800 : /days/.test(n) ? 30 : /count|attempts|quantity|qty/.test(n) ? 1 : 1;
  if (type === "number") return 1.5;
  // A date kept as text (checkDate, snoozedUntil, dueOn): a real date, not the field's name.
  if (/(date|until|due|day)$|_on$|on$/.test(n) && !/reason|description/.test(n)) return "2026-10-04";
  if (/email/.test(n)) return "amira@example.com";
  if (/currency/.test(n)) return "GBP";
  if (/url|link/.test(n)) return "https://example.com/" + (n.replace(/url$/, "") || "file");
  if (/colou?r/.test(n)) return "#0f766e";
  if (/token|secret|key/.test(n)) return "tok_9f2a71c4e0";
  if (/number/.test(n)) return "1042";
  if (/domain/.test(n)) return "northwind-goods.myshopify.com";
  if (/name/.test(n)) return "Northwind Goods";
  if (/title/.test(n)) return "Linen shirt";
  if (/policy/.test(n)) return "Send back unworn items with the tags on within 30 days.";
  if (/message|error/.test(n)) return "Gift cards can't be returned";
  if (/variant/.test(n)) return "Sand · M";
  if (/reason|note|summary|description/.test(n)) return "Fits small across the shoulders.";
  if (/status|state/.test(n)) return "received";
  if (/arrive|eta|delivery|expected/.test(n)) return "in 3–5 days";
  return name;
}

/**
 * The fields an example shows: an optional one only when the design gives it an example. A made-up value for
 * something usually absent (snoozedUntil) reads as real and misleads whoever reads the example, agents included.
 */
const present = (fields: readonly Field[]) => fields.filter((f) => !f.optional || f.example !== undefined);

/** An example value of a type: a primitive, a shape (all its fields), an enum (its first value), or a list of one. */
export function example(doc: Doc, type: string, name = "value", depth = 0): Json {
  if (type.endsWith("[]")) return [example(doc, type.slice(0, -2), name, depth)];
  const shape = Object.values(doc.shapes).find((s) => s.name === type);
  if (!shape) return guess(name, type);
  if (shape.values?.length) return shape.values[0] ?? "";
  if (depth > 4) return {};
  return Object.fromEntries(present(shape.fields).map((f) => [f.name, f.example ?? example(doc, f.type, f.name, depth + 1)]));
}

/**
 * What a mock answers, with what the call sent written into every field of the same name, however deep (a
 * POST's wateredAt shows up in the log it returns), so a mock reads as having done what it was asked.
 */
export function echoInto(value: Json, sent: Record<string, unknown>): Json {
  if (Array.isArray(value)) return value.map((v) => echoInto(v, sent));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    const s = sent[k];
    return [k, typeof s === "string" || typeof s === "number" || typeof s === "boolean" ? s : echoInto(v, sent)];
  }));
}

/** An endpoint's request or response body as an example. */
export function exampleBody(doc: Doc, e: Endpoint, side: "request" | "response"): { [key: string]: Json } {
  const fields = bodyFields(doc, e, side);
  return Object.fromEntries(present(fields).map((f) => [f.name, f.example ?? example(doc, f.type, f.name)]));
}

const PRIM: Record<string, Json> = {
  id: { type: "string", format: "uuid" },
  string: { type: "string" },
  integer: { type: "integer" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  datetime: { type: "string", format: "date-time" },
};

function schemaOf(doc: Doc, type: string): Json {
  if (type.endsWith("[]")) return { type: "array", items: schemaOf(doc, type.slice(0, -2)) };
  if (PRIM[type]) return PRIM[type] ?? {};
  return Object.values(doc.shapes).some((s) => s.name === type) ? { $ref: `#/components/schemas/${type}` } : { type: "string", description: `Unknown type ${type}` };
}

function objectOf(doc: Doc, fields: readonly Field[]): { [key: string]: Json } {
  const required = fields.filter((f) => !f.optional).map((f) => f.name);
  return { type: "object", properties: Object.fromEntries(fields.map((f) => [f.name, schemaOf(doc, f.type)])), ...(required.length ? { required } : {}) };
}

/** OpenAPI 3.1 for the REST endpoints, one service or all; shapes become components, errors responses. */
export function openApi(doc: Doc, service?: Id): Json {
  const endpoints = Object.values(doc.endpoints).filter((e) => service === undefined || e.service === service).sort((a, b) => (a.index < b.index ? -1 : 1));
  const shapeName = (id: Id | undefined) => (id ? doc.shapes[id]?.name : undefined);
  const body = (e: Endpoint, side: "request" | "response"): Json => {
    const whole = shapeName(side === "request" ? e.requestShape : e.responseShape);
    return whole ? { $ref: `#/components/schemas/${whole}` } : objectOf(doc, e[side]);
  };
  const paths: Record<string, Record<string, Json>> = {};
  for (const e of endpoints) {
    const params = [...e.path.matchAll(/\{([^}]+)\}/g)].map((m): Json => ({ name: m[1] ?? "", in: "path", required: true, schema: { type: "string" } }));
    const inQuery = e.method === "GET" || e.method === "DELETE";
    const query = inQuery ? bodyFields(doc, e, "request").map((f): Json => ({ name: f.name, in: "query", required: !f.optional, schema: schemaOf(doc, f.type) })) : [];
    const hasBody = !inQuery && (e.requestShape !== undefined || e.request.length > 0);
    const access = e.access;
    const op: Record<string, Json> = {
      operationId: e.id,
      summary: e.summary,
      ...(params.length + query.length ? { parameters: [...params, ...query] } : {}),
      ...(hasBody ? { requestBody: { required: true, content: { "application/json": { schema: body(e, "request"), example: exampleBody(doc, e, "request") } } } } : {}),
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: body(e, "response"), example: exampleBody(doc, e, "response") } } },
        ...Object.fromEntries((e.errors ?? []).map((x) => [x.code, { description: x.when }])),
      },
      ...(access && access.who !== "public" ? { security: [{ session: [] }] } : { security: [] }),
      ...(access ? { "x-access": { who: access.who, ...(access.roles?.length ? { roles: access.roles } : {}), ...(access.rule ? { rule: access.rule } : {}) } } : {}),
    };
    (paths[e.path] ??= {})[e.method.toLowerCase()] = op;
  }
  const schemas = Object.fromEntries(Object.values(doc.shapes).sort((a, b) => (a.index < b.index ? -1 : 1)).map((s) => [
    s.name,
    s.values?.length ? { type: "string", enum: s.values, ...(s.note ? { description: s.note } : {}) } : { ...objectOf(doc, s.fields), ...(s.note ? { description: s.note } : {}) },
  ]));
  const part = service ? doc.parts[service] : undefined;
  return {
    openapi: "3.1.0",
    info: { title: part?.name ?? "API", version: "0.1.0", ...(part?.purpose ? { description: part.purpose } : {}) },
    paths,
    components: { schemas, securitySchemes: { session: { type: "http", scheme: "bearer" } } },
  };
}

const quote = (name: string) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

/** One table as CREATE TABLE, with keys, foreign keys, and personal or secret columns noted. */
function tableDdl(doc: Doc, t: Table): string {
  const keys = t.columns.filter((c) => c.primary).map((c) => quote(c.name));
  const lines = t.columns.map((c) => {
    const ref = c.ref && doc.tables[c.ref.table] ? ` REFERENCES ${quote(doc.tables[c.ref.table]?.name ?? c.ref.table)} (${quote(c.ref.column)})` : "";
    return `  ${quote(c.name)} ${c.type}${c.nullable ? "" : " NOT NULL"}${c.unique && !c.primary ? " UNIQUE" : ""}${keys.length === 1 && c.primary ? " PRIMARY KEY" : ""}${ref}`;
  });
  if (keys.length > 1) lines.push(`  PRIMARY KEY (${keys.join(", ")})`);
  const notes = t.columns.filter((c) => c.classification).map((c) => `COMMENT ON COLUMN ${quote(t.name)}.${quote(c.name)} IS '${c.classification === "secret" ? "secret: never shown or logged" : "personal: about a person"}';`);
  return [`CREATE TABLE ${quote(t.name)} (\n${lines.join(",\n")}\n);`, ...notes].join("\n");
}

/** Every table of a store (or all), referenced tables first, as Postgres DDL. */
export function sqlSchema(doc: Doc, store?: Id): string {
  const tables = Object.values(doc.tables).filter((t) => store === undefined || t.store === store).sort((a, b) => (a.index < b.index ? -1 : 1));
  const done = new Set<Id>();
  const out: string[] = [];
  const add = (t: Table, seen: Set<Id>) => {
    if (done.has(t.id) || seen.has(t.id)) return;
    seen.add(t.id);
    for (const c of t.columns) { const r = c.ref && tables.find((x) => x.id === c.ref?.table); if (r && r.id !== t.id) add(r, seen); }
    done.add(t.id);
    out.push(tableDdl(doc, t));
  };
  for (const t of tables) add(t, new Set());
  return `${out.join("\n\n")}\n`;
}

/** The endpoint a request is for, by method and a path with its {params} filled in. */
export function matchEndpoint(doc: Doc, method: string, path: string): Endpoint | undefined {
  const parts = path.split("/").filter(Boolean);
  return Object.values(doc.endpoints).find((e) => {
    if (e.method !== method.toUpperCase()) return false;
    const want = e.path.split("/").filter(Boolean);
    return want.length === parts.length && want.every((w, i) => /^\{[^}]+\}$/.test(w) || w === parts[i]);
  });
}

/** What the mock answers: an example of the return type, with any field the call sent echoed back. */
export function mockOperation(doc: Doc, o: Operation, input: Record<string, unknown>): Json {
  return echoInto(example(doc, o.returns, o.name), input);
}

/**
 * A GraphQL request answered by the mock: the operation is the first field the query asks for, its answer the
 * operation's return type, echoing the variables. One field per request; subscriptions aren't served.
 */
export function mockGraphql(doc: Doc, body: unknown): { data?: Record<string, unknown>; errors?: { message: string }[] } {
  const b: Record<string, unknown> = typeof body === "object" && body !== null ? { ...body } : {};
  const query = typeof b.query === "string" ? b.query.replace(/#[^\n]*/g, "") : "";
  const m = query.match(/^\s*(query|mutation|subscription)?\s*\w*\s*(\([^)]*\))?\s*\{\s*(\w+)/);
  if (!m) return { errors: [{ message: "No query to answer" }] };
  const kind = m[1] ?? "query";
  const name = m[3] ?? "";
  if (kind === "subscription") return { errors: [{ message: "The mock doesn't stream subscriptions" }] };
  const o = Object.values(doc.operations).find((x) => x.kind === kind && x.name === name);
  if (!o) return { errors: [{ message: `No ${kind} ${name} in this design` }] };
  const vars: Record<string, unknown> = typeof b.variables === "object" && b.variables !== null ? { ...b.variables } : {};
  return { data: { [name]: mockOperation(doc, o, vars) } };
}
