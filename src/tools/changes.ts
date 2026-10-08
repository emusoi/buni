// What changed in the system design between two versions of a file, for review.
import type { Doc, Id } from "../format/doc.ts";

const COLLECTIONS = ["parts", "links", "endpoints", "operations", "tables", "events", "shapes", "traces", "environments", "clusters", "placements", "phases", "requirements", "questions", "roles"] as const;
export type ChangedCollection = (typeof COLLECTIONS)[number];
export interface Change { collection: ChangedCollection; id: Id; name: string; what: "added" | "changed" | "removed" }

/** Key-sorted JSON, without canvas positions: moving a card is not a design change. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => k !== "x" && k !== "y" && k !== "index").sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function nameOf(v: unknown, id: Id): string {
  const o = v as { name?: unknown; title?: unknown; text?: unknown; method?: unknown; path?: unknown; kind?: unknown; from?: unknown; to?: unknown };
  if (typeof o.method === "string" && typeof o.path === "string") return `${o.method} ${o.path}`;
  if (typeof o.kind === "string" && typeof o.name === "string" && ["query", "mutation", "subscription"].includes(o.kind)) return `${o.kind} ${o.name}`;
  for (const k of [o.name, o.title, o.text]) if (typeof k === "string") return k;
  if (typeof o.from === "string" && typeof o.to === "string") return `${o.from} ${String(o.kind)} ${o.to}`;
  return id;
}

export function systemChanges(before: Doc, after: Doc): Change[] {
  const out: Change[] = [];
  for (const c of COLLECTIONS) {
    const a: Record<Id, unknown> = before[c];
    const b: Record<Id, unknown> = after[c];
    for (const [id, v] of Object.entries(b)) {
      if (!(id in a)) out.push({ collection: c, id, name: nameOf(v, id), what: "added" });
      else if (canonical(a[id]) !== canonical(v)) out.push({ collection: c, id, name: nameOf(v, id), what: "changed" });
    }
    for (const [id, v] of Object.entries(a)) if (!(id in b)) out.push({ collection: c, id, name: nameOf(v, id), what: "removed" });
  }
  return out;
}
