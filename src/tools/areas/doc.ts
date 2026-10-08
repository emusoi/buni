// The design doc: sections, and the decisions taken. One area of buni's design tools (agent/areas.ts); tools.ts gathers
// them.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import type { Decision, Section } from "../../format/doc.ts";
import { sectionsInOrder } from "../context.ts";
import { Ids, type Tool, ToolError, body, tool } from "../kit.ts";

export const docTools = {
  write_section: tool({
    description: "Add a section to the design doc, or rewrite one (pass section). Keep it short: a heading and a few plain sentences.",
    input: {
      section: z.string().optional().describe("Section id to rewrite; omit to add one at the end"),
      heading: z.string().min(1),
      body: z.string(),
    },
    run: async (doc, a, ctx) => {
      const old = a.section === undefined ? undefined : doc.sections[a.section];
      if (a.section !== undefined && !old) throw new ToolError(`section "${a.section}" does not exist`);
      const last = sectionsInOrder(doc).at(-1)?.index ?? null;
      const value: Section = { id: old?.id ?? new Ids(doc, ctx).next(), heading: a.heading, body: a.body, index: old?.index ?? generateKeyBetween(last, null) };
      return { label: `${old ? "Rewrite" : "Add"} doc section ${a.heading}`, ops: [{ kind: "put", collection: "sections", value }], reply: `Section ${value.id} saved.` };
    },
  }),

  delete_section: tool({
    description: "Remove a section from the design doc.",
    input: { section: z.string() },
    run: async (doc, a) => {
      const old = doc.sections[a.section];
      if (!old) throw new ToolError(`section "${a.section}" does not exist`);
      return { label: `Remove doc section ${old.heading}`, ops: [{ kind: "delete", collection: "sections", id: old.id }], reply: "Removed." };
    },
  }),

  decide: tool({
    description: "Record a design decision in the doc, e.g. \"8px spacing grid\" or \"serif for note text\", so every agent and person follows it.",
    input: { text: z.string().min(1) },
    run: async (doc, a, ctx) => {
      const value: Decision = { id: new Ids(doc, ctx).next(), text: a.text, by: ctx.author, at: ctx.now() };
      return { label: `Decide: ${a.text}`, ops: [{ kind: "put", collection: "decisions", value }], reply: `Decision ${value.id} recorded.` };
    },
  }),

  drop_decision: tool({
    description: "Remove a decision from the doc when it no longer holds.",
    input: { decision: z.string() },
    run: async (doc, a) => {
      const old = doc.decisions[a.decision];
      if (!old) throw new ToolError(`decision "${a.decision}" does not exist`);
      return { label: `Drop decision: ${old.text}`, ops: [{ kind: "delete", collection: "decisions", id: old.id }], reply: "Removed." };
    },
  }),
} satisfies Record<string, Tool>;
