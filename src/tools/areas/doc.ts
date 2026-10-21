import { sourceRefs, sourceTarget } from "../../format/sources.ts";
import type { Op } from "../../oplog/oplog.ts";
// The design doc: its sections. One area of buni's design tools (agent/areas.ts); tools.ts gathers
// them.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import type { Section } from "../../format/doc.ts";
import { sectionsInOrder } from "../doc-text.ts";
import { Ids, type Tool, ToolError, tool } from "../kit.ts";

export const docTools = {
  set_sources: tool({
    description: "Link any page, layer, component, link, flow, journey, doc section, rule, attachment or comment, or an architecture part, workload, release or plan, to its implementation files and symbols. Works for manually designed and imported items. Give repository-relative paths where possible. Empty sources removes links; this records context and does not change source code.",
    input: { ids: z.array(z.string()).min(1), sources: sourceRefs },
    run: async (doc, a) => {
      const ops: Op[] = a.ids.map((id) => {
        const target = sourceTarget(doc, id);
        if (!target) throw new ToolError(`No design item "${id}"`);
        const { sources: _sources, ...rest } = target.entity;
        return { kind: "put", collection: target.collection, value: { ...rest, ...(a.sources.length ? { sources: a.sources } : {}) } } as Op;
      });
      return { label: "Link source files", ops, reply: `Updated source context for ${a.ids.length} item(s).` };
    },
  }),
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
      const value: Section = { ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).next(), heading: a.heading, body: a.body, index: old?.index ?? generateKeyBetween(last, null) };
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
} satisfies Record<string, Tool>;
