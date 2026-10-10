import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Layers, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Flag, MessageSquarePlus, Monitor, MousePointerClick, Paperclip, RotateCcw, Sparkles, Unlink, Workflow, X } from "lucide-react";
import { statesOf, type Connection, type Doc, type Id } from "buni/format/doc.ts";
import { nodeAt, srcdoc } from "./Canvas.tsx";
import { motionCss } from "buni/tools/html.ts";
import { widthOf } from "./layout.ts";
import { findIssues, firstPage, flowFor, flowSteps, isPrefix, keyLinkFor, notesOn, notesPrompt } from "./play.ts";

interface Visit {
  page: Id;
  /** The link that led here; undefined for the first screen and for jumps from the step rail. */
  via?: Connection;
}

interface Draft {
  node: Id;
  /** Where the editor opens, in stage pixels. */
  x: number;
  y: number;
  text: string;
}

const WIDTHS = [1280, 1024] as const;
/** Flows up to this many screens show every step by name; longer ones get a compact rail. */
const RAIL_FULL = 5;

function elapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Plays a flow as a person would: links move between screens, the step rail shows where you are,
 * the journey drawer says what the person should be doing and thinking here, and notes pinned on
 * the page go to the agent in one request.
 */
export function Play({ doc, dir, start, flow: wanted, startWidth, onClose, onSend }: {
  doc: Doc;
  dir: string;
  start: Id;
  flow?: Id;
  /** The width the canvas showed the page at, to play it there. */
  startWidth?: number | undefined;
  onClose: () => void;
  /** Hands the notes and found issues to the agent as a request. */
  onSend: (request: string) => void;
}) {
  const [flowId, setFlowId] = useState(() => flowFor(doc, start, wanted)?.id);
  const flow = flowId ? doc.flows[flowId] : undefined;
  const steps = useMemo(() => flowSteps(doc, flow, start), [doc, flow, start]);
  const [trail, setTrail] = useState<Visit[]>(() => [{ page: firstPage(doc, flow, start) }]);
  const [started, setStarted] = useState(() => Date.now());
  const [hot, setHot] = useState(true);
  const [flash, setFlash] = useState(false);
  const [preset, setPreset] = useState<number | undefined>(startWidth);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noting, setNoting] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [journeyOpen, setJourneyOpen] = useState(true);
  const [ended, setEnded] = useState(false);
  /** A clicked node that leads to more than one place: the usual path and its conditions, to pick from. */
  const [choice, setChoice] = useState<{ x: number; y: number; links: Connection[] }>();
  // Below the click, unless that runs off the screen: then above it.
  const choiceTop = (c: { y: number; links: Connection[] }, screen: number) => {
    const tall = 34 + c.links.length * 50;
    return c.y + 10 + tall > screen ? Math.max(8, c.y - 10 - tall) : c.y + 10;
  };
  const [height, setHeight] = useState(900);
  const [winWidth, setWinWidth] = useState(() => window.innerWidth);
  const [pins, setPins] = useState<{ id: Id; n: number; x: number; y: number }[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  // Each screen starts at its top, as a page you navigate to does; not where the last one was scrolled to.
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (stage.current) stage.current.scrollTop = 0;
  }, [trail.length]);

  const here = trail.at(-1) ?? { page: start };
  const width = preset ?? widthOf(doc, here.page);
  const room = winWidth - 96 - (notesOpen ? 336 : 0);
  const scale = Math.min(1, room / width);
  // A state of a step's screen (same route: "label pending") is that step, reached another way.
  const screenOf = (page: Id) => {
    const p = doc.pages[page];
    return p?.state !== undefined ? Object.values(doc.pages).find((x) => x.route === p.route && x.state === undefined)?.id ?? page : page;
  };
  const visited = new Set(trail.map((v) => screenOf(v.page)));
  const now = screenOf(here.page);
  const stepIndex = steps.indexOf(screenOf(here.page));
  const journey = flow ? Object.values(doc.journeys).find((j) => j.flow === flow.id) : undefined;
  const step = journey?.steps.find((s) => s.page === here.page) ?? journey?.steps.find((s) => s.page === now);
  const notes = useMemo(() => notesOn(doc, [...new Set([...steps, ...trail.map((v) => v.page)])]), [doc, steps, trail]);
  const issues = useMemo(() => findIssues(doc, steps), [doc, steps]);

  const links = useMemo(
    () => Object.values(doc.connections).filter((c) => c.page === here.page && c.trigger === "click"),
    [doc, here.page],
  );
  // A terminal screen is played with its keys; they answer before Play's own shortcuts.
  const keyLinks = useMemo(
    () => Object.values(doc.connections).filter((c) => c.page === here.page && c.trigger === "key"),
    [doc, here.page],
  );
  /** When tmux's prefix (ctrl+b) was last pressed: a "prefix g" binding answers for two seconds after. */
  const prefixAt = useRef(0);

  const html = useMemo(() => {
    const ring = "outline:2px solid #5b6cf0;outline-offset:3px;box-shadow:0 0 0 6px rgba(91,108,240,0.18);border-radius:3px";
    const marks = hot || flash ? links.map((c) => `.b-${c.node}{${ring}}`).join("") : "";
    const cursor = noting ? "*{cursor:crosshair!important}" : links.map((c) => `.b-${c.node}{cursor:pointer}`).join("");
    // Play is where motion runs; the canvas shows each layer at rest.
    return srcdoc(doc, here.page, dir, `${motionCss(doc)}${marks}${cursor}`);
  }, [doc, dir, here.page, links, hot, flash, noting]);

  const go = (page: Id, via?: Connection) => {
    setDraft(undefined);
    setChoice(undefined);
    setTrail((t) => [...t, { page, ...(via ? { via } : {}) }]);
  };
  const restart = () => {
    setTrail([{ page: flow?.start ?? start }]);
    setStarted(Date.now());
    setEnded(false);
    setDraft(undefined);
  };

  // Pins sit on the top-left corner of the layer each note is about.
  const placePins = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const out: { id: Id; n: number; x: number; y: number }[] = [];
    notes.forEach(({ comment, page }, i) => {
      if (page !== here.page) return;
      const r = d.querySelector(`.b-${comment.node}`)?.getBoundingClientRect();
      if (r) out.push({ id: comment.id, n: i + 1, x: Math.max(4, r.left * scale - 10), y: Math.max(4, r.top * scale - 18) });
    });
    setPins(out);
  };
  useLayoutEffect(placePins, [notes, here.page, scale, height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!draft && !noting && keyLinks.length > 0) {
        const press = { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
        if (isPrefix(press) && keyLinks.some((c) => c.key?.toLowerCase().startsWith("prefix "))) {
          prefixAt.current = Date.now();
          e.preventDefault();
          return;
        }
        const link = keyLinkFor(keyLinks, press, Date.now() - prefixAt.current < 2000);
        if (link) {
          e.preventDefault();
          prefixAt.current = 0;
          return go(link.to, link);
        }
      }
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (choice) setChoice(undefined);
        else if (draft) setDraft(undefined);
        else if (noting) setNoting(false);
        else if (ended) setEnded(false);
        else onClose();
      } else if (k === "backspace" || k === "arrowleft") setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
      else if (k === "arrowright") {
        const next = steps[stepIndex + 1];
        if (next) go(next);
        else if (flow) setEnded(true);
      } else if (k === "h") setHot((v) => !v);
      else if (k === "c") setNoting((v) => !v);
      else if (k === "j") setJourneyOpen((v) => !v);
      else if (k === "n") setNotesOpen((v) => !v);
    };
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 500);
    return () => clearTimeout(t);
  }, [flash]);

  const click = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    if (choice) return setChoice(undefined);
    if (noting) {
      const node = nodeAt(frame.current, x, y);
      if (node) setDraft({ node, x: e.clientX - rect.left, y: e.clientY - rect.top, text: "" });
      return;
    }
    // The node under the pointer or any ancestor may carry the link.
    let el = frame.current?.contentDocument?.elementFromPoint(x, y)?.closest("[class^='b-']");
    while (el) {
      const id = el.classList[0]?.slice(2);
      const here = links.filter((c) => c.node === id);
      // The usual link first, then each condition's.
      here.sort((a, b) => Number(Boolean(a.condition)) - Number(Boolean(b.condition)));
      const [only, ...more] = here;
      if (only && !more.length) return go(only.to, only);
      if (only) return setChoice({ x: e.clientX - rect.left, y: e.clientY - rect.top, links: here });
      el = el.parentElement?.closest("[class^='b-']");
    }
    if (!hot) setFlash(true);
  };

  const save = async () => {
    if (!draft?.text.trim()) return;
    const r = await window.buni.edit("comment", { node: draft.node, body: draft.text.trim() });
    if (r.ok) {
      setDraft(undefined);
      setNoting(false);
      setNotesOpen(true);
    }
  };
  const send = () => onSend(notesPrompt(doc, flow?.name ?? doc.pages[start]?.name ?? "this page", notes, ended ? issues : []));

  const via = here.via;
  const motion = via && via.transition !== "none" ? { animation: `play-${via.transition} ${via.durationMs}ms ease-out` } : undefined;
  const flows = Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1));
  const confidence = step?.confidence;

  return (
    <div className="play" role="dialog" aria-label="Play">
      <div className="play-bar">
        <button type="button" className="play-icon" onClick={onClose} aria-label="Close Play"><X size={17} /></button>
        <label className="play-flow">
          <Workflow size={15} />
          <select value={flowId ?? ""} onChange={(e) => {
            const f = doc.flows[e.target.value];
            setFlowId(f?.id);
            setTrail([{ page: f?.start ?? start }]);
            setStarted(Date.now());
            setEnded(false);
          }}>
            {!flowId && <option value="">No flow</option>}
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <ChevronDown size={13} />
        </label>
        <div className="play-rail">
          {steps.length <= RAIL_FULL ? (
            steps.map((p, i) => {
              const state = p === now ? "now" : visited.has(p) ? "done" : "todo";
              return (
                <div key={p} className="play-step-wrap">
                  {i > 0 && <span className="play-sep" />}
                  <button type="button" className={`play-step ${state}`} onClick={() => go(p)}>
                    <span className="dot">{state === "done" ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                    <span className="play-step-name">{doc.pages[p]?.name ?? p}</span>
                  </button>
                </div>
              );
            })
          ) : (
            <>
              <button type="button" className="play-icon small" disabled={stepIndex <= 0} onClick={() => { const prev = steps[stepIndex - 1]; if (prev) go(prev); }} aria-label="Previous screen"><ChevronLeft size={16} /></button>
              <label className="play-step now picker">
                <span className="dot">{stepIndex >= 0 ? stepIndex + 1 : "·"}</span>
                <span className="picker-text">{stepIndex >= 0 ? `of ${steps.length} · ` : "Off the flow · "}{doc.pages[here.page]?.name}</span>
                <ChevronDown size={13} />
                <select value={stepIndex >= 0 ? here.page : ""} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Jump to a screen">
                  {stepIndex < 0 && <option value="">Off the flow</option>}
                  {steps.map((p, i) => <option key={p} value={p}>{i + 1}. {doc.pages[p]?.name ?? p}{visited.has(p) && p !== now ? " ✓" : ""}</option>)}
                </select>
              </label>
              <button type="button" className="play-icon small" disabled={stepIndex < 0 || stepIndex >= steps.length - 1} onClick={() => { const next = steps[stepIndex + 1]; if (next) go(next); }} aria-label="Next screen"><ChevronRight size={16} /></button>
              <div className="play-segments" aria-hidden="true">
                {steps.map((p) => (
                  <button type="button" key={p} tabIndex={-1} title={doc.pages[p]?.name} className={p === now ? "now" : visited.has(p) ? "done" : ""} onClick={() => go(p)} />
                ))}
              </div>
            </>
          )}
          {flow && stepIndex === steps.length - 1 && (
            <button type="button" className="play-finish" onClick={() => setEnded(true)}><Flag size={13} /> Finish</button>
          )}
        </div>
        {(() => {
          // The screen here in any of its states, without leaving the flow.
          const p = doc.pages[here.page];
          const screen = p?.state === undefined ? p : Object.values(doc.pages).find((x) => x.route === p.route && x.state === undefined);
          const states = screen ? statesOf(doc, screen) : [];
          if (!screen || !states.length) return null;
          return (
            <label className="play-tool" title="See this screen in another state">
              <Layers size={15} />
              <select value={here.page} onChange={(e) => setTrail((t) => [...t.slice(0, -1), { ...here, page: e.target.value }])}>
                <option value={screen.id}>Screen</option>
                {states.map((s) => <option key={s.id} value={s.id}>{s.state}</option>)}
              </select>
            </label>
          );
        })()}
        <label className="play-tool">
          <Monitor size={15} />
          <select value={preset ?? ""} onChange={(e) => setPreset(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">{widthOf(doc, here.page)}</option>
            {(doc.pages[here.page]?.widths?.length ? doc.pages[here.page]?.widths ?? [] : WIDTHS).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <button type="button" className={`play-tool${hot ? " on" : ""}`} aria-pressed={hot} onClick={() => setHot((v) => !v)} title="Outline links (H)">
          <MousePointerClick size={15} /> Hotspots
        </button>
        <button type="button" className={`play-tool${notesOpen || noting ? " on" : ""}`} aria-pressed={notesOpen} onClick={() => setNotesOpen((v) => !v)} title="Notes (N); press C to add one">
          <MessageSquarePlus size={15} /> Notes{notes.length > 0 && <span className="count">{notes.length}</span>}
        </button>
        <button type="button" className="play-tool" onClick={restart} title="Restart the flow"><RotateCcw size={15} /> Restart</button>
      </div>

      <div className="play-body">
        <div className="play-main">
          <div className="play-stage" ref={stage}>
            <div key={trail.length} className={`play-screen${noting ? " noting" : ""}${doc.pages[here.page]?.terminal ? " terminal" : ""}`} style={{ width: width * scale, height: height * scale, ...motion }}>
              <iframe
                ref={frame}
                title="Play"
                sandbox="allow-same-origin"
                srcDoc={html}
                width={width}
                height={height}
                style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}
                onLoad={() => {
                  // A terminal screen is as tall as its grid, not the window it is shown in.
                  const d = frame.current?.contentDocument;
                  setHeight((doc.pages[here.page]?.terminal ? d?.body?.scrollHeight : d?.documentElement.scrollHeight) || 900);
                  placePins();
                }}
              />
              <div className="hit" onPointerDown={click} />
              {pins.map((p) => (
                <span key={p.id} className="play-pin" style={{ left: p.x, top: p.y }}>{p.n}</span>
              ))}
              {draft && (
                <div className="play-note-editor" style={{ left: Math.max(8, Math.min(draft.x, width * scale - 310)), top: draft.y + 12 }}>
                  <div className="where">On “{doc.nodes[draft.node]?.name ?? draft.node}” · {doc.pages[here.page]?.name}</div>
                  <textarea
                    autoFocus
                    rows={3}
                    placeholder="What should change here?"
                    value={draft.text}
                    onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void save();
                      }
                      if (e.key === "Escape") setDraft(undefined);
                    }}
                  />
                  <div className="foot"><span>↵ save · Esc cancel</span><button type="button" className="btn primary" disabled={!draft.text.trim()} onClick={() => void save()}>Add note</button></div>
                </div>
              )}
              {noting && !draft && <div className="play-noting">Click anything to leave a note · Esc to stop</div>}
              {choice && (
                <div className="play-choice" role="menu" aria-label="Where this goes" style={{ left: Math.max(8, Math.min(choice.x, width * scale - 290)), top: choiceTop(choice, height * scale) }} onPointerDown={(e) => e.stopPropagation()}>
                  <div className="where">This leads to more than one place</div>
                  {choice.links.map((c) => (
                    <button type="button" role="menuitem" key={c.id} onClick={() => go(c.to, c)}>
                      <small>{c.condition ? `If ${c.condition.charAt(0).toLowerCase()}${c.condition.slice(1)}` : "Usually"}</small>
                      <b>{doc.pages[c.to]?.name ?? c.to}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {keyLinks.length > 0 && (
              <div className="play-keys" aria-label="Keys on this screen">
                {keyLinks.map((c) => (
                  <button type="button" key={c.id} onClick={() => go(c.to, c)}>
                    <kbd>{c.key}</kbd> {doc.pages[c.to]?.name ?? c.to}
                  </button>
                ))}
              </div>
            )}
          </div>

          {journey && (
            journeyOpen ? (
              <div className="play-journey">
                <div className="head">
                  <b>{stepIndex >= 0 ? `Step ${stepIndex + 1} of ${steps.length}` : "Off the flow"} · {doc.pages[here.page]?.name}</b>
                  {confidence && (
                    <span className="conf">
                      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= confidence ? "on" : ""} />)}
                      <em>confidence {confidence}/5</em>
                    </span>
                  )}
                  <span className="grow" />
                  {step?.evidence.map((id) => (
                    <span key={id} className="evidence"><Paperclip size={12} /> {doc.attachments[id]?.path.split("/").at(-1) ?? id}</span>
                  ))}
                  <button type="button" className="play-link" onClick={() => setJourneyOpen(false)}>Journey <ChevronDown size={13} /></button>
                </div>
                {step ? (
                  <div className="lanes">
                    {journey.lanes.map((lane) => (
                      <div key={lane} className={`lane${/watch|risk/i.test(lane) && step.cells[lane] ? " warn" : ""}`}>
                        <span>{lane.toUpperCase()}</span>
                        <p>{step.cells[lane] || "—"}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="play-empty">This screen has no journey step yet.</p>
                )}
              </div>
            ) : (
              <button type="button" className="play-journey-closed" onClick={() => setJourneyOpen(true)}>Journey <ChevronUp size={13} /></button>
            )
          )}
          <div className="play-keys">
            {([["← →", "steps"], ["H", "hotspots"], ["C", "add a note"], ["J", "journey"], ["Esc", "leave"]] as const).map(([k, v]) => (
              <span key={k}><kbd>{k}</kbd> {v}</span>
            ))}
          </div>
        </div>

        {notesOpen && (
          <aside className="play-notes">
            <div className="head"><b>Notes</b><span>{notes.length} on this flow</span></div>
            {notes.length === 0 && <p className="play-empty">Press C, then click anything on the page to leave a note.</p>}
            <div className="list">
              {notes.map(({ comment, page }, i) => (
                <button type="button" key={comment.id} className="note" onClick={() => page !== here.page && go(page)}>
                  <span className="pin">{i + 1}</span>
                  <span className="text">
                    <small>{doc.pages[page]?.name} · {doc.nodes[comment.node]?.name}</small>
                    {comment.posts.at(-1)?.body}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="play-add" onClick={() => setNoting(true)}><MessageSquarePlus size={14} /> Add a note <kbd>C</kbd></button>
            <p className="hint">The agent turns notes into a plan and asks before big changes. Notes stay in the file.</p>
            <button type="button" className="play-send" disabled={notes.length === 0} onClick={send}>
              <Sparkles size={15} /> Copy {notes.length} note{notes.length === 1 ? "" : "s"} for your agent
            </button>
          </aside>
        )}
      </div>

      {ended && (
        <div className="play-end">
          <div className="card">
            <div className="title">
              <span className="flag"><Flag size={18} /></span>
              <div>
                <h2>You reached the end of {flow?.name}</h2>
                <p>{steps.map((p) => doc.pages[p]?.name).join(" → ")}</p>
              </div>
            </div>
            <div className="stats">
              <div><b>{steps.filter((p) => visited.has(p)).length} of {steps.length}</b><span>screens visited</span></div>
              <div><b>{elapsed(Date.now() - started)}</b><span>time in flow</span></div>
              <div><b>{notes.length}</b><span>notes</span></div>
            </div>
            {journey && journey.steps.some((s) => s.confidence) && (
              <>
                <div className="label">CONFIDENCE BY STEP</div>
                <div className="bars">
                  {steps.map((p) => {
                    const c = journey.steps.find((s) => s.page === p)?.confidence;
                    return (
                      <div key={p}>
                        <span className={`bar${c && c >= 4 ? " good" : ""}`} style={{ height: (c ?? 0) * 12 }} />
                        <em>{doc.pages[p]?.name}</em>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div className="label">FOUND WHILE PLAYING</div>
            {issues.length === 0 ? (
              <p className="none">No dead ends: every link goes somewhere and every screen has a way back.</p>
            ) : (
              <div className="issues">
                {issues.slice(0, 4).map((x, i) => (
                  <div key={i} className="issue">
                    {x.node ? <Unlink size={15} /> : <CircleAlert size={15} />}
                    <div><b>{x.title}</b><span>{x.fix}</span></div>
                  </div>
                ))}
                {issues.length > 4 && <span className="more">+ {issues.length - 4} more</span>}
              </div>
            )}
            <div className="actions">
              <button type="button" className="play-send" disabled={notes.length + issues.length === 0} onClick={send}>
                <Sparkles size={15} /> Copy {notes.length} note{notes.length === 1 ? "" : "s"}{issues.length ? ` and ${issues.length} issue${issues.length === 1 ? "" : "s"}` : ""} for your agent
              </button>
              <button type="button" className="btn" onClick={restart}><RotateCcw size={14} /> Play again</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
