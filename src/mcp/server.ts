import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadSkills, readSkill, skillList } from "../skills/skills.ts";
import { toolNames, tools } from "../tools/tools.ts";
import type { Workspace } from "../tools/workspace.ts";
import { VERSION } from "../version.ts";

const INSTRUCTIONS = `buni is a design tool. You edit one .buni document through these tools only.
Every edit is written to the file at once, so make each one leave the design in a good state (keep the file in git to go back).
Design skills hold buni's design guidance: call list_skills, then read_skill the ones that fit before you design (principles for anything new, typography and color before tokens, layout before a page).
Start with read_tree and read_doc (the design doc: who it's for, principles, direction, decisions); read_context gives the brief for one part, page, endpoint or table. Build UI with write_html (inline styles, CSS custom properties from tokens).
The system behind the pages has its own tools: set_part and link_parts, set_endpoint, set_operation, set_table, set_shape, set_event; the plan has set_requirement, set_phase and set_question.
Multi-screen work: link screens with connect, name the path with set_flow, and describe the experience step by step with set_journey. read_flows shows what exists.
Icons: <buni-icon name="search" size="16" style="color:…"> in write_html draws a Lucide icon; find_icons searches names.
Reuse: make_component turns a layer into a component (nav bars, cards, footers); place_component uses it elsewhere; override changes one use's text. Edit the component itself to change every use.
If an edit is refused, the reply says which reference or rule it broke; fix the call and retry.`;

/**
 * MCP server over one workspace. Edits are made as the client's name, so the
 * canvas shows who is working where.
 */
export interface HostTools {
  /** Renders a page to PNG (base64). Only a host with a browser engine can offer this. */
  screenshot?: (pageId: string) => Promise<string>;
  /** A terminal screen as the characters a terminal shows, borders and all. Needs a browser engine too. */
  screenAsText?: (pageId: string) => Promise<string>;
  /** Loads a live website and returns a PNG (base64) and a short summary of its look. */
  lookAtUrl?: (url: string) => Promise<{ png: string; summary: string }>;
}

export function createMcpServer(ws: Workspace, host: HostTools = {}): McpServer {
  const server = new McpServer({ name: "buni", version: VERSION }, { instructions: INSTRUCTIONS });
  const author = () => server.server.getClientVersion()?.name ?? "mcp client";

  for (const name of toolNames) {
    const tool = tools[name];
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, async (args) => {
      const r = await ws.call(author(), name, args);
      return { content: [{ type: "text", text: r.reply }], isError: !r.ok };
    });
  }
  server.registerTool("list_skills", { description: "List the design skills: what each covers and when to read it.", inputSchema: {} }, async () => ({
    content: [{ type: "text", text: skillList(await loadSkills()) }],
  }));
  server.registerTool(
    "read_skill",
    { description: "Read one design skill by name, e.g. typography, before doing that kind of work.", inputSchema: { name: z.string() } },
    async ({ name }) => {
      const skill = await readSkill(name);
      return skill
        ? { content: [{ type: "text", text: skill.body }] }
        : { content: [{ type: "text", text: `No skill "${name}"; list_skills shows what exists.` }], isError: true };
    },
  );
  const { screenshot } = host;
  if (screenshot) {
    server.registerTool(
      "screenshot",
      { description: "Render one page to a PNG.", inputSchema: { page: z.string() } },
      async ({ page }) => {
        if (!ws.view().pages[page]) return { content: [{ type: "text", text: `page "${page}" does not exist` }], isError: true };
        return { content: [{ type: "image", data: await screenshot(page), mimeType: "image/png" }] };
      },
    );
  }
  const { screenAsText } = host;
  if (screenAsText) {
    server.registerTool(
      "read_screen",
      { description: "Read a terminal screen as the characters a terminal shows, borders as box drawing: what to build, cell for cell.", inputSchema: { page: z.string() } },
      async ({ page }) => {
        if (!ws.view().pages[page]) return { content: [{ type: "text", text: `page "${page}" does not exist` }], isError: true };
        return { content: [{ type: "text", text: await screenAsText(page) }] };
      },
    );
  }
  const { lookAtUrl } = host;
  if (lookAtUrl) {
    server.registerTool(
      "look_at_url",
      { description: "Open a live website for reference: a screenshot plus its title, headings, colours and fonts.", inputSchema: { url: z.string() } },
      async ({ url }) => {
        try {
          const r = await lookAtUrl(url);
          return { content: [{ type: "image", data: r.png, mimeType: "image/png" }, { type: "text", text: r.summary }] };
        } catch (e) {
          return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
        }
      },
    );
  }
  return server;
}
