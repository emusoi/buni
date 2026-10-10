// The window's tabs, one per open file or Files view, drawn in each page's own top bar.
import { useEffect, useState } from "react";
import { FileText, LayoutGrid, Plus, X } from "lucide-react";
import type { StripApi, StripState } from "../api.ts";

declare global {
  interface Window {
    tabs: StripApi;
  }
}

export function FileTabs() {
  const [state, setState] = useState<StripState>({ tabs: [], active: undefined });
  const [drag, setDrag] = useState<number>();
  useEffect(() => window.tabs.onTabs(setState), []);
  // The desktop always has a tab; a host with none (the web, where browser tabs do this) shows no strip.
  if (state.tabs.length === 0) return null;
  return (
    <div className="file-tabs" role="tablist" onDoubleClick={(e) => e.target === e.currentTarget && void window.tabs.newTab()}>
      {state.tabs.map((t, i) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === state.active}
          className={`file-tab${t.id === state.active ? " on" : ""}${drag === t.id ? " dragging" : ""}`}
          title={t.title}
          draggable
          onDragStart={() => setDrag(t.id)}
          onDragEnd={() => setDrag(undefined)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drag !== undefined && drag !== t.id && void window.tabs.move(drag, i)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              void window.tabs.close(t.id);
            } else if (e.button === 0 && t.id !== state.active) void window.tabs.select(t.id);
          }}
        >
          {t.file ? <FileText size={14} strokeWidth={1.75} /> : <LayoutGrid size={14} strokeWidth={1.75} />}
          <span className="title">{t.title}</span>
          <button type="button" className="close" aria-label={`Close ${t.title}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => void window.tabs.close(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="file-tab-new" aria-label="New tab" title="New tab (⌘T)" onClick={() => void window.tabs.newTab()}>
        <Plus size={15} />
      </button>
    </div>
  );
}
