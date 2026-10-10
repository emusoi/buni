// The plan: requirements, phases, open questions, roles and access, review, and agents designed in the file. One area
// of buni's design tools (agent/areas.ts); tools.ts gathers them.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { fingerprint, pieceName, reviewCopy, type Decision, type Access, type Phase, type Question, type Requirement, type Role, type Thread, type AgentDef, type EvalCase, endpointToolName, operationToolName } from "../../format/doc.ts";
import { AREA_IDS } from "./areas.ts";
import type { Op } from "../../oplog/oplog.ts";
import { Ids, type Tool, ToolError, body, page, tool } from "../kit.ts";

export const planTools = {
  set_phase: tool({
    description: 'Add or change (pass phase) a phase: when things ship, e.g. "v1", "later". Order is the order added.',
    input: { phase: z.string().optional(), name: z.string().min(1), goal: z.string().optional().describe("What the phase delivers") },
    run: async (doc, a, ctx) => {
      const old = a.phase === undefined ? undefined : doc.phases[a.phase];
      if (a.phase !== undefined && !old) throw new ToolError(`phase "${a.phase}" does not exist`);
      const last = Object.values(doc.phases).map((p) => p.index).sort().at(-1) ?? null;
      const value: Phase = { ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null), name: a.name, ...(a.goal ? { goal: a.goal } : {}) };
      return { label: `${old ? "Change" : "Add"} phase ${a.name}`, ops: [{ kind: "put", collection: "phases", value }], reply: `Phase ${value.id} saved.` };
    },
  }),

  set_requirement: tool({
    description:
      "Add or change (pass requirement) a requirement: something the design has to achieve, its priority (must, should, could), its phase, " +
      "and the pieces that serve it (parts, endpoints, operations, tables, events, shapes, traces, pages, flows). Read buni skills design-process first.",
    input: {
      requirement: z.string().optional(),
      title: z.string().min(1).describe('An outcome, e.g. "A buyer sends a quote in under a minute"'),
      detail: z.string().optional(),
      priority: z.enum(["must", "should", "could"]).default("must"),
      phase: z.string().optional(),
      servedBy: z.array(z.string()).optional().describe("Ids of what serves it; kept when omitted"),
    },
    run: async (doc, a, ctx) => {
      const old = a.requirement === undefined ? undefined : doc.requirements[a.requirement];
      if (a.requirement !== undefined && !old) throw new ToolError(`requirement "${a.requirement}" does not exist`);
      const last = Object.values(doc.requirements).map((q) => q.index).sort().at(-1) ?? null;
      const value: Requirement = {
        ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).slug(`req ${a.title.split(/\s+/).slice(0, 4).join(" ")}`), index: old?.index ?? generateKeyBetween(last, null),
        title: a.title, priority: a.priority, servedBy: a.servedBy ?? old?.servedBy ?? [],
        ...(a.detail ? { detail: a.detail } : {}), ...(a.phase ? { phase: a.phase } : {}),
      };
      return { label: `${old ? "Change" : "Add"} requirement`, ops: [{ kind: "put", collection: "requirements", value }], reply: `Requirement ${value.id} saved.` };
    },
  }),

  serve: tool({
    description: "Say that a piece (part, endpoint, operation, table, event, shape, trace, page, flow) serves a requirement, or stop (remove).",
    input: { requirement: z.string(), id: z.string(), remove: z.boolean().optional() },
    run: async (doc, a) => {
      const q = doc.requirements[a.requirement];
      if (!q) throw new ToolError(`requirement "${a.requirement}" does not exist`);
      const servedBy = a.remove ? q.servedBy.filter((x) => x !== a.id) : [...new Set([...q.servedBy, a.id])];
      return { label: a.remove ? "Stop serving a requirement" : "Serve a requirement", ops: [{ kind: "put", collection: "requirements", value: { ...q, servedBy } }], reply: "Saved." };
    },
  }),

  set_agent: tool({
    description:
      "Design an agent in this file, or change one (pass agent): its name, its instructions (who it is, its job, how it works), " +
      "the model it runs on (provider/model, optional), exactly which tools it may call, and what it must never do. " +
      "Tools are named: the design's endpoints and operations as tools (api_post_refunds, gql_query_returns), buni's own tools (read_tree), " +
      "or a whole area of them (area:pages). Give it the fewest tools its job needs.",
    input: {
      agent: z.string().optional(),
      name: z.string().min(1),
      instructions: z.string().min(1),
      model: z.string().optional().describe('"provider/model"; "" goes back to buni\'s model'),
      tools: z.array(z.string()).optional(),
      never: z.array(z.string()).optional(),
    },
    run: async (doc, a, ctx) => {
      const old = a.agent === undefined ? undefined : doc.agents[a.agent];
      if (a.agent !== undefined && !old) throw new ToolError(`agent "${a.agent}" does not exist`);
      const tools = a.tools ?? old?.tools ?? [];
      const api = new Set([...Object.values(doc.endpoints).map(endpointToolName), ...Object.values(doc.operations).map(operationToolName)]);
      const engine = new Set(["plan", "ask", "screenshot", "look_at_url", "repo_list", "repo_read", "repo_search", "list_skills", "read_skill"]);
      // Every design tool, gathered in tools.ts from all the areas, this one included: read when the tool runs.
      const { toolNames } = await import("../tools.ts");
      const bad = tools.filter((t) => !(api.has(t) || toolNames.some((n) => n === t) || engine.has(t) || AREA_IDS.some((id) => `area:${id}` === t)));
      if (bad.length) throw new ToolError(`not tools: ${bad.join(", ")}. Use an endpoint or operation's tool name (${[...api].slice(0, 3).join(", ") || "none yet"}), one of buni's tools, or area:<${AREA_IDS.join("|")}>`);
      const model = a.model === undefined ? old?.model : a.model || undefined;
      if (model !== undefined && !/^[\w.-]+\/.+$/.test(model)) throw new ToolError(`"${model}" is not provider/model`);
      const last = Object.values(doc.agents).map((x) => x.index).sort().at(-1) ?? null;
      const value: AgentDef = {
        ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null),
        name: a.name, instructions: a.instructions, ...(model ? { model } : {}), tools: [...new Set(tools)], never: a.never ?? old?.never ?? [],
      };
      return { label: `${old ? "Change" : "Design"} agent ${a.name}`, ops: [{ kind: "put", collection: "agents", value }], reply: `Agent ${value.id} saved with ${value.tools.length} tool${value.tools.length === 1 ? "" : "s"}.` };
    },
  }),
  set_eval: tool({
    description:
      "Add an eval case for an agent, or change one (pass eval): what the person asks, and each thing the agent must do, " +
      'checkable after the run ("uses the Chips component", "asks before deleting", "calls api_post_refunds once"). ' +
      'agent is "buni" or the id of an agent designed in this file. Cases run on a copy of the file, so nothing real changes.',
    input: {
      eval: z.string().optional(),
      agent: z.string().min(1),
      ask: z.string().min(1),
      must: z.array(z.string().min(1)).min(1),
      given: z.record(z.string(), z.unknown()).optional().describe("What the design's API tools answer in this case, by tool name (e.g. api_get_plants: {items: [...]}), instead of the mock's made-up example"),
    },
    run: async (doc, a, ctx) => {
      const old = a.eval === undefined ? undefined : doc.evals[a.eval];
      if (a.eval !== undefined && !old) throw new ToolError(`eval "${a.eval}" does not exist`);
      if (a.agent !== "buni" && !doc.agents[a.agent]) throw new ToolError(`no agent "${a.agent}"; use "buni" or one of ${Object.keys(doc.agents).join(", ") || "(none designed yet)"}`);
      const last = Object.values(doc.evals).map((x) => x.index).sort().at(-1) ?? null;
      const value: EvalCase = {
        ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).slug(a.ask.split(/\s+/).slice(0, 5).join(" ")), index: old?.index ?? generateKeyBetween(last, null),
        agent: a.agent, ask: a.ask, must: a.must, ...(a.given ?? old?.given ? { given: a.given ?? old?.given } : {}),
      };
      return { label: `${old ? "Change" : "Add"} eval case`, ops: [{ kind: "put", collection: "evals", value }], reply: `Eval ${value.id} saved with ${value.must.length} check${value.must.length === 1 ? "" : "s"}.` };
    },
  }),
  set_question: tool({
    description:
      "Record something not decided yet (kind question, with the options weighed: pros and cons) or taken as given (kind assumption), " +
      "and the pieces it is about. Agents read open questions instead of guessing. Decide one with decide_question.",
    input: {
      question: z.string().optional(),
      kind: z.enum(["question", "assumption"]).default("question"),
      text: z.string().min(1),
      options: z.array(z.object({ name: z.string().min(1), pros: z.string().optional(), cons: z.string().optional() })).default([]),
      about: z.array(z.string()).default([]),
    },
    run: async (doc, a, ctx) => {
      const old = a.question === undefined ? undefined : doc.questions[a.question];
      if (a.question !== undefined && !old) throw new ToolError(`question "${a.question}" does not exist`);
      const last = Object.values(doc.questions).map((q) => q.index).sort().at(-1) ?? null;
      const value: Question = {
        ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).slug(`q ${a.text.split(/\s+/).slice(0, 4).join(" ")}`), index: old?.index ?? generateKeyBetween(last, null),
        kind: a.kind, text: a.text, options: a.options, about: a.about,
        status: old?.status ?? "open", ...(old?.chosen ? { chosen: old.chosen } : {}), by: old?.by ?? ctx.author, at: old?.at ?? ctx.now(),
      };
      return { label: `${old ? "Change" : "Ask"}: ${a.text}`, ops: [{ kind: "put", collection: "questions", value }], reply: `Question ${value.id} saved.` };
    },
  }),

  decide_question: tool({
    description: "Close a question by choosing one of its options (and say why), or confirm an assumption; the outcome is also recorded as a decision.",
    input: { question: z.string(), option: z.string().optional().describe("Required for a question"), why: z.string().optional(), reopen: z.boolean().optional() },
    run: async (doc, a, ctx) => {
      const q = doc.questions[a.question];
      if (!q) throw new ToolError(`question "${a.question}" does not exist`);
      if (a.reopen) {
        const { chosen: _, ...rest } = q;
        return { label: `Reopen: ${q.text}`, ops: [{ kind: "put", collection: "questions", value: { ...rest, status: "open" } }], reply: "Reopened." };
      }
      if (q.kind === "question" && !q.options.some((o) => o.name === a.option)) throw new ToolError(`choose one of: ${q.options.map((o) => o.name).join(", ") || "(add options first)"}`);
      const text = q.kind === "question" ? `${q.text} → ${a.option}${a.why ? `: ${a.why}` : ""}` : `Assume: ${q.text}${a.why ? ` (${a.why})` : ""}`;
      const decision: Decision = { id: new Ids(doc, ctx).next(), text, by: ctx.author, at: ctx.now() };
      const value: Question = { ...q, status: "decided", ...(a.option && q.kind === "question" ? { chosen: a.option } : {}) };
      return { label: `Decide: ${q.text}`, ops: [{ kind: "put", collection: "questions", value }, { kind: "put", collection: "decisions", value: decision }], reply: `Decided; recorded as decision ${decision.id}.` };
    },
  }),

  set_role: tool({
    description: 'Add or change (pass role) a role: someone who uses the system, for access rules ("admin", "reviewer", "recipient").',
    input: { role: z.string().optional(), name: z.string().min(1), description: z.string().default("") },
    run: async (doc, a, ctx) => {
      const old = a.role === undefined ? undefined : doc.roles[a.role];
      if (a.role !== undefined && !old) throw new ToolError(`role "${a.role}" does not exist`);
      const last = Object.values(doc.roles).map((r) => r.index).sort().at(-1) ?? null;
      const value: Role = { ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null), name: a.name, description: a.description };
      return { label: `${old ? "Change" : "Add"} role ${a.name}`, ops: [{ kind: "put", collection: "roles", value }], reply: `Role ${value.id} saved.` };
    },
  }),

  set_access: tool({
    description: 'Say who may call an endpoint or operation: "public", "signed-in", or "roles" with role ids; and which rows (rule). Omit who to clear.',
    input: { call: z.string(), who: z.enum(["public", "signed-in", "roles"]).optional(), roles: z.array(z.string()).optional(), rule: z.string().optional() },
    run: async (doc, a) => {
      const access: Access | undefined = a.who ? { who: a.who, ...(a.who === "roles" ? { roles: a.roles ?? [] } : {}), ...(a.rule ? { rule: a.rule } : {}) } : undefined;
      const e = doc.endpoints[a.call];
      if (e) {
        const { access: _, ...rest } = e;
        return { label: `Access for ${e.method} ${e.path}`, ops: [{ kind: "put", collection: "endpoints", value: access ? { ...rest, access } : rest }], reply: "Saved." };
      }
      const o = doc.operations[a.call];
      if (!o) throw new ToolError(`no endpoint or operation "${a.call}"`);
      const { access: _, ...rest } = o;
      return { label: `Access for ${o.kind} ${o.name}`, ops: [{ kind: "put", collection: "operations", value: access ? { ...rest, access } : rest }], reply: "Saved." };
    },
  }),

  review: tool({
    description: "Set where a piece is in review: draft, proposed, changes (changes requested) or approved. " +
      "A note starts a discussion on the piece; asking for changes, say what should change.",
    input: { id: z.string(), state: z.enum(["draft", "proposed", "changes", "approved"]), note: z.string().min(1).optional() },
    run: async (doc, a, ctx) => {
      // What was reviewed, so a later change shows the review no longer covers the piece as it stands.
      const print = fingerprint(doc, a.id);
      const was = reviewCopy(doc, a.id);
      // Moving on from an approval keeps it, so the next reviewer sees what changed since that yes.
      const old = doc.reviews[a.id];
      const last = old?.state === "approved" ? { by: old.by, at: old.at, ...(old.was ? { was: old.was } : {}) } : old?.approved;
      const review: Op = { kind: "put", collection: "reviews", value: { id: a.id, state: a.state, by: ctx.author, at: ctx.now(), ...(print ? { fingerprint: print } : {}), ...(was ? { was } : {}), ...(a.state !== "approved" && last ? { approved: last } : {}) } };
      const thread: Thread | undefined = a.note ? { id: new Ids(doc, ctx).next(), target: a.id, state: "open", posts: [{ author: ctx.author, body: a.note, at: ctx.now() }] } : undefined;
      return { label: `Review: ${pieceName(doc, a.id)} ${a.state}`, ops: thread ? [review, { kind: "put", collection: "threads", value: thread }] : [review], reply: `${pieceName(doc, a.id)} is ${({ draft: "a draft", proposed: "proposed", changes: "sent back for changes", approved: "approved" })[a.state]}.${thread ? ` Thread ${thread.id} started.` : ""}` };
    },
  }),

  discuss: tool({
    description: "Start a discussion on a piece of the system (target), or reply in one (thread); state resolves or reopens it. " +
      "Resolving with a decision records the outcome in the design doc, where every agent reads it.",
    input: {
      target: z.string().optional(), thread: z.string().optional(), body: z.string().optional(), state: z.enum(["open", "addressed", "resolved"]).optional(),
      decision: z.string().min(1).optional().describe('With state "resolved": what was decided, e.g. "Refunds wait for the parcel in v1"'),
    },
    run: async (doc, a, ctx) => {
      if (a.decision !== undefined && (a.state !== "resolved" || !a.thread)) throw new ToolError('a decision closes a thread: pass thread and state "resolved" with it');
      const post = [...(a.body ? [a.body] : []), ...(a.decision ? [`Decided: ${a.decision}`] : [])].map((body) => ({ author: ctx.author, body, at: ctx.now() }));
      if (a.thread) {
        const t = doc.threads[a.thread];
        if (!t) throw new ToolError(`thread "${a.thread}" does not exist`);
        const value: Thread = { ...t, posts: [...t.posts, ...post], state: a.state ?? t.state };
        if (!a.decision) return { label: "Reply", ops: [{ kind: "put", collection: "threads", value }], reply: "Saved." };
        // Named after the piece, since the doc's decisions are read away from the thread.
        const decision: Decision = { id: new Ids(doc, ctx).next(), text: `${pieceName(doc, t.target)}: ${a.decision}`, by: ctx.author, at: ctx.now() };
        return { label: `Decide: ${a.decision}`, ops: [{ kind: "put", collection: "threads", value }, { kind: "put", collection: "decisions", value: decision }], reply: `Resolved; recorded as decision ${decision.id}.` };
      }
      if (!a.target || !a.body) throw new ToolError("start a thread with a target and a body");
      const value: Thread = { id: new Ids(doc, ctx).next(), target: a.target, state: a.state ?? "open", posts: post };
      return { label: "Start a discussion", ops: [{ kind: "put", collection: "threads", value }], reply: `Thread ${value.id} started.` };
    },
  }),
} satisfies Record<string, Tool>;
