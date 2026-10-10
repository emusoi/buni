import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Store } from "buni/tools/workspace.ts";

/**
 * The store as one person sees it: only paths inside `root`. A design's imports, a split into a new file and its
 * attachments resolve relative paths, so the boundary is kept here rather than by each tool.
 */
export function within(store: Store, root: string): Store {
  const inside = (path: string) => {
    if (!path.startsWith(`${root}/`) || path.split("/").some((p) => p === ".." || p === ".")) throw new Error(`${path} is outside your designs`);
    return path;
  };
  return { read: async (p) => store.read(inside(p)), write: async (p, t) => store.write(inside(p), t), remove: async (p) => store.remove(inside(p)) };
}

/** What the web server needs of where designs live: the Postgres rows when hosted, a folder on disk when local. */
export interface EditorStore extends Store {
  readBytes(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeBytes(path: string, body: Uint8Array): Promise<void>;
  moveDir(from: string, to: string): Promise<void>;
  removeDir(dir: string): Promise<void>;
  list(dir: string): Promise<{ path: string; text: string; modified: Date }[]>;
}

/**
 * A folder on this machine as the server's designs: "/designs/<folder>/<file>.buni" is <root>/<folder>/<file>.buni.
 * Files are edited in place, where they already live, beside whatever else is in their folder; so a design's folder
 * is never moved or removed from here.
 */
export class DiskStore implements EditorStore {
  constructor(private readonly root: string, private readonly virtual = "/designs") {}

  /** The file on disk for a design path; nothing outside the root, however the path is spelled. */
  real(path: string): string {
    if (!path.startsWith(`${this.virtual}/`) || path.split("/").some((p) => p === ".." || p === ".")) throw new Error(`${path} is outside your designs`);
    return join(this.root, path.slice(this.virtual.length + 1));
  }

  async read(path: string): Promise<string> {
    return readFile(this.real(path), "utf8");
  }

  async write(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await readFile(this.real(path)));
  }

  /** Written beside and renamed over, so a reader (buni open, an editor) never sees half a file. */
  async writeBytes(path: string, body: Uint8Array): Promise<void> {
    const target = this.real(path);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
  }

  async remove(path: string): Promise<void> {
    await rm(this.real(path), { force: true });
  }

  async moveDir(_from: string, _to: string): Promise<void> {
    throw new Error("Local designs live in your own folders: rename them in Finder.");
  }

  async removeDir(_dir: string): Promise<void> {
    throw new Error("Local designs live in your own folders: delete them in Finder.");
  }

  /** The .buni files one folder down from the root, newest first. */
  async list(dir: string): Promise<{ path: string; text: string; modified: Date }[]> {
    if (dir !== this.virtual) return [];
    const out: { path: string; text: string; modified: Date }[] = [];
    for (const folder of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (!folder.isDirectory() || folder.name.startsWith(".") || folder.name === "node_modules") continue;
      for (const f of await readdir(join(this.root, folder.name)).catch(() => [])) {
        if (!f.endsWith(".buni")) continue;
        const real = join(this.root, folder.name, f);
        const [text, info] = await Promise.all([readFile(real, "utf8"), stat(real)]).catch(() => [undefined, undefined] as const);
        if (text !== undefined && info) out.push({ path: `${this.virtual}/${folder.name}/${f}`, text, modified: info.mtime });
      }
    }
    return out.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }
}
