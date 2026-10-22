// Where the API view puts things: callers, then GraphQL parts, then REST parts, each column stacked. Pure (no React), so
// the tablet's API (server.ts) lays it out exactly as the editor draws it.
import { GRAPHQL_TYPES, type Architecture, type Id, type Operation, type Part } from "buni/format/doc.ts";

export const ROW = 30, HEAD = 52, SECTION = 26, CALLER_W = 176, GAP = 64;
const COL = { graphql: 360, rest: 376 } as const;
export interface ApiRow { op: Operation; y: number }
export interface ApiCard { part: Part; x: number; y: number; w: number; h: number; rows: ApiRow[]; sections: { label: string; y: number }[]; add: number }
export interface ApiLayout { callers: { part: Part; x: number; y: number; to: Id[] }[]; cards: ApiCard[]; width: number; height: number }

/** Where everything sits: callers, then GraphQL parts, then REST parts, each column stacked. Pure, for tests. */
export function apiLayout(arch: Architecture): ApiLayout {
  const parts = Object.values(arch.parts).filter((p) => p.api).sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(parts.map((p) => p.id));
  const callers = Object.values(arch.parts).filter((p) => !ids.has(p.id) && Object.values(arch.links).some((l) => l.from === p.id && ids.has(l.to) && l.kind === "calls"))
    .sort((a, b) => a.name.localeCompare(b.name));
  let x = 24 + (callers.length ? CALLER_W + GAP : 0);
  const cards: ApiCard[] = [];
  for (const kind of ["graphql", "rest"] as const) {
    const here = parts.filter((p) => p.api!.kind === kind);
    if (!here.length) continue;
    let y = 48;
    for (const part of here) {
      const rows: ApiRow[] = [];
      const sections: { label: string; y: number }[] = [];
      let at = y + HEAD;
      const groups = kind === "rest" ? [["Operations", part.api!.operations] as const]
        : GRAPHQL_TYPES.map((t) => [`${t[0]!.toUpperCase()}${t.slice(1)}`, part.api!.operations.filter((o) => (o.type ?? "query") === t)] as const).filter(([, ops]) => ops.length);
      for (const [label, ops] of groups) {
        sections.push({ label, y: at });
        at += SECTION;
        for (const op of ops) { rows.push({ op, y: at }); at += ROW; }
      }
      cards.push({ part, x, y, w: COL[kind], h: at + ROW - y, rows, sections, add: at });
      y = at + ROW + 48;
    }
    x += COL[kind] + GAP;
  }
  const callerBoxes = callers.map((part, i) => ({ part, x: 24, y: 72 + i * 100, to: Object.values(arch.links).filter((l) => l.from === part.id && ids.has(l.to) && l.kind === "calls").map((l) => l.to) }));
  const bottom = Math.max(0, ...cards.map((c) => c.y + c.h), ...callerBoxes.map((c) => c.y + 80));
  return { callers: callerBoxes, cards, width: x, height: bottom + 64 };
}

