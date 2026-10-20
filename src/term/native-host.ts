// What buni's Chrome extension talks to, with no editor running: Chrome starts `buni native-host` and speaks to it
// over stdin and stdout, each message a JSON object behind its 4-byte length. A snap lands in a scratch design of its
// own (~/buni/scratch/<name>/<name>.buni) or a design snapped into before, and can be opened in the editor from there.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { emptyDoc, pagesInOrder } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { serializeDoc } from "../format/serialize.ts";
import { personalLibrary, writePattern } from "../tools/inspiration.ts";

export const HOST_NAME = "com.buni.snap";
export const SCRATCH = join(homedir(), "buni", "scratch");

const request = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({
    type: z.literal("snap"),
    /** A new scratch design named after this, or a design file snapped into before. */
    into: z.union([z.object({ scratch: z.string().min(1) }), z.object({ file: z.string().min(1) })]),
    snapshot: z.record(z.string(), z.unknown()),
    page: z.object({ name: z.string().min(1) }),
    brief: z.string().optional(),
  }),
  z.object({ type: z.literal("open"), file: z.string().min(1), page: z.string().optional() }),
  /** Keep a snap as a pattern in the person's own inspiration library. */
  z.object({ type: z.literal("inspire"), name: z.string().min(1), use: z.string().optional(), snapshot: z.object({ html: z.string(), url: z.string().optional(), images: z.array(z.object({ id: z.string(), base64: z.string(), mime: z.string() })).default([]) }) }),
]);
export type HostRequest = z.infer<typeof request>;

export interface HostTools {
  /** Runs a design tool on a file, through its open editor when it has one. */
  run: (file: string, name: "import_snapshot", args: unknown) => Promise<{ ok: boolean; text: string }>;
  /** The open editor's address for a file, if one is open. */
  liveApp: (file: string) => Promise<string | undefined>;
}

/** A name as a folder and file name: "Stripe · Pricing" → "stripe-pricing". */
export const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "snap";

/** The scratch designs, newest first. */
async function scratchDesigns(): Promise<{ file: string; name: string; modified: string }[]> {
  const folders = await readdir(SCRATCH).catch(() => []);
  const found = await Promise.all(folders.map(async (f) => {
    const file = join(SCRATCH, f, `${f}.buni`);
    const s = await stat(file).catch(() => undefined);
    return s ? [{ file, name: f, modified: s.mtime.toISOString() }] : [];
  }));
  return found.flat().sort((a, b) => b.modified.localeCompare(a.modified));
}

/** A fresh scratch design for `name`, never over one that exists: "pricing", then "pricing-2". */
async function newScratch(name: string): Promise<string> {
  const base = slug(name);
  for (let n = 1; ; n++) {
    const folder = n === 1 ? base : `${base}-${n}`;
    const file = join(SCRATCH, folder, `${folder}.buni`);
    if (existsSync(file)) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, serializeDoc(emptyDoc()), { encoding: "utf8", flag: "wx" });
    return file;
  }
}

/** Opens the editor on a file (or finds the one already open) and answers its address. */
async function openEditor(file: string, tools: HostTools): Promise<string> {
  const live = await tools.liveApp(file);
  if (live) return live;
  // The same buni that is running now: a linked checkout runs its cli.ts with bun, a built one is the binary itself.
  const self = process.argv[1]?.endsWith(".ts") ? [process.execPath, process.argv[1]] : [process.execPath];
  const child = spawn(self[0]!, [...self.slice(1), "open", file, "--no-open"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const url = await new Promise<string>((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => reject(new Error("The editor didn't start in time.")), 20_000);
    child.stdout?.on("data", (d: Buffer) => {
      seen += d.toString();
      const m = seen.match(/https?:\/\/\S+/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    child.on("exit", () => { clearTimeout(timer); reject(new Error("The editor stopped as it started.")); });
  });
  child.stdout?.destroy();
  child.unref();
  return url;
}

/** One request from the extension, answered. */
export async function answer(raw: unknown, tools: HostTools): Promise<Record<string, unknown>> {
  const parsed = request.safeParse(raw);
  if (!parsed.success) return { ok: false, reply: "buni didn't understand the extension; update both (buni extension)." };
  const r = parsed.data;
  try {
    if (r.type === "list") return { ok: true, scratch: await scratchDesigns(), folder: SCRATCH };
    if (r.type === "open") {
      const url = new URL(await openEditor(r.file, tools));
      if (r.page) url.searchParams.set("page", r.page);
      return { ok: true, url: url.href };
    }
    if (r.type === "inspire") {
      // The snap's layers are inline-styled already; its images go in as data, so the pattern is one file.
      let html = r.snapshot.html;
      for (const img of r.snapshot.images) html = html.split(`asset:${img.id}`).join(`data:${img.mime};base64,${img.base64}`);
      const host = r.snapshot.url ? new URL(r.snapshot.url).hostname : undefined;
      const file = await writePattern(await personalLibrary(), { name: r.name, use: r.use?.trim() || `Snapped${host ? ` from ${host}` : ""}; say when to use it`, tags: ["snapped"], ...(r.snapshot.url ? { seenIn: r.snapshot.url } : {}) }, { html, css: "body{margin:0}" });
      return { ok: true, reply: `Kept as inspiration: ${file}`, file, name: r.name };
    }
    const file = "scratch" in r.into ? await newScratch(r.into.scratch) : r.into.file;
    if (!file.endsWith(".buni") || !existsSync(file)) return { ok: false, reply: `There is no design at ${file}.` };
    const done = await tools.run(file, "import_snapshot", { snapshot: r.snapshot, page: r.page, ...(r.brief?.trim() ? { brief: r.brief.trim() } : {}) });
    const page = done.text.match(/^Created page (\S+)\./)?.[1];
    return { ok: done.ok, reply: done.text, file, name: basename(file, ".buni"), ...(page ? { page } : {}) };
  } catch (e) {
    return { ok: false, reply: e instanceof Error ? e.message : String(e) };
  }
}

/** Reads the extension's messages from stdin and answers each on stdout, until Chrome closes the pipe. */
export async function runNativeHost(tools: HostTools): Promise<void> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (buffer.length < 4 + size) break;
      const body = buffer.subarray(4, 4 + size).toString("utf8");
      buffer = buffer.subarray(4 + size);
      let message: unknown;
      try { message = JSON.parse(body); } catch { message = undefined; }
      const reply = Buffer.from(JSON.stringify(await answer(message, tools)));
      const head = Buffer.alloc(4);
      head.writeUInt32LE(reply.length);
      process.stdout.write(Buffer.concat([head, reply]));
    }
  }
}

/** Where Chrome-family browsers on this machine look for native hosts. */
export function hostManifestDirs(): string[] {
  const home = homedir();
  const base = process.platform === "darwin"
    ? ["Google/Chrome", "Google/Chrome Beta", "Google/Chrome Canary", "Google/Chrome for Testing", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge", "Arc/User Data"].map((b) => join(home, "Library/Application Support", b))
    : ["google-chrome", "google-chrome-beta", "chromium", "BraveSoftware/Brave-Browser", "microsoft-edge"].map((b) => join(home, ".config", b));
  return base.filter((d) => existsSync(d)).map((d) => join(d, "NativeMessagingHosts"));
}

/** A captured page in a scratch design: where it came from and what the person wants changed. */
export interface Snap { file: string; page: string; pageId: string; url?: string; brief?: string; modified: string }

/** Captured pages in the scratch designs, newest design first: what `buni snaps` lists and agents pick up. */
export async function recentSnaps(): Promise<Snap[]> {
  const out: Snap[] = [];
  for (const d of await scratchDesigns()) {
    const parsed = parseDoc(await Bun.file(d.file).text());
    if (!parsed.ok) continue;
    const doc = parsed.doc;
    // Newest page first within a design: the last capture is what was just asked about.
    for (const p of pagesInOrder(doc).reverse()) {
      const url = p.sources?.find((s) => s.url)?.url ?? doc.nodes[p.frame]?.sources?.find((s) => s.url)?.url
        ?? Object.values(doc.nodes).find((n) => n.parent === p.frame)?.sources?.find((s) => s.url)?.url;
      if (!url && !p.name.endsWith("· Now")) continue;
      const brief = Object.values(doc.comments).find((c) => c.node === p.frame && c.posts[0]?.body.startsWith("Brief: "))?.posts[0]?.body.slice(7);
      out.push({ file: d.file, page: p.name, pageId: p.id, modified: d.modified, ...(url ? { url } : {}), ...(brief ? { brief } : {}) });
    }
  }
  return out;
}
