// Coding agents in a terminal beside the design, on this Mac only: Claude Code, Codex or a shell in a PTY, started
// already connected to this design's MCP endpoint. Sessions belong to the server, not the tab: switching panels or
// reloading the page reattaches to them, with what they printed lately.
import type { ServerWebSocket } from "bun";

export type Program = "claude" | "codex" | "shell";
export const PROGRAMS: readonly Program[] = ["claude", "codex", "shell"];

export interface TermInfo {
  id: string;
  program: Program;
  alive: boolean;
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
/** `ask` is the person's first message to the agent, sent as it starts. */
export function command(program: Program, mcpUrl: string, ask?: string): string | undefined {
  const first = ask?.trim() ? ` ${quote(ask.trim())}` : "";
  switch (program) {
    case "claude":
      return `claude --mcp-config ${quote(JSON.stringify({ mcpServers: { buni: { type: "http", url: mcpUrl } } }))} --append-system-prompt ${quote(BRIEF)}${first}`;
    case "codex":
      return `codex -c ${quote(`mcp_servers.buni.url=${JSON.stringify(mcpUrl)}`)}${first}`;
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

  /** `cwdOf` says where a design's sessions run (its repo); `mcpUrl` where its MCP endpoint is. */
  constructor(private readonly cwdOf: (file: string) => string, private readonly mcpUrl: (file: string) => string) {}

  list(file: string): TermInfo[] {
    return [...this.sessions.values()].filter((s) => s.file === file).map(({ id, program, alive }) => ({ id, program, alive }));
  }

  owns(file: string, id: string): boolean {
    return this.sessions.get(id)?.file === file;
  }

  start(file: string, program: Program, cols = 100, rows = 30, ask?: string): TermInfo {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const shell = process.env.SHELL || "/bin/zsh";
    const run = command(program, this.mcpUrl(file), ask);
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

  close(file: string, id: string): void {
    const s = this.sessions.get(id);
    if (!s || s.file !== file) return;
    s.proc.kill();
    for (const ws of s.clients) ws.close(1000, "closed");
    this.sessions.delete(id);
  }

  stop(): void {
    for (const s of this.sessions.values()) s.proc.kill();
    this.sessions.clear();
  }
}
