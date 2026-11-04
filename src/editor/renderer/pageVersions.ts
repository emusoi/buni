// A page as one of its versions had it: the design with that page's layers swapped for the version's, to draw it.
import { childrenOf, type Doc, type Id, type PageVersion } from "buni/format/doc.ts";

/** `doc` with `v`'s page drawn as it was then: the page's layers now are set aside, the version's take their place. */
export function docAtVersion(doc: Doc, v: PageVersion): Doc {
  const frame = doc.pages[v.page]?.frame;
  const gone = new Set<Id>();
  const walk = (id: Id) => { gone.add(id); for (const c of childrenOf(doc, id)) walk(c.id); };
  if (frame) walk(frame);
  const nodes = { ...Object.fromEntries(Object.entries(doc.nodes).filter(([id]) => !gone.has(id))), ...v.nodes };
  return { ...doc, nodes };
}
