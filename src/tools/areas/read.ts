import { sourceLabel } from "../../format/sources.ts";
// Reading a design: its layers, a node, the doc, flows, a build brief and attachments. One area of buni's design tools
// (agent/areas.ts); tools.ts gathers them.
import { z } from "zod";
import { childrenOf, outline, pageLabel, pagesInOrder, walkFlow, withImports, type Id, type Node } from "../../format/doc.ts";
import { contextText, docText, parseFocus } from "../context.ts";
import { forTarget } from "../terminal.ts";
import { type Tool, ToolError, node, page, subtree, tool } from "../kit.ts";

export const readTools = {
  read_tree: tool({
    description: "Outline of pages, or of one node's subtree: kind, tag, id, name and text.",
    input: { root: z.string().optional().describe("Node id; omit for every page") },
    run: async (doc, a) => {
      const lines: string[] = [];
      if (a.root !== undefined) outline(doc, node(doc, a.root), 0, lines);
      else {
        for (const p of pagesInOrder(doc)) {
          lines.push(`page ${p.id} "${p.name}" ${pageLabel(doc, p)}`);
          for (const source of p.sources ?? []) lines.push(`  source: ${sourceLabel(source)}`);
          const frame = doc.nodes[p.frame];
          if (frame) outline(doc, frame, 1, lines);
        }
        for (const s of Object.values(doc.shared)) {
          lines.push(`shared ${s.id} "${s.name}"`);
          for (const source of s.sources ?? []) lines.push(`  source: ${sourceLabel(source)}`);
          const root = doc.nodes[s.root];
          if (root) outline(doc, root, 1, lines);
        }
      }
      return { label: "Read tree", ops: [], reply: lines.join("\n") || "(empty document)" };
    },
  }),

  get_node: tool({
    description: "One node as JSON, with its children's ids. A component's id gives its root node, with the component's name and variant.",
    input: { id: z.string() },
    run: async (doc, a) => {
      const c = doc.shared[a.id];
      const n = node(doc, c ? c.root : a.id);
      const of = c ? { component: { id: c.id, name: c.name, ...(c.sources ? { sources: c.sources } : {}), ...(c.variant ? { variant: c.variant } : {}) } } : {};
      const reply = JSON.stringify({ ...of, ...n, children: childrenOf(doc, n.id).map((x) => x.id) }, null, 2);
      return { label: "Get node", ops: [], reply };
    },
  }),

  read_doc: tool({
    description: "The design doc: what this product is, who it is for, its principles and the decisions made so far. Read it before designing.",
    input: {},
    run: async (doc) => ({ label: "Read doc", ops: [], reply: docText(doc) || "(no design doc yet: write_section to start one)" }),
  }),

  read_context: tool({
    description:
      "A brief to build from: the design doc, then the system slice around one part, page, endpoint or table (its links, contracts, " +
      "tables, events and the pages that use it). Omit focus for the whole system. Read it before building or changing any piece.",
    input: {
      focus: z.string().optional().describe('"part:ID", "page:ID", "flow:ID", "endpoint:ID" (or "operation:ID"), "table:ID" or "trace:ID"; omit for the whole system'),
      target: z.string().optional().describe('For terminal clients built several ways: the one to brief, e.g. "ratatui", or "go" for a target with no framework'),
    },
    run: async (own, a, ctx) => {
      const all = withImports(own, ctx.imported);
      const doc = a.target === undefined ? all : forTarget(all, a.target);
      if (!doc) throw new ToolError(`no terminal client is built with "${a.target}"`);
      const focus = a.focus === undefined ? undefined : parseFocus(a.focus);
      if (a.focus !== undefined && !focus) throw new ToolError('focus looks like "part:ID", "page:ID", "flow:ID", "endpoint:ID", "operation:ID", "table:ID" or "trace:ID"');
      const r = contextText(doc, focus);
      if (!r.ok) throw new ToolError(r.error);
      return { label: "Read context", ops: [], reply: r.text };
    },
  }),

  read_flows: tool({
    description: "Every flow with the pages it reaches, the links between them, and its journey.",
    input: {},
    run: async (doc) => {
      const name = (id: Id) => `${doc.pages[id]?.name ?? id} (${id})`;
      const lines: string[] = [];
      for (const f of Object.values(doc.flows).sort((x, y) => (x.index < y.index ? -1 : 1))) {
        const { pages, links, alternatives } = walkFlow(doc, f.start);
        // The usual path, then the screens only a condition reaches (an error, a slow carrier).
        lines.push(`flow ${f.id} "${f.name}": ${pages.filter((p) => !alternatives.includes(p)).map(name).join(" → ")}`);
        if (alternatives.length) lines.push(`  when things differ: ${alternatives.map(name).join(", ")}`);
        for (const c of links) {
          lines.push(`  link ${c.id}: ${name(c.page)} ${doc.nodes[c.node]?.name ?? c.node} --${c.trigger}${c.condition ? ` if ${c.condition}` : ""}--> ${name(c.to)} [${c.transition} ${c.durationMs}ms]`);
        }
        const j = Object.values(doc.journeys).find((x) => x.flow === f.id);
        if (j) {
          lines.push(`  journey ${j.id}, lanes: ${j.lanes.join(", ")}`);
          for (const s of j.steps) {
            const cells = j.lanes.filter((l) => s.cells[l]).map((l) => `${l}: ${s.cells[l]}`).join(" | ");
            lines.push(`    ${name(s.page)}${s.confidence ? ` confidence ${s.confidence}` : ""}${cells ? ` — ${cells}` : ""}`);
          }
        }
      }
      // Reached by navigation counts as reached; flows only leave it out as a step.
      const navTo = new Set(Object.values(doc.connections).filter((c) => c.nav).map((c) => c.to));
      const orphans = pagesInOrder(doc).filter((p) => !navTo.has(p.id) && !Object.values(doc.flows).some((f) => walkFlow(doc, f.start).pages.includes(p.id)));
      if (orphans.length) lines.push(`pages in no flow: ${orphans.map((p) => name(p.id)).join(", ")}`);
      return { label: "Read flows", ops: [], reply: lines.join("\n") || "(no flows)" };
    },
  }),

  read_attachment: tool({
    description: "Read a text attachment listed in the document (briefs, research notes).",
    input: { id: z.string() },
    run: async (doc, a, ctx) => {
      const att = doc.attachments[a.id];
      if (!att) throw new ToolError(`attachment "${a.id}" does not exist`);
      // Text only; add PDF text extraction when briefs arrive as PDFs
      if (!att.mime.startsWith("text/") && att.mime !== "application/json") {
        throw new ToolError(`attachment "${a.id}" is ${att.mime}; only text attachments can be read`);
      }
      return { label: "Read attachment", ops: [], reply: await ctx.readAttachment(att.path) };
    },
  }),
} satisfies Record<string, Tool>;
