import { useCallback, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { ProjectFile } from "../api.ts";
import { loadProject, siblings } from "./projectStore.ts";
import { useDismiss } from "./useDismiss.ts";
import { NameDialog } from "./Ask.tsx";

export { siblings } from "./projectStore.ts";

/** "12 pages", or for a core file of components only, "4 components". */
const describe = (f: ProjectFile): string => {
  const n = f.pages.length || f.components.length;
  return `${n} ${f.pages.length || n === 0 ? "page" : "component"}${n === 1 ? "" : "s"}`;
};

/** The open file's name in the top bar; it opens the other designs of its project, so a big app split across files is one click apart. */
export function ProjectSwitch({ path, name, detail }: { path: string; name: string; detail?: string }) {
  const [files, setFiles] = useState<ProjectFile[]>();
  const [naming, setNaming] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setFiles(undefined), []);
  useDismiss(files !== undefined, close, anchor);
  // A new design joins this project; where the host names files (the web) it is named first, the desktop asks where.
  const add = () => { close(); if (window.buni.renameFile) setNaming(true); else void window.buni.create(); };
  // Listed fresh when opened: files come and go on disk while a design is open (and the project's summaries are small).
  const toggle = () => (files ? close() : void loadProject(true).then((all) => setFiles(siblings(all, path))));
  return (
    <div className="project-switch" ref={anchor}>
      <button type="button" title={`${path}: other designs in this project`} aria-haspopup="menu" aria-expanded={files !== undefined} onClick={toggle}>
        <span className="title"><b>{name}</b>{detail && <small>{detail}</small>}</span><ChevronDown size={13} />
      </button>
      {files && (
        <div className="agent-menu project-menu" role="menu">
          <div className="menu-label">This project</div>
          {files.length <= 1 && <p className="rail-empty">No other designs in this folder yet. Put an app's sections in one folder, a .buni file each, and they show here.</p>}
          {files.map((f) => (
            <button type="button" role="menuitem" key={f.path} className={`menu-chat${f.path === path ? " on" : ""}`} disabled={f.path === path} onClick={() => { close(); void window.buni.open(f.path); }}>
              <span className="menu-name">{f.name}</span>
              <span className="menu-state">{describe(f)}{f.agentNote ? ` · ${f.agentNote}` : ""}</span>
            </button>
          ))}
          <button type="button" role="menuitem" className="menu-chat preset" onClick={add}>
            <span className="menu-name"><Plus size={13} /> New design in this project</span>
          </button>
        </div>
      )}
      {naming && <NameDialog title="New design in this project" label="Name" initial="Untitled" action="Create" onClose={() => setNaming(false)} onSubmit={(n) => { setNaming(false); void window.buni.create(n); }} />}
    </div>
  );
}
