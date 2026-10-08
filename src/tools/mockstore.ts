// A mock API that remembers: writes change what later reads return, the way a REST API would, read from the
// endpoint paths alone. GET /plants lists what is stored (seeded from the design's example), POST /plants adds,
// GET / PUT / PATCH / DELETE /plants/{id} read, change and remove one, POST /plants/{id}/logs adds to that plant's
// own list, and an action such as PUT /plants/{id}/snooze writes its fields onto the plant. Business rules (a
// watering moving the next check) live in no path, so they aren't simulated.
import type { Doc, Endpoint } from "../format/doc.ts";
import { echoInto, exampleBody, type Json } from "./backend.ts";

type Obj = { [key: string]: Json };
const isObj = (v: Json | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const param = (seg: string) => /^\{.+\}$/.test(seg);

/** What a call sent, as JSON values: anything else (undefined, functions) is left out. */
function toJson(v: unknown): Json | undefined {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.flatMap((x) => { const j = toJson(x); return j === undefined ? [] : [j]; });
  if (typeof v !== "object") return undefined;
  return Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const j = toJson(x); return j === undefined ? [] : [[k, j]]; }));
}

/** The endpoint's path with its parameters filled in from what the call sent, as segments. */
function concrete(e: Endpoint, sent: Record<string, unknown>): string[] {
  return e.path.split("/").filter(Boolean).map((seg) => (param(seg) ? String(sent[seg.slice(1, -1)] ?? seg) : seg));
}

/** Where an answer keeps its list: the first array, top level first (items: Plant[]), or the answer itself. */
function listIn(v: Json): { get: () => Json[]; set: (list: Json[]) => Json } | undefined {
  if (Array.isArray(v)) return { get: () => v, set: (list) => list };
  if (!isObj(v)) return undefined;
  const key = Object.keys(v).find((k) => Array.isArray(v[k]));
  if (key === undefined) return undefined;
  return { get: () => (Array.isArray(v[key]) ? v[key] : []), set: (list) => ({ ...v, [key]: list }) };
}

/** The record an answer is about: itself when it has an id, else its first field that has one ({log, plant} → log). */
function recordIn(v: Json): { get: () => Obj; set: (r: Obj) => Json } | undefined {
  if (!isObj(v)) return undefined;
  if ("id" in v) return { get: () => v, set: (r) => r };
  const key = Object.keys(v).find((k) => { const x = v[k]; return isObj(x) && "id" in x; });
  if (key === undefined) return undefined;
  return { get: () => { const x = v[key]; return isObj(x) ? x : {}; }, set: (r) => ({ ...v, [key]: r }) };
}

const newId = () => crypto.randomUUID();

export class MockStore {
  /** Each list by its path ("plants", "plants/a1/watering-logs"). */
  private lists = new Map<string, Obj[]>();
  /** Each single record by its path ("me"): a path whose GET answers one object, not a list. */
  private records = new Map<string, Obj>();

  /** Clears everything: the next read starts again from the design's examples. */
  reset(): void {
    this.lists.clear();
    this.records.clear();
  }

  private list(doc: Doc, key: string): Obj[] {
    const had = this.lists.get(key);
    if (had) return had;
    // Seeded from the example answer of the GET that lists this path, when the design has one.
    const lister = Object.values(doc.endpoints).find((e) => e.method === "GET" && e.path.split("/").filter(Boolean).every((seg, i) => param(seg) || seg === key.split("/")[i]) && e.path.split("/").filter(Boolean).length === key.split("/").length);
    const seed = lister ? listIn(exampleBody(doc, lister, "response"))?.get() ?? [] : [];
    const list = seed.filter(isObj).map((r) => ({ ...r }));
    this.lists.set(key, list);
    return list;
  }

  /** What the endpoint answers to this call, after what the call changes. */
  answer(doc: Doc, e: Endpoint, sent: Record<string, unknown>): Json {
    const example = echoInto(exampleBody(doc, e, "response"), sent);
    const segs = concrete(e, sent);
    const last = e.path.split("/").filter(Boolean).at(-1) ?? "";
    // The call's own fields, path parameters taken out.
    const sentJson = toJson(Object.fromEntries(Object.entries(sent).filter(([k]) => !e.path.includes(`{${k}}`))));
    const body: Obj = isObj(sentJson) ? sentJson : {};
    // /me: one record, when the path's GET answers an object with no list in it.
    const getter = Object.values(doc.endpoints).find((x) => x.method === "GET" && x.path === e.path);
    const read = getter ? exampleBody(doc, getter, "response") : undefined;
    if (!param(last) && read !== undefined && !listIn(read)) {
      const key = segs.join("/");
      if (e.method === "DELETE") {
        this.records.delete(key);
        return example;
      }
      const rec = this.records.get(key) ?? { ...read };
      if (e.method !== "GET") Object.assign(rec, body);
      this.records.set(key, rec);
      return isObj(example) ? { ...example, ...rec } : rec;
    }
    // /plants or /plants/{id}/watering-logs: a list.
    if (!param(last)) {
      const key = segs.join("/");
      const parentKey = segs.slice(0, -2).join("/");
      const parentId = segs.at(-2);
      const isAction = segs.length >= 2 && param(e.path.split("/").filter(Boolean).at(-2) ?? "") && !this.listed(doc, e);
      // PUT /plants/{id}/snooze: an action on the record it names.
      if (isAction && e.method !== "GET" && parentId !== undefined) {
        const rec = this.list(doc, parentKey).find((r) => String(r.id) === parentId);
        if (rec) Object.assign(rec, body);
        const r = recordIn(example);
        return rec && r ? r.set({ ...r.get(), ...rec }) : example;
      }
      const list = this.list(doc, key);
      if (e.method === "GET") return listIn(example)?.set(list) ?? list;
      if (e.method === "POST") {
        const r = recordIn(example);
        const made: Obj = { ...(r?.get() ?? {}), ...body, id: newId() };
        list.push(made);
        return r ? r.set(made) : made;
      }
      return example;
    }
    // /plants/{id}: one record.
    const key = segs.slice(0, -1).join("/");
    const id = segs.at(-1) ?? "";
    const list = this.list(doc, key);
    const at = list.findIndex((r) => String(r.id) === id);
    const r = recordIn(example);
    if (e.method === "DELETE") {
      if (at >= 0) list.splice(at, 1);
      return example;
    }
    const rec = list[at];
    if (!rec) return example;
    if (e.method === "PUT" || e.method === "PATCH") Object.assign(rec, body);
    return r ? r.set({ ...r.get(), ...rec }) : rec;
  }

  /** Whether a GET lists this endpoint's path, i.e. it names a list rather than an action. */
  private listed(doc: Doc, e: Endpoint): boolean {
    return Object.values(doc.endpoints).some((x) => x.method === "GET" && x.path === e.path);
  }
}
