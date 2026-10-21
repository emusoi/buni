// Taking the design out of buni: the design as a file, a site, a picture or a PDF.
// Agents read the design itself over MCP, so nothing here is a brief for them.
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "./useDismiss.ts";
import { Share } from "lucide-react";

export function Export({ shown, onClose, children }: {
  /** Opens it from elsewhere (the toolbar's menu) instead of its own button; `onClose` closes it. */
  shown?: boolean;
  onClose?: () => void;
  /** Sharing the design itself: website, PDF, image exports. */
  children: ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const open = shown ?? own;
  const setOpen = (o: boolean) => (shown === undefined ? setOwn(o) : !o && onClose?.());
  const anchor = useRef<HTMLSpanElement>(null);
  useDismiss(open, useCallback(() => (shown === undefined ? setOwn(false) : onClose?.()), [shown, onClose]), anchor);

  return (
    <span className="export-anchor" ref={anchor}>
      {shown === undefined && (
        <button type="button" className="icon-btn" aria-expanded={open} aria-label="Export" onClick={() => setOwn((o) => !o)} title="Export: the file, a website, a picture, a PDF">
          <Share size={16} strokeWidth={1.75} />
        </button>
      )}
      {open && (
        <div className="agent-menu export-menu" onPointerLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="menu-label">Share the design</div>
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      )}
    </span>
  );
}
