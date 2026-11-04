// Tasks: what the person asked for, in their words, for an agent to take. Queued until taken, working until done.
import { z } from "zod";
import { generateKeyBetween } from "fractional-indexing";
import { Ids, ToolError, tool, type Tool } from "../kit.ts";
import type { Doc, Task } from "../../format/doc.ts";

const byIndex = (a: Task, b: Task) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
/** Queued first, then working, then done; each in the order asked. */
export function tasksInOrder(doc: Doc): Task[] {
  const rank = { queued: 0, working: 1, done: 2 };
  return Object.values(doc.tasks).sort((a, b) => rank[a.state] - rank[b.state] || byIndex(a, b));
}
const one = (doc: Doc, id: string): Task => {
  const t = doc.tasks[id];
  if (!t) throw new ToolError(`task "${id}" does not exist; tasks lists them`);
  return t;
};
const line = (doc: Doc, t: Task) => `${t.id} [${t.state}${t.by ? ` · ${t.by}` : ""}] ${t.title}${t.page ? ` (on ${doc.pages[t.page]?.name ?? t.page})` : ""}${t.detail ? `\n    ${t.detail}` : ""}${t.note ? `\n    done: ${t.note}` : ""}`;

export const tasksTools = {
  tasks: tool({
    description: "What the person asked for: every task, queued first, with who took it and what was done. Take one with take_task before working on it.",
    input: {},
    run: async (doc) => {
      const all = tasksInOrder(doc);
      return { label: "Tasks", ops: [], reply: all.length ? all.map((t) => line(doc, t)).join("\n") : "No tasks. The person adds them in the editor's Agents panel; add_task adds one too." };
    },
  }),
  add_task: tool({
    description: "Ask for something to be done, in the person's words: a title, detail if it needs it, and the page it is about when it is about one. Queued until an agent takes it.",
    input: { title: z.string().min(1).max(200), detail: z.string().max(4000).optional(), page: z.string().optional() },
    run: async (doc, a, ctx) => {
      if (a.page !== undefined && !doc.pages[a.page]) throw new ToolError(`page "${a.page}" does not exist`);
      const last = tasksInOrder(doc).at(-1)?.index ?? null;
      const task: Task = { id: new Ids(doc, ctx).next(), title: a.title.trim(), ...(a.detail?.trim() ? { detail: a.detail.trim() } : {}), state: "queued", ...(a.page ? { page: a.page } : {}), at: ctx.now(), index: generateKeyBetween(last, null) };
      return { label: `Ask: ${task.title}`, ops: [{ kind: "put", collection: "tasks", value: task }], reply: `Task ${task.id} is queued: ${task.title}` };
    },
  }),
  take_task: tool({
    description: "Take a queued task: it is yours, shown as working beside your name. Do the work with the other tools, then finish_task.",
    input: { task: z.string() },
    run: async (doc, a, ctx) => {
      const t = one(doc, a.task);
      if (t.state === "working" && t.by !== ctx.author) throw new ToolError(`${t.by} is on it already`);
      if (t.state === "done") throw new ToolError("that task is done");
      return { label: `Take: ${t.title}`, ops: [{ kind: "put", collection: "tasks", value: { ...t, state: "working", by: ctx.author, taken: ctx.now() } }], reply: `Working on ${t.id}: ${t.title}${t.detail ? `\n${t.detail}` : ""}` };
    },
  }),
  finish_task: tool({
    description: "Finish a task you took, with a note saying what you did and what to look at.",
    input: { task: z.string(), note: z.string().min(1).max(2000) },
    run: async (doc, a, ctx) => {
      const t = one(doc, a.task);
      return { label: `Done: ${t.title}`, ops: [{ kind: "put", collection: "tasks", value: { ...t, state: "done", by: t.by ?? ctx.author, note: a.note.trim(), done: ctx.now() } }], reply: `${t.title} is done.` };
    },
  }),
  delete_task: tool({
    description: "Remove a task (the person's call, usually: one no longer wanted). Tasks that are done can stay as the record.",
    input: { task: z.string() },
    run: async (doc, a) => {
      const t = one(doc, a.task);
      return { label: `Remove task: ${t.title}`, ops: [{ kind: "delete", collection: "tasks", id: t.id }], reply: `Removed ${t.id}.` };
    },
  }),
} satisfies Record<string, Tool>;
