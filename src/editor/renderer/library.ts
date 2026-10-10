import type { Doc, Id } from "buni/format/doc.ts";

export interface LibraryItem {
  id: Id;
  /** Name without its group, e.g. "Primary" for "Buttons / Primary". */
  name: string;
  full: string;
  group: string | undefined;
  uses: number;
  /** Pages it is placed on. */
  pages: Set<Id>;
}

export type LibraryFilter = "all" | "here" | "unused";

/** Every component with its group (from a "Group / Name" name), use count and pages. */
export function libraryItems(doc: Doc): LibraryItem[] {
  const pageOfRoot = new Map(Object.values(doc.pages).map((p) => [p.frame, p.id]));
  const pageOf = (id: Id): Id | undefined => {
    let n = doc.nodes[id];
    while (n?.parent !== undefined) n = doc.nodes[n.parent];
    return n ? pageOfRoot.get(n.id) : undefined;
  };
  const byShared = new Map<Id, Id[]>();
  for (const n of Object.values(doc.nodes)) if (n.kind === "instance") byShared.set(n.shared, [...(byShared.get(n.shared) ?? []), n.id]);
  return Object.values(doc.shared)
    .map((s) => {
      const cut = s.name.lastIndexOf("/");
      const instances = byShared.get(s.id) ?? [];
      return {
        id: s.id,
        name: cut < 0 ? s.name : s.name.slice(cut + 1).trim(),
        full: s.name,
        group: cut < 0 ? undefined : s.name.slice(0, cut).trim(),
        uses: instances.length,
        pages: new Set(instances.flatMap((i) => pageOf(i) ?? [])),
      };
    })
    .sort((a, b) => (a.full < b.full ? -1 : 1));
}

/** Items matching a query and filter, gathered by group; ungrouped ones come last as "Unsorted" once any group exists. */
export function libraryGroups(items: readonly LibraryItem[], query: string, filter: LibraryFilter, page: Id | undefined): { name: string; items: LibraryItem[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter(
    (i) => words.every((w) => i.full.toLowerCase().includes(w)) && (filter === "all" || (filter === "here" ? page !== undefined && i.pages.has(page) : i.uses === 0)),
  );
  const grouped = items.some((i) => i.group);
  const out = new Map<string, LibraryItem[]>();
  for (const i of shown) {
    const g = i.group ?? (grouped ? "Unsorted" : "Components");
    out.set(g, [...(out.get(g) ?? []), i]);
  }
  return [...out].map(([name, list]) => ({ name, items: list })).sort((a, b) => (a.name === "Unsorted" ? 1 : b.name === "Unsorted" ? -1 : a.name < b.name ? -1 : 1));
}
