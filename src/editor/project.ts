// A project's designs, parsed once and kept: lists and pickers read summaries of them, and a design is read and parsed
// again only when it changed on disk.
import { basename, dirname, resolve } from "node:path";
import { emptyDoc, pagesInOrder, withImports, withUseLinks, type Doc, type Id } from "buni/format/doc.ts";
import { parseDoc } from "buni/format/parse.ts";
import type { ProjectFile } from "buni/tools/protocol.ts";
import type { EditorStore } from "./store.ts";

/** A design as last read: the file is read again only when its time or size moves. */
export interface Indexed {
  stamp: string;
  modified: Date;
  doc: Doc;
}

export class ProjectIndex {
  private readonly files = new Map<string, Indexed>();
  constructor(private readonly store: EditorStore) {}

  /** The designs under `dir`, read and parsed only where they changed since last asked. */
  async docs(dir: string): Promise<ReadonlyMap<string, Indexed>> {
    const seen = new Set<string>();
    if (this.store.entries) {
      for (const e of await this.store.entries(dir)) {
        seen.add(e.path);
        const stamp = `${e.modified}:${e.size}`;
        if (this.files.get(e.path)?.stamp === stamp) continue;
        const text = await this.store.read(e.path).catch(() => undefined);
        this.keep(e.path, stamp, new Date(e.modified), text);
      }
    } else {
      // A store that can't tell what changed without reading (the hosted one) is read whole; parsing still skips
      // what didn't change.
      for (const f of await this.store.list(dir)) {
        seen.add(f.path);
        const stamp = `${f.modified.getTime()}:${f.text.length}`;
        if (this.files.get(f.path)?.stamp !== stamp) this.keep(f.path, stamp, f.modified, f.text);
      }
    }
    for (const path of this.files.keys()) if (!seen.has(path)) this.files.delete(path);
    return new Map(this.files);
  }

  private keep(path: string, stamp: string, modified: Date, text: string | undefined): void {
    // Its shape only: a section's references resolve in the core it imports, checked when it's opened.
    const r = text === undefined ? undefined : parseDoc(text, { refs: false });
    if (r?.ok) this.files.set(path, { stamp, modified, doc: r.doc });
    else this.files.delete(path);
  }
}

/**
 * A design with what it imports, from the designs already indexed: drawn as its window would (components, tokens,
 * links on every use), without reading a file. Imports outside the index are left out.
 */
export function withImportsFrom(files: ReadonlyMap<string, Indexed>, path: string): Doc | undefined {
  const own = files.get(path)?.doc;
  if (!own) return undefined;
  // Every file reachable through imports, each once, cycles and all; folded as Workspace folds them.
  const seen = new Set([path]);
  const reached: Doc[] = [];
  const walk = (from: string, doc: Doc) => {
    for (const rel of doc.imports ?? []) {
      const abs = resolve(dirname(from), rel);
      const next = files.get(abs)?.doc;
      if (seen.has(abs) || !next) continue;
      seen.add(abs);
      reached.push(next);
      walk(abs, next);
    }
  };
  walk(path, own);
  const context = reached.length ? reached.reduce((acc, d) => withImports(d, acc), emptyDoc()) : undefined;
  return withUseLinks(withImports(own, context));
}

/** Every design as a summary: pages and components by name, how often the others place each component. */
export function summaries(files: ReadonlyMap<string, Indexed>, folderOf: (path: string) => string): ProjectFile[] {
  // Uses by component, counted in the designs that don't define it: a core's components are placed in its sections.
  const usesIn = new Map<string, Map<Id, number>>();
  for (const [path, { doc }] of files) {
    const counts = new Map<Id, number>();
    for (const n of Object.values(doc.nodes)) if (n.kind === "instance" && !doc.shared[n.shared]) counts.set(n.shared, (counts.get(n.shared) ?? 0) + 1);
    usesIn.set(path, counts);
  }
  return [...files].map(([path, { doc, modified }]) => ({
    path,
    name: basename(path, ".buni"),
    folder: folderOf(path),
    modified: modified.toISOString(),
    pages: pagesInOrder(doc).map((p) => ({ id: p.id, name: p.name, ...(p.route !== undefined ? { route: p.route } : {}) })),
    components: Object.values(doc.shared).map((s) => ({
      id: s.id,
      name: s.name,
      usedElsewhere: [...usesIn].reduce((n, [other, counts]) => n + (other === path ? 0 : counts.get(s.id) ?? 0), 0),
    })),
    imports: doc.imports ?? [],
  }));
}

