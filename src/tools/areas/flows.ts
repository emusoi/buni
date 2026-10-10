// Flows: links between screens, named flows and journeys. One area of buni's design tools (agent/areas.ts); tools.ts
// gathers them.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { walkFlow, type Connection, type Endpoint, type Journey, type Link } from "../../format/doc.ts";
import type { Op } from "../../oplog/oplog.ts";
import { Ids, type Tool, ToolError, linkPages, node, page, tool } from "../kit.ts";

export const flowsTools = {
  connect: tool({
    description:
      "Link a node to a page: in Play mode and in export, triggering the node goes there. Replaces the node's existing link for the same trigger and condition; " +
      "a link with a condition is an alternative path from the same node (\"the carrier was slow\"), next to its usual one. " +
      "For a layer inside a component (a nav item), it links on every page that uses the component; give page to link on one only.",
    input: {
      node: z.string(),
      page: z.string().optional().describe("Only for layers inside a component: link on this page only, not every page that uses it"),
      to: z.string().describe("Destination page id"),
      trigger: z.enum(["click", "hover", "submit", "key"]).default("click"),
      key: z.string().optional().describe('For a "key" trigger: the key, e.g. "enter", "ctrl+k", "?", or a tmux binding "prefix g". Give the screen\'s frame as node for a key that works anywhere on it'),
      transition: z.enum(["none", "fade", "slide-left", "slide-right"]).default("none"),
      durationMs: z.number().int().min(0).max(5000).default(200),
      condition: z.string().optional().describe('When the link applies, e.g. "signed in"'),
      endpoint: z.string().optional().describe('Endpoint or GraphQL operation this trigger calls, e.g. a form submit that posts; kept from the existing link when omitted, "" to clear'),
      nav: z.boolean().optional().describe("Navigation that is always there (a sidebar item, a tab bar): flows don't follow it as a step. Kept from the existing link when omitted"),
    },
    run: async (doc, a, ctx) => {
      const to = page(doc, a.to);
      if (a.trigger === "key" && !a.key) throw new ToolError('a "key" trigger needs key, e.g. "enter"');
      // Across a component's uses, the page it points to doesn't link to itself (the nav item for where you are).
      const froms = a.page === undefined ? linkPages(doc, a.node).filter((p, _, all) => all.length === 1 || p.id !== to.id) : [page(doc, a.page)];
      const ids = new Ids(doc, ctx);
      const made = froms.map((from) => {
        // One link per node, trigger and condition (for keys, per key): a condition makes an alternative path, not a replacement.
        const existing = Object.values(doc.connections).find((c) => c.node === a.node && c.page === from.id && c.trigger === a.trigger && (a.trigger !== "key" || c.key === a.key) && (c.condition ?? "") === (a.condition ?? ""));
        const value: Connection = {
          ...(existing?.sources ? { sources: existing.sources } : {}), id: existing?.id ?? ids.next(),
          page: from.id, node: a.node, to: to.id, trigger: a.trigger, transition: a.transition, durationMs: a.durationMs,
          ...(a.trigger === "key" && a.key ? { key: a.key } : {}),
          ...(a.condition ? { condition: a.condition } : {}),
        };
        const endpoint = a.endpoint ?? existing?.endpoint;
        if (endpoint) value.endpoint = endpoint;
        if (a.nav ?? existing?.nav) value.nav = true;
        return { value, line: `${existing ? "Updated" : "Created"} connection ${value.id}: ${from.name} → ${to.name}.` };
      });
      return {
        label: `Link ${node(doc, a.node).name} to ${to.name}`,
        ops: made.map(({ value }) => ({ kind: "put", collection: "connections", value })),
        reply: made.map((m) => m.line).join("\n"),
      };
    },
  }),

  disconnect: tool({
    description: "Remove connections by id.",
    input: { connections: z.array(z.string()).min(1) },
    run: async (doc, a) => {
      for (const id of a.connections) if (!doc.connections[id]) throw new ToolError(`connection "${id}" does not exist`);
      return {
        label: `Remove ${a.connections.length} link${a.connections.length === 1 ? "" : "s"}`,
        ops: a.connections.map((id) => ({ kind: "delete", collection: "connections", id })),
        reply: "Removed.",
      };
    },
  }),

  set_flow: tool({
    description: "Create a named flow starting at a page, rename or restart one, or remove it with its journey. Flows follow connections from the start page.",
    input: {
      flow: z.string().optional().describe("Flow id to change; omit to create"),
      name: z.string().optional(),
      start: z.string().optional().describe("Start page id"),
      remove: z.boolean().optional(),
    },
    run: async (doc, a, ctx) => {
      const old = a.flow === undefined ? undefined : doc.flows[a.flow];
      if (a.flow !== undefined && !old) throw new ToolError(`flow "${a.flow}" does not exist`);
      if (old && a.remove) {
        const ops: Op[] = [{ kind: "delete", collection: "flows", id: old.id }];
        for (const j of Object.values(doc.journeys)) if (j.flow === old.id) ops.push({ kind: "delete", collection: "journeys", id: j.id });
        return { label: `Remove flow ${old.name}`, ops, reply: "Removed the flow and its journey." };
      }
      if (a.start !== undefined) page(doc, a.start);
      const name = a.name ?? old?.name;
      const start = a.start ?? old?.start;
      if (name === undefined || start === undefined) throw new ToolError("a new flow needs a name and a start page");
      const last = Object.values(doc.flows).map((f) => f.index).sort().at(-1) ?? null;
      const value = { ...(old?.sources ? { sources: old.sources } : {}), id: old?.id ?? new Ids(doc, ctx).next(), name, start, index: old?.index ?? generateKeyBetween(last, null) };
      const { pages } = walkFlow(doc, start);
      return {
        label: `${old ? "Change" : "Create"} flow ${name}`,
        ops: [{ kind: "put", collection: "flows", value }],
        reply: `Flow ${value.id} reaches ${pages.length} page${pages.length === 1 ? "" : "s"}: ${pages.map((id) => doc.pages[id]?.name ?? id).join(" → ")}.`,
      };
    },
  }),

  set_journey: tool({
    description:
      "Write the UX journey for a flow: lanes (e.g. Does, Thinks, System, Watch for) and one step per screen with lane text, " +
      "confidence 1-5 and evidence attachment ids. Replaces the flow's journey.",
    input: {
      flow: z.string(),
      lanes: z.array(z.string().min(1)).min(1),
      steps: z.array(z.object({
        page: z.string(),
        confidence: z.literal([1, 2, 3, 4, 5]).optional(),
        cells: z.record(z.string(), z.string()).default({}),
        evidence: z.array(z.string()).default([]),
      })).min(1),
    },
    run: async (doc, a, ctx) => {
      const flow = doc.flows[a.flow];
      if (!flow) throw new ToolError(`flow "${a.flow}" does not exist`);
      const existing = Object.values(doc.journeys).find((j) => j.flow === flow.id);
      const value: Journey = {
        ...(existing?.sources ? { sources: existing.sources } : {}), id: existing?.id ?? new Ids(doc, ctx).next(),
        flow: flow.id,
        lanes: a.lanes,
        steps: a.steps.map((s) => ({
          page: s.page, cells: s.cells, evidence: s.evidence,
          ...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
        })),
      };
      return {
        label: `Journey for ${flow.name}`,
        ops: [{ kind: "put", collection: "journeys", value }],
        reply: `${existing ? "Replaced" : "Created"} journey ${value.id} with ${value.steps.length} steps.`,
      };
    },
  }),
} satisfies Record<string, Tool>;
