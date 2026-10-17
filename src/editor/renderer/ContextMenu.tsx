// A layer's right-click menu, as macOS draws one: what you'd reach for on that layer, with its shortcut beside it.
import { useCallback, useRef, useState } from "react";
import { ChevronRight, Diamond, FileText, Link2, MessageCircle, Unlink } from "lucide-react";
import { pagesInOrder, type Doc, type Id } from "buni/format/doc.ts";
import type { EditTool } from "../api.ts";
import { useDismiss } from "./useDismiss.ts";

export function ContextMenu({ doc, node, page, at, onRun, onComment, onClose }: {
  doc: Doc;
  node: Id;
  /** The page the layer is on: a link from it goes from there. */
  page: Id | undefined;
  at: { x: number; y: number };
  onRun: (tool: EditTool, args: Record<string, unknown>, pick?: (reply: string) => Id | undefined) => void;
  onComment: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, useCallback(() => onClose(), [onClose]), ref);
  const [linking, setLinking] = useState(false);
  const link = Object.values(doc.connections).find((c) => c.node === node && c.page === page && c.trigger === "click");
  const pages = pagesInOrder(doc).filter((p) => p.id !== page);
  const elsewhere = Object.values(doc.elsewhere ?? {});
  const act = (tool: EditTool, args: Record<string, unknown>, pick?: (reply: string) => Id | undefined) => { onRun(tool, args, pick); onClose(); };
  // Kept on screen: a menu opened near the right or bottom edge opens back towards the pointer.
  const left = Math.min(at.x, window.innerWidth - 250), top = Math.min(at.y, window.innerHeight - 330);
  const item = (label: string, keys: string, run: () => void, icon?: React.ReactNode) => (
    <button type="button" role="menuitem" className="menu-chat preset" onClick={run}>
      <span className="menu-name">{icon}{label}</span><span className="menu-state">{keys}</span>
    </button>
  );
  return (
    <div ref={ref} className="agent-menu context-menu" role="menu" style={{ left, top }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      {item("Comment…", "agents read it", () => { onComment(); onClose(); }, <MessageCircle size={13} />)}
      <div className="menu-rule" />
      {item("Copy", "⌘C", () => { document.execCommand("copy"); onClose(); })}
      {item("Duplicate", "⌘D", () => act("duplicate_nodes", { nodes: [node] }, (r) => r.match(/Copied: ([^,.\s]+)/)?.[1]))}
      {item("Wrap in a frame", "⌘G", () => act("wrap_nodes", { nodes: [node] }, (r) => r.match(/Frame (\S+) holds/)?.[1]))}
      {item("Make a component", "", () => act("make_component", { node }), <Diamond size={13} />)}
      <div className="menu-rule" />
      <div className="context-sub" onPointerEnter={() => setLinking(true)} onPointerLeave={() => setLinking(false)}>
        {item(link ? `Links to ${doc.pages[link.to]?.name ?? doc.elsewhere?.[link.to]?.name ?? "a page"}` : "Link to", "", () => setLinking((v) => !v), <Link2 size={13} />)}
        <ChevronRight size={12} className="context-chevron" />
        {linking && page && (
          <div className="agent-menu context-menu submenu" role="menu">
            {pages.map((p) => item(p.name, p.route ?? "", () => act("connect", { node, page, to: p.id }), <FileText size={13} />))}
            {elsewhere.length > 0 && <div className="menu-label">Other designs</div>}
            {elsewhere.map((p) => item(p.name, p.route ?? "", () => act("connect", { node, page, to: p.id }), <FileText size={13} />))}
            {link && <><div className="menu-rule" />{item("No link", "", () => act("disconnect", { connections: [link.id] }), <Unlink size={13} />)}</>}
          </div>
        )}
      </div>
      <div className="menu-rule" />
      {item("Delete", "⌫", () => act("delete_nodes", { nodes: [node] }, () => undefined))}
    </div>
  );
}
