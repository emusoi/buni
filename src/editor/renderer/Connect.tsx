import { useEffect, useState } from "react";
import { Copy, MessageSquare, Pause, Play, Undo2 } from "lucide-react";
import type { Edit } from "../api.ts";
import type { AgentState } from "buni/tools/protocol.ts";
import { ago } from "./Home.tsx";
import type { Doc, Id } from "buni/format/doc.ts";
import { pageOfNode } from "./search.ts";

const COLORS = ["#d9480f", "#2b8a3e", "#3346d3", "#9c36b5", "#0b7285", "#c2255c"];
/** A connected agent's colour, the same every time for the same name. */
export const agentColor = (name: string) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length] ?? "#3346d3";
/** Two letters for an agent's dot: "claude-code" is CC, "codex" is CO. */
export const agentInitials = (name: string) => {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2)).toUpperCase();
};

/**
 * The coding agents connected to this file and
 * where each last worked, then how to connect another.
 */
export function ConnectAgent({ doc, mcpUrl, connected, recent, edits, agents = [], onShow, onToast, onUndo }: { doc: Doc; mcpUrl: string; connected: readonly string[]; recent: Record<string, readonly Id[]>; edits: readonly Edit[]; agents?: readonly AgentState[]; onShow: (node: Id) => void; onToast: (t: string) => void; onUndo?: () => void }) {
  const [asking, setAsking] = useState<string>();
  const [words, setWords] = useState("");
  const tell = async (name: string) => {
    if (!words.trim() || !window.buni.tellAgent) return;
    await window.buni.tellAgent(name, words.trim());
    setWords("");
    setAsking(undefined);
    onToast(`${name} reads it with its next step.`);
  };
  // Re-read the clock now and then, so "just now" becomes "2 min ago" without an edit to prompt it.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Hosted, the server wants a token with every call: made here, once, and written into the lines.
  const needsToken = Boolean(window.buni.agentToken);
  const [token, setToken] = useState<string>();
  const [making, setMaking] = useState(false);
  const makeToken = () => {
    setMaking(true);
    void window.buni.agentToken?.("coding agent").then(setToken, (e: unknown) => onToast(e instanceof Error ? e.message : String(e))).finally(() => setMaking(false));
  };
  const ways = needsToken && token
    ? [
      { title: "Claude Code", text: `claude mcp add --transport http buni "${mcpUrl}" --header "Authorization: Bearer ${token}"` },
      { title: "Codex", text: `export BUNI_TOKEN=${token}\ncodex mcp add buni --url "${mcpUrl}" --bearer-token-env-var BUNI_TOKEN` },
      { title: "Any MCP client", text: `${mcpUrl}\nAuthorization: Bearer ${token}` },
    ]
    : needsToken ? [] : [
      { title: "Claude Code", text: `claude mcp add --transport http buni "${mcpUrl}"` },
      { title: "Codex or any MCP client", text: mcpUrl },
    ];
  // Agents connected now, then ones that edited here earlier and have since gone.
  const names = [...new Set([...connected, ...Object.keys(recent).filter((n) => n !== "you")])];
  return (
    <div className="connect-agent">
      {names.length > 0 && (
        <section className="agent-cards">
          {names.map((name) => {
            const touched = recent[name]?.[0];
            const page = touched ? doc.pages[pageOfNode(doc, touched) ?? ""]?.name : undefined;
            const live = connected.includes(name);
            const mine = edits.filter((e) => e.author === name).slice(-12).reverse();
            const state = agents.find((a) => a.name === name);
            const lastIsTheirs = edits.at(-1)?.author === name;
            const canSteer = live && Boolean(window.buni.pauseAgent);
            return (
              <div key={name} className="agent-card">
                <span className="agent-dot" style={{ background: agentColor(name) }}>{agentInitials(name)}</span>
                <div>
                  <b>{name} <span className={live ? "live" : "live off"} /> <small>{state?.paused ? "paused" : live ? "connected" : "gone"}</small></b>
                  <span>{page ? <>Working on <em>{page}</em>. ⌘Z takes any of it back.</> : "Connected; no edits yet."}</span>
                  {state?.tool && (
                    <span className={`agent-now${state.busy ? " busy" : ""}`}>
                      {state.paused && state.busy ? "Held before its next step · last " : state.busy ? "Now: " : "Last: "}<code>{state.tool}</code>{state.at && <> · {ago(state.at, now)}</>}
                    </span>
                  )}
                  {canSteer && (
                    <div className="agent-controls">
                      <button type="button" className="btn small" onClick={() => void window.buni.pauseAgent?.(name, !state?.paused)}>
                        {state?.paused ? <><Play size={12} /> Continue</> : <><Pause size={12} /> Pause</>}
                      </button>
                      <button type="button" className="btn small" onClick={() => setAsking(asking === name ? undefined : name)}><MessageSquare size={12} /> Ask it</button>
                      {onUndo && <button type="button" className="btn small" disabled={!lastIsTheirs} title={lastIsTheirs ? "Take back its last edit" : "Its last edit isn't the latest one; ⌘Z steps back through all of them"} onClick={onUndo}><Undo2 size={12} /> Undo last</button>}
                    </div>
                  )}
                  {asking === name && (
                    <form className="agent-ask" onSubmit={(e) => { e.preventDefault(); void tell(name); }}>
                      <input className="field" autoFocus placeholder={`Tell ${name} something; it reads it before its next step`} value={words} onChange={(e) => setWords(e.target.value)} />
                    </form>
                  )}
                  {mine.length > 0 && (
                    <ol className="agent-edits" aria-label={`What ${name} did last`}>
                      {mine.map((e) => (
                        <li key={`${e.at}${e.label}`}>
                          <button type="button" disabled={!e.nodes[0]} onClick={() => e.nodes[0] && onShow(e.nodes[0])} title={e.nodes[0] ? "Show it on the canvas" : undefined}>
                            <span>
                              <b>{(e.nodes[0] && doc.nodes[e.nodes[0]]?.name) || e.label}</b>
                              <small>{e.label}{e.nodes.length > 1 ? ` · ${e.nodes.length} layers` : ""}</small>
                            </span>
                            <time dateTime={e.at}>{ago(e.at, now)}</time>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
      <section className="connect-ways">
        <h3>{names.length ? "Connect another agent" : "Connect a coding agent"}</h3>
        <p className="hint">It edits this design through buni's tools. You see every change land here.</p>
        {needsToken && !token && (
          <div className="connect-way">
            <b>A token for it</b>
            <p className="hint">The agent signs in to this server with a token of its own, which you can revoke on your account page. It shows once.</p>
            <button type="button" className="btn" disabled={making} onClick={makeToken}>{making ? "Making…" : "Make a token"}</button>
          </div>
        )}
        {ways.map((w) => (
          <div key={w.title} className="connect-way">
            <b>{w.title}</b>
            <button type="button" title="Copy" onClick={() => void navigator.clipboard.writeText(w.text).then(() => onToast(`Copied the ${w.title} line.`))}>
              <code>{w.text}</code>
              <Copy size={13} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
