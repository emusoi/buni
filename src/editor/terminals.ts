// Coding agents in a terminal beside the design, on this Mac only: Claude Code, Codex or a shell in a PTY, started
// already connected to this design's MCP endpoint. Sessions belong to the server, not the tab: switching panels or
// reloading the page reattaches to them, with what they printed lately. The agents among them are remembered past
// buni itself: opened again, a design's agents come back resumed where they were.
import type { ServerWebSocket } from "bun";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Program = "claude" | "codex" | "shell";
export const PROGRAMS: readonly Program[] = ["claude", "codex", "shell"];

export interface TermInfo {
  id: string;
  program: Program;
  alive: boolean;
  /** Remembered from an earlier buni and not running: starting it with its id resumes the agent's conversation. */
  saved?: boolean;
}

/** An agent session remembered for a design, by the design's path. */
interface Saved {
  id: string;
  program: Program;
}

/** What a terminal's WebSocket carries in its data. */
export interface TermSocket {
  kind: "term";
  id: string;
}

interface Session {
  id: string;
  file: string;
  program: Program;
  proc: Bun.Subprocess;
  /** What it printed lately, replayed to a tab that attaches. */
  scroll: Uint8Array[];
  size: number;
  clients: Set<ServerWebSocket<TermSocket>>;
  alive: boolean;
}

/** Enough of the past for a reattached tab to see where things are. */
const KEEP = 256 * 1024;

/** Told to Claude Code as it starts: the design is open beside it, and buni's tools are how to reach it. */
export const BRIEF = "The person has this design open in buni beside you. Read and change it only through the buni MCP tools (start with buni's read tools), never by editing .buni files on disk; every edit shows on their canvas.";

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** The command line a session runs: the agent already pointed at this design's MCP endpoint. */
/** `ask` is the person's first message to the agent, sent as it starts. `session` names Claude Code's conversation, so
 * it can be resumed later; `resume` picks it up again (or starts it, when it never got as far as a message). */
export function command(program: Program, mcpUrl: string, ask?: string, session?: { id: string; resume?: boolean }): string | undefined {
  const first = ask?.trim() ? ` ${quote(ask.trim())}` : "";
  switch (program) {
    case "claude": {
      const run = `claude --mcp-config ${quote(JSON.stringify({ mcpServers: { buni: { type: "http", url: mcpUrl } } }))} --append-system-prompt ${quote(BRIEF)}`;
      if (!session) return run + first;
      const fresh = `${run} --session-id ${quote(session.id)}${first}`;
      return session.resume ? `${run} --resume ${quote(session.id)} || ${fresh}` : fresh;
    }
    case "codex": {
      const config = `-c ${quote(`mcp_servers.buni.url=${JSON.stringify(mcpUrl)}`)}`;
      // ponytail: Codex can't be told its session's id up front, so it resumes its latest here (codex filters by folder).
      return session?.resume ? `codex resume --last ${config} || codex ${config}` : `codex ${config}${first}`;
    }
    case "shell":
      return undefined;
  }
}

/** The environment of the person's own terminal: nothing of whatever started buni (a Claude Code session, say). */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith("CLAUDE") || k.startsWith("CODEX_") || k === "MCP_CONNECTION_NONBLOCKING") continue;
    env[k] = v;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

export class Terminals {
  private readonly sessions = new Map<string, Session>();

  /** `cwdOf` says where a design's sessions run (its repo); `mcpUrl` where its MCP endpoint is; `pathOf` the design's
   * real path, under which `store` (a JSON file) remembers its agents. */
  constructor(
    private readonly cwdOf: (file: string) => string,
    private readonly mcpUrl: (file: string) => string,
    private readonly pathOf: (file: string) => string = (f) => f,
    private readonly store?: string,
  ) {}

  private remembered(): Record<string, Saved[]> {
    if (!this.store) return {};
    try {
      const all: unknown = JSON.parse(readFileSync(this.store, "utf8"));
      return typeof all === "object" && all !== null ? (all as Record<string, Saved[]>) : {};
    } catch {
      return {}; // none yet, or unreadable: nothing remembered
    }
  }

  private remember(file: string, change: (saved: Saved[]) => Saved[]): void {
    if (!this.store) return;
    const all = this.remembered();
    const key = this.pathOf(file);
    const next = change(all[key] ?? []);
    if (next.length) all[key] = next;
    else delete all[key];
    mkdirSync(dirname(this.store), { recursive: true });
    writeFileSync(this.store, JSON.stringify(all, undefined, 2));
  }

  private saved(file: string): Saved[] {
    return (this.remembered()[this.pathOf(file)] ?? []).filter((s) => typeof s?.id === "string" && PROGRAMS.includes(s.program));
  }

  list(file: string): TermInfo[] {
    const running = [...this.sessions.values()].filter((s) => s.file === file).map(({ id, program, alive }): TermInfo => ({ id, program, alive }));
    const asleep = this.saved(file).filter((s) => !this.sessions.has(s.id)).map(({ id, program }): TermInfo => ({ id, program, alive: false, saved: true }));
    return [...asleep, ...running];
  }

  owns(file: string, id: string): boolean {
    return this.sessions.get(id)?.file === file;
  }

  /** `resume`: the id of this design's remembered or ended agent session, started again where it was; undefined when
   * it is no session of this design's. */
  start(file: string, program: Program, cols = 100, rows = 30, ask?: string, resume?: string): TermInfo | undefined {
    if (resume) {
      const was = this.sessions.get(resume);
      const kind = was?.file === file ? was.program : this.saved(file).find((s) => s.id === resume)?.program;
      if (!kind || kind === "shell") return undefined;
      program = kind;
      was?.proc.kill();
      this.sessions.delete(resume);
    }
    const id = resume ?? crypto.randomUUID();
    const shell = process.env.SHELL || "/bin/zsh";
    const run = command(program, this.mcpUrl(file), ask, program === "shell" ? undefined : { id, resume: !!resume });
    // The agent first; when it ends, the person is left in a shell in the same place rather than a dead pane.
    const argv = run ? [shell, "-lc", `${run}; exec ${shell} -l`] : [shell, "-l"];
    const session: Session = { id, file, program, proc: undefined as unknown as Bun.Subprocess, scroll: [], size: 0, clients: new Set(), alive: true };
    session.proc = Bun.spawn(argv, {
      cwd: this.cwdOf(file),
      env: cleanEnv(),
      terminal: {
        cols,
        rows,
        data: (_t, data) => {
          session.scroll.push(data);
          session.size += data.byteLength;
          while (session.size > KEEP && session.scroll.length > 1) session.size -= session.scroll.shift()!.byteLength;
          for (const ws of session.clients) ws.sendBinary(data);
        },
      },
    });
    void session.proc.exited.then(() => {
      session.alive = false;
      for (const ws of session.clients) ws.send(JSON.stringify({ ended: true }));
    });
    this.sessions.set(id, session);
    if (program !== "shell" && !resume) this.remember(file, (saved) => [...saved, { id, program }]);
    return { id, program, alive: true };
  }

  attach(ws: ServerWebSocket<TermSocket>): void {
    const s = this.sessions.get(ws.data.id);
    if (!s) return void ws.close(4404, "no such session");
    for (const chunk of s.scroll) ws.sendBinary(chunk);
    if (!s.alive) ws.send(JSON.stringify({ ended: true }));
    s.clients.add(ws);
  }

  detach(ws: ServerWebSocket<TermSocket>): void {
    this.sessions.get(ws.data.id)?.clients.delete(ws);
  }

  /** Keys typed, or a new size, from a tab. */
  message(ws: ServerWebSocket<TermSocket>, raw: string | Buffer): void {
    const s = this.sessions.get(ws.data.id);
    if (!s?.alive) return;
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as { input?: unknown; cols?: unknown; rows?: unknown };
    if (typeof m.input === "string") s.proc.terminal?.write(m.input);
    if (typeof m.cols === "number" && typeof m.rows === "number" && m.cols > 0 && m.rows > 0) s.proc.terminal?.resize(Math.floor(m.cols), Math.floor(m.rows));
  }

  /** Ends a session and forgets it. */
  close(file: string, id: string): void {
    const s = this.sessions.get(id);
    if (s?.file === file) {
      s.proc.kill();
      for (const ws of s.clients) ws.close(1000, "closed");
      this.sessions.delete(id);
    }
    if (this.saved(file).some((x) => x.id === id)) this.remember(file, (saved) => saved.filter((x) => x.id !== id));
  }

  stop(): void {
    for (const s of this.sessions.values()) s.proc.kill();
    this.sessions.clear();
  }
}
