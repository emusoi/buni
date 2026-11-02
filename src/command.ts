#!/usr/bin/env bun
// The buni command line: the design tools for any coding agent that can run a shell.
import { readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { emptyDoc, type Doc } from "./format/doc.ts";
import { editChecks } from "./tools/review.ts";
import { serializeDoc } from "./format/serialize.ts";
import { startMcpHttp } from "./mcp/http.ts";
import { createMcpServer } from "./mcp/server.ts";
import { loadSkills, readSkill, skillList, SKILLS_DIR } from "./skills/skills.ts";
import { pageSvg } from "./tools/html.ts";
import { toolNames, tools, type ToolName } from "./tools/tools.ts";
import { EXPORT_FORMATS } from "./tools/arch-export.ts";
import { Workspace } from "./tools/workspace.ts";
import { renderHeadless, screenAsText, screenshotPng } from "./term/render.ts";
import { embeddedFont } from "./tools/fontdata.ts";
import { VERSION } from "./version.ts";
import { ACCOUNT_FILE, DEFAULT_SERVER, saveAccount, signedIn, type Account } from "./account/account.ts";
import { checkServer, type Person } from "./account/signin.ts";

const COMMANDS = `buni — design tools for agents and people. Edits are written to the file at once (keep it in git to go back).

usage: buni <command> [args] [--as <name>] [--json]

  help                              how to design with buni (read this first)
  skill                             the same guide as a SKILL.md for coding agents
  extension [dir]                   write buni's Chrome extension (snap the page you're on into a scratch design) to load unpacked
  tools [name]                      every design tool and its arguments; with a name, that tool's in full
  skills [name]                     design skills: list them, or print one to follow
  new <file.buni>                   start an empty design
  snaps [--all] [--json]            pages captured with the Chrome extension, newest first, with what to change
  adopt <scratch.buni> <folder>     move a scratch design (a snap) into a project folder, with its assets and history
  inspiration [find <words> | add <folder> | remove <folder>]
                                    the inspiration libraries agents design from: buni's own, and folders of yours
  open <file.buni|folder>           edit in your browser; a folder opens its newest
      [--port N] [--no-open]          its port; print the address instead
      [--new]                         another tab even when one already shows it
      [--no-sync]                     don't mirror it on your buni server (signed in, it is, as it changes)
      [--to NAME]                     mirror it in that organization's space there, not your own
  tree <file.buni> [node]           outline of pages, components and layers
  context <file.buni> [kind:id]     brief to build from: the doc, then one page or flow (page:, flow:), or all of them
  arch <file.buni> [--level system|runtime|code] [--env NAME] [--focus ID]
                                    the architecture as a brief: how the app is built, shipped and run
  arch <file.buni> check            what in it would break or leak at deploy time, worst first, each with its fix
  arch <file.buni> text             the architecture as YAML to read and write by hand
  arch <file.buni> write <file|->   replace the architecture with what a text says, as one edit; "-" reads stdin
  arch <file.buni> edit             the text in $EDITOR, applied when you save and close; reopened with what's wrong
  arch <file.buni> export manifests|argocd|ci|brief|openapi|graphql [--env NAME] [--out DIR]
                                    draft Kubernetes YAML, Argo CD Applications, CI workflows or a Markdown brief,
                                    written to a folder inside the design's (default architecture/FORMAT)
  call <file.buni> <tool> [json|-]  run one tool; "-" reads the JSON from stdin
  shot <file.buni> <page> <out>     draw a page (id, name or route) to .png (--scale 2; --frames 6 for its motion), .pdf, or .svg (a graphic
                                    that is one svg), with the Chrome, Chromium or Edge on this machine; a terminal
                                    screen also to .txt, its characters, or .ans, the same in colour for cat
  icons <file.buni> <page> <dir>    an app icon set from a square graphic: PNGs 16-1024, favicon.ico, AppIcon.icns
  capture <file.buni> <page> <out.png>   PNG plus exact document, revision and layer bounds in out.png.json
  export <file.buni> <out-dir>      write the site as static HTML + CSS
  split <file.buni> core <core.buni>      move every component and token into a core file the design imports
  mcp <file.buni>                   serve the tools over MCP (stdio); "buni mcp --remote" alone: all your designs there
  login [--server URL]              sign in: approve a code in the browser (--with-password: type them here); then --remote works
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
                    A JavaScript app: add "live":true (scripts run), "cookies":"session=…" when signed in, "wait_for":"#main".
Snap from Chrome:   buni extension writes a Chrome extension; with it the person snaps the page they're on (signed in),
                    or a part of it, as "<title> · Now" in a scratch design, ~/buni/scratch/<name>/<name>.buni, or one
                    snapped into before. "My latest snap": buni snaps lists them, newest first, with the person's
                    brief; read the file with buni tree and redesign from the snapshot (critique skill). To keep it,
                    buni adopt SCRATCH.buni PROJECT_FOLDER moves it into a project.
Improve a real page: snapshot it with import_html_page onto "<Screen> · Now", find what's wrong there, fix it on a
                    duplicate_page "<Screen> · Next". Read buni skills critique first.
Try options:        buni call FILE explore_page '{"page":"PAGE","options":[{"name":"Proof first","idea":"…"}]}'; change each copy,
                    then compare_options '{"page":"PAGE"}' and pick_option '{"option":"ID","why":"…"}'
Inspiration:        buni call FILE find_inspiration '{"query":"settings page"}' finds finished UI patterns (buni's and the
                    person's own); use_inspiration '{"pattern":"Settings sections"}' brings one in as a reference page.
Find and replace:   buni call FILE find_nodes '{"style":[{"value":"#999"}],"replace_with":"var(--muted)"}'   (also text, page, root)
Review a page:      buni call FILE review_page '{"page":"PAGE"}'   (score and issues worst first, on their layers;
                    "pin":true leaves them as comments, "against":"NOW_PAGE" says what a Next page fixed)
Check your work:    buni shot FILE PAGE out.png      (then look at out.png; also .pdf, .svg, --scale 2, --frames 6 to see motion; needs a Chrome,
                    Chromium or Edge, or BUNI_CHROME pointing at one)

Rules that save retries:
- Inline style="" only; CSS values cannot contain { } or <. Use tokens: buni call FILE tokens '{"set":{"--ink":"#111"}}' then var(--ink).
- Icons: <buni-icon name="search" size="16" style="color:var(--ink-2)"> draws a Lucide icon; buni call FILE find_icons '{"query":"arrow"}' finds names.
- layer-name="…" names a layer. Text elements need margin:0 if you want no browser margin.
- New page: create_page {name, route}. Links: connect {node, to}. Flows: set_flow, set_journey.
- Graphics (logo, icon, post, slide): create_page {name, width, height} with no route; draw one <svg> of shapes; change it with set_svg {node, markup}. Read buni skills logo first. buni icons FILE PAGE DIR exports an app icon set.
- Reuse: make_component {node}, place_component {component, parent}, override {instance, node, text}. Anything on two pages is a component; find_repeats lists copies, componentize {nodes, name} makes them one. Components can hold components (place_component into one); override reaches inside by path "use/layer".
- Terminal screens: create_page {name, terminal} or set_screen, sized in cells. Read buni skills terminal first.
- Big designs split across files: buni split FILE core CORE.buni, or import_file {path}; imported components and tokens can be used, and are edited in their own file.
- Before building a screen, read its brief: buni context FILE page:ID (or flow:ID); with no focus, every page and flow.
- Name components "Group / Name" (e.g. "Buttons / Primary"). library_report finds unused and near-duplicate ones; merge_components and rename_component tidy them.
- If a call is refused, the reply says which rule it broke; fix the arguments and call again.

Pass --as YOUR_NAME on every call so the person sees who is working where.
For a terminal viewer, the person runs "buni-tui open". Find it with "buni-tui sessions --json", then
"buni-tui attach SESSION FILE.buni --as YOUR_NAME". Keep designing through buni; saved changes appear live.
"buni-tui context SESSION --json" returns the exact displayed revision and selected reference. A pinned view
stays where the person left it; an agent can keep working without forcing it to follow.
Parallel local calls to the same file wait their turn, reading the latest design before editing.
If a process is killed while writing, its FILE.buni.lock directory may remain: remove it only after confirming no call is still writing.
Run "buni tools" for every tool and its arguments.

A big app is a project: one folder of .buni files, a core and its sections.
- Split by area of the product, not by page: checkout.buni, account.buni, admin.buni, marketing.buni. Split once a
  file passes about 15 pages, or when two agents or people would work in it at once; a small app stays one file.
- What sections share lives in core files: core.buni holds the tokens and the reused components (nav, footer,
  buttons, cards). A big library can be split again (core/forms.buni).
- A section builds on them with import_file {"path":"core.buni"}: place_component places a core component, and a
  token the section doesn't set comes from the core. Set a token in the section only to override it there.
- A core component is edited in the core file, never copied: change the core and every section shows it. A component
  only one section uses stays in that section.
- An existing file grown big: buni split FILE core core.buni moves all its components and tokens into core.buni, ids
  kept, and the file imports it; then start the next section beside it and import core.buni there too.
- Start each file with buni new FOLDER/NAME.buni. Work only in the file asked for; read the others with buni tree.
- Sections link to each other: import the other section (import_file; two sections may import each other), then
  connect {node, to} with the other file's page id. Play follows it into that file; in the editor a flow walks on
  through the project's designs (the CLI's briefs stop at the file's edge).
- A core's nav links once: connect {node, page: COMPONENT_ID, to} on its layer holds on every use of the component,
  in every section that imports the core (import the sections the links go to). A page's own link wins there.
- Inside a section, every screen and state is a page; name pages "NN · Name" so the sitemap reads in order, and
  link them with connect and name each path through them with set_flow.
- The person switches between a project's files from the file name in the editor's top bar, and Home groups designs
  by folder.

Workflow for a bigger design:
1. buni tree FILE, then buni tools once, to learn the file and the tools. Read buni skills principles, and the skills for the work ahead.
2. Set tokens (colours, fonts) first so every section can use var(--…).
3. Build one section per write_html call: nav, hero, a card row, footer. The person watches each land on the canvas.
4. After a few sections, buni shot the page and look at it; fix spacing and hierarchy before moving on.
5. Repeated parts (nav, footer, cards): make_component once, place_component elsewhere; before finishing, find_repeats and componentize what was copied.
6. Link pages with connect, name the path with set_flow, and write set_journey for the experience.
7. review_page each page and fix what it finds (a repeated problem is one find_nodes … replace_with edit); edits also
   come back with quick checks on what they changed, so fix those as they appear.
8. Tell the person what you changed and what to look at.

Improving a product that already ships (read buni skills critique first):
1. Snapshot it: import_html_page {url, live:true, cookies, wait_for} onto "<Screen> · Now". Don't write a capture script.
2. Judge it yourself first, then review_page {page, pin:true}; pin your own findings with comment {node, body}.
3. duplicate_page to "<Screen> · Next" and fix there, worst first; review_page {page: NEXT, against: NOW} says what changed.
4. For a real choice of direction, explore_page {page, options:[{name, idea}]} makes 3 or 4 takes to build out fully;
   compare_options reviews them side by side, ask_person when the choice is theirs, pick_option {option, why} makes one live.

Pen marks and sketches: the person draws with a tablet (Open on tablet in the editor), then may just say "I left
annotations", "fix what I marked" or "build from my sketches". Start with buni call FILE read_marks: every open mark (on
pages, flows, the architecture) and every sketch of a new screen on the Screens canvas, numbered, with what's under each.
The handwriting is only in pictures: buni shot FILE screens out.png draws the Screens canvas as the tablet shows it, the
sketches, arrows and marks where they were drawn (--all for all of it); buni shot FILE PAGE out.png --marks draws one page.
A sketch on empty canvas is a new screen: build it as a page in the design's style (create_page, write_html, its tokens and
components), move_page it to where the sketch is, fill in what it leaves out (copy, states, errors), and connect what an
arrow points from and to; a page linked from a flow's page joins that flow. A mark on a page asks for a change there.
Reply on each thread with comment {thread, body, addressed: true} once it's handled, saying how you read it.

Motion: set_motion on the layer (read buni skills motion); buni shot FILE PAGE out.png --frames 6 shows it as moments
side by side, so check order and pace there. Imported pages keep their motion.

Architecture: how the app behind the screens is built and shipped (code → build → release → Kubernetes → run), designed
before and while it is built; not monitoring.
- Parts and links: set_part {name, kind, tech, managed}, link_parts {from, to, kind, carries}, set_group; set_build {part, repo, path, steps}.
  Who uses it: set_part {kind: "person"} (the Context level draws people, the system and outside services).
- API contracts before code: set_api {part, kind: rest|graphql, spec}, set_operation {part, method, path | type, field, about,
  request, responses, resolves}; export_architecture openapi|graphql writes openapi.yaml and schema.graphql drafts.
- Where it runs: set_environment {name, order, cluster}, set_cluster {name, provider, pools, addons, gitops}, set_namespace
  {cluster, name}, set_workload {part, environment, namespace, kind, replicas, scale, probes, resources, …}.
- How it ships: set_release {name, parts, path, strategy, checks, rollback, before}, set_migration {name, store, release, change, safe}.
- set_stage writes the software path (idea → respond); set_play plays a request, release or failure step by step.
- Plan a change before code: set_plan {name, issue}, then mark what it adds status "planned" (or "removed") with plan; the
  person merges it (merge_plan) or discards it (delete_architecture). Every set_ tool changes a thing when given its id;
  null removes a field.
- Read it: buni arch FILE [--level system|runtime|code] [--env prod] [--focus ID] (read_architecture).
- Or write it whole as YAML, keyed by id: buni arch FILE text prints it (read_architecture_text); buni arch FILE write
  PATH|- applies it as one edit (write_architecture_text); buni arch FILE edit opens it in $EDITOR. People write it too.
- How to design it, layer by layer: buni skills architecture. Then buni arch FILE check (check_architecture) and fix
  what it finds; buni arch FILE export manifests|argocd|ci|brief|openapi|graphql writes drafts for the person to review.`;

/** The guide in the SKILL.md shape shared by pi, Codex and Claude Code. */
const SKILL = `---
name: buni
description: >-
  Design desktop web pages, app flows, UX journeys and terminal screens in buni (.buni files) through the buni
  CLI: pages, components, tokens, motion, links, flows and journeys, and the architecture behind them: parts,
  builds, Kubernetes workloads, releases, plans and plays. Also snapshots a live app to improve it,
  reviews pages (motion, contrast, type, targets, generated-look tells), and tries options of a page to compare and
  pick from. Use when asked to design, mock up, lay out or restyle a screen, page, site or app flow, to improve or
  review an existing UI, to try alternatives of a page, to design how an app is built and shipped, to build from a
  design, or when a .buni file is involved.
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
  /** --frames N: shot draws the page's motion as N moments side by side. */
  frames: number | undefined;
  /** --marks: shot draws the page's pen marks over it. */
  marks: boolean;
  /** --all: shot of the Screens canvas draws all of it, not just around the sketches. */
  whole: boolean;
  rest: string[];
}

function parseFlags(argv: string[]): Flags {
  const rest: string[] = [];
  let as = process.env.BUNI_AGENT ?? "cli";
  let json = false;
  let remote = false;
  let server: string | undefined;
  let scale: number | undefined;
  let frames: number | undefined;
  let marks = false;
  let whole = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--scale") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0 && n <= 8) scale = n;
    } else if (a === "--frames") {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n >= 2 && n <= 12) frames = n;
    } else if (a === "--marks") marks = true;
    else if (a === "--all") whole = true;
    else if (a === "--as") as = argv[++i] ?? as;
    else if (a.startsWith("--as=")) as = a.slice(5);
    else if (a === "--json") json = true;
    else if (a === "--remote") remote = true;
    else if (a === "--server") server = argv[++i];
    else if (a.startsWith("--server=")) server = a.slice(9);
    else rest.push(a);
  }
  return { as, json, remote, server, scale, frames, marks, whole, rest };
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
  file = await realpath(file);
  // Atomic saves alone still lose edits: hold the lock from the first read through the activity write.
  const lock = `${file}.lock`;
  const deadline = performance.now() + 30_000;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (e) {
      if (!(e instanceof Error) || !("code" in e) || e.code !== "EEXIST") throw e;
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for ${lock}. Retry when the other call finishes. If a writer was killed, remove this lock directory only after confirming no call is still writing.`);
      }
      await delay(25);
    }
  }
  let before: Doc, after: Doc, r: { ok: boolean; reply: string };
  try {
    const ws = await Workspace.open(file);
    before = ws.view();
    r = await ws.call(as, name, args);
    after = ws.view();
  } finally {
    await rmdir(lock);
  }
  // Checked once the file is free again: the browser takes a moment.
  const checks = r.ok && after !== before ? await editChecks(before, after) : "";
  return { ok: r.ok, text: checks ? `${r.reply}\n${checks}` : r.reply };
}

/** Flags as a tool's arguments, by `names` ("--env" → "environment"); anything else is left out. */
function flagArgs(args: readonly string[], names: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = names[args[i] ?? ""];
    const value = args[i + 1];
    if (key && value !== undefined) { out[key] = value; i++; }
  }
  return out;
}

const ARCH_USAGE = "usage: buni arch <file.buni> [--level system|runtime|code] [--env NAME] [--focus ID] | check | text | write <file|-> | edit | export manifests|argocd|ci|brief|openapi|graphql [--env NAME] [--out DIR]";

/**
 * buni arch as a tool call: check, text, write PATH|-, export FORMAT, or the brief; a usage line when it is none of
 * them. An export's --out is read from where the command runs and handed on relative to the design, whose folder it
 * has to be inside.
 */
async function archCall(file: string, args: readonly string[]): Promise<{ tool: ToolName; args: Record<string, string> } | undefined> {
  const [sub, format, ...rest] = args;
  if (sub === "check") return { tool: "check_architecture", args: {} };
  if (sub === "text") return { tool: "read_architecture_text", args: {} };
  if (sub === "write") return format === undefined ? undefined : { tool: "write_architecture_text", args: { text: format === "-" ? await stdin() : await readFile(format, "utf8") } };
  if (sub !== "export") return sub === undefined || sub.startsWith("--") ? { tool: "read_architecture", args: flagArgs(args, { "--level": "level", "--env": "environment", "--focus": "focus" }) } : undefined;
  if (format === undefined || !EXPORT_FORMATS.some((f) => f === format)) return undefined;
  const { out, ...flags } = flagArgs(rest, { "--env": "environment", "--out": "out" });
  return { tool: "export_architecture", args: { format, ...flags, ...(out !== undefined ? { out: relative(dirname(resolve(file)), resolve(out)) } : {}) } };
}

/** What `buni arch FILE edit` puts above the text when the last save was refused; taken off again before applying. */
const REFUSED = "# ! ";

/**
 * buni arch FILE edit: the architecture's text in $VISUAL or $EDITOR on a temporary copy, written back when the
 * editor closes. A refused save opens again with what is wrong on top, as git commit does; closing it unchanged
 * gives up and leaves the design as it was.
 */
async function archEdit(call: (tool: ToolName, args: Record<string, string>) => Promise<Reply>): Promise<number> {
  const read = await call("read_architecture_text", {});
  if (!read.ok) { console.error(read.text); return 1; }
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const dir = await mkdtemp(join(tmpdir(), "buni-arch-"));
  const path = join(dir, "architecture.yaml");
  try {
    let text = read.text.endsWith("\n") ? read.text : `${read.text}\n`;
    let problem = "";
    for (;;) {
      const shown = `${problem ? `${problem.split("\n").map((l) => `${REFUSED}${l}`).join("\n")}\n${REFUSED}Fix it and save, or close without saving to give up.\n` : ""}${text}`;
      await writeFile(path, shown);
      // Through the shell, so an $EDITOR with flags ("code --wait") runs as written.
      const exit = await Bun.spawn(["sh", "-c", `${editor} "$1"`, "sh", path], { stdio: ["inherit", "inherit", "inherit"] }).exited;
      if (exit !== 0) { console.error(`${editor} exited with ${exit}; the architecture is as it was.`); return 1; }
      const saved = (await readFile(path, "utf8")).split("\n").filter((l) => !l.startsWith(REFUSED)).join("\n");
      if (saved === text) {
        console.log(problem ? "Gave up; the architecture is as it was." : "No changes.");
        return problem ? 1 : 0;
      }
      text = saved;
      const r = await call("write_architecture_text", { text });
      if (r.ok) { console.log(r.text); return 0; }
      problem = r.text;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `context` arguments: what to focus on, "page:ID" or "flow:ID". */
function contextArgs(args: readonly string[]): { focus?: string } {
  const focus = args[0];
  return focus ? { focus } : {};
}

/** Lines piped in, read once, when there is no terminal to ask at. */
let piped: string[] | undefined;

/** A line typed at the terminal; with `hidden`, nothing is echoed (a password). Piped in, the next line. */
async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  if (!process.stdin.isTTY) {
    const lines = (piped ??= (await stdin()).split("\n"));
    return lines.shift()?.trim() ?? "";
  }
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // The line is read with its echo off: readline's own echo is replaced with nothing.
    const asTty = rl as unknown as { _writeToOutput: (s: string) => void };
    asTty._writeToOutput = () => undefined;
  }
  return new Promise((resolve) => rl.question("", (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); }));
}

/**
 * Signs in: a code here, approved in the browser where the person is signed in to the server, and the command line
 * gets a token of its own, kept for that server. --with-password asks for the email and password here instead.
 */
async function login(server: string | undefined, withPassword: boolean): Promise<number> {
  const { signInWithPassword, startDeviceSignIn, waitForDevice } = await import("./account/signin.ts");
  const target = checkServer(server ?? DEFAULT_SERVER);
  const name = `buni CLI on ${hostname()}`;
  let signedInAs: { token: string; person: Person };
  if (withPassword) {
    console.log(`Signing in to ${new URL(target).host}.`);
    const email = await ask("Email: ");
    const password = await ask("Password: ", true);
    signedInAs = await signInWithPassword(target, email, password, name);
  } else {
    const { openUrl } = await import("./term/open.ts");
    const started = await startDeviceSignIn(target, name);
    console.log(`Approve this sign-in in the browser; check it shows ${started.userCode}.\nIf the browser didn't open: ${started.url}`);
    openUrl(started.url);
    const stop = new AbortController();
    process.once("SIGINT", () => stop.abort());
    signedInAs = await waitForDevice(target, started, stop.signal);
  }
  const { token, person } = signedInAs;
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
    case "arch": {
      if (args[0] === "edit") return archEdit(tool);
      const c = await archCall(name, args);
      // Drafts are files on this machine; the server's folder is no place for them.
      if (!c || c.tool === "export_architecture") {
        console.error(c ? "buni arch export works on local files: download the design first." : ARCH_USAGE);
        return 2;
      }
      return out(await tool(c.tool, c.args));
    }
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
  if (flags.rest[0] === "open") flags.rest = flags.rest.filter((a) => a !== "--web");
  const { as, json, remote, server, scale, frames, marks, whole, rest } = flags;
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
    case "snaps": {
      // What the Chrome extension captured, newest first: "work on my latest snap" starts here.
      const { recentSnaps } = await import("./term/native-host.ts");
      const snaps = await recentSnaps();
      if (json) { console.log(JSON.stringify(snaps)); return 0; }
      if (!snaps.length) { console.log("No snaps yet. In Chrome: the buni icon, Redesign it, Capture page (set it up with buni extension)."); return 0; }
      for (const s of snaps.slice(0, file === "--all" ? undefined : 10)) {
        console.log(`${s.page} (${s.pageId})${s.url ? `  from ${s.url}` : ""}\n  ${s.file.replace(homedir(), "~")}  ${s.modified.slice(0, 16).replace("T", " ")}${s.brief ? `\n  Brief: ${s.brief}` : ""}`);
      }
      return 0;
    }
    case "inspiration": {
      const lib = await import("./tools/inspiration.ts");
      if (file === "add" || file === "remove") {
        const [dir] = args;
        if (!dir) { console.error(`usage: buni inspiration ${file} <folder>`); return 2; }
        if (file === "add" && !(await stat(resolve(dir)).catch(() => undefined))?.isDirectory()) return out({ ok: false, text: `${dir} isn't a folder.` });
        const now = await lib.setLibrary(dir, file === "add");
        return out({ ok: true, text: `${file === "add" ? "Added" : "Removed"} ${resolve(dir)}. Your libraries: ${now.length ? now.join(", ") : "none"} (plus buni's own).` });
      }
      const all = await lib.allPatterns();
      const shown = file === "find" ? lib.searchPatterns(all, args.join(" ")) : all;
      const libs = await lib.libraries();
      const lines = await Promise.all(shown.map(async (p) => `  ${p.name.padEnd(28)} ${p.library}: ${await lib.shortPath(p)}`));
      return out({ ok: true, text: `${libs.map((l) => `${l.name} (${l.dir})`).join("\n")}\n\n${shown.length} pattern${shown.length === 1 ? "" : "s"}:\n${lines.join("\n")}\n\nAdd your own: buni inspiration add <folder of .html patterns> (format: ${join(lib.BUILTIN, "README.md")}).` });
    }
    case "extension": {
      // Written fresh each time, so loading the folder again picks up a new buni's capture.
      const { extensionFiles } = await import("./term/extension-build.ts");
      const { HOST_NAME, hostManifestDirs, SCRATCH } = await import("./term/native-host.ts");
      const { EXTENSION_ORIGIN } = await import("./editor/guard.ts");
      const dir = resolve(file ?? join(homedir(), ".buni", "chrome-extension"));
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(await extensionFiles())) await writeFile(join(dir, name), text);
      // Chrome starts this to hand it a snap: the buni running now, without the slower checks an agent's edit gets.
      const self = process.argv[1]?.endsWith(".ts") ? [process.execPath, process.argv[1]] : [process.execPath];
      const host = join(homedir(), ".buni", "native-host");
      await mkdir(dirname(host), { recursive: true });
      await writeFile(host, `#!/bin/sh\nBUNI_EDIT_CHECKS=0 exec ${self.map((a) => JSON.stringify(a)).join(" ")} native-host "$@"\n`, { mode: 0o755 });
      const manifest = JSON.stringify({ name: HOST_NAME, description: "buni: snaps from the Chrome extension", path: host, type: "stdio", allowed_origins: [`${EXTENSION_ORIGIN}/`] }, null, 2);
      const browsers = hostManifestDirs();
      for (const d of browsers) { await mkdir(d, { recursive: true }); await writeFile(join(d, `${HOST_NAME}.json`), manifest); }
      console.log(`Wrote buni's Chrome extension to ${dir}, and let ${browsers.length} browser${browsers.length === 1 ? "" : "s"} here start buni for it.\nIn Chrome: chrome://extensions, turn on Developer mode, Load unpacked, choose that folder (or press reload on it after an update).\nThen on any page: the buni icon, Snap page or Pick a part. Snaps go to ${SCRATCH.replace(homedir(), "~")} unless you pick a design.`);
      return 0;
    }
    case "native-host": {
      const { runNativeHost } = await import("./term/native-host.ts");
      await runNativeHost({ run: (f, name, a) => run(f, "chrome extension", name, a), liveApp });
      return 0;
    }
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
      // `buni tools write_html`: one tool, every nested argument spelled out.
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
      return login(server, args.includes("--with-password"));
    }
    case "logout": {
      const { forgetAccount, loadAccount } = await import("./account/account.ts");
      const { revokeToken } = await import("./account/signin.ts");
      const was = await loadAccount();
      await forgetAccount();
      if (was && !process.env.BUNI_TOKEN) await revokeToken(was.server, was.token);
      console.log(process.env.BUNI_TOKEN ? "Forgot the saved sign-in, but $BUNI_TOKEN is set, so commands still sign in with it." : was ? "Signed out." : "You weren't signed in.");
      return 0;
    }
    case "whoami": {
      const account = await signedIn();
      const { fetchPerson } = await import("./account/signin.ts");
      const person = await fetchPerson(account.server, account.token);
      if (!person) throw new Error(`${new URL(account.server).host} no longer accepts this sign-in. Run: buni login`);
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

  // `buni mcp --remote` with no design: the client is connected to your spaces there, and picks designs itself.
  if (!file && cmd === "mcp" && remote) {
    const { bearer, proxyMcp } = await import("./account/remote.ts");
    const account = await signedIn();
    await proxyMcp(new URL("/mcp", account.server), bearer(account));
    return new Promise<number>(() => {});
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
      // A folder (a project) opens its newest design; an empty one starts a design named for it.
      const target = await designIn(file);
      if (target !== file) return main(["open", target, ...args], ext);
      // Remembered, so the Chrome extension can offer it as where a site's captures go.
      await (await import("./tools/settings.ts")).rememberDesign(file).catch(() => undefined);
      const live = await liveApp(file);
      if (live) {
        const at = new URL(live);
        const design = at.searchParams.get("file");
        if (design) {
          const url = `${at.origin}/?file=${encodeURIComponent(design)}`;
          // A tab already showing it is enough: agents open designs often, and every extra tab holds a connection.
          const open = await fetch(`${at.origin}/tabs?file=${encodeURIComponent(design)}`).then((r) => r.json()).then((j: unknown) => typeof j === "object" && j !== null && "tabs" in j && typeof j.tabs === "number" ? j.tabs : 0, () => 0);
          if (open > 0 && !args.includes("--new")) {
            console.log(`Already open in ${open === 1 ? "a tab" : `${open} tabs`}: ${url} (buni open ${file} --new opens another).`);
            return 0;
          }
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
        console.error("usage: buni open <file.buni> [--port N] [--no-open] [--new]");
        return 2;
      }
      const { url, stop, editor, design } = await serveEditor(file, port);
      process.on("exit", stop);
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
      console.log(`Editing ${file} at ${url} (ctrl+c stops).`);
      // Signed in, the design is mirrored on the buni server as it changes, so the people there see it too.
      const account = args.includes("--no-sync") ? undefined : await (await import("./account/account.ts")).loadAccount().catch(() => undefined);
      if (account) {
        const { mirror } = await import("./account/sync.ts");
        // --to <organization>: the mirror goes in that space on the server rather than the person's own.
        const to = args.indexOf("--to");
        let root: string | undefined;
        if (to >= 0) {
          const want = args[to + 1] ?? "";
          const { spaces } = await import("./account/remote.ts");
          const all = await spaces(account);
          const hit = all.find((s) => s.name === want) ?? all.find((s) => s.name.toLowerCase() === want.toLowerCase());
          if (!hit) throw new Error(`No space called "${want}" on ${new URL(account.server).host}; you have: ${all.map((s) => s.name).join(", ")}`);
          root = hit.root;
        }
        const stopMirror = mirror(account, editor, design, file, (line) => console.log(line), root);
        process.on("exit", stopMirror);
      }
      if (!args.includes("--no-open")) openUrl(url);
      return new Promise<number>(() => {});
    }
    case "new":
      // wx: never over an existing design. Its folder is made, so a project's section starts in a folder of its own.
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, serializeDoc(emptyDoc()), { encoding: "utf8", flag: "wx" });
      console.log(`Created ${file}. Next: buni call ${file} create_page '{"name":"Home","route":"/"}'`);
      return 0;
    case "tree":
      return out(await run(file, as, "read_tree", args[0] ? { root: args[0] } : {}));
    case "context":
      return out(await run(file, as, "read_context", contextArgs(args)));
    case "arch": {
      if (args[0] === "edit") return archEdit((t, a) => run(file, as, t, a));
      const c = await archCall(file, args);
      if (!c) {
        console.error(ARCH_USAGE);
        return 2;
      }
      return out(await run(file, as, c.tool, c.args));
    }
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
        console.error("usage: buni shot <file.buni> <page|screens> <out.png|out.pdf|out.svg|out.txt|out.ans> [--scale 2] [--frames 6] [--marks] [--all]");
        return 2;
      }
      // "screens": the Screens canvas with what the pen left on it, as the tablet shows it (unless a page is called that).
      if (page === "screens" && format === "png" && !Object.values((await Workspace.open(file)).view().pages).some((p) => p.id === page || p.name === page)) {
        const { canvasShot } = await import("./term/canvas-shot.ts");
        return out({ ok: true, text: await canvasShot(file, resolve(target), whole) });
      }
      if (format === "svg") {
        const svg = pageSvg((await Workspace.open(file)).system(), page, embeddedFont);
        if (!svg) return out({ ok: false, text: `Page "${page}" is not a graphic made of one svg; save it as .png or .pdf.` });
        await writeFile(target, svg);
        return out({ ok: true, text: `Saved ${target}.` });
      }
      // The open app draws a plain screenshot; anything else, or no app, renders here.
      if (format === "png" && scale === undefined && frames === undefined && !marks && (await liveApp(file))) {
        const r = await run(file, as, "screenshot", { page });
        if (!r.ok || !r.png) return out(r);
        await writeFile(target, r.png);
        return out({ ok: true, text: `Saved ${target}.` });
      }
      return out(await renderHeadless({ file: resolve(file), page, out: resolve(target), format, ...(scale ? { scale } : {}), ...(frames ? { frames } : {}), ...(marks ? { marks } : {}) }));
    }
    case "capture": {
      const [page, target] = args;
      if (!page || !target?.endsWith(".png")) {
        console.error("usage: buni capture <file.buni> <page> <out.png>");
        return 2;
      }
      await (await import("./term/capture.ts")).capturePage(file, page, resolve(target));
      return out({ ok: true, text: `Captured ${target} and ${target}.json.` });
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
      // Long-running: one browser kept warm for the edit checks.
      (await import("./term/chrome.ts")).keepBrowserWarm();
      const ws = await Workspace.open(file);
      const host = { screenshot: (page: string, marks?: boolean) => screenshotPng(ws.path, page, marks), screenAsText: (page: string) => screenAsText(ws.path, page) };
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
    case "adopt": {
      // A scratch design is a folder of its own (~/buni/scratch/<name>/): it moves whole, so its assets and history
      // come along, into the project as a section folder.
      const [to] = args;
      if (!file?.endsWith(".buni") || !to) {
        console.error("usage: buni adopt <scratch.buni> <project folder>");
        return 2;
      }
      const from = dirname(resolve(file));
      const dest = join(resolve(to), basename(from));
      if (await liveApp(resolve(file))) return out({ ok: false, text: `${basename(file)} is open in an editor; close it (ctrl+c where buni open runs), then adopt it.` });
      if (await stat(dest).catch(() => undefined)) return out({ ok: false, text: `${dest} already exists; adopt into another folder, or rename one.` });
      await mkdir(resolve(to), { recursive: true });
      await rename(from, dest);
      return out({ ok: true, text: `Moved to ${join(dest, basename(file))}. It is part of ${resolve(to)} now: import_file links it to the project's core.` });
    }
    case "split": {
      const [what, to] = args;
      if (what !== "core" || !to) {
        console.error("usage: buni split <file.buni> core <new.buni>");
        return 2;
      }
      const r = await (await Workspace.open(file)).splitCore(to);
      return out({ ok: r.ok, text: r.reply });
    }
    default:
      console.error(usage(ext));
      return 2;
  }
}

/** The design to open for `path`: itself, or for a folder, its newest .buni (one level down too), made if there is none. */
async function designIn(path: string): Promise<string> {
  if (!(await stat(path).catch(() => undefined))?.isDirectory()) return path;
  const top = await readdir(path, { withFileTypes: true });
  const names = [
    ...top.filter((e) => e.isFile() && e.name.endsWith(".buni")).map((e) => e.name),
    ...(await Promise.all(top.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map(async (d) => (await readdir(join(path, d.name)).catch(() => [])).filter((f) => f.endsWith(".buni")).map((f) => join(d.name, f))))).flat(),
  ];
  const found = await Promise.all(names.map(async (f) => ({ f: join(path, f), at: (await stat(join(path, f))).mtimeMs })));
  const newest = found.sort((a, b) => b.at - a.at)[0]?.f;
  if (newest) return newest;
  const made = join(path, `${basename(resolve(path)) || "design"}.buni`);
  await writeFile(made, serializeDoc(emptyDoc()), { encoding: "utf8", flag: "wx" });
  console.log(`Started ${made}: the folder had no design yet.`);
  return made;
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
