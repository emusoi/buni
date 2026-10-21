import { emptyDoc, type Doc } from "./doc.ts";

/** The fields of a document that hold entries by key: tokens and every collection. */
type BagKey = Exclude<keyof Doc, "buni" | "imports" | "tokensRef">;
/**
 * A document seen as its bags of entries, whatever each entry is; `elsewhere` only on a document with its imports.
 * The architecture is one bag whose entries are its collections.
 */
type Bags = Partial<Record<BagKey, Record<string, unknown>>>;

const BAGS: BagKey[] = [...Object.keys(emptyDoc()).filter((k): k is BagKey => k !== "buni"), "elsewhere", "architecture"];
const NONE: Record<string, unknown> = {};

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
    const was = a[k] ?? NONE, now = b[k] ?? NONE;
    const put: Record<string, unknown> = {};
    for (const [id, v] of Object.entries(now)) if (was[id] !== v) put[id] = v;
    const removed = Object.keys(was).filter((id) => !(id in now));
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
    const next = { ...(bags[k] ?? NONE), ...p.put };
    for (const id of p.removed) delete next[id];
    // An architecture with every collection gone is none at all.
    if (k === "architecture" && Object.keys(next).length === 0) delete bags[k];
    else bags[k] = next;
  }
  return out;
}

/**
 * `next` sharing `prev`'s objects wherever an entry is the same: a design fetched again (after switching back to it)
 * keeps the identity of everything that didn't change, so what is drawn from it isn't drawn again.
 */
export function sharing(prev: Doc, next: Doc): Doc {
  const a: Bags = prev;
  const out: Doc = { ...next };
  const b: Bags = out;
  for (const k of BAGS) {
    const was = a[k], now = b[k];
    if (!was || !now) continue;
    let same = Object.keys(was).length === Object.keys(now).length;
    const kept: Record<string, unknown> = {};
    for (const [id, v] of Object.entries(now)) {
      const old = was[id];
      const keep = old !== undefined && JSON.stringify(old) === JSON.stringify(v);
      kept[id] = keep ? old : v;
      if (!keep) same = false;
    }
    b[k] = same ? was : kept;
  }
  return out;
}
