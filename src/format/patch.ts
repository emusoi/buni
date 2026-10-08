import { emptyDoc, type Doc } from "./doc.ts";

/** The fields of a document that hold entries by key: tokens and every collection. */
type BagKey = Exclude<keyof Doc, "buni" | "imports" | "tokensRef">;
/** A document seen as its bags of entries, whatever each entry is. */
type Bags = Record<BagKey, Record<string, unknown>>;

const BAGS = Object.keys(emptyDoc()).filter((k): k is BagKey => k !== "buni");

/**
 * How one version of a document differs from an earlier one, entry by entry. Versions share every
 * collection and entry that didn't change (documents are never edited in place), so working this
 * out compares by identity and costs little beyond the collections that did change.
 */
export interface DocPatch {
  head: Pick<Doc, "buni" | "imports" | "tokensRef">;
  /** Per field: entries added or replaced (as the newer document has them), and keys removed. */
  bags: Partial<Record<BagKey, { put: Record<string, unknown>; removed: string[] }>>;
}

export function diffDoc(prev: Doc, next: Doc): DocPatch {
  const a: Bags = prev;
  const b: Bags = next;
  const bags: DocPatch["bags"] = {};
  for (const k of BAGS) {
    if (a[k] === b[k]) continue;
    const put: Record<string, unknown> = {};
    for (const [id, v] of Object.entries(b[k])) if (a[k][id] !== v) put[id] = v;
    const removed = Object.keys(a[k]).filter((id) => !(id in b[k]));
    if (removed.length > 0 || Object.keys(put).length > 0) bags[k] = { put, removed };
  }
  const { buni, imports, tokensRef } = next;
  return { head: { buni, ...(imports ? { imports } : {}), ...(tokensRef !== undefined ? { tokensRef } : {}) }, bags };
}

/** `doc` with `patch` applied; what didn't change is shared with `doc`. */
export function applyPatch(doc: Doc, patch: DocPatch): Doc {
  const { imports: _i, tokensRef: _t, ...rest } = doc;
  const out: Doc = { ...rest, ...patch.head };
  const bags: Bags = out;
  for (const k of BAGS) {
    const p = patch.bags[k];
    if (!p) continue;
    const next = { ...bags[k], ...p.put };
    for (const id of p.removed) delete next[id];
    bags[k] = next;
  }
  return out;
}
