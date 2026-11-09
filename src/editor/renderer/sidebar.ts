import type { Page } from "buni/format/doc.ts";

export type PageItem = { kind: "page"; page: Page } | { kind: "group"; key: string; name: string; pages: Page[] };

/**
 * Pages with the same first route segment gather into a group ("/settings/billing" and
 * "/settings/team" under "settings") once there are at least two of them; others stay loose.
 * Keeps the sidebar short when a file has dozens of pages. Graphics (pages without a route)
 * always gather under "Graphics", apart from the site; terminal screens gather under "Terminal".
 */
/** A flow as the sidebar lists it: its name and its pages in walking order. */
export interface FlowGroup {
  id: string;
  name: string;
  pages: readonly string[];
}

/**
 * With flows, the list reads like the product: each flow's pages under its name, in the order a person walks them,
 * then the pages in no flow, then graphics. A screen's states fold into it (its row says how many), and a take sits
 * under its page. Without flows, pages group by route as before.
 */
export function groupPages(all: readonly Page[], flows: readonly FlowGroup[] = []): PageItem[] {
  // A state shows under its screen (the inspector lists them), not as a row of its own, when the screen is listed.
  const screens = new Set(all.filter((p) => p.state === undefined && p.route !== undefined).map((p) => p.route));
  const pages = all.filter((p) => p.state === undefined || !screens.has(p.route));
  if (!flows.length) return byRoute(pages);
  const takes = new Map<string, Page[]>();
  for (const p of pages) if (p.option && pages.some((q) => q.id === p.option?.of)) takes.set(p.option.of, [...(takes.get(p.option.of) ?? []), p]);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const out: PageItem[] = [];
  for (const f of flows) {
    const mine = f.pages.flatMap((id) => {
      const p = byId.get(id);
      if (!p || placed.has(id)) return [];
      placed.add(id);
      for (const t of takes.get(id) ?? []) placed.add(t.id);
      return [p, ...(takes.get(id) ?? [])];
    });
    if (mine.length) out.push({ kind: "group", key: `flow:${f.id}`, name: f.name, pages: mine });
  }
  const rest = pages.filter((p) => !placed.has(p.id));
  const site = rest.filter((p) => p.route !== undefined || (p.option && !p.terminal));
  const loose = byRoute(site).flatMap((i) => (i.kind === "page" ? [i.page] : i.pages));
  if (loose.length) out.push({ kind: "group", key: "no-flow", name: "Not in a flow", pages: loose });
  out.push(...byRoute(rest.filter((p) => !site.includes(p))));
  return out;
}

function byRoute(pages: readonly Page[]): PageItem[] {
  const GRAPHICS = "\0graphics";
  const TERMINAL = "\0terminal";
  const segment = (p: Page) => {
    if (p.terminal) return TERMINAL;
    if (p.route === undefined) return GRAPHICS;
    const parts = p.route.split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : undefined;
  };
  const counts = new Map<string, number>();
  for (const p of pages) {
    if (p.option) continue;
    const s = segment(p);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const out: PageItem[] = [];
  const groups = new Map<string, Extract<PageItem, { kind: "group" }>>();
  // A take sits right under its page, wherever that page is listed, never among the graphics.
  const takes = new Map<string, Page[]>();
  for (const p of pages) if (p.option && pages.some((q) => q.id === p.option?.of)) takes.set(p.option.of, [...(takes.get(p.option.of) ?? []), p]);
  const under = (p: Page) => takes.get(p.id) ?? [];
  for (const p of pages) {
    if (p.option && takes.get(p.option.of)?.includes(p)) continue;
    const s = segment(p);
    if (!s || (s !== GRAPHICS && s !== TERMINAL && (counts.get(s) ?? 0) < 2)) {
      out.push({ kind: "page", page: p }, ...under(p).map((t): PageItem => ({ kind: "page", page: t })));
      continue;
    }
    let g = groups.get(s);
    if (!g) {
      g = s === TERMINAL
        ? { kind: "group", key: "terminal", name: "Terminal", pages: [] }
        : s === GRAPHICS ? { kind: "group", key: "graphics", name: "Graphics", pages: [] } : { kind: "group", key: `/${s}`, name: s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "), pages: [] };
      groups.set(s, g);
      out.push(g);
    }
    g.pages.push(p, ...under(p));
  }
  return out;
}

/** Visible fixed-height page rows with six extra rows for scrolling and keyboard focus. */
export function pageWindow(count: number, top: number, height: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(count - 1, Math.floor(top / 28) - 6));
  return { start, end: Math.min(count, Math.max(start + 1, Math.ceil((top + height) / 28) + 6)) };
}
