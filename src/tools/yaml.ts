// A small YAML emitter: block style, quoted where YAML would misread a plain scalar. Exported drafts and the
// architecture as text both write with it; reading back is Bun.YAML.parse.

export type Yaml = string | number | boolean | readonly Yaml[] | YamlMap;
export type YamlMap = { readonly [k: string]: Yaml | undefined };

const isList = (v: Yaml): v is readonly Yaml[] => Array.isArray(v);
const isMap = (v: Yaml): v is YamlMap => typeof v === "object" && !Array.isArray(v);
const pairs = (m: YamlMap) => Object.entries(m).filter((e): e is [string, Yaml] => e[1] !== undefined);
/** A map with at least one key set, or a list with an item: what `block` writes on lines of its own. */
export const filled = (v: Yaml) => (isList(v) ? v.length > 0 : isMap(v) ? pairs(v).length > 0 : false);

// What a plain scalar can't be: starting with an indicator, edge spaces, ": " or " #", flow brackets, or a word
// YAML reads as a bool, null or number.
const UNSAFE = /^[-?:,[\]{}#&*!|>'"%@`]|^\s|\s$|: | #|[{}[\],]|[\u0000-\u001f\u007f]/;
const RESERVED = /^(true|false|yes|no|on|off|y|n|null|~|[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+|[-+]?\.inf|\.nan)$/i;
export const scalar = (s: string) => (s === "" || UNSAFE.test(s) || RESERVED.test(s) ? JSON.stringify(s) : s);

/** A value that sits on its key's line: a scalar, an empty collection, or the head of a block literal. */
function inline(v: Yaml, pad: string): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isList(v)) return "[]";
  if (isMap(v)) return "{}";
  // |- keeps every line as written but drops a final newline, and can't start with a space: those are quoted.
  if (v.includes("\n") && !/^\s|\n$|[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) return `|-\n${v.split("\n").map((l) => (l ? `${pad}${l}` : "")).join("\n")}`;
  return scalar(v);
}

/** A list of one-line scalars as [a, b, c]: scalar() already quotes the commas and brackets a flow list would misread. */
const flowList = (v: readonly Yaml[]) => (v.every((x) => typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && !x.includes("\n"))) ? `[${v.map((x) => (typeof x === "string" ? scalar(x) : String(x))).join(", ")}]` : undefined);

/**
 * A map's keys or a list's items as lines at `pad`. With `flow`, a map's list of plain values that fits in that many
 * columns goes on its key's line, [a, b], for people to read and write.
 */
export function yamlLines(v: YamlMap | readonly Yaml[], pad: string, flow?: number): string[] {
  const out: string[] = [];
  const nested = (item: Yaml, at: string) => (filled(item) && (isList(item) || isMap(item)) ? yamlLines(item, at, flow) : undefined);
  if (isList(v)) {
    for (const item of v) {
      const inner = nested(item, `${pad}  `);
      if (inner) out.push(`${pad}- ${(inner[0] ?? "").slice(pad.length + 2)}`, ...inner.slice(1));
      else out.push(`${pad}- ${inline(item, `${pad}  `)}`);
    }
    return out;
  }
  for (const [k, item] of pairs(v)) {
    const short = isList(item) && item.length > 0 ? flowList(item) : undefined;
    if (flow !== undefined && short !== undefined && pad.length + scalar(k).length + 2 + short.length <= flow) { out.push(`${pad}${scalar(k)}: ${short}`); continue; }
    const inner = nested(item, `${pad}  `);
    if (inner) out.push(`${pad}${scalar(k)}:`, ...inner);
    else out.push(`${pad}${scalar(k)}: ${inline(item, `${pad}  `)}`);
  }
  return out;
}
