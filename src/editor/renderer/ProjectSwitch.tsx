import { useCallback, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { HomeFile } from "../api.ts";
import { useDismiss } from "./useDismiss.ts";

/** The files of the open one's project, a project being the folder they share; the open file is in it. */
export function siblings(files: readonly HomeFile[], path: string): HomeFile[] {
  const folder = files.find((f) => f.path === path)?.folder;
  return folder === undefined ? [] : files.filter((f) => f.folder === folder).sort((a, b) => a.name.localeCompare(b.name));
}

/** The open file's name in the top bar; it opens the other designs of its project, so a big app split across files is one click apart. */
export function ProjectSwitch({ path, name }: { path: string; name: string }) {
  const [files, setFiles] = useState<HomeFile[]>();
  const anchor = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setFiles(undefined), []);
  useDismiss(files !== undefined, close, anchor);
  // Listed when opened, not kept: files come and go on disk while a design is open.
  const toggle = () => (files ? close() : void window.buni.home().then((all) => setFiles(siblings(all, path))));
  return (
    <div className="project-switch" ref={anchor}>
      <button type="button" title={`${path}: other designs in this project`} aria-haspopup="menu" aria-expanded={files !== undefined} onClick={toggle}>
        <b>{name}</b><ChevronDown size={13} />
      </button>
      {files && (
        <div className="agent-menu project-menu" role="menu">
          <div className="menu-label">This project</div>
          {files.length <= 1 && <p className="rail-empty">No other designs in this folder yet. Put an app's sections in one folder, a .buni file each, and they show here.</p>}
          {files.map((f) => (
            <button type="button" role="menuitem" key={f.path} className={`menu-chat${f.path === path ? " on" : ""}`} disabled={f.path === path} onClick={() => { close(); void window.buni.open(f.path); }}>
              <span className="menu-name">{f.name}</span>
              <span className="menu-state">{f.pages} page{f.pages === 1 ? "" : "s"}{f.agentNote ? ` · ${f.agentNote}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
