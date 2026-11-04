// A page's versions: points in time, each the page's layers as they were. Saved by the person, or by an agent at the
// start of a stretch of work; looked at, restored as one edit, or branched into a take.
import { z } from "zod";
import { generateKeyBetween } from "fractional-indexing";
import { Ids, ToolError, page, subtree, tool, type Tool, type ToolContext } from "../kit.ts";
import { pageVersionsOf, pagesInOrder, type Doc, type Id, type PageVersion } from "../../format/doc.ts";
import type { Op } from "../../oplog/oplog.ts";

/** The op that keeps `pageId` of `doc` as its next version; `doc` may be an earlier state than the one being edited. */
export function versionOp(doc: Doc, live: Doc, pageId: Id, by: string, now: string, note: string | undefined, ids: Ids): Op {
  const p = page(doc, pageId);
  const nodes = Object.fromEntries(subtree(doc, p.frame).map((n) => [n.id, structuredClone(n)]));
  const n = (pageVersionsOf(live, pageId).at(-1)?.n ?? 0) + 1;
  return { kind: "put", collection: "versions", value: { id: ids.next(), page: pageId, n, at: now, by, ...(note ? { note } : {}), nodes } };
}

const one = (doc: Doc, id: string): PageVersion => {
  const v = doc.versions[id];
  if (!v) throw new ToolError(`version "${id}" does not exist; versions lists a page's`);
  return v;
};
const line = (v: PageVersion) => `${v.id} v${v.n} · ${v.by} · ${v.at.slice(0, 16).replace("T", " ")}${v.note ? ` · ${v.note}` : ""} · ${Object.keys(v.nodes).length} layers`;

/** The page's layers become the version's: those gone come back, those added since go, the rest take the old values. */
function restoreOps(doc: Doc, v: PageVersion): Op[] {
  const p = page(doc, v.page);
  const now = new Set(subtree(doc, p.frame).map((n) => n.id));
  const ops: Op[] = [];
  for (const id of now) if (!v.nodes[id]) ops.push({ kind: "delete", collection: "nodes", id });
  for (const n of Object.values(v.nodes)) ops.push({ kind: "put", collection: "nodes", value: structuredClone(n) });
  return ops;
}

export const pageVersionsTools = {
  versions: tool({
    description: "A page's versions, oldest first: points in time saved by a person or at the start of an agent's work. restore_version puts one back; branch_version starts a take from one.",
    input: { page: z.string() },
    run: async (doc, a) => {
      const p = page(doc, a.page);
      const all = pageVersionsOf(doc, p.id);
      return { label: "Versions", ops: [], reply: all.length ? all.map(line).join("\n") : `${p.name} has no versions yet; save_version keeps the page as it is now.` };
    },
  }),
  save_version: tool({
    description: "Keep a page as it is now as its next version, with a note on what this point is (\"Headline shortened\"). Do it before a change worth coming back from; the editor saves one at the start of each stretch of your work on its own.",
    input: { page: z.string(), note: z.string().max(200).optional() },
    run: async (doc, a, ctx) => {
      const p = page(doc, a.page);
      const op = versionOp(doc, doc, p.id, ctx.author, ctx.now(), a.note?.trim(), new Ids(doc, ctx));
      const v = op.kind === "put" && op.collection === "versions" ? op.value : undefined;
      return { label: `Save v${v?.n ?? "?"} of ${p.name}`, ops: [op], reply: v ? `Saved v${v.n} of ${p.name} (${v.id}).` : "Saved." };
    },
  }),
  restore_version: tool({
    description: "Make a page its version again: the layers as they were then, as one edit (undo takes it back). The versions since stay.",
    input: { version: z.string() },
    run: async (doc, a) => {
      const v = one(doc, a.version);
      const p = page(doc, v.page);
      return { label: `Restore v${v.n} of ${p.name}`, ops: restoreOps(doc, v), reply: `${p.name} is v${v.n} again${v.note ? ` (${v.note})` : ""}.` };
    },
  }),
  branch_version: tool({
    description: "Start a take (an option of the page) from one of its versions: a copy of the page as it was then, to go another way from that point. name names the take.",
    input: { version: z.string(), name: z.string().min(1).max(120).optional() },
    run: async (doc, a, ctx) => {
      const v = one(doc, a.version);
      const p = page(doc, v.page);
      const live = p.option ? page(doc, p.option.of) : p;
      const ids = new Ids(doc, ctx);
      // The take's layers are the version's, with ids of their own, so it and the page go their own ways.
      const fresh = new Map(Object.keys(v.nodes).map((id) => [id, ids.next()]));
      const id = (old: Id) => fresh.get(old) ?? old;
      const ops: Op[] = Object.values(v.nodes).map((n) => {
        const { twin: _t, ...copy } = structuredClone(n);
        return { kind: "put", collection: "nodes", value: { ...copy, id: id(n.id), ...(n.parent !== undefined ? { parent: id(n.parent) } : {}) } };
      });
      const last = pagesInOrder(doc).at(-1)?.index ?? null;
      const { x: _x, y: _y, state: _s, route: _r, option: _o, picked: _p, live: _l, ...rest } = p;
      const name = a.name?.trim() || `${live.name} · from v${v.n}`;
      const pageId = ids.next();
      ops.push({ kind: "put", collection: "pages", value: { ...rest, id: pageId, name, frame: id(p.frame), index: generateKeyBetween(last, null), option: { of: live.id, idea: `From v${v.n}${v.note ? `: ${v.note}` : ""}` } } });
      return { label: `Branch a take from v${v.n}`, ops, reply: `${name} (${pageId}) is a take of ${live.name}, from v${v.n}. Pick it with pick_option when it wins.` };
    },
  }),
  delete_version: tool({
    description: "Forget a version. The others keep their numbers.",
    input: { version: z.string() },
    run: async (doc, a) => {
      const v = one(doc, a.version);
      return { label: `Forget v${v.n}`, ops: [{ kind: "delete", collection: "versions", id: v.id }], reply: `Forgot v${v.n}.` };
    },
  }),
} satisfies Record<string, Tool>;

/**
 * The pages whose layers differ between two states of the design, for keeping a version of each as it was before an
 * agent's stretch of work began.
 */
export function pagesChanged(before: Doc, after: Doc): Id[] {
  const changed = new Set<Id>();
  for (const p of Object.values(before.pages)) {
    if (!after.pages[p.id]) continue;
    const a = subtree(before, p.frame), b = after.nodes[p.frame] ? subtree(after, p.frame) : [];
    if (a.length !== b.length || a.some((n, i) => n !== b[i])) changed.add(p.id);
  }
  return [...changed];
}

export type { ToolContext };
