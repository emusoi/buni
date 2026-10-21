// The architecture as text a person writes by hand: YAML, one section per collection, each a map keyed by id, with
// defaults left out. Read back with Bun.YAML.parse and narrowed through the format's own Reader and reference checks,
// so a hand-written file is held to exactly the rules a tool edit is, and each error names its line and path.
import { ARCH_COLLECTIONS, emptyArchitecture, emptyDoc, type Architecture } from "../format/doc.ts";
import { Reader, validateDoc, type FormatError } from "../format/parse.ts";
import { ToolError } from "./kit.ts";
import { scalar, yamlLines, type Yaml, type YamlMap } from "./yaml.ts";

const HEADER = [
  "# buni architecture: how the app is built and shipped (code → build → release → Kubernetes → run).",
  "# Each section is a map keyed by id: the key is the thing's id, and other things name it by that key.",
  "# Left out means the default: status live, no list. A link can be one line: FROM KIND TO (calls, reads,",
  "# writes, publishes, subscribes, routes). Apply it with buni arch FILE write, or buni arch FILE edit.",
];
const STARTER = ["#", "# Nothing yet. A start:", "# parts:", "#   api:", "#     name: API", "#     kind: service"];

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** A value as YAML, without what the text leaves out: status live and empty lists. */
function bare(v: unknown): Yaml | undefined {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.length ? v.flatMap((x) => bare(x) ?? []) : undefined;
  if (!isRecord(v)) return undefined;
  const out: Record<string, Yaml> = {};
  for (const [k, x] of Object.entries(v)) {
    const y = k === "status" && x === "live" ? undefined : bare(x);
    if (y !== undefined) out[k] = y;
  }
  return out;
}

/** A link with nothing but its ends and kind, as one line: "web calls api". */
function compactLink(v: YamlMap): string | undefined {
  const { from, to, kind, ...rest } = v;
  const word = (s: Yaml | undefined) => typeof s === "string" && /^\S+$/.test(s);
  return Object.keys(rest).length === 0 && word(from) && word(to) && word(kind) ? `${String(from)} ${String(kind)} ${String(to)}` : undefined;
}

/** The architecture as text to read and write by hand; parseArchitectureText reads it back. */
export function architectureText(given: Architecture): string {
  // Read through the format's reader first, so keys come in its order however the objects were built.
  const r = new Reader();
  const arch = r.architecture(given, "");
  const byOrder = <T extends { order: number }>(bag: Record<string, T>) => Object.fromEntries(Object.entries(bag).sort(([, a], [, b]) => a.order - b.order));
  const sorted = { ...arch, environments: byOrder(arch.environments), stages: byOrder(arch.stages) };
  const sections: string[] = [];
  for (const c of ARCH_COLLECTIONS) {
    const items = Object.entries(sorted[c]).map(([id, x]): [string, string[]] => {
      const value = bare(x);
      if (!isRecord(value)) return [id, []];
      const { id: _, ...rest } = value;
      const line = c === "links" ? compactLink(rest) : undefined;
      return [id, line !== undefined ? [`  ${scalar(id)}: ${scalar(line)}`] : yamlLines({ [id]: rest }, "  ", 100)];
    });
    if (items.length === 0) continue;
    // A blank line between things that take several lines each; one-liners sit together.
    const gap = items.some(([, lines]) => lines.length > 1) ? "\n\n" : "\n";
    sections.push(`${c}:\n${items.map(([, lines]) => lines.join("\n")).join(gap)}`);
  }
  const head = [...HEADER, ...(sections.length ? [] : STARTER)].join("\n");
  return `${[head, ...sections].join("\n\n")}\n`;
}

// ---- Reading it back ----

// Null is YAML's word for a key with nothing after it: read as left out, so nothing past here sees one.
function narrow(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === null ? undefined : narrow(x)));
  return isRecord(v) ? narrowMap(v) : v;
}
function narrowMap(v: Json): Json {
  const out: Json = {};
  for (const [k, x] of Object.entries(v)) if (x !== null) out[k] = narrow(x);
  return out;
}

/**
 * What the reader takes: each item's key as its id, a one-line link spread out, status live left out, a play step's
 * touches an empty list when left out. Shapes it can't use are passed on as they are, for the reader to name.
 */
function expand(raw: Json, r: Reader): Json {
  const out: Json = {};
  for (const [c, section] of Object.entries(raw)) {
    if (!isRecord(section)) { out[c] = section ?? {}; continue; }
    const items: Json = {};
    for (const [id, given] of Object.entries(section)) {
      let item: unknown = given ?? {};
      if (c === "links" && typeof item === "string") {
        const [from, kind, to, ...more] = item.trim().split(/\s+/);
        if (more.length || to === undefined) r.fail(`links.${id}`, 'a link on one line is "FROM KIND TO", e.g. "web calls api"; or write from, to and kind under it');
        item = { from, to, kind };
      }
      if (!isRecord(item)) { items[id] = item; continue; }
      const value = narrowMap(item);
      // Live is what no status means; read either way, it is the same thing.
      if (value.status === "live") delete value.status;
      if (c === "plays" && Array.isArray(value.steps)) value.steps = value.steps.map((s: unknown) => (isRecord(s) && s.touches === undefined ? { ...s, touches: [] } : s));
      items[id] = { id, ...value };
    }
    out[c] = items;
  }
  return out;
}

/** The line (from 1) that `path` ("parts.api.build.steps[2]") is written on, as near as the text shows it. */
export function lineOf(text: string, path: string): number | undefined {
  const lines = text.split("\n");
  let found: number | undefined;
  // Where to look next, and the indent at or above which the thing found so far has ended.
  let from = 0;
  let col = -1;
  for (const step of path.match(/\[\d+\]|[^.[\]]+/g) ?? []) {
    const index = /^\[(\d+)\]$/.exec(step)?.[1];
    const key = new RegExp(`^"?${step.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?\\s*:`);
    let level: number | undefined;
    let seen = -1;
    let hit: number | undefined;
    for (let i = from; i < lines.length && hit === undefined; i++) {
      const [, spaces = "", dash = "", rest = ""] = /^( *)(- +)?(.*)$/.exec(lines[i] ?? "") ?? [];
      if (!dash && (rest.trim() === "" || rest.startsWith("#"))) continue;
      const indent = spaces.length;
      // A list may sit at its key's own indent.
      if (indent < col || (indent === col && !(index !== undefined && dash))) break;
      level ??= indent;
      if (indent !== level) continue;
      if (index === undefined ? key.test(rest) && !dash : dash && ++seen === Number(index)) hit = i;
    }
    if (hit === undefined) break;
    found = hit;
    const indent = /^ */.exec(lines[hit] ?? "")?.[0].length ?? 0;
    if (index === undefined) { from = hit + 1; col = indent; continue; }
    // An item's keys start on its dash line: read that line as if the dash were a space.
    lines[hit] = (lines[hit] ?? "").replace("-", " ");
    from = hit;
    col = indent;
  }
  return found === undefined ? undefined : found + 1;
}

/** Ids written twice in one section: YAML would keep the last without a word. */
function twice(text: string): FormatError[] {
  const errors: FormatError[] = [];
  let section = "";
  let level: number | undefined;
  let ids = new Set<string>();
  text.split("\n").forEach((line, i) => {
    const m = /^( *)"?([^\s":#][^\s":]*)"?\s*:/.exec(line);
    if (!m) return;
    const [, spaces = "", key = ""] = m;
    if (spaces === "") { section = key; level = undefined; ids = new Set(); return; }
    level ??= spaces.length;
    if (spaces.length !== level) return;
    if (ids.has(key)) errors.push({ path: `line ${i + 1} · ${section}.${key}`, message: `"${key}" is written twice; each id is a key once` });
    ids.add(key);
  });
  return errors;
}

const report = (errors: readonly FormatError[]) => errors.map((e) => `${e.path}: ${e.message}`).join("\n");

/**
 * The architecture a text says, held to the format's rules (shape, then references between things). Throws a
 * ToolError naming each problem's line and path when it breaks one.
 */
export function parseArchitectureText(text: string): Architecture {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch (e) {
    // The parser doesn't say where; the first line at which the text stops parsing does.
    const lines = text.split("\n");
    let lo = 1;
    let hi = lines.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      try { Bun.YAML.parse(lines.slice(0, mid).join("\n")); lo = mid + 1; } catch { hi = mid; }
    }
    throw new ToolError(`The architecture text isn't YAML: line ${lo}: ${e instanceof Error ? e.message.replace(/^YAML Parse error: /, "") : String(e)}`);
  }
  if (raw === null || raw === undefined) return emptyArchitecture();
  if (!isRecord(raw)) throw new ToolError(`The architecture text is sections keyed by name (${ARCH_COLLECTIONS.join(", ")}), each a map keyed by id.`);
  const dups = twice(text);
  const r = new Reader();
  const arch = r.architecture(expand(raw, r), "");
  // References are checked only once the shape holds: a broken shape would only add noise.
  const errors = [...dups, ...(r.errors.length ? r.errors : validateDoc({ ...emptyDoc(), architecture: arch }).map((e) => ({ ...e, path: e.path.replace(/^architecture\./, "") })))];
  if (errors.length) {
    const located = errors.map((e) => {
      if (e.path.startsWith("line ")) return e;
      const line = lineOf(text, e.path);
      return line === undefined ? e : { ...e, path: `line ${line} · ${e.path}` };
    });
    throw new ToolError(`The architecture text breaks the format:\n${report(located)}`);
  }
  return arch;
}
