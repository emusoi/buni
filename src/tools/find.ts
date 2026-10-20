// Finding layers by what they look like or say: a colour, a size, a token, a phrase. The same colour written two
// ways (#ccc, rgb(204, 204, 204)) is one colour, and a colour also finds the tokens set to it, so a sweep can turn
// every raw value into its token in one edit.
import type { Doc, Id, Node, Style } from "../format/doc.ts";

/** A style to match: a property (kebab or camel case, "*" wildcards) and a value (a literal, a token, "*" wildcards). */
export interface StyleQuery { prop?: string; value?: string }
export interface Match { node: Id; matched: string[] }

const NAMED: Record<string, string> = { white: "255,255,255,1", black: "0,0,0,1", transparent: "0,0,0,0" };
/** Colours written in a style value: hex, rgb()/rgba(), and the few names a design uses. */
const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|transparent)\b/gi;
const camel = (p: string) => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A colour as "r,g,b,a", the same however it was written; undefined when it isn't one. */
export function colorKey(c: string): string | undefined {
  const s = c.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const hex = s.match(/^#([0-9a-f]{3,8})$/)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((h) => h + h).join("") : hex;
    const [r, g, b, a = 255] = (full.match(/../g) ?? []).map((h) => parseInt(h, 16));
    return `${r},${g},${b},${+(a / 255).toFixed(3)}`;
  }
  const rgb = s.match(/^rgba?\(([^)]*)\)$/)?.[1];
  if (rgb) {
    const parts = rgb.split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : Number(p)));
    const [r, g, b, a = 1] = parts;
    if ([r, g, b, a].every((n) => n !== undefined && Number.isFinite(n))) return `${r},${g},${b},${+a!.toFixed(3)}`;
  }
  return undefined;
}

/** "*" as "anything", the rest literal, matched against the whole of `s`. */
const glob = (pattern: string, s: string) => new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i").test(s);

/**
 * What in `value` the query's value names: the whole value, a colour in it equal to the query's, or a token used in
 * it (named, or set to the queried colour). The parts found, as written; [] when it doesn't match.
 */
function valueHits(doc: Doc, wanted: string, value: string): string[] {
  const token = wanted.match(/^(?:var\()?(--[\w-]+)\)?$/)?.[1];
  if (token) return value.includes(`var(${token})`) ? [`var(${token})`] : [];
  if (glob(wanted, value)) return [value];
  const key = colorKey(wanted);
  if (!key) return [];
  const colours = (value.match(COLOR) ?? []).filter((c) => colorKey(c) === key);
  const tokens = [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!).filter((t) => colorKey(doc.tokens[t] ?? "") === key).map((t) => `var(${t})`);
  return [...colours, ...tokens];
}

/** The styles a layer carries: its own, and at each of the page's other widths. */
function styles(n: Node): [string | undefined, Style][] {
  return [[undefined, n.style], ...Object.entries(n.at ?? {})];
}

/** Every layer under `roots` (all pages when none) matching every style query and the text, in tree order. */
export function findNodes(doc: Doc, q: { styles?: StyleQuery[]; text?: string; roots?: Id[] }): Match[] {
  const kids = new Map<Id, Node[]>();
  for (const n of Object.values(doc.nodes)) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  for (const list of kids.values()) list.sort((a, b) => (a.index < b.index ? -1 : 1));
  const roots = q.roots ?? Object.values(doc.pages).sort((a, b) => (a.index < b.index ? -1 : 1)).map((p) => p.frame);
  const out: Match[] = [];
  const visit = (n: Node) => {
    const matched: string[] = [];
    let ok = true;
    for (const want of q.styles ?? []) {
      const hits = styles(n).flatMap(([width, style]) => Object.entries(style)
        .filter(([prop]) => !want.prop || glob(camel(want.prop), prop))
        .flatMap(([prop, value]) => (want.value ? valueHits(doc, want.value, value) : [value]).map((hit) => `${prop}${width ? ` at ${width}px` : ""}: ${hit}`)));
      if (!hits.length) ok = false;
      matched.push(...hits);
    }
    if (q.text !== undefined) {
      if (n.kind === "text" && glob(q.text.includes("*") ? q.text : `*${q.text}*`, n.text)) matched.push(`text: ${n.text}`);
      else ok = false;
    }
    if (ok && matched.length) out.push({ node: n.id, matched });
    for (const c of kids.get(n.id) ?? []) visit(c);
  };
  for (const r of roots) { const n = doc.nodes[r]; if (n) visit(n); }
  return out;
}

/** `style` with every part that `want` matches replaced by `by`; the same object when nothing matched. */
export function replaceIn(doc: Doc, style: Style, want: StyleQuery, by: string): Style {
  let changed = false;
  const next: Style = {};
  for (const [prop, value] of Object.entries(style)) {
    let v = value;
    if (!want.prop || glob(camel(want.prop), prop)) {
      const hits = want.value ? valueHits(doc, want.value, value) : [value];
      for (const hit of hits) v = hit === value ? by : v.split(hit).join(by);
    }
    if (v !== value) changed = true;
    next[prop] = v;
  }
  return changed ? next : style;
}
