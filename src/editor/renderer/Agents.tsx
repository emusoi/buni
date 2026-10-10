// The Agents mode: agents designed in the file, by hand. Design says who an agent is, its model, its tools and what
// it never does; Cases says what a person asks it and what it must do. Both are saved in the design (set_agent,
// set_eval) and undo like any edit; running them is the coding agent's or buni agent's job, not the app's.
import { useState } from "react";
import { Bot, Plus, Trash2 } from "lucide-react";
import { endpointToolName, operationToolName, type AgentDef, type Doc, type EvalCase } from "buni/format/doc.ts";
import { AREA_IDS, AREAS } from "buni/tools/areas/areas.ts";

type Tab = "design" | "cases";

const ENGINE_TOOLS = [["ask", "Ask the person and wait"], ["plan", "Show a checklist"], ["list_skills", "List design skills"], ["read_skill", "Read a design skill"]] as const;

/** An agent designed in the file, by hand: who it is, its model, exactly which tools, and what it never does. Saved with set_agent, so it undoes like any edit. */
function Design({ doc, def, onSaved }: { doc: Doc; def: AgentDef | undefined; onSaved: (id: string) => void }) {
  const [name, setName] = useState(def?.name ?? "");
  const [instructions, setInstructions] = useState(def?.instructions ?? "");
  const [model, setModel] = useState(def?.model ?? "");
  const [tools, setTools] = useState<string[]>(def?.tools ?? []);
  const [never, setNever] = useState((def?.never ?? []).join("\n"));
  const [said, setSaid] = useState<string>();
  const api = [
    ...Object.values(doc.endpoints).map((e) => [endpointToolName(e), `${e.method} ${e.path}`] as const),
    ...Object.values(doc.operations).filter((o) => o.kind !== "subscription").map((o) => [operationToolName(o), `${o.kind} ${o.name}`] as const),
  ];
  const toggle = (t: string) => setTools((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  const box = (t: string, label: string, hint: string) => (
    <label key={t} className="ag-def-tool"><input type="checkbox" checked={tools.includes(t)} onChange={() => toggle(t)} /><code>{t}</code><span>{label || hint}</span></label>
  );
  const save = () => void window.buni.edit("set_agent", {
    ...(def ? { agent: def.id } : {}), name: name.trim(), instructions, model: model.trim(), tools,
    never: never.split("\n").map((n) => n.trim()).filter(Boolean),
  }).then((r) => {
    setSaid(r.reply);
    const id = r.ok ? (def?.id ?? r.reply.match(/^Agent (\S+) saved/)?.[1]) : undefined;
    if (id) onSaved(id);
  });
  return (
    <div className="ag-def ag-pad">
      <label className="ag-def-field"><span className="ag-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Refund helper" /></label>
      <label className="ag-def-field"><span className="ag-label">Instructions <em>who it is, its job, how it works</em></span><textarea rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="You help support staff refund returns that arrived back…" /></label>
      <label className="ag-def-field"><span className="ag-label">Model <em>provider/model; empty uses buni's pick</em></span><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="anthropic/claude-sonnet-5-5" /></label>
      <div className="ag-def-field">
        <span className="ag-label">Tools <em>{tools.length} picked; the fewest its job needs</em></span>
        {api.length > 0 && <p className="ag-note">Your API</p>}
        {api.map(([t, label]) => box(t, label, ""))}
        <p className="ag-note">buni's tools, by area</p>
        {AREA_IDS.filter((a) => a !== "endpoints").map((a) => box(`area:${a}`, AREAS[a].name, AREAS[a].about))}
        {box("area:endpoints", "Every API call", "")}
        <p className="ag-note">The person</p>
        {ENGINE_TOOLS.map(([t, label]) => box(t, label, ""))}
      </div>
      <label className="ag-def-field"><span className="ag-label">Never <em>one per line</em></span><textarea rows={3} value={never} onChange={(e) => setNever(e.target.value)} placeholder="Refund more than was paid" /></label>
      <div className="ag-def-actions">
        <button type="button" className="btn primary" disabled={!name.trim() || !instructions.trim()} onClick={save}>{def ? "Save" : "Create agent"}</button>
        {def && <button type="button" className="btn" title="Removes it from the design; undo brings it back" onClick={() => void window.buni.edit("delete_system", { what: "agent", id: def.id }).then((r) => setSaid(r.reply))}><Trash2 size={12} /> Delete</button>}
        {said && <span className="ag-note">{said}</span>}
      </div>
    </div>
  );
}

/** One case, written by hand: what the person asks and each thing the agent must do. Saved with set_eval. */
function CaseForm({ me, c, onDone }: { me: string; c: EvalCase | undefined; onDone: () => void }) {
  const [text, setText] = useState(c?.ask ?? "");
  const [must, setMust] = useState((c?.must ?? []).join("\n"));
  const [given, setGiven] = useState(c?.given ? JSON.stringify(c.given, null, 2) : "");
  const [said, setSaid] = useState<string>();
  const musts = must.split("\n").map((m) => m.trim()).filter(Boolean);
  const save = () => {
    let answers: unknown;
    try {
      answers = given.trim() ? JSON.parse(given) : undefined;
    } catch {
      return setSaid("Given isn't JSON: an object of tool name to what it answers.");
    }
    void window.buni.edit("set_eval", { ...(c ? { eval: c.id } : {}), agent: me, ask: text.trim(), must: musts, ...(answers ? { given: answers } : {}) }).then((r) => (r.ok ? onDone() : setSaid(r.reply)));
  };
  return (
    <div className="ag-case-form">
      <label className="ag-def-field"><span className="ag-label">The person asks</span><textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add status filters above the returns table" /></label>
      <label className="ag-def-field"><span className="ag-label">It must <em>one per line, each checkable after the run</em></span><textarea rows={3} value={must} onChange={(e) => setMust(e.target.value)} placeholder={"Uses the Chips component\nAsks before deleting anything"} /></label>
      <label className="ag-def-field"><span className="ag-label">Given <em>optional: what the API answers in this case, by tool name, instead of the mock</em></span><textarea className="mono" rows={3} value={given} onChange={(e) => setGiven(e.target.value)} placeholder={'{ "api_get_plants": { "items": [{ "name": "Monstera", "isDue": true }] } }'} /></label>
      <div className="ag-def-actions">
        <button type="button" className="btn primary" disabled={!text.trim() || !musts.length} onClick={save}>{c ? "Save case" : "Add case"}</button>
        {c && <button type="button" className="btn" onClick={() => void window.buni.edit("delete_system", { what: "eval", id: c.id }).then(onDone)}><Trash2 size={12} /> Delete</button>}
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        {said && <span className="ag-note">{said}</span>}
      </div>
    </div>
  );
}

/** The agent's eval cases: each one a request and what the agent must do, edited in place. */
function Cases({ doc, me }: { doc: Doc; me: string }) {
  const cases = Object.values(doc.evals).filter((c) => c.agent === me).sort((a, b) => (a.index < b.index ? -1 : 1));
  const [editing, setEditing] = useState<string | "new">();
  const done = () => setEditing(undefined);
  return (
    <div className="ag-evals ag-pad">
      <div className="ag-evals-head">
        <b>{cases.length} case{cases.length === 1 ? "" : "s"}</b>
        <span className="ag-grow" />
        <button type="button" className="btn" onClick={() => setEditing("new")}><Plus size={12} /> Add a case</button>
      </div>
      {editing === "new" && <CaseForm me={me} c={undefined} onDone={done} />}
      {cases.length > 0 ? (
        <table className="ag-cases">
          <thead><tr><th>The person asks</th><th>It must</th></tr></thead>
          <tbody>
            {cases.map((c) => (
              editing === c.id ? (
                <tr key={c.id}><td colSpan={2}><CaseForm me={me} c={c} onDone={done} /></td></tr>
              ) : (
                <tr key={c.id} onClick={() => setEditing(c.id)} title="Edit this case">
                  <td>{c.ask}</td>
                  <td className="ag-musts">{c.must.join(" · ")}</td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      ) : editing !== "new" && <p className="ag-note">No cases yet. A case is something a person asks and what the agent must do.</p>}
      <div className="ag-evals-notes">
        <div><b>How a case is checked</b><p>Each case runs on a copy of the file, offline: the design's API answers from its mock and nothing real changes. Then each "must" is checked against the run's steps, the reply and the design afterwards.</p></div>
      </div>
    </div>
  );
}

export function Agents({ doc }: { doc: Doc }) {
  const defs = Object.values(doc.agents).sort((a, b) => (a.index < b.index ? -1 : 1));
  const [current, setCurrent] = useState<string>();
  const [tab, setTab] = useState<Tab>("design");
  const def = doc.agents[current ?? ""] ?? (current === undefined ? defs[0] : undefined);
  return (
    <div className="agents-view">
      <aside className="ag-rail">
        <p className="ag-label">Agents</p>
        {defs.map((a) => (
          <button type="button" key={a.id} className={`ag-agent${a.id === def?.id ? " on" : ""}`} onClick={() => setCurrent(a.id)}>
            <Bot size={16} />
            <span>{a.name}</span>
          </button>
        ))}
        <button type="button" className={`ag-agent ag-new${current === "" ? " on" : ""}`} onClick={() => setCurrent("")}><Plus size={14} /><span>New agent</span></button>
        <p className="ag-rail-note">Agents you design live in this file, beside the screens and the system they work in.</p>
      </aside>
      {!def && current === undefined ? (
        // No agents yet: what an agent here is, before a form to fill in.
        <section className="ag-main ag-intro">
          <div className="ag-intro-box">
            <Bot size={28} />
            <h2>Design the agents in your product</h2>
            <p>An agent here is one your product ships: who it is, the model it runs on, exactly which of your API calls and buni's tools it may use, and what it must never do. Its cases say what a person asks it and what it has to do, so it can be checked.</p>
            <button type="button" className="btn primary" onClick={() => setCurrent("")}><Plus size={13} /> New agent</button>
          </div>
        </section>
      ) : def ? (
        <section className="ag-main">
          <header className="ag-head">
            <div className="ag-title"><b>{def.name}</b><span className="ag-sub">{def.model || "buni's pick of model"} · {def.tools.length} tool{def.tools.length === 1 ? "" : "s"}</span></div>
            <div className="ag-tabs" role="tablist">
              {(["design", "cases"] as const).map((t) => <button type="button" key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t[0]?.toUpperCase()}{t.slice(1)}</button>)}
            </div>
          </header>
          {tab === "design" ? <Design key={def.id} doc={doc} def={def} onSaved={setCurrent} /> : <Cases doc={doc} me={def.id} />}
        </section>
      ) : (
        <section className="ag-main">
          <header className="ag-head"><div className="ag-title"><b>New agent</b><span className="ag-sub">Saved in this design</span></div></header>
          <Design doc={doc} def={undefined} onSaved={(id) => { setTab("design"); setCurrent(id); }} />
        </section>
      )}
    </div>
  );
}
