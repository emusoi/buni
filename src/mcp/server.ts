import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadSkills, readSkill, skillList } from "../skills/skills.ts";
import { toolNames, tools } from "../tools/tools.ts";
import type { Doc } from "../format/doc.ts";
import type { Workspace } from "../tools/workspace.ts";
import { VERSION } from "../version.ts";
import { editChecks } from "../tools/review.ts";

const INSTRUCTIONS = `buni is a design tool. You edit one .buni document through these tools only.
Every edit is written to the file at once, so make each one leave the design in a good state (keep the file in git to go back).
Design skills hold buni's design guidance: call list_skills, then read_skill the ones that fit before you design (principles for anything new, typography and color before tokens, layout before a page).
Start with read_tree and read_doc (the design doc: who it's for, principles, direction); read_context gives the brief for one page or flow. Build UI with write_html (inline styles, CSS custom properties from tokens).
Import existing HTML with import_html_page: give url, file (inside the design folder) or html, an optional selector, and page or parent. It resolves class styles and images into editable layers using Chrome on the host; scripts are excluded unless live is set (a JavaScript app; cookies signs it in, wait_for waits for it). Attach source_file and symbol to retain implementation context. To improve a page that already ships, snapshot it this way first and improve from the snapshot (read_skill critique).
To try alternatives of a page: explore_page makes options (copies with an idea each), compare_options reviews them, pick_option makes one live.
review_page checks a page as it renders (motion, contrast, type, targets, overflow, generated-look tells), scores it and names the layers; against compares a fixed copy with its snapshot.
Terminal screens: create_page with terminal, or set_screen; read_skill terminal first.
Multi-screen work: link screens with connect, name the path with set_flow, and describe the experience step by step with set_journey. read_flows shows what exists.
Icons: <buni-icon name="search" size="16" style="color:…"> in write_html draws a Lucide icon; find_icons searches names.
Reuse: make_component turns a layer into a component (nav bars, cards, footers); place_component uses it elsewhere; override changes one use's text. Edit the component itself to change every use.
When a choice is the person's to make (copy, a direction, a trade-off), ask_person asks them in the editor and waits for the answer; don't ask about each step.
Tasks: what the person asked for, in their words. tasks lists them, queued first; take_task before you start one, finish_task with a note on what you did and what to look at. Several agents share the list: take only what you will do now.
Architecture (how the app is built and shipped, designed before it is built): set_part, link_parts, set_build, set_environment, set_cluster, set_namespace, set_workload, set_release, set_migration, set_stage and set_play; read_architecture gives the brief (level system, runtime or code; environment; focus). Plan a change with set_plan and mark what it adds status "planned" with plan; merge_plan is the person's to run.
Designing the software path layer by layer: read_skill architecture; then check_architecture, fix what it finds, and export_architecture writes drafts (manifests, argocd, ci, brief) for the person to review.
Pen marks the person drew on a tablet: read_marks lists them; screenshot with marks: true shows the handwriting. Answer each with comment {thread, body, addressed: true}.
If an edit is refused, the reply says which reference or rule it broke; fix the call and retry.`;

const SPACE = `You are connected to a space, not one design: list_designs shows every design you may work on (your own and each organization's), use_design picks one, create_design starts one; every other tool then works on the one picked. Switch with use_design whenever the work moves to another design.`;

/**
 * MCP server over one workspace. Edits are made as the client's name, so the
 * canvas shows who is working where.
 */
export interface HostTools {
  /** Renders a page to PNG (base64). Only a host with a browser engine can offer this. */
  screenshot?: (pageId: string, marks: boolean | undefined, ws: Workspace) => Promise<string>;
  /** A terminal screen as the characters a terminal shows, borders and all. Needs a browser engine too. */
  screenAsText?: (pageId: string, ws: Workspace) => Promise<string>;
  /** Loads a live website and returns a PNG (base64) and a short summary of its look. */
  lookAtUrl?: (url: string) => Promise<{ png: string; summary: string }>;
  /** Puts a question to the person watching in the editor; the answer, or undefined when none came in time. */
  ask?: (author: string, q: { question: string; options: string[]; node?: string }, ws: Workspace) => Promise<string | undefined>;
  /** An agent changed the design; `before` is how it was. The host can keep it as a point to go back to. */
  edited?: (author: string, before: Doc, ws: Workspace) => void;
  /**
   * Before a tool runs: resolves when the person lets the agent go on (at once unless they paused it), with what
   * they said to it meanwhile, which goes on top of the tool's reply.
   */
  hold?: (author: string, ws: Workspace) => Promise<string[]>;
  /** What the agent runs now, and when it is done: the editor shows it beside the agent. */
  working?: (author: string, tool: string, phase: "start" | "done", ws: Workspace) => void;
  /**
   * The designs the client may work on, when it is connected to a space rather than one design: it lists them,
   * picks one (use_design), or starts one (create_design); every other tool then works on the one picked.
   */
  designs?: {
    list(): Promise<{ space: string; name: string; path: string; pages: number }[]>;
    use(path: string): Promise<Workspace>;
    create(name: string, space?: string): Promise<Workspace>;
  };
}


export function createMcpServer(first: Workspace | undefined, host: HostTools = {}): McpServer {
  const server = new McpServer({ name: "buni", version: VERSION }, { instructions: host.designs ? `${INSTRUCTIONS}\n${SPACE}` : INSTRUCTIONS });
  const author = () => server.server.getClientVersion()?.name ?? "mcp client";
  /** The design the tools work on; a client connected to a space picks it with use_design. */
  let current = first;
  const none = { content: [{ type: "text" as const, text: "No design is chosen yet: list_designs, then use_design one, or create_design." }], isError: true };

  for (const name of toolNames) {
    const tool = tools[name];
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, async (args) => {
      const ws = current;
      if (!ws) return none;
      const notes = (await host.hold?.(author(), ws)) ?? [];
      host.working?.(author(), name, "start", ws);
      try {
        // An imported core may have been edited where this server doesn't see (straight to disk): read it again first.
        await ws.refreshImports();
        const before = ws.view();
        const r = await ws.call(author(), name, args);
        const after = ws.view();
        if (after !== before) host.edited?.(author(), before, ws);
        const checks = r.ok && after !== before ? await editChecks(before, after) : "";
        const said = notes.length ? `The person watching says:\n${notes.map((n) => `- ${n}`).join("\n")}\n\n` : "";
        return { content: [{ type: "text", text: `${said}${checks ? `${r.reply}\n${checks}` : r.reply}` }], isError: !r.ok };
      } finally {
        host.working?.(author(), name, "done", ws);
      }
    });
  }
  const { designs } = host;
  if (designs) {
    const named = (ws: Workspace) => `Working on ${ws.path.split("/").pop()?.replace(/\.buni$/, "")} (${ws.path}): ${Object.keys(ws.view().pages).length} pages. read_tree and read_doc come next.`;
    server.registerTool("list_designs", { description: "The designs you can work on, by space (your own, each organization's): name, path and pages. use_design picks one.", inputSchema: {} }, async () => {
      const all = await designs.list();
      const lines = all.map((d) => `${d.space} · ${d.name} — ${d.path} — ${d.pages} page${d.pages === 1 ? "" : "s"}`);
      return { content: [{ type: "text", text: lines.length ? `${lines.join("\n")}${current ? `\n\nNow on: ${current.path}` : ""}` : "No designs yet. create_design starts one." }] };
    });
    server.registerTool("use_design", { description: "Work on one of the designs list_designs shows, by its path (or its exact name). Later tools act on it.", inputSchema: { design: z.string() } }, async ({ design }) => {
      const all = await designs.list();
      const hit = all.find((d) => d.path === design) ?? all.find((d) => d.name === design) ?? all.find((d) => d.name.toLowerCase() === design.toLowerCase());
      if (!hit) return { content: [{ type: "text", text: `No design "${design}". list_designs shows them.` }], isError: true };
      current = await designs.use(hit.path);
      return { content: [{ type: "text", text: named(current) }] };
    });
    server.registerTool("create_design", { description: "Start a new design in a space (your own unless `space` names an organization) and work on it.", inputSchema: { name: z.string(), space: z.string().optional() } }, async ({ name, space }) => {
      try {
        current = await designs.create(name, space);
        return { content: [{ type: "text", text: `Created. ${named(current)}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
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
  const { ask } = host;
  if (ask) {
    server.registerTool(
      "ask_person",
      {
        description: "Ask the person watching in the editor and wait for their answer (up to ten minutes). Use it for a choice that is theirs to make, not to check each step. Give two to four short options; they can also write their own. Name a layer with node to ask about it in place.",
        inputSchema: { question: z.string(), options: z.array(z.string()).max(4).optional(), node: z.string().optional() },
      },
      async ({ question, options, node }) => {
        const ws = current;
        if (!ws) return none;
        if (node && !ws.view().nodes[node]) return { content: [{ type: "text", text: `layer "${node}" does not exist` }], isError: true };
        const answer = await ask(author(), { question, options: options ?? [], ...(node ? { node } : {}) }, ws);
        return { content: [{ type: "text", text: answer === undefined ? "No answer in ten minutes. Go with your best judgement, and say what you chose and why." : `They answered: ${answer}` }] };
      },
    );
  }
  const { screenshot } = host;
  if (screenshot) {
    server.registerTool(
      "screenshot",
      { description: "Render one page to a PNG; marks draws the pen marks people left on it (read_marks lists them).", inputSchema: { page: z.string(), marks: z.boolean().optional() } },
      async ({ page, marks }) => {
        const ws = current;
        if (!ws) return none;
        if (!ws.view().pages[page]) return { content: [{ type: "text", text: `page "${page}" does not exist` }], isError: true };
        return { content: [{ type: "image", data: await screenshot(page, marks, ws), mimeType: "image/png" }] };
      },
    );
  }
  const { screenAsText } = host;
  if (screenAsText) {
    server.registerTool(
      "read_screen",
      { description: "Read a terminal screen as the characters a terminal shows, borders as box drawing: what to build, cell for cell.", inputSchema: { page: z.string() } },
      async ({ page }) => {
        const ws = current;
        if (!ws) return none;
        if (!ws.view().pages[page]) return { content: [{ type: "text", text: `page "${page}" does not exist` }], isError: true };
        return { content: [{ type: "text", text: await screenAsText(page, ws) }] };
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
