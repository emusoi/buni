// Splitting a big system across files: move one part, with what it owns, into a file of its own.
import { bodyTypes, emptyDoc, type Doc, type Field, type Id, type Shape } from "../format/doc.ts";

/**
 * `doc` minus `part` and what it owns (its endpoints or operations, tables, events, outgoing links,
 * placements and the shapes those use), and a new document holding exactly that. The two import
 * each other, so every reference still resolves; `restPath` and `movedPath` are how each names the other.
 */
export function splitPart(doc: Doc, part: Id, restPath: string, movedPath: string): { rest: Doc; moved: Doc } | string {
  const p = doc.parts[part];
  if (!p) return `part "${part}" does not exist`;
  const rest: Doc = structuredClone(doc);
  const moved: Doc = emptyDoc();
  const take = <C extends "parts" | "links" | "tables" | "endpoints" | "operations" | "events" | "shapes" | "placements">(c: C, ids: Id[]) => {
    for (const id of ids) {
      const v = rest[c][id];
      if (!v) continue;
      (moved[c] as Record<Id, typeof v>)[id] = v;
      delete rest[c][id];
    }
  };
  const endpoints = Object.values(doc.endpoints).filter((e) => e.service === part);
  const operations = Object.values(doc.operations).filter((o) => o.service === part);
  const events = Object.values(doc.events).filter((e) => e.queue === part);
  take("parts", [part]);
  take("endpoints", endpoints.map((e) => e.id));
  take("operations", operations.map((o) => o.id));
  take("tables", Object.values(doc.tables).filter((t) => t.store === part).map((t) => t.id));
  take("events", events.map((e) => e.id));
  take("links", Object.values(doc.links).filter((l) => l.from === part).map((l) => l.id));
  take("placements", Object.values(doc.placements).filter((pl) => pl.part === part).map((pl) => pl.id));
  // The shapes its contracts use, and the shapes those use, travel with it; the rest of the system still sees them through the import.
  const byName = new Map(Object.values(doc.shapes).map((s) => [s.name, s]));
  const shapes = new Map<Id, Shape>();
  const visit = (type: string) => {
    const s = byName.get(type.replace(/\[\]$/, ""));
    if (!s || shapes.has(s.id)) return;
    shapes.set(s.id, s);
    for (const f of s.fields) visit(f.type);
  };
  const fields: Field[] = [
    ...endpoints.flatMap((e) => [...bodyTypes(doc, e, "request"), ...bodyTypes(doc, e, "response")]),
    ...operations.flatMap((o) => [...o.args, { name: o.name, type: o.returns }]),
    ...events.flatMap((e) => e.payload),
  ];
  for (const f of fields) visit(f.type);
  take("shapes", [...shapes.keys()]);
  // Canvas positions follow what moved.
  const movedIds = new Set([...Object.keys(moved.parts), ...Object.keys(moved.endpoints), ...Object.keys(moved.operations), ...Object.keys(moved.tables), ...Object.keys(moved.shapes)]);
  for (const [key, pos] of Object.entries(doc.positions)) {
    if (movedIds.has(key.slice(key.indexOf(":") + 1))) {
      moved.positions[key] = pos;
      delete rest.positions[key];
    }
  }
  rest.imports = [...new Set([...(doc.imports ?? []), movedPath])];
  moved.imports = [restPath];
  return { rest, moved };
}
