import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { checkImage } from "./assets.ts";
import { emptyDoc, SYSTEM_COLLECTIONS, withImports, type Doc, type Id } from "../format/doc.ts";
import { parseDoc, validateDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { applyChange, diffOps, invert, propose, view, type ChangeSet, type Op, type Rejected, type Session } from "../oplog/oplog.ts";
import { exportSite } from "./html.ts";
import { splitPart } from "./split.ts";
import { gridProblems } from "./terminal.ts";
import { copyHints, REPEAT_MIN } from "./library.ts";
import { ToolError, tools, type ToolContext, type ToolName, type ToolOutput } from "./tools.ts";

/** One edit, as undo sees it. */
interface Undoable {
  label: string;
  undo: Op[];
  redo: Op[];
  /** Who made it and when, in edit order, so one agent's request can be taken back alone. */
  author?: string;
  seq?: number;
}

/** One edit as people watching see it: who made it, what it was, which layers it touched, when. */
export interface Edit {
  author: string;
  label: string;
  nodes: Id[];
  /** System things it changed, as "collection:id" ("parts:api"). */
  things?: string[];
  /** ISO 8601. */
  at: string;
}

export const isEdit = (v: unknown): v is Edit =>
  typeof v === "object" && v !== null && "author" in v && typeof v.author === "string" && "label" in v && typeof v.label === "string"
  && "nodes" in v && Array.isArray(v.nodes) && v.nodes.every((n: unknown) => typeof n === "string") && "at" in v && typeof v.at === "string"
  && (!("things" in v) || (Array.isArray(v.things) && v.things.every((t: unknown) => typeof t === "string")));

export interface CallResult {
  ok: boolean;
  reply: string;
}

/** Where .buni files live: the disk here, the browser's storage on the web. */
export interface Store {
  readonly localImports?: boolean;
  readBytes?(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<string>;
  /** Replaces the whole file at once, creating its folder. */
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const diskStore: Store = {
  localImports: true,
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  writeBytes: async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); },
  read: (path) => readFile(path, "utf8"),
  async write(path, text) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  },
  remove: (path) => rm(path, { force: true }),
};

function describe(rejected: Rejected[]): string {
  return rejected.flatMap((r) => r.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))).join("\n");
}

function nodesOf(ops: readonly Op[]): Id[] {
  return ops.flatMap((op) => (op.kind === "put" && op.collection === "nodes" ? [op.value.id] : []));
}

const SYSTEM = new Set<string>(SYSTEM_COLLECTIONS);
function thingsOf(ops: readonly Op[]): string[] {
  return ops.flatMap((op) => (op.kind === "put" || op.kind === "delete") && SYSTEM.has(op.collection) ? [`${op.collection}:${op.kind === "put" ? op.value.id : op.id}`] : []);
}

/** A file this one imports, directly or through others: its path and system, read-only here. */
export interface ImportedFile {
  path: string;
  doc: Doc;
}

/** Every file reachable through imports from `path` (not `path` itself), each read once, cycles and all. */
async function loadImports(store: Store, path: string, doc: Doc): Promise<ImportedFile[]> {
  const seen = new Set([path]);
  const out: ImportedFile[] = [];
  const walk = async (from: string, d: Doc) => {
    for (const rel of d.imports ?? []) {
      const abs = resolve(dirname(from), rel);
      if (seen.has(abs)) continue;
      seen.add(abs);
      let text: string;
      try {
        text = await store.read(abs);
      } catch {
        throw new Error(`${from} imports ${rel}, which can't be read`);
      }
      // Imported files are checked in their own window; here only their shape has to hold.
      const r = parseDoc(text, { refs: false });
      if (!r.ok) throw new Error(`${abs} is not a valid .buni file:\n${r.errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`);
      out.push({ path: abs, doc: r.doc });
      await walk(abs, r.doc);
    }
  };
  await walk(path, doc);
  return out;
}

/** The system of several files as one document: what an importing file's references resolve against. */
function systemOf(files: readonly ImportedFile[]): Doc | undefined {
  if (files.length === 0) return undefined;
  return files.reduce((acc, f) => withImports(f.doc, acc), emptyDoc());
}

function isChangeSetList(v: unknown): v is ChangeSet[] {
  return (
    Array.isArray(v) &&
    v.every((s) => typeof s === "object" && s !== null && typeof s.id === "string" && typeof s.author === "string" && Array.isArray(s.changes))
  );
}

/**
 * One open .buni file. The only writer of the file: agents and people change it
 * through `call`, each edit is written at once, and undo takes edits back.
 */
export class Workspace {
  private session: Session;
  private queue: Promise<unknown> = Promise.resolve();
  private counter = 0;
  private undos: Undoable[] = [];
  private redos: Undoable[] = [];
  private readonly listeners = new Set<() => void>();
  private imported: ImportedFile[] = [];
  /** Nodes each author's latest edit touched, to show where they are working. */
  private touched = new Map<string, Id[]>();
  /** The latest edits, newest last, so an editor can show agents' work as it lands. */
  private log: Edit[] = [];

  private constructor(readonly path: string, base: Doc, private readonly store: Store) {
    this.session = { base, pending: [] };
  }

  /** Who edited what, for buni open; written beside the file once shareActivity is on. */
  get activityPath(): string {
    return `${this.path}.activity`;
  }

  private sharing = false;

  /**
   * Shares the latest edits with buni open through <file>.activity, after every edit; on for every file on disk. What
   * is there already is kept, so one-shot buni call runs add to the same list as a long-running buni mcp.
   */
  async shareActivity(): Promise<void> {
    this.sharing = true;
    try {
      const raw: unknown = JSON.parse(await this.store.read(this.activityPath));
      if (Array.isArray(raw)) this.log = raw.filter(isEdit).slice(-50);
    } catch {
      // None yet, or unreadable: start a new list.
    }
  }

  /** The last 50 edits; an editor shows a handful per agent, and buni open shows where each agent is. */
  private async note(edit: Edit): Promise<void> {
    this.log = [...this.log, edit].slice(-50);
    if (this.sharing) await this.store.write(this.activityPath, JSON.stringify(this.log)).catch(() => undefined);
  }

  get pendingPath(): string {
    return `${this.path}.pending`;
  }

  static async open(path: string, store: Store = diskStore): Promise<Workspace> {
    const abs = resolve(path);
    const text = await store.read(abs);
    const shape = parseDoc(text, { refs: false });
    const imported = shape.ok ? await loadImports(store, abs, shape.doc) : [];
    const context = systemOf(imported);
    const errors = shape.ok ? validateDoc(shape.doc, context) : shape.errors;
    if (!shape.ok || errors.length) throw new Error(`${path} is not a valid .buni file:\n${errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`);
    const ws = new Workspace(abs, shape.doc, store);
    ws.imported = imported;
    ws.session = { ...ws.session, context };
    await ws.keepLegacyPending();
    // Every writer of a file on disk tells buni open who is editing what: the CLI, MCP, an agent, an app.
    if (store === diskStore) await ws.shareActivity();
    return ws;
  }

  /**
   * The file as it is now, in memory: edits to the copy are never written anywhere, and the files it imports are
   * read from where this one lives. Evals run on one, so nothing real changes.
   */
  copy(): Promise<Workspace> {
    const mine = new Map([[this.path, serializeDoc(this.view())]]);
    const store: Store = {
      read: async (p) => mine.get(p) ?? this.store.read(p),
      write: async (p, text) => void mine.set(p, text),
      remove: async (p) => void mine.delete(p),
    };
    return Workspace.open(this.path, store);
  }

  /** Files from before edits applied directly may still have a <file>.pending: keep that work, then remove it. */
  private async keepLegacyPending(): Promise<void> {
    let text: string;
    try {
      text = await this.store.read(this.pendingPath);
    } catch {
      return;
    }
    const raw: unknown = JSON.parse(text);
    if (!isChangeSetList(raw)) throw new Error(`${this.pendingPath} is not a list of change sets`);
    let session = this.session;
    for (const set of raw) {
      const r = propose(session, set);
      if (!r.ok) throw new Error(`${this.pendingPath}: change set "${set.id}" no longer applies:\n${describe(r.rejected)}`);
      session = r.session;
    }
    // The side file is ours but not trusted: the resulting document must pass the full parser.
    const check = parseDoc(serializeDoc(view(session).doc));
    if (!check.ok) throw new Error(`${this.pendingPath} produces an invalid document`);
    await this.store.write(this.path, serializeDoc(view(session).doc));
    this.session = { base: view(session).doc, pending: [] };
    await this.store.remove(this.pendingPath);
  }

  /** Runs one operation at a time; tool calls from several agents never interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Called after every edit or settle, e.g. to redraw the canvas. Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  view(): Doc {
    return this.session.base;
  }

  /** The files this one imports, as last read. */
  imports(): readonly ImportedFile[] {
    return this.imported;
  }

  /** This file's system with everything it imports: what briefs, specs and the System views read. */
  system(): Doc {
    return withImports(this.view(), this.session.context);
  }

  /** Which imported file each shared thing lives in, by id; things in this file are absent. */
  owners(): Record<Id, string> {
    const out: Record<Id, string> = {};
    for (const f of this.imported) {
      const name = relative(dirname(this.path), f.path) || basename(f.path);
      for (const c of SYSTEM_COLLECTIONS) for (const id of Object.keys(f.doc[c])) out[id] ??= name;
    }
    return out;
  }

  /**
   * Moves a part and what it owns into a new file at `to`, and makes the two import each other.
   * Both are checked as one system before either is written.
   */
  split(part: Id, to: string): Promise<CallResult> {
    return this.exclusive(async () => {
      const target = resolve(dirname(this.path), to);
      if (!target.endsWith(".buni")) return { ok: false, reply: "the new file's name ends in .buni" };
      try {
        await this.store.read(target);
        return { ok: false, reply: `${to} already exists` };
      } catch {
        // a new file: good
      }
      const r = splitPart(this.view(), part, relative(dirname(target), this.path), relative(dirname(this.path), target));
      if (typeof r === "string") return { ok: false, reply: r };
      const others = systemOf(this.imported);
      const restErrors = parseDoc(serializeDoc(r.rest), { context: withImports(r.moved, others) });
      const movedErrors = parseDoc(serializeDoc(r.moved), { context: withImports(r.rest, others) });
      if (!restErrors.ok || !movedErrors.ok) {
        const errs = [...(restErrors.ok ? [] : restErrors.errors), ...(movedErrors.ok ? [] : movedErrors.errors)];
        return { ok: false, reply: `Splitting would break the design:\n${errs.map((e) => `${e.path}: ${e.message}`).join("\n")}` };
      }
      await this.store.write(target, serializeDoc(r.moved));
      await this.store.write(this.path, serializeDoc(r.rest));
      this.imported = await loadImports(this.store, this.path, r.rest);
      this.session = { base: r.rest, pending: [], context: systemOf(this.imported) };
      this.undos = [];
      this.redos = [];
      this.changed();
      const n = (c: "endpoints" | "operations" | "tables" | "events" | "shapes") => Object.keys(r.moved[c]).length;
      return { ok: true, reply: `Moved ${r.moved.parts[part]?.name} to ${to} with ${n("endpoints") + n("operations")} calls, ${n("tables")} tables, ${n("events")} events and ${n("shapes")} shapes; the two files import each other.` };
    });
  }

  /** The latest edits, newest last. */
  edits(): readonly Edit[] {
    return this.log;
  }

  /** Where each author last edited, by author name. */
  recent(): Record<string, Id[]> {
    return Object.fromEntries(this.touched);
  }

  private async readAttachment(path: string): Promise<string> {
    const dir = dirname(this.path);
    const target = resolve(dir, path);
    if (!target.startsWith(dir + sep)) throw new ToolError(`attachment path "${path}" leaves the document's folder`);
    return this.store.read(target);
  }

  private context(author: string): ToolContext {
    return {
      author,
      now: () => new Date().toISOString(),
      randomId: () => randomBytes(4).toString("hex"),
      readAttachment: (p) => this.readAttachment(p),
      localImports: this.store.localImports === true,
      readImportFile: async (path) => {
        const target = resolve(dirname(this.path), path);
        if (!target.startsWith(dirname(this.path) + sep)) throw new ToolError("Import files must be inside the design's folder.");
        if (!this.store.readBytes) throw new ToolError("This host cannot read HTML import files; pass html or url instead.");
        const bytes = await this.store.readBytes(target);
        if (bytes.length > 8 * 1024 * 1024) throw new ToolError("Each imported resource must be under 8 MB.");
        return { url: pathToFileURL(target).href, mime: Bun.file(target).type.split(";")[0]!, base64: Buffer.from(bytes).toString("base64") };
      },
      saveImportImage: async (base64, mime) => {
        if (!this.store.writeBytes) throw new ToolError("This host cannot save imported images.");
        try {
          const image = checkImage("import", base64, mime);
          if ("error" in image) throw new ToolError(image.error);
          const hash = createHash("sha256").update(image.bytes).digest("hex");
          const path = `assets/import-${hash}.${image.ext}`;
          await this.store.writeBytes(join(dirname(this.path), path), image.bytes);
          return path;
        } catch (e) { throw new ToolError(e instanceof Error ? e.message : String(e)); }
      },
      ...(this.session.context ? { imported: this.session.context } : {}),
    };
  }

  /** Runs a design tool as `author`. An edit is written to the file at once and can be undone; reads change nothing. */
  call(author: string, name: ToolName, args: unknown): Promise<CallResult> {
    return this.exclusive(async () => {
      const out = await this.plan(name, args, this.view(), author);
      if (!("ops" in out)) return out;
      if (out.ops.length === 0) return { ok: true, reply: out.reply };
      const undo = invert(this.view(), out.ops);
      const r = await this.write(author, out.label, out.ops);
      if (!r.ok) return r;
      this.undos.push({ label: out.label, undo, redo: out.ops, author, seq: ++this.seq });
      // Oldest edits stop being undoable past 500; each holds every node it wrote, and agents make thousands
      if (this.undos.length > 500) this.undos.shift();
      this.redos = [];
      const nodes = nodesOf(out.ops);
      if (nodes.length) this.touched.set(author, nodes);
      const things = thingsOf(out.ops);
      await this.note({ author, label: out.label, nodes, ...(things.length ? { things } : {}), at: new Date().toISOString() });
      this.changed();
      // On a terminal screen, what the edit did that a terminal can't draw, for whoever made it to fix.
      const grid = gridProblems(this.view(), nodes);
      const more = grid.length > 12 ? [`…and ${grid.length - 12} more`] : [];
      // Layers that copy a component or another page's layers: said now, while one change still fixes it.
      const copies = nodes.length >= REPEAT_MIN ? copyHints(this.view(), nodes) : [];
      const notes = [
        ...(grid.length ? [`On the terminal grid:\n${[...grid.slice(0, 12), ...more].map((g) => `- ${g}`).join("\n")}`] : []),
        ...(copies.length ? [`Copied, not reused:\n${copies.map((c) => `- ${c}`).join("\n")}`] : []),
      ];
      return { ok: true, reply: [out.reply, ...notes].join("\n") };
    });
  }

  /** Makes the document match `to` (a saved version) as one edit, so it can be undone like any other. */
  restore(author: string, label: string, to: Doc): Promise<CallResult> {
    return this.exclusive(async () => {
      const ops = diffOps(this.view(), to);
      if (ops.length === 0) return { ok: true, reply: "It already matches that version." };
      const undo = invert(this.view(), ops);
      const r = await this.write(author, label, ops);
      if (!r.ok) return r;
      this.undos.push({ label, undo, redo: ops });
      this.redos = [];
      await this.note({ author, label, nodes: nodesOf(ops), at: new Date().toISOString() });
      this.changed();
      return { ok: true, reply: `${label}: ${ops.length} change${ops.length === 1 ? "" : "s"}.` };
    });
  }

  private seq = 0;

  /** Where the edit history stands now; pass it to undoSince to take back what one author does from here. */
  mark(): number {
    return this.seq;
  }

  /**
   * Takes back every edit `author` made after `mark`, newest first, as one edit that can itself be undone.
   * Others' edits stay. If a later edit built on them, nothing changes and the reply says why.
   */
  undoSince(author: string, mark: number, label: string): Promise<CallResult> {
    return this.exclusive(async () => {
      const mine = this.undos.filter((u) => u.author === author && (u.seq ?? 0) > mark);
      if (mine.length === 0) return { ok: false, reply: "Nothing to undo: no edits since then." };
      const undo = [...mine].reverse().flatMap((u) => u.undo);
      const r = await this.write("you", label, undo);
      if (!r.ok) return { ok: false, reply: `Couldn't undo it all at once; later edits build on it. ${r.reply}` };
      this.undos = this.undos.filter((u) => !mine.includes(u));
      this.undos.push({ label, undo: mine.flatMap((u) => u.redo), redo: undo });
      this.redos = [];
      this.changed();
      return { ok: true, reply: `${label}: ${mine.length} edit${mine.length === 1 ? "" : "s"}.` };
    });
  }

  /** Takes back the last edit, whoever made it. */
  undo(): Promise<CallResult> {
    return this.exclusive(() => this.step(this.undos, this.redos, "Undid"));
  }

  /** Puts back the last undone edit. */
  redo(): Promise<CallResult> {
    return this.exclusive(() => this.step(this.redos, this.undos, "Redid"));
  }

  private async step(from: Undoable[], to: Undoable[], verb: string): Promise<CallResult> {
    const entry = from.pop();
    if (!entry) return { ok: false, reply: `Nothing to ${verb === "Undid" ? "undo" : "redo"}.` };
    const r = await this.write("you", `${verb} ${entry.label}`, verb === "Undid" ? entry.undo : entry.redo);
    if (!r.ok) {
      // Later edits built on it; leave it where it was.
      from.push(entry);
      return r;
    }
    to.push(entry);
    this.changed();
    return { ok: true, reply: `${verb} ${entry.label}.` };
  }

  /** Applies ops to the file as `author`, if the document still holds together. */
  private async write(author: string, label: string, ops: Op[]): Promise<CallResult> {
    // A new import list is checked against the files it names, loaded before anything is written.
    const importOp = ops.find((o) => o.kind === "imports");
    let session = this.session;
    let imported = this.imported;
    if (importOp) {
      try {
        imported = await loadImports(this.store, this.path, { ...this.view(), imports: importOp.value });
      } catch (e) {
        return { ok: false, reply: e instanceof Error ? e.message : String(e) };
      }
      session = { ...session, context: systemOf(imported) };
    }
    // Nothing waits for review here: each edit is applied, checked once and written.
    const r = applyChange(session.base, { id: `edit-${++this.counter}`, label, ops }, session.context);
    if (!r.ok) return { ok: false, reply: `That change would break the document:\n${describe([{ set: author, change: "", errors: r.errors }])}` };
    await this.store.write(this.path, serializeDoc(r.doc));
    this.session = { ...session, base: r.doc };
    this.imported = imported;
    return { ok: true, reply: label };
  }

  private async plan(name: ToolName, args: unknown, doc: Doc, author: string): Promise<ToolOutput | CallResult> {
    try {
      return await tools[name].run(doc, args, this.context(author));
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, reply: e.message };
      throw e;
    }
  }

  /** Writes the committed document as a static site under `outDir`. */
  async exportSite(outDir: string): Promise<string[]> {
    return this.writeFiles(outDir, exportSite(this.view(), (await import("./fontdata.ts")).embeddedFont));
  }

  private async writeFiles(outDir: string, files: Map<string, string>): Promise<string[]> {
    // The parser keeps routes inside the site; this is the last word, whatever a file's names say.
    const root = resolve(outDir);
    for (const rel of files.keys()) if (!resolve(root, rel).startsWith(`${root}${sep}`)) throw new Error(`"${rel}" would be written outside ${outDir}`);
    for (const [rel, text] of files) await this.store.write(join(outDir, rel), text);
    return [...files.keys()];
  }
}
