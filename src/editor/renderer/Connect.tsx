import { useEffect, useState } from "react";
import { turnsOf } from "./TurnCard.tsx";
import { ChevronDown, ChevronRight, Copy, MessageSquare, Pause, Play } from "lucide-react";
import type { Edit } from "../api.ts";
import type { AgentState } from "buni/tools/protocol.ts";
import { ago } from "./Home.tsx";
import { Tasks } from "./Tasks.tsx";
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

/** How many of an agent's edits show before "All n edits". */
const FEW = 3;

/**
 * The coding agents on this file, one card each (who, what, whether it's here; where it was last; its edits as rows),
 * then a row that opens to connect another. Drawn as buni-web's 21 · Inspector · Agents and Doc draws it.
 */
export function ConnectAgent({ doc, mcpUrl, connected, recent, edits, agents = [], page, onShow, onShowPage, onToast, onUndo }: { doc: Doc; mcpUrl: string; connected: readonly string[]; recent: Record<string, readonly Id[]>; edits: readonly Edit[]; agents?: readonly AgentState[]; page?: Id | undefined; onShow: (node: Id) => void; onShowPage?: (page: Id) => void; onToast: (t: string) => void; onUndo?: () => void }) {
  const [asking, setAsking] = useState<string>();
  const [words, setWords] = useState("");
  const [allOf, setAllOf] = useState<string>();
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
  // Connecting opens by itself while no agent is here yet.
  const [connecting, setConnecting] = useState(names.length === 0);
  return (
    <div className="connect-agent">
      <Tasks doc={doc} page={page} now={now} onShowPage={(p) => onShowPage?.(p)} onToast={onToast} />
      <Timeline doc={doc} edits={edits} now={now} onShow={onShow} />
      {names.length > 0 && (
        <section className="agent-cards">
          {names.map((name) => {
            const touched = recent[name]?.[0];
            const pageName = touched ? doc.pages[pageOfNode(doc, touched) ?? ""]?.name : undefined;
            const live = connected.includes(name);
            const mine = edits.filter((e) => e.author === name).slice(-12).reverse();
            const last = mine[0];
            const state = agents.find((a) => a.name === name);
            const lastIsTheirs = edits.at(-1)?.author === name;
            const canSteer = live && Boolean(window.buni.pauseAgent);
            const shown = allOf === name ? mine : mine.slice(0, FEW);
            // One line on how it is: paused, working (what it runs), here, or gone (since when).
            const how = state?.paused ? "paused" : live && state?.busy && state.tool ? `working · ${state.tool}` : live ? "here" : last ? `left ${ago(last.at, now)}` : "gone";
            return (
              <div key={name} className="agent-card">
                <div className="agent-head">
                  <span className="agent-dot" style={{ background: agentColor(name) }}>{agentInitials(name)}</span>
                  <span className="agent-who"><b>{name}</b><small>Coding agent · {how}</small></span>
                  <span className={`live${live ? "" : " off"}${state?.busy && live ? " busy" : ""}`} title={live ? "connected" : "gone"} />
                </div>
                <p className="agent-last">{pageName ? <>Last on <em>{pageName}</em>{last ? ` · ${ago(last.at, now)}` : ""}. ⌘Z takes any of it back.</> : "Connected; no edits yet."}</p>
                {canSteer && (
                  <div className="agent-controls">
                    <button type="button" className="btn small" onClick={() => void window.buni.pauseAgent?.(name, !state?.paused)}>
                      {state?.paused ? <><Play size={12} /> Continue</> : <><Pause size={12} /> Pause</>}
                    </button>
                    <button type="button" className="btn small" onClick={() => setAsking(asking === name ? undefined : name)}><MessageSquare size={12} /> Ask it</button>
                  </div>
                )}
                {asking === name && (
                  <form className="agent-ask" onSubmit={(e) => { e.preventDefault(); void tell(name); }}>
                    <input className="field" autoFocus placeholder={`Tell ${name} something; it reads it before its next step`} value={words} onChange={(e) => setWords(e.target.value)} />
                  </form>
                )}
                {shown.length > 0 && (
                  <ol className="agent-edits" aria-label={`What ${name} did last`}>
                    {shown.map((e, i) => (
                      <li key={`${e.at}${e.label}`}>
                        <button type="button" className="agent-edit" disabled={!e.nodes[0]} onClick={() => e.nodes[0] && onShow(e.nodes[0])} title={e.nodes[0] ? "Show it on the canvas" : undefined}>
                          <span>{e.label}{e.nodes.length > 1 ? ` · ${e.nodes.length} layers` : ""}</span>
                          <time dateTime={e.at}>{ago(e.at, now)}</time>
                        </button>
                        {i === 0 && lastIsTheirs && onUndo && <button type="button" className="link-btn" title="Take back its last edit" onClick={onUndo}>Undo</button>}
                      </li>
                    ))}
                  </ol>
                )}
                {mine.length > FEW && (
                  <button type="button" className="link-btn" onClick={() => setAllOf(allOf === name ? undefined : name)}>{allOf === name ? "Fewer" : `All ${mine.length} edits`}</button>
                )}
              </div>
            );
          })}
        </section>
      )}
      <section className="connect-ways">
        <button type="button" className="group-title fold" aria-expanded={connecting} onClick={() => setConnecting((c) => !c)}>
          {connecting ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="group-name">{names.length ? "Connect an agent" : "Connect a coding agent"}</span>
          {!connecting && <span className="group-summary">Claude Code, Codex</span>}
        </button>
        {connecting && <>
          <p className="hint small">It edits this design through buni's tools. You see every change land here.</p>
          {needsToken && !token && (
            <div className="connect-way">
              <p className="hint small">The agent signs in with a token of its own, which you can revoke on your account page. It shows once.</p>
              <button type="button" className="btn small" disabled={making} onClick={makeToken}>{making ? "Making…" : "Make a token"}</button>
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
        </>}
      </section>
    </div>
  );
}

/** What happened here, as turns (each author's run of edits), newest first, narrowed to one author with a chip. */
function Timeline({ doc, edits, now, onShow }: { doc: Doc; edits: readonly Edit[]; now: number; onShow: (node: Id) => void }) {
  const [who, setWho] = useState<string>();
  const [all, setAll] = useState(false);
  const turns = turnsOf(edits);
  if (!turns.length) return null;
  const authors = [...new Set(turns.map((t) => t.author))];
  const shown = turns.filter((t) => !who || t.author === who);
  return (
    <section className="timeline" aria-label="Activity">
      <div className="timeline-head">
        <b>Activity</b>
        <span className="grow" />
        {authors.length > 1 && [undefined, ...authors].map((a) => (
          <button key={a ?? "all"} type="button" className={`tag-chip${who === a ? " on" : ""}`} aria-pressed={who === a} onClick={() => setWho(a)}>{a ?? "All"}</button>
        ))}
      </div>
      {(all ? shown : shown.slice(0, 6)).map((t) => {
        const node = t.edits.flatMap((e) => e.nodes).find((n) => doc.nodes[n]);
        const page = node ? doc.pages[pageOfNode(doc, node) ?? ""]?.name : undefined;
        const labels = [...new Set(t.edits.map((e) => e.label))];
        const at = t.edits.at(-1)?.at ?? "";
        return (
          <button key={`${t.author}${t.edits[0]?.at}`} type="button" className="turn-row" disabled={!node} onClick={() => node && onShow(node)} title={node ? "Show it on the canvas" : undefined}>
            <span className="turn-dot" style={{ background: agentColor(t.author) }} />
            <span className="turn-what">
              <b>{t.author}{page ? ` · ${page}` : ""}</b>
              <span className="hint">{labels.slice(-2).join(" · ")}{labels.length > 2 ? ` · ${labels.length - 2} more` : ""} · {ago(at, now)}</span>
            </span>
          </button>
        );
      })}
      {shown.length > 6 && <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>{all ? "Fewer" : `All ${shown.length} turns`}</button>}
    </section>
  );
}
