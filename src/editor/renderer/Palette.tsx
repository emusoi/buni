import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, CircleHelp, Component, CornerDownLeft, FileText, ListChecks, Search, Server, Table2, Type, Workflow, type LucideIcon } from "lucide-react";
import type { Doc } from "buni/format/doc.ts";
import { search, type Hit } from "./search.ts";

const ICON = { page: FileText, flow: Workflow, component: Component, layer: Type } as const;
const SYSTEM_ICON = { part: Server, call: Braces, table: Table2, requirement: ListChecks, question: CircleHelp } as const;

/** Something to do from ⌘K; every one is also a button somewhere in the app. */
export interface Action { id: string; title: string; detail?: string; keys?: string; icon: LucideIcon; run: () => void }

type Row = { kind: "hit"; hit: Hit } | { kind: "action"; action: Action };

/** ⌘K: go to any page, flow, layer or piece of the system, or do something, by name. */
export function Palette({ doc, system, actions, onPick, onClose }: { doc: Doc; system?: Doc; actions: Action[]; onPick: (hit: Hit) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase().replace(/^>\s*/, "");
    const commandsOnly = query.trim().startsWith(">");
    const hits = commandsOnly ? [] : search(doc, query, 30, system).map((hit): Row => ({ kind: "hit", hit }));
    const acts = actions.filter((a) => !q || a.title.toLowerCase().includes(q)).map((action): Row => ({ kind: "action", action }));
    return [...hits, ...acts];
  }, [doc, system, actions, query]);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    // Braces matter: scrollIntoView returns a promise in newer Chromium, and an effect may only return a cleanup.
    void list.current?.querySelectorAll(".palette-row")[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === "hit") onPick(row.hit);
    else row.action.run();
  };
  const firstAction = rows.findIndex((r) => r.kind === "action");

  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search and commands">
        <label className="palette-input">
          <Search size={16} strokeWidth={1.75} />
          <input
            autoFocus
            placeholder="Go to a page, part or call… or do something"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === "Enter") pick(rows[cursor]);
            }}
          />
          <span className="kbd">esc</span>
        </label>
        <div className="palette-list" ref={list}>
          {rows.length === 0 && <p className="hint palette-empty">Nothing matches “{query}”.</p>}
          {rows.map((r, i) => {
            const on = i === cursor;
            const head = i === 0 && r.kind === "hit" ? "Go to" : i === firstAction ? "Do" : undefined;
            if (r.kind === "hit") {
              const h = r.hit;
              const Icon = h.kind === "system" ? SYSTEM_ICON[h.icon] : ICON[h.kind];
              return (
                <div key={`${h.kind}:${h.id}`}>
                  {head && <div className="palette-head">{head}</div>}
                  <button type="button" className={`palette-row${on ? " on" : ""}`} onPointerMove={() => setCursor(i)} onClick={() => pick(r)}>
                    <Icon size={15} strokeWidth={1.75} />
                    <span className="name">{h.title}</span>
                    <span className="meta">{h.detail}</span>
                  </button>
                </div>
              );
            }
            const a = r.action;
            return (
              <div key={`action:${a.id}`}>
                {head && <div className="palette-head">{head}</div>}
                <button type="button" className={`palette-row${on ? " on" : ""}`} onPointerMove={() => setCursor(i)} onClick={() => pick(r)}>
                  <a.icon size={15} strokeWidth={1.75} />
                  <span className="name">{a.title}</span>
                  {a.detail && <span className="meta">{a.detail}</span>}
                  {a.keys && <span className="kbd">{a.keys}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot"><span>↑↓ move</span><span><CornerDownLeft size={11} /> open</span><span className="grow" /><span>Type &gt; for commands only</span></div>
      </div>
    </div>
  );
}
