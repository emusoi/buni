// A new design: its name, the project (folder) it joins, and the design it builds on there (a core's tokens and
// components), so a new section of an app starts from what the app already has.
import { useMemo, useState } from "react";
import type { HomeFile, Space } from "../api.ts";

export function NewDesign({ files, folder, space, onCreate, onClose }: {
  files: readonly HomeFile[];
  /** The project showing in Home, if one is. */
  folder: string | undefined;
  /** The space showing in Home (the web): a new design with no project to join starts in its root. */
  space?: Space | undefined;
  onCreate: (name: string, options: { beside?: string; core?: string; in?: string }) => void;
  onClose: () => void;
}) {
  const inSpace = space ? files.filter((f) => f.space?.root === space.root) : files;
  const folders = useMemo(() => [...new Set(inSpace.map((f) => f.folder))].sort(), [inSpace]);
  const [name, setName] = useState("Untitled");
  // "" is a project of its own, named for the design.
  const [where, setWhere] = useState(folder ?? (space ? "" : folders[0] ?? ""));
  const here = files.filter((f) => f.folder === where);
  // Designs with components can be built on; one called core first, as projects usually name it.
  const cores = here.filter((f) => Object.keys(f.doc.shared).length > 0).sort((a, b) => Number(b.name === "core") - Number(a.name === "core"));
  const [core, setCore] = useState<string | undefined>(cores[0]?.path);
  const chosen = cores.some((c) => c.path === core) ? core : undefined;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog new-design" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), { ...(here[0] ? { beside: here[0].path } : space ? { in: space.root } : {}), ...(chosen ? { core: chosen } : {}) }); }}>
        <h2>New design{space ? ` in ${space.name}` : ""}</h2>
        <label className="new-row"><span>Name</span><input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} /></label>
        {(folders.length > 1 || (space && folders.length > 0)) && (
          <label className="new-row"><span>Project</span>
            <select className="field" value={where} onChange={(e) => { setWhere(e.target.value); setCore(undefined); }}>
              {space && <option value="">A project of its own</option>}
              {folders.map((f) => <option key={f} value={f}>{f.split("/").filter(Boolean).at(-1) ?? f}</option>)}
            </select>
          </label>
        )}
        <label className="new-row"><span>Builds on</span>
          <select className="field" value={chosen ?? ""} onChange={(e) => setCore(e.target.value || undefined)}>
            <option value="">Nothing: start blank</option>
            {cores.map((c) => <option key={c.path} value={c.path}>{c.name} · {Object.keys(c.doc.shared).length} component{Object.keys(c.doc.shared).length === 1 ? "" : "s"}</option>)}
          </select>
        </label>
        {chosen && <p className="hint">Its tokens and components are there from the start; change them in {cores.find((c) => c.path === chosen)?.name}, and every design built on it follows.</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}
