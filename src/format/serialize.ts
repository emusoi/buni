import type { Doc } from "./doc.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function sortKeys(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const out: { [key: string]: JsonValue } = {};
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, v] of entries) {
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new TypeError(`cannot serialize ${typeof value}`);
}

/**
 * Canonical text of a .buni file: keys sorted at every level, two-space indent,
 * trailing newline. The same document always produces the same bytes, so git
 * diffs show only what changed.
 */
export function serializeDoc(doc: Doc): string {
  return `${JSON.stringify(sortKeys(doc), null, 2)}\n`;
}
