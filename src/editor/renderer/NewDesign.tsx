// A new design: its name, the project (folder) it joins, and the design it builds on there (a core's tokens and
// components), so a new section of an app starts from what the app already has.
import { useMemo, useState } from "react";
import type { HomeFile } from "../api.ts";

export function NewDesign({ files, folder, onCreate, onClose }: {
  files: readonly HomeFile[];
  /** The project showing in Home, if one is. */
  folder: string | undefined;
  onCreate: (name: string, options: { beside?: string; core?: string }) => void;
  onClose: () => void;
}) {
  const folders = useMemo(() => [...new Set(files.map((f) => f.folder))].sort(), [files]);
  const [name, setName] = useState("Untitled");
  const [where, setWhere] = useState(folder ?? folders[0] ?? "");
  const here = files.filter((f) => f.folder === where);
  // Designs with components can be built on; one called core first, as projects usually name it.
  const cores = here.filter((f) => Object.keys(f.doc.shared).length > 0).sort((a, b) => Number(b.name === "core") - Number(a.name === "core"));
  const [core, setCore] = useState<string | undefined>(cores[0]?.path);
  const chosen = cores.some((c) => c.path === core) ? core : undefined;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog new-design" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), { ...(here[0] ? { beside: here[0].path } : {}), ...(chosen ? { core: chosen } : {}) }); }}>
        <h2>New design</h2>
        <label className="new-row"><span>Name</span><input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} /></label>
        {folders.length > 1 && (
          <label className="new-row"><span>Project</span>
            <select className="field" value={where} onChange={(e) => { setWhere(e.target.value); setCore(undefined); }}>
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
