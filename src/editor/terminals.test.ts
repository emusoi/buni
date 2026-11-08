import { expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEF, command, Terminals } from "./terminals.ts";

test("agents start already pointed at the design's MCP endpoint", () => {
  const url = "http://localhost:4000/mcp?file=%2Fdesigns%2Fshop%2Fshop.buni";
  // What the shell hands claude, word for word, quotes and all.
  const words = Bun.spawnSync(["sh", "-c", `printf '%s\\n' ${command("claude", url)!.replace(/^claude /, "")}`]).stdout.toString().split("\n");
  expect(words.slice(0, 4)).toEqual(["--mcp-config", JSON.stringify({ mcpServers: { buni: { type: "http", url } } }), "--append-system-prompt", BRIEF]);
  expect(command("codex", url)).toBe(`codex -c 'mcp_servers.buni.url="${url}"'`);
  expect(command("shell", url)).toBeUndefined();
  // The person's first message rides along as one word, whatever it says.
  const asked = Bun.spawnSync(["sh", "-c", `printf '%s\\n' ${command("claude", url, "a checkout that's calm; no \"dark patterns\" $(rm -rf /)")!.replace(/^claude /, "")}`]).stdout.toString().split("\n");
  expect(asked[4]).toBe(`a checkout that's calm; no "dark patterns" $(rm -rf /)`);
  // Claude Code is told its conversation's id, so buni can resume it; resuming falls back to starting it under that id.
  const id = "8f0c2a4e-1b2d-4c3e-9f00-112233445566";
  expect(command("claude", url, undefined, { id })).toEndWith(` --session-id '${id}'`);
  expect(command("claude", url, undefined, { id, resume: true })).toMatch(new RegExp(` --resume '${id}' \\|\\| claude .* --session-id '${id}'$`));
  expect(command("codex", url, undefined, { id, resume: true })).toStartWith("codex resume --last -c ");
});

test("a design's agents are remembered past buni, and forgotten when closed", async () => {
  const store = join(await mkdtemp(join(tmpdir(), "buni-terms-")), "terminals.json");
  const real = (f: string) => `/work${f}`;
  await Bun.write(store, JSON.stringify({ "/work/designs/a.buni": [{ id: "c1", program: "claude" }, { id: "x", program: "rm -rf" }], "/work/designs/b.buni": [{ id: "d1", program: "codex" }] }));
  const terms = new Terminals(() => tmpdir(), () => "http://localhost/mcp", real, store);
  expect(terms.list("/designs/a.buni")).toEqual([{ id: "c1", program: "claude", alive: false, saved: true }]);
  // Another design's session is not this one's to resume, and a shell is never remembered.
  expect(terms.start("/designs/a.buni", "claude", 80, 24, undefined, "d1")).toBeUndefined();
  terms.close("/designs/a.buni", "c1");
  expect(terms.list("/designs/a.buni")).toEqual([]);
  expect(terms.list("/designs/b.buni").map((s) => s.id)).toEqual(["d1"]);
});

test("the local editor runs a terminal for its own page only, and keeps it across reconnects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-term-"));
  await cp(join(import.meta.dir, "../../examples"), join(dir, "design"), { recursive: true });
  const child = Bun.spawn(["bun", "-e", `
    import { serveEditor } from "./src/editor/server.ts";
    const editor = await serveEditor(process.argv[1]);
    process.on("SIGTERM", () => { editor.stop(); process.exit(0); });
    console.log(editor.url);
  `, join(dir, "design/portal.buni")], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "inherit" });
  try {
    const first = await child.stdout.getReader().read();
    const url = new URL(new TextDecoder().decode(first.value).trim());
    const terms = `${url.origin}/terms${url.search}`;
    const json = { "content-type": "application/json" };
    const start = (headers: Record<string, string>) => fetch(terms, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ program: "shell", cols: 80, rows: 24 }) });

    // Another site, or no page at all, gets nothing: a terminal runs commands.
    expect((await start({ origin: "https://evil.example" })).status).toBe(403);
    expect((await start({})).status).toBe(403);
    expect((await fetch(terms, { headers: { origin: "https://evil.example" } })).status).toBe(403);

    const res = await start({ origin: url.origin });
    expect(res.status).toBe(200);
    const { session } = (await res.json()) as { session: { id: string; program: string; alive: boolean } };
    expect(session.program).toBe("shell");
    const listed = (await (await fetch(terms, { headers: { origin: url.origin } })).json()) as { sessions: { id: string }[] };
    expect(listed.sessions.map((s) => s.id)).toEqual([session.id]);

    const socket = `${url.origin.replace("http", "ws")}/term${url.search}&id=${session.id}`;
    // A socket from elsewhere, or for a session that isn't there, is refused.
    const refused = new WebSocket(socket, { headers: { origin: "https://evil.example" } } as unknown as string[]);
    expect(await new Promise<string>((done) => { refused.onopen = () => done("open"); refused.onerror = () => done("refused"); })).toBe("refused");

    const read = (ws: WebSocket, until: string) => new Promise<string>((done, fail) => {
      let seen = "";
      const timer = setTimeout(() => fail(new Error(`never saw ${until}: ${seen}`)), 8000);
      ws.onmessage = (e: MessageEvent) => {
        seen += typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
        if (seen.includes(until)) {
          clearTimeout(timer);
          done(seen);
        }
      };
    });
    const open = () => {
      const ws = new WebSocket(socket, { headers: { origin: url.origin } } as unknown as string[]);
      ws.binaryType = "arraybuffer";
      return ws;
    };
    const ws = open();
    await new Promise((done) => (ws.onopen = done));
    const seen = read(ws, "buni-42");
    ws.send(JSON.stringify({ input: "echo buni-$((40+2))\r" }));
    expect(await seen).toContain("buni-42");
    ws.close();

    // A tab that comes back sees what was printed, and the shell still runs where the design is.
    const again = open();
    const replay = read(again, "buni-42");
    await new Promise((done) => (again.onopen = done));
    expect(await replay).toContain("buni-42");
    const where = read(again, "pwd-is:/");
    again.send(JSON.stringify({ input: "echo pwd-is:$(pwd)\r" }));
    expect(await where).toContain(`pwd-is:${await Bun.$`realpath ${join(dir, "design")}`.text().then((t) => t.trim())}`);
    const ended = read(again, '"ended":true');
    again.send(JSON.stringify({ input: "exit\r" }));
    expect(await ended).toContain("ended");
    again.close();
  } finally {
    child.kill();
    await child.exited;
  }
}, 30000);
