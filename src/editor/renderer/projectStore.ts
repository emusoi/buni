// The project's designs as summaries, read once per tab and shared: the sidebar's list, ⌘P, link pickers, Uses,
// the project menu and component counts all read this one request.
import { useEffect, useState } from "react";
import { pagesInOrder, type Id } from "buni/format/doc.ts";
import type { HomeFile, ProjectFile } from "../api.ts";

let request: Promise<ProjectFile[]> | undefined;

/** The files of the open one's project, a project being the folder they share; the open file is in it. */
export function siblings<F extends { path: string; folder: string; name: string }>(files: readonly F[], path: string): F[] {
  const folder = files.find((f) => f.path === path)?.folder;
  return folder === undefined ? [] : files.filter((f) => f.folder === folder).sort((a, b) => a.name.localeCompare(b.name));
}

/** Summaries from home(), for a host without project(): the same shape, built in the window. */
export function fromHome(files: readonly HomeFile[]): ProjectFile[] {
  const uses = new Map<string, Map<Id, number>>();
  for (const f of files) {
    const counts = new Map<Id, number>();
    for (const n of Object.values(f.doc.nodes)) if (n.kind === "instance" && !f.doc.shared[n.shared]) counts.set(n.shared, (counts.get(n.shared) ?? 0) + 1);
    uses.set(f.path, counts);
  }
  return files.map((f) => ({
    path: f.path, name: f.name, folder: f.folder, modified: f.modified, imports: f.doc.imports ?? [],
    pages: pagesInOrder(f.doc).map((p) => ({ id: p.id, name: p.name, ...(p.route !== undefined ? { route: p.route } : {}) })),
    components: Object.values(f.doc.shared).map((s) => ({ id: s.id, name: s.name, usedElsewhere: [...uses].reduce((n, [o, c]) => n + (o === f.path ? 0 : c.get(s.id) ?? 0), 0) })),
    ...(f.agentNote ? { agentNote: f.agentNote } : {}),
  }));
}

/** The whole folder's designs; asked once per tab, again only when `fresh` (after making a design, say). */
export function loadProject(fresh = false): Promise<ProjectFile[]> {
  if (!request || fresh) request = window.buni.project ? window.buni.project() : window.buni.home().then(fromHome);
  return request;
}

/** The designs of the open one's project (its folder), it among them, by name. */
export function useProject(path: string): ProjectFile[] {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  useEffect(() => {
    let live = true;
    // A design the summaries don't know yet (made since, in this tab) asks again.
    void loadProject().then((all) => (all.some((f) => f.path === path) ? all : loadProject(true))).then((all) => live && setFiles(siblings(all, path)));
    return () => { live = false; };
  }, [path]);
  return files;
}
