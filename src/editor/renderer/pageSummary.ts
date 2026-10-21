// What a page connects to across the file: the flows it is in and the pages it links with, for the panel that opens with it.
import { walkFlow, type Doc, type Flow, type Id, type Page } from "buni/format/doc.ts";

export interface PageSummary {
  page: Page;
  /** Flows that walk through it. */
  flows: Flow[];
  /** Pages it links to, and pages that link to it. */
  out: Page[];
  in: Page[];
  /** Pages of other files it links to. */
  away: NonNullable<Doc["elsewhere"]>[Id][];
}

function unique<T extends { id: Id }>(xs: readonly (T | undefined)[]): T[] {
  const seen = new Map<Id, T>();
  for (const x of xs) if (x && !seen.has(x.id)) seen.set(x.id, x);
  return [...seen.values()];
}

export function pageSummary(doc: Doc, id: Id): PageSummary | undefined {
  const page = doc.pages[id];
  if (!page) return undefined;
  const links = Object.values(doc.connections);
  const flows = Object.values(doc.flows)
    .sort((a, b) => (a.index < b.index ? -1 : 1))
    .filter((f) => walkFlow(doc, f.start).pages.includes(id));
  return {
    page,
    flows,
    out: unique(links.filter((c) => c.page === id && c.to !== id).map((c) => doc.pages[c.to])),
    away: unique(links.filter((c) => c.page === id && !doc.pages[c.to]).map((c) => doc.elsewhere?.[c.to])),
    in: unique(links.filter((c) => c.to === id && c.page !== id).map((c) => doc.pages[c.page])),
  };
}
