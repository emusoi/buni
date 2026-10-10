#!/usr/bin/env bun
// The buni command line: the design tools for any coding agent that can run a shell.
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { emptyDoc } from "./format/doc.ts";
import { serializeDoc } from "./format/serialize.ts";
import { startMcpHttp } from "./mcp/http.ts";
import { createMcpServer } from "./mcp/server.ts";
import { loadSkills, readSkill, skillList, SKILLS_DIR } from "./skills/skills.ts";
import { pageSvg } from "./tools/html.ts";
import { toolNames, tools, type ToolName } from "./tools/tools.ts";
import { Workspace } from "./tools/workspace.ts";
import { renderHeadless, screenAsText, screenshotPng } from "./term/render.ts";
import { embeddedFont } from "./tools/fontdata.ts";
import { VERSION } from "./version.ts";
import { ACCOUNT_FILE, DEFAULT_SERVER, saveAccount, signedIn, type Account } from "./account/account.ts";
import { checkServer } from "./account/wazo.ts";

const COMMANDS = `buni — design tools for agents and people. Edits are written to the file at once (keep it in git to go back).

usage: buni <command> [args] [--as <name>] [--json]

  help                              how to design with buni (read this first)
  skill                             the same guide as a SKILL.md for coding agents
  tools [name]                      every design tool and its arguments; with a name, that tool's in full
  skills [name]                     design skills: list them, or print one to follow
  new <file.buni>                   start an empty design
  open <file.buni>                  edit it in your browser, live as agents design it
      [--port N] [--no-open]          its port; print the address instead
  tree <file.buni> [node]           outline of pages, components and layers
  context <file.buni> [kind:id] [--target fw]   brief to build from: doc + system slice (part:, page:, flow:, endpoint:, table:);
                                    --target picks one build of a terminal client, e.g. ratatui
  call <file.buni> <tool> [json|-]  run one tool; "-" reads the JSON from stdin
  shot <file.buni> <page> <out>     draw a page (id, name or route) to .png (--scale 2), .pdf, or .svg (a graphic
                                    that is one svg), with the Chrome, Chromium or Edge on this machine; a terminal
                                    screen also to .txt, its characters, or .ans, the same in colour for cat
  icons <file.buni> <page> <dir>    an app icon set from a square graphic: PNGs 16-1024, favicon.ico, AppIcon.icns
  export <file.buni> <out-dir>      write the site as static HTML + CSS
  pdf <file.buni> <out.pdf>         the whole system design as one PDF to share
  split <file.buni> part:<id> <new.buni>  move a part and what it owns into its own file; the two import each other
  mcp <file.buni>                   serve the tools over MCP (stdio)
  login [--server URL]              sign in with Wazo; your designs on buni.emusoi.app (or URL) then work with --remote
  logout | whoami                   sign out of it, or say who you are signed in as
  ls                                your designs on that buni server
`;
const FLAGS = `--remote     <file.buni> names a design on your buni server instead, as \`buni ls\` shows it: tree, context, call,
             export and mcp work on it there, and the edits show for everyone who has it open
--as <name>  who you are, shown on the canvas where you work (default: $BUNI_AGENT or "cli")
--json       machine-readable output where it applies`;
/** The help, with the commands a carrying package adds. */
const usage = (ext?: Extension) => [COMMANDS, ext?.usage ?? "", FLAGS].filter(Boolean).join("\n");

const GUIDE = `# Designing with buni

A .buni file is a set of desktop web pages, flows between them and reusable components, plus graphics:
fixed-size boards such as logos, app icons, posts and slides.
You change it only through tools; each edit is written to the file at once (the person can undo it in a buni editor,
or with git), so make each one leave the design in a good state.

Design guidance:    buni skills, then buni skills NAME (principles, typography, color, layout, …)
New design:         buni new FILE.buni
Start by reading:   buni tree FILE
Build with HTML:    buni call FILE write_html '{"parent":"FRAME_ID","html":"<section style=\\"…\\">…</section>"}'
Long HTML:          buni call FILE write_html - < part.json
Import a page:      buni call FILE import_html_page '{"url":"http://localhost:3000","selector":"#hero","page":{"name":"Hero","width":1440}}'
                    Also accepts html or a file inside the design folder; omit selector for the whole page.
Check your work:    buni shot FILE PAGE out.png      (then look at out.png; also .pdf, .svg, --scale 2; needs a Chrome,
                    Chromium or Edge, or BUNI_CHROME pointing at one)

Rules that save retries:
- Inline style="" only; CSS values cannot contain { } or <. Use tokens: buni call FILE tokens '{"set":{"--ink":"#111"}}' then var(--ink).
- Icons: <buni-icon name="search" size="16" style="color:var(--ink-2)"> draws a Lucide icon; buni call FILE find_icons '{"query":"arrow"}' finds names.
- layer-name="…" names a layer. Text elements need margin:0 if you want no browser margin.
- New page: create_page {name, route}. Links: connect {node, to}. Flows: set_flow, set_journey.
- Graphics (logo, icon, post, slide): create_page {name, width, height} with no route; draw one <svg> of shapes; change it with set_svg {node, markup}. Read buni skills logo first. buni icons FILE PAGE DIR exports an app icon set.
- Reuse: make_component {node}, place_component {component, parent}, override {instance, node, text}. Anything on two pages is a component; find_repeats lists copies, componentize {nodes, name} makes them one. Components can hold components (place_component into one); override reaches inside by path "use/layer".
- The system behind the pages: set_part (client, service, store, cache, queue, external), link_parts (with carries: the shapes on it),
  set_shape for data structures and enums, then contracts with set_table, set_endpoint (REST) or set_operation (GraphQL services), set_event;
  set_trace follows one user action through the parts. Where it runs: set_environment, set_cluster, place (Kubernetes, functions, managed services).
  Tie pages in with place_page {page, client}, connect {…, endpoint}, and bind {node, endpoint, field}. Read buni skills system-design, api-design and database-design first.
- Why and what's open: set_phase, set_requirement, serve {requirement, id}; set_question (options, assumptions), decide_question;
  set_role, set_access {call, who, roles, rule}; failure on link_parts, ifDown on set_part, ifFails on trace steps; review {id, state}, discuss. Read buni skills design-process.
- Big systems split across files: buni split FILE part:ID NEW.buni, or import_file {path}; imported parts, shapes and calls can be used, and are edited in their own file.
- Before building any piece, read its brief: buni context FILE part:ID (or page:, flow:, endpoint:, table:); with no focus, the whole system.
- Name components "Group / Name" (e.g. "Buttons / Primary"). library_report finds unused and near-duplicate ones; merge_components and rename_component tidy them.
- If a call is refused, the reply says which rule it broke; fix the arguments and call again.

Pass --as YOUR_NAME on every call so the person sees who is working where.
Run "buni tools" for every tool and its arguments.

Workflow for a bigger design:
1. buni tree FILE, then buni tools once, to learn the file and the tools. Read buni skills principles, and the skills for the work ahead.
2. Set tokens (colours, fonts) first so every section can use var(--…).
3. Build one section per write_html call: nav, hero, a card row, footer. The person watches each land on the canvas.
4. After a few sections, buni shot the page and look at it; fix spacing and hierarchy before moving on.
5. Repeated parts (nav, footer, cards): make_component once, place_component elsewhere; before finishing, find_repeats and componentize what was copied.
6. Link pages with connect, name the path with set_flow, and write set_journey for the experience.
7. Tell the person what you changed and what to look at.`;

/** The guide in the SKILL.md shape shared by pi, Codex and Claude Code. */
const SKILL = `---
name: buni
description: >-
  Design desktop web pages, app flows and UX journeys, and the system behind them, in buni (.buni files)
  through the buni CLI: pages, components, links, flows, journeys, services, stores, queues, endpoints and tables.
  Use when asked to design, mock up, lay out or restyle a screen, page, site or app flow, to design an API,
  database or system architecture, to build from a design, or when a .buni file is involved.
---

${GUIDE.replace("# Designing with buni", "# buni")}
`;

function isTool(name: string): name is ToolName {
  return toolNames.some((t) => t === name);
}

export interface Flags {
  as: string;
  json: boolean;
  /** The design is one on your buni server (buni login), named as `buni ls` shows it, not a local file. */
  remote: boolean;
  /** --server URL: the buni server to sign in to (login) or to talk to (agent). */
  server: string | undefined;
  /** Pixel density for a PNG: 1 is the page's own size, 2 is retina. */
  scale: number | undefined;
  rest: string[];
}

function parseFlags(argv: string[]): Flags {
  const rest: string[] = [];
  let as = process.env.BUNI_AGENT ?? "cli";
  let json = false;
  let remote = false;
  let server: string | undefined;
  let scale: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--scale") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0 && n <= 8) scale = n;
    } else if (a === "--as") as = argv[++i] ?? as;
    else if (a.startsWith("--as=")) as = a.slice(5);
    else if (a === "--json") json = true;
    else if (a === "--remote") remote = true;
    else if (a === "--server") server = argv[++i];
    else if (a.startsWith("--server=")) server = a.slice(9);
    else rest.push(a);
  }
  return { as, json, remote, server, scale, rest };
}

/** All of standard input, piped or redirected from a file. Read straight from fd 0: a stream over it came back empty for a redirected file. */
async function stdin(): Promise<string> {
  return readFileSync(0, "utf8");
}

async function readJson(arg: string | undefined): Promise<unknown> {
  if (arg === undefined) return {};
  const text = arg === "-" ? await stdin() : arg;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`arguments must be JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The running buni app that has this file open, if any. */
async function liveApp(file: string): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(`${resolve(file)}.live`, "utf8"));
    if (typeof raw !== "object" || raw === null || !("pid" in raw) || !("mcp" in raw)) return undefined;
    const { pid, mcp } = raw;
    if (typeof pid !== "number" || typeof mcp !== "string") return undefined;
    // Only an app on this machine: a .live file that came with a downloaded design can't send the calls elsewhere.
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(mcp).hostname)) return undefined;
    process.kill(pid, 0);
    return mcp;
  } catch {
    return undefined;
  }
}

interface Reply {
  ok: boolean;
  text: string;
  png?: Buffer;
}

const contentItem = z.object({ type: z.string(), text: z.string().optional(), data: z.string().optional() });

/** One tool call on a buni that serves the design over MCP: an app that has it open, or your buni server. */
async function callOver(url: URL, headers: Record<string, string>, as: string, name: string, args: unknown): Promise<Reply> {
  const client = new Client({ name: as, version: VERSION });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  await client.connect(transport);
  try {
    const r = await client.callTool({ name, arguments: args && typeof args === "object" ? { ...args } : {} });
    const content = z.array(contentItem).catch([]).parse(r.content);
    const text = content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
    const data = content.find((c) => c.type === "image")?.data;
    return { ok: r.isError !== true, text, ...(data ? { png: Buffer.from(data, "base64") } : {}) };
  } finally {
    // Ends the session on the server too, so it doesn't keep showing a call that's over as connected.
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
}

/** Runs a tool through the app when it has the file open (live canvas, one writer), else on the file itself. */
async function run(file: string, as: string, name: string, args: unknown): Promise<Reply> {
  const url = await liveApp(file);
  // An app that left its .live file behind but no longer answers: work on the file itself.
  const live = url ? await callOver(new URL(url), {}, as, name, args).catch(() => undefined) : undefined;
  if (live) return live;
  if (name === "screenshot") {
    const page = typeof args === "object" && args !== null && "page" in args && typeof args.page === "string" ? args.page : "";
    return screenshotPng(resolve(file), page).then((png) => ({ ok: true, text: "", png: Buffer.from(png, "base64") }), (e: unknown) => ({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }
  if (!isTool(name)) return { ok: false, text: `Unknown tool "${name}". Run "buni tools".` };
  const ws = await Workspace.open(file);
  const r = await ws.call(as, name, args);
  return { ok: r.ok, text: r.reply };
}

/** `context` arguments: what to focus on, and --target ratatui for one build of a terminal client designed several ways. */
function contextArgs(args: readonly string[]): { focus?: string; target?: string } {
  const at = args.indexOf("--target");
  const target = at >= 0 ? args[at + 1] : undefined;
  const focus = (at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args)[0];
  return { ...(focus ? { focus } : {}), ...(target ? { target } : {}) };
}

/** Signs in with Wazo: a code here, approved on Wazo's site in the browser; the token is kept for this buni server. */
async function login(server: string | undefined): Promise<number> {
  const { fetchPerson, startSignIn, waitForApproval, WAZO_URL } = await import("./account/wazo.ts");
  const { openUrl } = await import("./term/open.ts");
  const target = checkServer(server ?? DEFAULT_SERVER);
  if (target !== checkServer(DEFAULT_SERVER)) console.log(`Signing in for ${new URL(target).host}: it will hold a Wazo token for your account, so only use a buni server you trust.`);
  const started = await startSignIn(WAZO_URL, `buni CLI on ${hostname()}`);
  console.log(`Check that Wazo shows ${started.userCode}, then choose Allow.\nIf the browser didn't open: ${started.url}`);
  openUrl(started.url);
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  const token = await waitForApproval(WAZO_URL, started, stop.signal);
  const person = await fetchPerson(WAZO_URL, token);
  if (!person) throw new Error("Wazo didn't accept the new sign-in. Try again.");
  const where = await saveAccount({ server: target, token, person });
  console.log(`Signed in as ${person.name} (@${person.username}). Your designs on ${new URL(target).host}: buni ls`);
  if (where === "file") console.log(`There's no keychain here, so the sign-in is kept in ${ACCOUNT_FILE} (readable only by you).`);
  return 0;
}

/** A command on a design kept on your buni server, named as `buni ls` shows it. */
async function remoteCommand(cmd: string | undefined, name: string, args: readonly string[], as: string, out: (r: Reply) => number): Promise<number> {
  const { bearer, download, findDesign, mcpUrl, proxyMcp } = await import("./account/remote.ts");
  const account = await signedIn();
  const path = await findDesign(account, name);
  const tool = (tool: string, toolArgs: unknown) => callOver(mcpUrl(account, path), bearer(account), as, tool, toolArgs);
  switch (cmd) {
    case "tree":
      return out(await tool("read_tree", args[0] ? { root: args[0] } : {}));
    case "context":
      return out(await tool("read_context", contextArgs(args)));
    case "call": {
      const [name, arg] = args;
      if (!name) {
        console.error('usage: buni call <design> <tool> [json|-] --remote   (see "buni tools")');
        return 2;
      }
      return out(await tool(name, await readJson(arg)));
    }
    case "export": {
      const [dir] = args;
      if (!dir) {
        console.error("usage: buni export <design> <out-dir> --remote");
        return 2;
      }
      // The design's text only; images it shows aren't downloaded, so they're missing from the site
      const scratch = await mkdtemp(join(tmpdir(), "buni-remote-"));
      try {
        const local = join(scratch, `${name.replace(/[^\w -]+/g, " ").trim() || "design"}.buni`);
        await writeFile(local, await download(account, path));
        const files = await (await Workspace.open(local)).exportSite(dir);
        console.log(`Wrote ${files.length} files to ${dir}.`);
        return 0;
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
    case "mcp":
      await proxyMcp(mcpUrl(account, path), bearer(account));
      return new Promise<number>(() => {});
    default:
      console.error(`buni ${cmd ?? ""} works on local files; on a design on your buni server, use tree, context, call, export, mcp or agent with --remote.`);
      return 2;
  }
}

/**
 * Commands a package that carries this CLI adds to it (the design agent): their help, and a handler that sees each
 * command first and returns an exit code for the ones it runs.
 */
export interface Extension {
  /** The carrying package's version, which --version reports. */
  version?: string;
  usage: string;
  run(cmd: string | undefined, file: string | undefined, args: readonly string[], flags: Flags): Promise<number | undefined>;
}

/** The commands that come with the design agent, and what to use here instead. */
const AGENT_COMMANDS = new Set(["agent", "ask", "eval", "metrics"]);
function needsAgent(cmd: string): number {
  console.error(`buni ${cmd} comes with buni's design agent, which is coming soon. Here, any coding agent designs with buni: buni skill prints the guide to give it, buni mcp serves the tools.`);
  return 2;
}

export async function main(argv: string[], ext?: Extension): Promise<number> {
  const flags = parseFlags(argv);
  const { as, json, remote, server, scale, rest } = flags;
  const [cmd, file, ...args] = rest;
  const handled = await ext?.run(cmd, file, args, flags);
  if (handled !== undefined) return handled;
  if (cmd !== undefined && AGENT_COMMANDS.has(cmd)) return needsAgent(cmd);
  const out = (r: Reply) => {
    console.log(json ? JSON.stringify({ ok: r.ok, reply: r.text }) : r.text);
    return r.ok ? 0 : 1;
  };

  switch (cmd) {
    case undefined:
    case "-h":
    case "--help":
      console.log(usage(ext));
      return 0;
    case "-v":
    case "--version":
      console.log(ext?.version ?? VERSION);
      return 0;
    case "help":
      console.log(GUIDE);
      return 0;
    case "skill":
      process.stdout.write(SKILL);
      return 0;
    case "skills": {
      if (file) {
        const skill = await readSkill(file);
        if (!skill) {
          console.error(`No skill "${file}". Run "buni skills".`);
          return 1;
        }
        console.log(skill.body);
        return 0;
      }
      const skills = await loadSkills();
      console.log(json ? JSON.stringify(skills.map(({ body: _, ...s }) => s), null, 2) : `${skillList(skills)}\n\nAdd your own as ${SKILLS_DIR}/NAME.md (front matter: name, description).`);
      return 0;
    }
    case "tools": {
      const list = toolNames.map((name) => {
        const schema = z.toJSONSchema(z.object(tools[name].input), { io: "input" });
        return { name, description: tools[name].description, arguments: schema };
      });
      // `buni tools set_endpoint`: one tool, every nested argument spelled out (fields, columns, steps).
      const one = file && list.find((t) => t.name === file);
      if (file && !one) {
        console.error(`Unknown tool "${file}". Run "buni tools".`);
        return 2;
      }
      if (one) {
        console.log(`${one.name}\n  ${one.description}\n\n${JSON.stringify(one.arguments.properties ?? {}, null, 2)}\nrequired: ${(one.arguments.required ?? []).join(", ")}`);
        return 0;
      }
      if (json) {
        console.log(JSON.stringify(list, null, 2));
        return 0;
      }
      for (const t of list) {
        const props = Object.keys(t.arguments.properties ?? {});
        const required = new Set(t.arguments.required ?? []);
        console.log(`${t.name}  {${props.map((p) => (required.has(p) ? p : `${p}?`)).join(", ")}}\n  ${t.description}\n`);
      }
      console.log("screenshot  {page}\n  Render a page: buni shot FILE PAGE out.png|out.pdf|out.svg [--scale 2]. Draws with the buni app when it has the file open, else with Chrome, Chromium or Edge.");
      console.log('\n"buni tools NAME" spells out one tool\'s arguments in full, nested ones included.');
      return 0;
    }
    case "login": {
      if (file !== undefined) {
        console.error("usage: buni login [--server URL]");
        return 2;
      }
      return login(server);
    }
    case "logout": {
      const { forgetAccount, loadAccount } = await import("./account/account.ts");
      const { revokeToken, WAZO_URL } = await import("./account/wazo.ts");
      const was = await loadAccount();
      await forgetAccount();
      if (was && !process.env.BUNI_TOKEN) await revokeToken(WAZO_URL, was.token);
      console.log(process.env.BUNI_TOKEN ? "Forgot the saved sign-in, but $BUNI_TOKEN is set, so commands still sign in with it." : was ? "Signed out." : "You weren't signed in.");
      return 0;
    }
    case "whoami": {
      const account = await signedIn();
      const { fetchPerson, WAZO_URL } = await import("./account/wazo.ts");
      const person = await fetchPerson(WAZO_URL, account.token);
      if (!person) throw new Error("Wazo no longer accepts this sign-in. Run: buni login");
      console.log(json ? JSON.stringify({ server: account.server, person }) : `${person.name} (@${person.username}) on ${new URL(account.server).host}`);
      return 0;
    }
    case "ls": {
      const { designs } = await import("./account/remote.ts");
      const all = await designs(await signedIn());
      if (json) console.log(JSON.stringify(all.map(({ name, pages, modified }) => ({ name, pages, modified }))));
      else if (!all.length) console.log("No designs yet. Make one at the buni site, then work on it here with --remote.");
      else for (const d of all) console.log(`${d.name.padEnd(32)} ${String(d.pages).padStart(3)} pages   ${d.modified.slice(0, 10)}`);
      return 0;
    }
  }

  if (!file) {
    console.error(usage(ext));
    return 2;
  }

  // A design on your buni server: the tools run there, so the edits reach everyone who has it open.
  if (remote) return remoteCommand(cmd, file, args, as, out);

  switch (cmd) {
    case "open": {
      const { openUrl } = await import("./term/open.ts");
      const live = await liveApp(file);
      if (live) {
        const at = new URL(live);
        const design = at.searchParams.get("file");
        if (design) {
          const url = `${at.origin}/?file=${encodeURIComponent(design)}`;
          console.log(`Already open: ${url}`);
          if (!args.includes("--no-open")) openUrl(url);
          return 0;
        }
        console.error("An MCP server is already editing this design. Stop it, open the editor, then reconnect the agent through the editor.");
        return 1;
      }
      const { serveEditor } = await import("./editor/server.ts");
      const at = args.indexOf("--port");
      const port = at >= 0 ? Number(args[at + 1]) : 0;
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error("usage: buni open <file.buni> [--port N] [--no-open]");
        return 2;
      }
      const { url, stop } = await serveEditor(file, port);
      process.on("exit", stop);
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
      console.log(`Editing ${file} at ${url} (ctrl+c stops).`);
      if (!args.includes("--no-open")) openUrl(url);
      return new Promise<number>(() => {});
    }
    case "new":
      // wx: never over an existing design.
      await writeFile(file, serializeDoc(emptyDoc()), { encoding: "utf8", flag: "wx" });
      console.log(`Created ${file}. Next: buni call ${file} create_page '{"name":"Home","route":"/"}'`);
      return 0;
    case "tree":
      return out(await run(file, as, "read_tree", args[0] ? { root: args[0] } : {}));
    case "context":
      return out(await run(file, as, "read_context", contextArgs(args)));
    case "call": {
      const [name, arg] = args;
      if (!name) {
        console.error('usage: buni call <file.buni> <tool> [json|-]   (see "buni tools")');
        return 2;
      }
      return out(await run(file, as, name, await readJson(arg)));
    }
    case "shot": {
      const [page, target] = args;
      const format = target?.toLowerCase().match(/\.(png|pdf|svg|txt|ans)$/)?.[1];
      if (!page || !target || (format !== "png" && format !== "pdf" && format !== "svg" && format !== "txt" && format !== "ans")) {
        console.error("usage: buni shot <file.buni> <page> <out.png|out.pdf|out.svg|out.txt|out.ans> [--scale 2]");
        return 2;
      }
      if (format === "svg") {
        const svg = pageSvg((await Workspace.open(file)).view(), page, embeddedFont);
        if (!svg) return out({ ok: false, text: `Page "${page}" is not a graphic made of one svg; save it as .png or .pdf.` });
        await writeFile(target, svg);
        return out({ ok: true, text: `Saved ${target}.` });
      }
      // The open app draws a plain screenshot; anything else, or no app, renders here.
      if (format === "png" && scale === undefined && (await liveApp(file))) {
        const r = await run(file, as, "screenshot", { page });
        if (!r.ok || !r.png) return out(r);
        await writeFile(target, r.png);
        return out({ ok: true, text: `Saved ${target}.` });
      }
      return out(await renderHeadless({ file: resolve(file), page, out: resolve(target), format, ...(scale ? { scale } : {}) }));
    }
    case "icons": {
      const [page, dir] = args;
      if (!page || !dir) {
        console.error("usage: buni icons <file.buni> <page> <out-dir>");
        return 2;
      }
      const r = await renderHeadless({ file: resolve(file), page, out: resolve(dir), format: "icons" });
      return out(r.ok ? { ok: true, text: `Wrote the icon set to ${dir}.` } : r);
    }
    case "mcp": {
      // One writer per design: when a buni here has it open, its edits go there and show at once.
      const live = await liveApp(file);
      if (live) {
        const { proxyMcp } = await import("./account/remote.ts");
        await proxyMcp(new URL(live), {});
        return new Promise<number>(() => {});
      }
      const ws = await Workspace.open(file);
      const host = { screenshot: (page: string) => screenshotPng(ws.path, page), screenAsText: (page: string) => screenAsText(ws.path, page) };
      // Otherwise this is the writer while it runs: buni call and other MCP clients find it through <file>.live.
      const served = await startMcpHttp(ws, 0, host);
      const marker = `${ws.path}.live`;
      await writeFile(marker, `${JSON.stringify({ pid: process.pid, mcp: served.url })}\n`, "utf8");
      // Removed on the way out, unless another buni has since taken the design over.
      process.once("exit", () => {
        const now = (() => {
          try {
            return readFileSync(marker, "utf8");
          } catch {
            return "";
          }
        })();
        if (now.includes(`"pid":${process.pid},`)) rmSync(marker, { force: true });
      });
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => process.exit(0));
      // The client closing stdin ends the session.
      process.stdin.once("end", () => process.exit(0));
      await createMcpServer(ws, host).connect(new StdioServerTransport());
      return new Promise<number>(() => {});
    }
    case "pdf": {
      const [target] = args;
      if (!target?.toLowerCase().endsWith(".pdf")) {
        console.error("usage: buni pdf <file.buni> <out.pdf>");
        return 2;
      }
      return out(await renderHeadless({ file: resolve(file), out: resolve(target), format: "system" }));
    }
    case "export": {
      const [dir] = args;
      if (!dir) {
        console.error(usage(ext));
        return 2;
      }
      const files = await (await Workspace.open(file)).exportSite(dir);
      console.log(`Wrote ${files.length} files to ${dir}.`);
      return 0;
    }
    case "split": {
      const [focus, to] = args;
      const part = focus?.startsWith("part:") ? focus.slice(5) : undefined;
      if (!part || !to) {
        console.error("usage: buni split <file.buni> part:<id> <new.buni>");
        return 2;
      }
      const r = await (await Workspace.open(file)).split(part, to);
      return out({ ok: r.ok, text: r.reply });
    }
    default:
      console.error(usage(ext));
      return 2;
  }
}

/** Runs the CLI on this process's arguments, with `ext`'s commands too, and sets the exit code. */
export function start(ext?: Extension): void {
  main(process.argv.slice(2), ext).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
  );
}
