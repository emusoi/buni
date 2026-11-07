// The Agents panel with a terminal: Claude Code, Codex or a shell running beside the design, already connected to it
// through buni's MCP tools. Sessions live in buni open, so switching panels or reloading reattaches to them.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { X } from "lucide-react";
import type { Program, TermInfo } from "../terminals.ts";
import { agentColor } from "./Connect.tsx";

const NAMES: Record<Program, string> = { claude: "Claude Code", codex: "Codex", shell: "Shell" };
const SHORT: Record<Program, string> = { claude: "claude", codex: "codex", shell: "zsh" };

/** The terminal's colours from the editor's own, so it sits in the panel in either theme. */
function themeFromPage() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { background: v("--content", "#ffffff"), foreground: v("--ink", "#1c1c1e"), cursor: v("--ink", "#1c1c1e"), selectionBackground: v("--accent-tint", "rgba(0,98,204,0.15)") };
}

/** One session's screen: what it prints, and the keys typed into it. */
function TermView({ socket, onEnded }: { socket: string; onEnded: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeFromPage(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const ws = new WebSocket(socket);
    ws.binaryType = "arraybuffer";
    const size = () => {
      try {
        fit.fit();
      } catch {
        return; // not laid out yet
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cols: term.cols, rows: term.rows }));
    };
    ws.onopen = () => {
      size();
      term.focus();
    };
    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (typeof e.data !== "string") return void term.write(new Uint8Array(e.data));
      try {
        if ((JSON.parse(e.data) as { ended?: boolean }).ended) ended.current();
      } catch {
        // not a notice: ignore
      }
    };
    const typed = term.onData((input) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ input })));
    const resize = new ResizeObserver(size);
    resize.observe(el);
    return () => {
      resize.disconnect();
      typed.dispose();
      ws.close();
      term.dispose();
    };
  }, [socket]);
  return <div className="term-host" ref={host} />;
}

/** `onWiden` asks for room: a terminal needs about eighty columns. */
export function AgentsPanel({ activity, onWiden }: { activity: ReactNode; onWiden?: () => void }) {
  const api = window.buni.terminals;
  const [sessions, setSessions] = useState<TermInfo[]>([]);
  // A session's id, or the agents' activity (what they did, connecting by hand).
  const [shown, setShown] = useState<string>();
  const [ended, setEnded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const widen = useRef(onWiden);
  useEffect(() => {
    if (api) widen.current?.();
  }, [api]);
  useEffect(() => {
    void api?.list().then((list) => {
      // ?start=claude (buni open --agent) starts one when none runs; the address forgets it, so a reload doesn't.
      const params = new URLSearchParams(location.search);
      const wanted = params.get("start");
      if (wanted) {
        params.delete("start");
        history.replaceState(history.state, "", `${location.pathname}?${params}`);
      }
      const program = (["claude", "codex", "shell"] as const).find((p) => p === wanted);
      if (program && !list.some((s) => s.alive)) return start(program);
      setSessions(list);
      setEnded(new Set(list.filter((s) => !s.alive).map((s) => s.id)));
      setShown((s) => s ?? list[0]?.id);
    });
  }, [api]);
  if (!api) return <>{activity}</>;
  function start(program: Program) {
    if (!api) return;
    setError(undefined);
    void api.start(program, 100, 30).then((s) => {
      setSessions((list) => [...list, s]);
      setShown(s.id);
    }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }
  const close = (id: string) => {
    void api.close(id).then(() => {
      setSessions((list) => {
        const rest = list.filter((s) => s.id !== id);
        setShown((cur) => (cur === id ? rest.at(-1)?.id : cur));
        return rest;
      });
    });
  };
  const current = sessions.find((s) => s.id === shown);
  return (
    <div className="agents-term">
      <div className="term-bar" role="tablist" aria-label="Agent sessions">
        {sessions.map((s) => (
          <span key={s.id} className={`term-chip${s.id === shown ? " on" : ""}${ended.has(s.id) ? " ended" : ""}`}>
            <button type="button" role="tab" aria-selected={s.id === shown} onClick={() => setShown(s.id)}>
              {s.program !== "shell" && <span className="term-dot" style={{ background: agentColor(s.program === "claude" ? "claude-code" : s.program) }} />}
              {SHORT[s.program]}
            </button>
            <button type="button" className="term-x" aria-label={`Close ${NAMES[s.program]}`} title="Close" onClick={() => close(s.id)}><X size={11} /></button>
          </span>
        ))}
        {(["claude", "codex", "shell"] as const).map((p) => (
          <button key={p} type="button" className="term-add" onClick={() => start(p)} title={`Start ${NAMES[p]} here`}>+ {SHORT[p]}</button>
        ))}
        <span className="grow" />
        <button type="button" className={`term-add${shown === "activity" ? " on" : ""}`} onClick={() => setShown("activity")}>Activity</button>
      </div>
      {error && <div className="notice">{error}</div>}
      {shown === "activity" ? (
        <div className="term-activity">{activity}</div>
      ) : current ? (
        <>
          {ended.has(current.id) && (
            <div className="term-ended">
              <span>{NAMES[current.program]} ended.</span>
              <button type="button" className="btn small" onClick={() => { close(current.id); start(current.program); }}>Start again</button>
            </div>
          )}
          <TermView key={current.id} socket={api.socket(current.id)} onEnded={() => setEnded((e) => new Set(e).add(current.id))} />
        </>
      ) : (
        <div className="term-empty">
          <p className="term-empty-title">Run a coding agent beside the design</p>
          <p className="hint">It starts in this project with buni's tools connected: every change it makes lands here, and ⌘Z takes it back.</p>
          <div className="term-empty-actions">
            <button type="button" className="btn primary" onClick={() => start("claude")}>Start Claude Code</button>
            <button type="button" className="btn" onClick={() => start("codex")}>Codex</button>
            <button type="button" className="btn" onClick={() => start("shell")}>Shell</button>
          </div>
        </div>
      )}
    </div>
  );
}
