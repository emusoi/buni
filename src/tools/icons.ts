import { icons } from "lucide";

/** Lucide icons by a forgiving key: "arrow-up", "ArrowUp" and "arrowup" all match. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const byKey = new Map(Object.entries(icons).map(([name, node]) => [key(name), { name: kebab(name), node }]));

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** A Lucide icon as SVG markup that takes its colour from CSS `color`; undefined for an unknown name. */
export function iconSvg(name: string, size = 16, strokeWidth = 2): string | undefined {
  const icon = byKey.get(key(name));
  if (!icon) return undefined;
  const parts = icon.node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(String(v))}"`).join(" ")}/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</svg>`;
}

/** Icon names containing every word of the query, shortest first. */
export function findIcons(query: string, limit = 30): string[] {
  const words = query.toLowerCase().split(/[\s,-]+/).filter(Boolean).map(key);
  return [...byKey.entries()]
    .filter(([k]) => words.every((w) => k.includes(w)))
    .map(([, v]) => v.name)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
    .slice(0, limit);
}
