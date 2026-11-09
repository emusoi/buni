// The Agents panel with a terminal: Claude Code, Codex or a shell running beside the design, already connected to it
// through buni's MCP tools. Sessions live in buni open, so switching panels or reloading reattaches to them.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Terminal } from "@xterm/xterm";
import { X } from "lucide-react";
import type { Program, TermInfo } from "../terminals.ts";
import { agentColor } from "./Connect.tsx";

/** Home hands a new design its first request here; the design's Agents panel picks it up. */
const ASK = "buni.ask";
export function askFirst(prompt: string, program: Program = "claude"): void {
  try {
    sessionStorage.setItem(ASK, JSON.stringify({ prompt, program, at: Date.now() }));
  } catch {
    // no storage: the design opens without the request
  }
}
/** A request home left in the last minute, and the agent it's for, taken once. */
export function pendingAsk(take = false): { prompt: string; program: Program } | undefined {
  try {
    const raw = sessionStorage.getItem(ASK);
    if (!raw) return undefined;
    const { prompt, program, at } = JSON.parse(raw) as { prompt?: unknown; program?: unknown; at?: unknown };
    if (take) sessionStorage.removeItem(ASK);
    if (typeof prompt !== "string" || typeof at !== "number" || Date.now() - at >= 60_000) return undefined;
    return { prompt, program: program === "codex" ? "codex" : "claude" };
  } catch {
    return undefined;
  }
}

const NAMES: Record<Program, string> = { claude: "Claude Code", codex: "Codex", shell: "Shell" };
const SHORT: Record<Program, string> = { claude: "claude", codex: "codex", shell: "zsh" };

/** The terminal's colours from the editor's own, so it sits in the panel in either theme. */
function themeFromPage() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { background: v("--content", "#ffffff"), foreground: v("--ink", "#1c1c1e"), cursor: v("--ink", "#1c1c1e"), selectionBackground: v("--accent-tint", "rgba(0,98,204,0.15)") };
}

/** One session's screen: what it prints, and the keys typed into it. */
/** `typeRef` is set to a way to type into the session (and focus it), for "ask about the selection". */
function TermView({ socket, onEnded, typeRef }: { socket: string; onEnded: () => void; typeRef?: { current: ((text: string) => void) | undefined } }) {
  const host = useRef<HTMLDivElement>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // The terminal's code loads with the first terminal: a hosted buni, which has none, never fetches it.
    let gone = false;
    let stop = () => {};
    void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]).then(([{ Terminal }, { FitAddon }]) => {
      if (gone) return;
      stop = open(el, Terminal, FitAddon);
    });
    return () => {
      gone = true;
      stop();
    };
  }, [socket]);
  function open(el: HTMLDivElement, Term: typeof Terminal, Fit: typeof import("@xterm/addon-fit").FitAddon): () => void {
    const term = new Term({
      fontFamily: '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeFromPage(),
    });
    const fit = new Fit();
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
    if (typeRef) typeRef.current = (input) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ input }));
      term.focus();
    };
    const resize = new ResizeObserver(size);
    resize.observe(el);
    return () => {
      if (typeRef) typeRef.current = undefined;
      resize.disconnect();
      typed.dispose();
      ws.close();
      term.dispose();
    };
  }
  return <div className="term-host" ref={host} />;
}

/** The last ⌘L answered, across the panel's remounts. */
let handledAsk = 0;

/** What is selected on the canvas, for the agent to work on exactly that. */
export interface Selection {
  id: string;
  label: string;
  page?: string;
}

/** How a selection is named to an agent: enough for buni's tools to find it, nothing it has to guess. */
export const aboutSelection = (s: Selection) => `In the buni design, the layer ${s.label} (id ${s.id})${s.page ? ` on the page "${s.page}"` : ""}: `;

/** What to ask about the page the person is on: one click fills the composer. */
const suggestions = (page?: string): string[] => [
  page ? `Review "${page}" against the design doc and fix what's off` : "Review the design against its doc and fix what's off",
  page ? `Add the states "${page}" is missing: empty, loading, error` : "Add the states the screens are missing: empty, loading, error",
  "Tidy names, spacing and type across the pages",
];

/** `onWiden` asks for room: a terminal needs about eighty columns. `page` is the page the person is on. */
export function AgentsPanel({ activity, onWiden, page, selection, askNonce }: { activity: ReactNode; onWiden?: () => void; page?: string; selection?: Selection; askNonce?: number }) {
  const typeInto = useRef<((text: string) => void) | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
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
      setLoaded(true);
      // ?start=claude (buni open --agent) starts one when none runs; the address forgets it, so a reload doesn't.
      const params = new URLSearchParams(location.search);
      const wanted = params.get("start");
      if (wanted) {
        params.delete("start");
        history.replaceState(history.state, "", `${location.pathname}?${params}`);
      }
      const program = (["claude", "codex", "shell"] as const).find((p) => p === wanted);
      const ask = pendingAsk(true);
      setSessions(list);
      setEnded(new Set(list.filter((s) => !s.alive && !s.saved).map((s) => s.id)));
      if (ask && !list.some((s) => s.alive)) return start(ask.program, ask.prompt);
      if (program && !list.some((s) => s.alive)) return start(program);
      // The latest agent, so a design opened again carries on with the one it was talking to.
      setShown((s) => s ?? list.at(-1)?.id);
    });
  }, [api]);
  // Each start of a session's terminal, so its screen reconnects when the session is resumed under the same id.
  const [runs, setRuns] = useState(0);
  const resuming = useRef(new Set<string>());
  const current = sessions.find((s) => s.id === shown);
  // A remembered agent comes back when it's shown: Claude Code or Codex resumed in its conversation.
  useEffect(() => {
    if (current?.saved) resume(current);
  }, [current?.id, current?.saved]);
  if (!api) return <>{activity}</>;
  function resume({ id, program }: TermInfo) {
    if (!api || resuming.current.has(id)) return;
    resuming.current.add(id);
    setError(undefined);
    void api.start(program, 100, 30, undefined, id).then((s) => {
      setSessions((list) => list.map((x) => (x.id === id ? s : x)));
      setEnded((e) => new Set([...e].filter((x) => x !== id)));
      setRuns((n) => n + 1);
    }, (e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => resuming.current.delete(id));
  }
  function start(program: Program, ask?: string) {
    if (!api) return;
    setError(undefined);
    void api.start(program, 100, 30, ask).then((s) => {
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
  const live = current && !ended.has(current.id) && current.program !== "shell" ? current : undefined;
  /** The selection goes to the running agent's prompt, or into the composer when none runs. */
  const ask = () => {
    if (!selection) return;
    const ref = aboutSelection(selection);
    if (live && typeInto.current) return typeInto.current(ref);
    setShown(undefined);
    setDraft((d) => (d.startsWith(ref) ? d : ref + d));
  };
  // ⌘L may open this panel and ask at once: it answers once the sessions are known, and each press only once.
  useEffect(() => {
    if (loaded && askNonce !== undefined && askNonce > handledAsk) {
      handledAsk = askNonce;
      ask();
    }
  });
  return (
    <div className="agents-term">
      {(sessions.length > 0 || shown === "activity") && <div className="term-bar" role="tablist" aria-label="Agent sessions">
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
      </div>}
      {error && <div className="notice">{error}</div>}
      {selection && shown !== "activity" && (
        <div className="agent-selection">
          <span className="agent-selection-what"><span className="hint">Selected</span> <b>{selection.label}</b>{selection.page ? <span className="hint"> on {selection.page}</span> : null}</span>
          <button type="button" className="link-btn" onClick={ask} title="Name it to the agent, then say what to do (⌘L)">Ask about it <kbd>⌘L</kbd></button>
        </div>
      )}
      {shown === "activity" ? (
        <div className="term-activity">{activity}</div>
      ) : current ? (
        <>
          {ended.has(current.id) && (
            <div className="term-ended">
              <span>{NAMES[current.program]} ended.</span>
              {current.program === "shell"
                ? <button type="button" className="btn small" onClick={() => { close(current.id); start(current.program); }}>Start again</button>
                : <button type="button" className="btn small" onClick={() => resume(current)}>Resume</button>}
            </div>
          )}
          {current.saved ? <div className="term-ended"><span>Resuming {NAMES[current.program]}…</span></div> : <TermView key={`${current.id}:${runs}`} socket={api.socket(current.id)} typeRef={typeInto} onEnded={() => setEnded((e) => new Set(e).add(current.id))} />}
        </>
      ) : (
        <Composer page={page} text={draft} setText={setDraft} onStart={start} onActivity={() => setShown("activity")} />
      )}
    </div>
  );
}

/** No agent running yet: say what to do, and the agent starts on it. */
function Composer({ page, text, setText, onStart, onActivity }: { page?: string; text: string; setText: (t: string) => void; onStart: (program: Program, ask?: string) => void; onActivity: () => void }) {
  const [agent, setAgent] = useState<"claude" | "codex">("claude");
  const box = useRef<HTMLTextAreaElement>(null);
  // A selection put in: the cursor waits after it, for what to do.
  useEffect(() => {
    const el = box.current;
    if (el && text && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(text.length, text.length);
    }
  }, [text]);
  const send = () => text.trim() && onStart(agent, text.trim());
  return (
    <div className="agent-start">
      <div className="agent-start-head">
        <p className="agent-start-title">What should the agent do?</p>
        <p className="hint">It works in this project with buni's tools, beside you: each change lands on the canvas, and ⌘Z takes it back.</p>
      </div>
      <div className="agent-suggest">
        {suggestions(page).map((s) => (
          <button key={s} type="button" onClick={() => { setText(s); box.current?.focus(); }}>{s}</button>
        ))}
      </div>
      <span className="grow" />
      <form className="agent-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={box} rows={3} value={text} placeholder="Describe a change…" aria-label="Describe a change for the agent" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="agent-compose-bar">
          <select value={agent} aria-label="Agent" onChange={(e) => setAgent(e.target.value === "codex" ? "codex" : "claude")}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <span className="grow" />
          <button type="button" className="link-btn" onClick={() => onStart(agent)}>Start without a message</button>
          <button type="submit" className="btn primary" disabled={!text.trim()}>Send</button>
        </div>
      </form>
      <div className="agent-start-foot">
        <button type="button" className="link-btn" onClick={() => onStart("shell")}>Open a shell</button>
        <button type="button" className="link-btn" onClick={onActivity}>What agents did</button>
      </div>
    </div>
  );
}

/** A design's name from a request: its first sentence, at most five words. */
export function designName(prompt: string): string {
  const first = prompt.split(/[.!?\n:;]/)[0] ?? "";
  return first.split(/\s+/).filter(Boolean).slice(0, 5).join(" ").replace(/[^\p{L}\p{N} -]/gu, "").trim() || "Untitled";
}

/**
 * Home's "describe what you want to build": a new design, named from the words, opened with Claude Code starting on
 * them beside the canvas. Only where terminals run (buni open).
 */
export function Describe({ onError }: { onError: (message: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<"claude" | "codex">("claude");
  const submit = () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const name = designName(prompt);
    setBusy(true);
    askFirst(prompt, agent);
    window.buni.create(name).catch((e: unknown) => {
      setBusy(false);
      onError(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <form className="describe" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor="describe-input">Describe what you want to build</label>
      <div className="describe-box">
        <textarea id="describe-input" rows={2} value={text} placeholder="A calm checkout for a small shop: cart, address, payment, done." onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button type="submit" className="btn primary" disabled={!text.trim() || busy}>{busy ? "Starting…" : "Design it"}</button>
      </div>
      <div className="describe-foot">
        <div className="segmented small" role="radiogroup" aria-label="Agent">
          {(["claude", "codex"] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={agent === p} className={agent === p ? "on" : ""} onClick={() => setAgent(p)}>{NAMES[p]}</button>)}
        </div>
        <p className="hint">buni makes the design and {NAMES[agent]} starts on it beside the canvas.</p>
      </div>
    </form>
  );
}
