import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

/**
 * Whether a side panel is showing: remembered between launches under `key` and shared by every screen. With
 * `shortcut`, ⌘\ toggles it; the editor turns that off and uses ⌘\ for both panels at once.
 */
export function useSidebar(key = "buni.sidebar", shortcut = true): [boolean, (open?: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "closed";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, open ? "open" : "closed");
    } catch {
      // Remembering it is a convenience; without storage the sidebar starts open.
    }
  }, [open, key]);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  return [open, (to?: boolean) => setOpen((o) => to ?? !o)];
}

export function SidebarToggle({ open, onToggle, side = "left", hint = "⌘\\" }: { open: boolean; onToggle: () => void; side?: "left" | "right"; hint?: string }) {
  const Icon = side === "left" ? (open ? PanelLeftClose : PanelLeftOpen) : open ? PanelRightClose : PanelRightOpen;
  const what = side === "left" ? "sidebar" : "panel";
  return (
    <button
      type="button"
      className="icon-btn sidebar-toggle"
      aria-label={`${open ? "Hide" : "Show"} ${what}`}
      aria-expanded={open}
      title={`${open ? "Hide" : "Show"} ${what} (${hint})`}
      onClick={onToggle}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
