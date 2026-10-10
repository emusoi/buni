import type { Doc, Page } from "buni/format/doc.ts";

export type PageItem = { kind: "page"; page: Page } | { kind: "group"; key: string; name: string; pages: Page[] };

/**
 * Pages with the same first route segment gather into a group ("/settings/billing" and
 * "/settings/team" under "settings") once there are at least two of them; others stay loose.
 * Keeps the sidebar short when a file has dozens of pages. Graphics (pages without a route)
 * always gather under "Graphics", apart from the site; terminal screens gather under their client.
 */
export function groupPages(pages: readonly Page[], parts: Doc["parts"] = {}): PageItem[] {
  const GRAPHICS = "\0graphics";
  const TERMINAL = "\0terminal:";
  const segment = (p: Page) => {
    if (p.terminal) return `${TERMINAL}${p.client ?? ""}`;
    if (p.route === undefined) return GRAPHICS;
    const parts = p.route.split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : undefined;
  };
  const counts = new Map<string, number>();
  for (const p of pages) {
    const s = segment(p);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const out: PageItem[] = [];
  const groups = new Map<string, Extract<PageItem, { kind: "group" }>>();
  for (const p of pages) {
    const s = segment(p);
    if (!s || (s !== GRAPHICS && !s.startsWith(TERMINAL) && (counts.get(s) ?? 0) < 2)) {
      out.push({ kind: "page", page: p });
      continue;
    }
    let g = groups.get(s);
    if (!g) {
      const client = s.startsWith(TERMINAL) ? s.slice(TERMINAL.length) : undefined;
      g = client !== undefined
        ? { kind: "group", key: `terminal:${client}`, name: parts[client]?.name ?? "Terminal", pages: [] }
        : s === GRAPHICS ? { kind: "group", key: "graphics", name: "Graphics", pages: [] } : { kind: "group", key: `/${s}`, name: s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "), pages: [] };
      groups.set(s, g);
      out.push(g);
    }
    g.pages.push(p);
  }
  return out;
}

/** Visible fixed-height page rows with six extra rows for scrolling and keyboard focus. */
export function pageWindow(count: number, top: number, height: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(count - 1, Math.floor(top / 28) - 6));
  return { start, end: Math.min(count, Math.max(start + 1, Math.ceil((top + height) / 28) + 6)) };
}
