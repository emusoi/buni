// What a page connects to across the file: the screens side and the system side, for the panel that opens with it.
import { walkFlow, type Doc, type Flow, type Id, type Page, type Part, type Requirement } from "buni/format/doc.ts";
import { callOf, type Call } from "buni/tools/calls.ts";

export interface PageSummary {
  page: Page;
  /** The client part the page is a screen of. */
  client: Part | undefined;
  /** Flows that walk through it. */
  flows: Flow[];
  /** Pages it links to, and pages that link to it. */
  out: Page[];
  in: Page[];
  /** Endpoints and operations it calls: from its links, and from layers that show live data. */
  calls: Call[];
  /** The services behind those calls. */
  parts: Part[];
  /** Requirements it serves: named directly, through a flow it is in, or through a call it makes. */
  requirements: Requirement[];
}

function unique<T extends { id: Id }>(xs: readonly (T | undefined)[]): T[] {
  const seen = new Map<Id, T>();
  for (const x of xs) if (x && !seen.has(x.id)) seen.set(x.id, x);
  return [...seen.values()];
}

/** The page's root frame and everything under it. */
function onPage(doc: Doc, page: Page): Set<Id> {
  const ids = new Set<Id>();
  for (const n of Object.values(doc.nodes)) {
    let at: Id | undefined = n.id;
    while (at && at !== page.frame) at = doc.nodes[at]?.parent;
    if (at === page.frame) ids.add(n.id);
  }
  return ids;
}

export function pageSummary(doc: Doc, id: Id): PageSummary | undefined {
  const page = doc.pages[id];
  if (!page) return undefined;
  const links = Object.values(doc.connections);
  const flows = Object.values(doc.flows)
    .sort((a, b) => (a.index < b.index ? -1 : 1))
    .filter((f) => walkFlow(doc, f.start).pages.includes(id));
  const nodes = onPage(doc, page);
  const callIds = [
    ...links.filter((c) => c.page === id && c.endpoint).map((c) => c.endpoint ?? ""),
    ...[...nodes].flatMap((n) => {
      const bind = doc.nodes[n]?.bind;
      return bind ? [bind.endpoint] : [];
    }),
  ];
  const calls = unique(callIds.map((c) => callOf(doc, c)).map((c) => c && { id: c.value.id, call: c })).map((x) => x.call);
  const serving = new Set<Id>([id, ...flows.map((f) => f.id), ...calls.map((c) => c.value.id)]);
  return {
    page,
    client: page.client === undefined ? undefined : doc.parts[page.client],
    flows,
    out: unique(links.filter((c) => c.page === id && c.to !== id).map((c) => doc.pages[c.to])),
    in: unique(links.filter((c) => c.to === id && c.page !== id).map((c) => doc.pages[c.page])),
    calls,
    parts: unique(calls.map((c) => doc.parts[c.value.service])),
    requirements: Object.values(doc.requirements).filter((r) => r.servedBy.some((s) => serving.has(s))),
  };
}
