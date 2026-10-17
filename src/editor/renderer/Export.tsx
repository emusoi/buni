// Taking the design out of buni: backend contracts to paste into tools, and the design as a file, a site or a PDF.
// Agents read the design itself over MCP, so nothing here is a brief for them.
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "./useDismiss.ts";
import { Braces, Database, Server, Share } from "lucide-react";
import type { Doc } from "buni/format/doc.ts";
import { openApi, sqlSchema } from "buni/tools/backend.ts";

/** A path to try the mock with: a GET if there is one (it opens in a browser), its {params} filled in. */
function sampleCall(doc: Doc): string {
  const all = Object.values(doc.endpoints);
  const e = all.find((x) => x.method === "GET") ?? all[0];
  return (e?.path ?? "/").replace(/\{[^}]+\}/g, "1");
}

export function Export({ system, path, onToast, shown, onClose, children }: {
  system: Doc;
  path: string;
  onToast: (text: string) => void;
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

  const give = async (text: string, toast: string) => {
    await navigator.clipboard.writeText(text);
    setOpen(false);
    onToast(toast);
  };

  return (
    <span className="export-anchor" ref={anchor}>
      {shown === undefined && (
        <button type="button" className="icon-btn" aria-expanded={open} aria-label="Export" onClick={() => setOwn((o) => !o)} title="Export: the file, a website, a PDF, backend contracts">
          <Share size={16} strokeWidth={1.75} />
        </button>
      )}
      {open && (
        <div className="agent-menu export-menu" onPointerLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="menu-label">Share the design</div>
          <div onClick={() => setOpen(false)}>{children}</div>
          {(Object.keys(system.endpoints).length > 0 || Object.keys(system.tables).length > 0) && (
            <>
              <div className="menu-rule" />
              <div className="menu-label">For the backend</div>
              {Object.keys(system.endpoints).length > 0 && (
                <button type="button" className="menu-chat preset" onClick={() => void give(JSON.stringify(openApi(system), null, 2), "Copied the OpenAPI 3.1 document. Paste it into your API tools, or a file as openapi.json.")}>
                  <span className="menu-name"><Braces size={13} /> OpenAPI</span>
                  <span className="menu-state">{Object.keys(system.endpoints).length} endpoints, JSON</span>
                </button>
              )}
              {Object.keys(system.tables).length > 0 && (
                <button type="button" className="menu-chat preset" onClick={() => void give(sqlSchema(system), "Copied the schema as Postgres DDL, referenced tables first.")}>
                  <span className="menu-name"><Database size={13} /> SQL schema</span>
                  <span className="menu-state">{Object.keys(system.tables).length} tables, Postgres</span>
                </button>
              )}
              {Object.keys(system.endpoints).length > 0 && (
                <button type="button" className="menu-chat preset" onClick={() => void give(`${location.origin}/mock${sampleCall(system)}?file=${encodeURIComponent(new URLSearchParams(location.search).get("file") ?? path)}`, "Copied a mock API address. Swap the path for any endpoint's; add &status=409 for a designed error.")}>
                  <span className="menu-name"><Server size={13} /> Mock API</span>
                  <span className="menu-state">example data, before it's built</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
