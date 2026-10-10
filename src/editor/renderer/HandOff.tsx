// Where design ends: a brief for the slice an agent should build next, copied to paste into Claude Code or Codex.
// Sharing the design itself (a website, a PDF, an image) sits below, as the lesser job.
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "./useDismiss.ts";
import { ArrowRightFromLine, Braces, Check, Copy, Database, Server } from "lucide-react";
import { walkFlow, type Doc, type Id } from "buni/format/doc.ts";
import { openApi, sqlSchema } from "buni/tools/backend.ts";
import { contextText, type Focus } from "buni/tools/context.ts";
import { forTarget, targetName } from "buni/tools/terminal.ts";

const FRAMEWORK_NAME: Record<string, string> = {
  bubbletea: "Bubble Tea", ratatui: "Ratatui", textual: "Textual", ink: "Ink", opentui: "OpenTUI", "pi-tui": "pi-tui",
  go: "Go", rust: "Rust", python: "Python", typescript: "TypeScript",
};

/** A path to try the mock with: a GET if there is one (it opens in a browser), its {params} filled in. */
function sampleCall(doc: Doc): string {
  const all = Object.values(doc.endpoints);
  const e = all.find((x) => x.method === "GET") ?? all[0];
  return (e?.path ?? "/").replace(/\{[^}]+\}/g, "1");
}

interface Slice {
  key: string;
  title: string;
  detail: string;
  focus: Focus | undefined;
  /** What `buni context` takes for it. */
  arg: string;
}

export function HandOff({ system, path, page, flow, part, onToast, children }: {
  system: Doc;
  path: string;
  page: Id | undefined;
  flow: Id | undefined;
  part: Id | undefined;
  onToast: (text: string) => void;
  /** Sharing the design itself: website, PDF, image exports. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), anchor);
  // Builds of terminal clients designed several ways; a brief speaks one of them.
  const targets = [...new Set(Object.values(system.parts).flatMap((p) => ((p.terminal?.targets.length ?? 0) > 1 ? p.terminal?.targets.map(targetName) ?? [] : [])))];
  const [target, setTarget] = useState<ReturnType<typeof targetName>>();
  const build = target && targets.includes(target) ? target : targets[0];

  const slices: Slice[] = [
    ...(page && system.pages[page] ? [{ key: "page", title: `This page`, detail: system.pages[page]?.name ?? page, focus: { page }, arg: `page:${page}` }] : []),
    ...(flow && system.flows[flow] ? [{ key: "flow", title: "This flow", detail: `${system.flows[flow]?.name} · ${walkFlow(system, system.flows[flow]?.start ?? "").pages.length} screens`, focus: { flow }, arg: `flow:${flow}` }] : []),
    ...(part && system.parts[part] ? [{ key: "part", title: "This part", detail: system.parts[part]?.name ?? part, focus: { part }, arg: `part:${part}` }] : []),
    { key: "all", title: "The whole file", detail: "screens and system", focus: undefined, arg: "" },
  ];

  const give = async (text: string, toast: string) => {
    await navigator.clipboard.writeText(text);
    setOpen(false);
    onToast(toast);
  };

  const copy = async (s: Slice) => {
    const doc = build ? forTarget(system, build) ?? system : system;
    const r = contextText(doc, s.focus);
    if (!r.ok) return onToast(r.error);
    await navigator.clipboard.writeText(r.text);
    setOpen(false);
    const file = path.split("/").pop() ?? path;
    // `buni context` reads files on disk, so the web, whose files live on its server, leaves that hint out.
    onToast(`Copied the brief${build ? ` for ${FRAMEWORK_NAME[build] ?? build}` : ""}. Paste it to Claude Code or Codex`);
  };

  return (
    <span className="export-anchor" ref={anchor}>
      <button type="button" className="bar-btn pill handoff" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="A brief for an agent to build from">
        <ArrowRightFromLine size={14} /> Hand off
      </button>
      {open && (
        <div className="agent-menu export-menu handoff-menu" onPointerLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="menu-label">Copy a brief to build from</div>
          {targets.length > 1 && (
            <div className="handoff-targets" role="radiogroup" aria-label="Build it with">
              {targets.map((t) => (
                <button type="button" key={t} role="radio" aria-checked={t === build} className={t === build ? "on" : ""} onClick={() => setTarget(t)}>
                  {t === build && <Check size={12} />} {FRAMEWORK_NAME[t] ?? t}
                </button>
              ))}
            </div>
          )}
          {slices.map((s) => (
            <button type="button" key={s.key} className="menu-chat preset" onClick={() => void copy(s)}>
              <span className="menu-name"><Copy size={13} /> {s.title}</span>
              <span className="menu-state">{s.detail}</span>
            </button>
          ))}
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
          <div className="menu-rule" />
          <div className="menu-label">Share the design</div>
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      )}
    </span>
  );
}
