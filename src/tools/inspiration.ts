// Inspiration libraries: folders of UI and UX patterns, one self-contained HTML file each, opening with a comment
// that says what it is and when to use it (inspiration/README.md). buni ships one; people add their own in
// ~/.buni/settings.json ("inspiration": [folders]). Agents search them and bring a pattern in as a reference page.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface Pattern {
  name: string;
  tags: string[];
  use: string;
  avoid?: string;
  why?: string;
  seenIn?: string;
  /** Which library, by its folder's name ("buni" for the built-in one). */
  library: string;
  /** The file, absolute. */
  file: string;
}

/** buni's own library, beside the engine. */
export const BUILTIN = resolve(import.meta.dir, "../../inspiration");
/** Where people's buni settings live; BUNI_HOME moves them (tests, a second setup). */
const settingsFile = () => join(process.env.BUNI_HOME ?? join(homedir(), ".buni"), "settings.json");

/** A pattern's header: the `key: value` lines of its leading comment; undefined when it has none or lacks the basics. */
export function patternHeader(html: string): Omit<Pattern, "library" | "file"> | undefined {
  const comment = html.match(/^\s*<!--([\s\S]*?)-->/)?.[1];
  if (!comment) return undefined;
  const fields = new Map<string, string>();
  let last: string | undefined;
  for (const line of comment.split("\n")) {
    const m = line.match(/^([a-z][a-z ]*):\s*(.*)$/i);
    if (m?.[1] && !line.startsWith(" ")) { last = m[1].trim().toLowerCase(); fields.set(last, (m[2] ?? "").trim()); }
    else if (last && line.startsWith("  ") && line.trim()) fields.set(last, `${fields.get(last)} ${line.trim()}`);
  }
  const name = fields.get("name"), use = fields.get("use");
  if (!name || !use) return undefined;
  const optional = (k: string) => (fields.get(k) ? fields.get(k) : undefined);
  const avoid = optional("avoid"), why = optional("why"), seenIn = optional("seen in");
  return {
    name, use, tags: (fields.get("tags") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    ...(avoid ? { avoid } : {}), ...(why ? { why } : {}), ...(seenIn ? { seenIn } : {}),
  };
}

/** The settings file as an object, so other keys in it are kept when one is changed. */
async function settings(): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(await readFile(settingsFile(), "utf8"));
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
  } catch { return {}; }
}

/** The folders people added, as they were saved. */
export async function addedLibraries(): Promise<string[]> {
  const list = (await settings()).inspiration;
  return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : [];
}

/** Adds or removes a library folder in the settings; answers the list after. */
export async function setLibrary(dir: string, on: boolean): Promise<string[]> {
  const s = await settings();
  const now = await addedLibraries();
  const next = on ? [...new Set([...now, resolve(dir)])] : now.filter((d) => d !== resolve(dir));
  await mkdir(dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), `${JSON.stringify({ ...s, inspiration: next }, null, 2)}\n`);
  return next;
}

/** Every library in use: buni's own first, then the ones added, that exist. */
export async function libraries(): Promise<{ name: string; dir: string }[]> {
  const added = (await addedLibraries()).filter((d) => existsSync(d));
  return [{ name: "buni", dir: BUILTIN }, ...added.map((dir) => ({ name: dir.split(sep).at(-1) ?? dir, dir }))].filter((l) => existsSync(l.dir));
}

/** Every pattern in the libraries; a file without a header is left out. */
export async function allPatterns(): Promise<Pattern[]> {
  const out: Pattern[] = [];
  for (const lib of await libraries()) {
    const files = (await readdir(lib.dir, { recursive: true })).filter((f) => f.endsWith(".html"));
    for (const f of files.sort()) {
      const file = join(lib.dir, f);
      const head = patternHeader(await readFile(file, "utf8").catch(() => ""));
      if (head) out.push({ ...head, library: lib.name, file });
    }
  }
  return out;
}

/** Patterns that fit the words, best first: a hit in the name counts most, then tags, then what it's for. */
export function searchPatterns(patterns: readonly Pattern[], query: string): Pattern[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!words.length) return [...patterns];
  const score = (p: Pattern) => words.reduce((sum, w) =>
    sum + (p.name.toLowerCase().includes(w) ? 5 : 0) + (p.tags.some((t) => t.includes(w)) ? 3 : 0) + (`${p.use} ${p.why ?? ""}`.toLowerCase().includes(w) ? 1 : 0), 0);
  return patterns.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);
}

/** A pattern by its file or name, only from a library in use: nothing else on disk can be read this way. */
export async function patternFor(ref: string): Promise<Pattern | undefined> {
  const all = await allPatterns();
  const asFile = resolve(ref);
  return all.find((p) => p.file === asFile) ?? all.find((p) => p.name.toLowerCase() === ref.trim().toLowerCase());
}

/** A pattern's place in its library, for lists: "navigation/command-palette.html". */
export async function shortPath(p: Pattern): Promise<string> {
  const lib = (await libraries()).find((l) => l.name === p.library);
  return lib ? relative(lib.dir, p.file) : p.file;
}

/** The person's own library, where saved patterns go unless they name another: added to the settings when first used. */
export async function personalLibrary(): Promise<string> {
  const dir = join(process.env.BUNI_HOME ?? join(homedir(), ".buni"), "inspiration");
  await mkdir(dir, { recursive: true });
  if (!(await addedLibraries()).includes(dir)) await setLibrary(dir, true);
  return dir;
}

export interface NewPattern { name: string; use: string; tags?: string[]; avoid?: string; why?: string; seenIn?: string }

/** A pattern written as a file of the library: its header, then the document. Never over another; answers the file. */
export async function writePattern(dir: string, p: NewPattern, body: { html: string; css: string; title?: string }): Promise<string> {
  const line = (k: string, v: string | undefined) => (v ? `${k}: ${v.replace(/-->/g, "—>").replace(/\s*\n\s*/g, " ")}\n` : "");
  const head = `<!--\n${line("name", p.name)}${line("tags", (p.tags ?? []).join(", "))}${line("use", p.use)}${line("avoid", p.avoid)}${line("why", p.why)}${line("seen in", p.seenIn)}-->\n`;
  const doc = `${head}<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${p.name.replace(/</g, "&lt;")}</title><style>${body.css}</style></head>\n<body>${body.html}</body>\n</html>\n`;
  const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pattern";
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const file = join(dir, `${n === 1 ? base : `${base}-${n}`}.html`);
    if (existsSync(file)) continue;
    await writeFile(file, doc, { flag: "wx" });
    return file;
  }
}
