// A tablet plugged into this Mac with a USB cable, drawing on designs. Nothing else reaches it: `adb reverse` carries
// the tablet's localhost:<port> over the cable to a listener of the editor's own on 127.0.0.1, and only to that one.
// Opening the design starts Chrome on the tablet with a one-time code; the code buys a cookie, and what a tablet may
// do with it is drawing marks (server.ts keeps that list). Unplugged, the tunnel is gone.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_ACTIVITY, APP_ID, buildApk } from "./apk.ts";

const CODE_MS = 2 * 60_000;
export const DEVICE_COOKIE = "buni-device";

/** A tablet on the cable, as adb sees it. */
export interface Wired {
  serial: string;
  /** "Galaxy Tab S7 FE 5G", from its settings; else its model. */
  name: string;
  /** ready: allowed and on. unauthorized: the tablet still has to allow this Mac. */
  state: "ready" | "unauthorized" | "offline";
  /** The buni app is installed on it: the design opens there, not in Chrome. */
  app: boolean;
}

/** What the Mac knows about tablets on the cable: none, the reason, or the list. */
export type WiredList = { error: string } | { tablets: Wired[] };

/** A browser that came in with a code: kept so it can be told apart and disconnected. */
export interface Device {
  id: string;
  name: string;
  since: number;
  seen: number;
}

/** adb from Android's platform tools: where Android Studio puts it, ANDROID_HOME, or the PATH. */
export function findAdb(): string | undefined {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const known = [home && join(home, "platform-tools", "adb"), join(homedir(), "Library", "Android", "sdk", "platform-tools", "adb")].filter((p): p is string => !!p);
  return known.find((p) => existsSync(p)) ?? Bun.which("adb") ?? undefined;
}

export class Tablets {
  /** The listener only tablets reach: set once it is listening. */
  port = 0;
  private codes = new Map<string, { file: string; name: string; until: number }>();
  /** Browsers by a hash of their cookie: the cookie itself is never kept. */
  private devices = new Map<string, Device>();
  private reversed = new Set<string>();

  /** `keep` is where paired browsers are remembered, so a tablet stays in when buni open restarts. */
  constructor(private readonly keep?: string, private readonly adb: string | undefined = findAdb()) {
    try {
      const kept: unknown = keep ? JSON.parse(readFileSync(keep, "utf8")) : [];
      if (Array.isArray(kept)) for (const d of kept) if (isKept(d)) this.devices.set(d.hash, { id: d.id, name: d.name, since: d.since, seen: d.seen });
    } catch { /* none kept yet */ }
  }

  async list(): Promise<WiredList> {
    if (!this.adb || !existsSync(this.adb)) return { error: "buni talks to the tablet through adb, from Android's platform tools. Install them (brew install android-platform-tools), then plug the tablet in." };
    const out = await run(this.adb, ["devices", "-l"]).catch(() => undefined);
    if (out === undefined) return { error: "adb didn't answer. Unplug the tablet and plug it in again." };
    const tablets: Wired[] = [];
    for (const line of out.split("\n").slice(1)) {
      const [serial, state] = line.trim().split(/\s+/);
      if (!serial || !state) continue;
      const model = line.match(/model:(\S+)/)?.[1]?.replace(/_/g, "-") ?? serial;
      const ready = state === "device";
      const named = ready ? (await run(this.adb, ["-s", serial, "shell", "settings", "get", "global", "device_name"]).catch(() => "")).trim() : "";
      const app = ready && (await run(this.adb, ["-s", serial, "shell", "pm", "list", "packages", APP_ID]).catch(() => "")).includes(`package:${APP_ID}`);
      tablets.push({ serial, name: named && named !== "null" ? named : model, state: ready ? "ready" : state === "unauthorized" ? "unauthorized" : "offline", app });
    }
    return { tablets };
  }

  /** Opens `file` in Chrome on the tablet with serial `serial`: the cable's tunnel, then a one-time code in the URL. */
  async open(serial: string, file: string): Promise<{ name: string; locked?: true } | { error: string }> {
    if (!this.adb || !this.port) return { error: "No tablet connection here." };
    const list = await this.list();
    const t = "tablets" in list ? list.tablets.find((x) => x.serial === serial) : undefined;
    if (!t) return { error: "That tablet isn't on the cable any more. Plug it in again." };
    if (t.state !== "ready") return { error: `Allow this Mac on ${t.name}: unlock it and tap Allow on the USB debugging prompt.` };
    try {
      await run(this.adb, ["-s", serial, "reverse", `tcp:${this.port}`, `tcp:${this.port}`]);
      this.reversed.add(serial);
      const code = token(8);
      for (const [c, v] of this.codes) if (v.until < Date.now()) this.codes.delete(c);
      this.codes.set(code, { file, name: t.name, until: Date.now() + CODE_MS });
      // Wake the screen; a locked tablet shows it once the person unlocks it, and the Mac says so.
      await run(this.adb, ["-s", serial, "shell", "input keyevent KEYCODE_WAKEUP"]).catch(() => undefined);
      // One string for the tablet's shell: the URL is quoted so its ? and & stay in it. The buni app when it's there
      // (it trades the code for a token: docs/tablet-api.md), else Chrome (which trades it for a cookie).
      if (t.app) {
        await run(this.adb, ["-s", serial, "shell", `am start -n ${APP_ACTIVITY} --es url 'http://localhost:${this.port}/tablet/v1?code=${code}'`]);
      } else {
        const view = `am start -a android.intent.action.VIEW -d 'http://localhost:${this.port}/pair?code=${code}'`;
        await run(this.adb, ["-s", serial, "shell", `${view} -p com.android.chrome`]).catch(() => run(this.adb ?? "adb", ["-s", serial, "shell", view]));
      }
      const locked = /isKeyguardShowing=true|mDreamingLockscreen=true/.test(await run(this.adb, ["-s", serial, "shell", "dumpsys window"]).catch(() => ""));
      return { name: t.name, ...(locked ? { locked: true as const } : {}) };
    } catch (e) {
      return { error: `Couldn't open it on ${t.name}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** Builds the buni app (apk.ts) and installs it on the tablet over the cable. */
  async install(serial: string): Promise<{ name: string } | { error: string }> {
    if (!this.adb) return { error: "Installing needs adb, from Android's platform tools." };
    try {
      const apk = await buildApk(this.adb);
      await run(this.adb, ["-s", serial, "install", "-r", apk]);
      const list = await this.list();
      return { name: ("tablets" in list && list.tablets.find((x) => x.serial === serial)?.name) || "the tablet" };
    } catch (e) {
      return { error: `Couldn't install the buni app: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** Trades a code for a cookie or token value and the design it was for; a code works once. */
  redeem(code: string): { token: string; file: string; name: string } | undefined {
    const c = this.codes.get(code);
    this.codes.delete(code);
    if (!c || c.until < Date.now()) return undefined;
    const t = token(32);
    const now = Date.now();
    this.devices.set(hash(t), { id: token(8), name: c.name, since: now, seen: now });
    this.save();
    return { token: t, file: c.file, name: c.name };
  }

  /** The paired tablet a request comes from: the app's bearer token or the browser's cookie; undefined when neither. */
  device(req: Request): Device | undefined {
    const bearer = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    const value = bearer ?? req.headers.get("cookie")?.split(/;\s*/).find((p) => p.startsWith(`${DEVICE_COOKIE}=`))?.slice(DEVICE_COOKIE.length + 1);
    const d = value ? this.devices.get(hash(value)) : undefined;
    if (d) d.seen = Date.now();
    return d && { ...d };
  }

  paired(): Device[] {
    return [...this.devices.values()].map((d) => ({ ...d }));
  }

  /** Forgets a browser: its next request is turned away. */
  forget(id: string): void {
    for (const [h, d] of this.devices) if (d.id === id) this.devices.delete(h);
    this.save();
  }

  /** Takes the tunnels down: the tablet can't reach this Mac once buni stops. At once, as buni may be exiting. */
  stop(): void {
    for (const serial of this.reversed) {
      try { execFileSync(this.adb ?? "adb", ["-s", serial, "reverse", "--remove", `tcp:${this.port}`], { timeout: 3000, stdio: "ignore" }); } catch { /* unplugged already: no tunnel */ }
    }
    this.reversed.clear();
  }

  private save(): void {
    if (!this.keep) return;
    try {
      mkdirSync(dirname(this.keep), { recursive: true });
      writeFileSync(this.keep, JSON.stringify([...this.devices].map(([h, d]) => ({ hash: h, ...d }))), { mode: 0o600 });
    } catch { /* kept for this run only */ }
  }
}

const hash = (t: string) => new Bun.CryptoHasher("sha256").update(t).digest("hex");

function isKept(d: unknown): d is Device & { hash: string } {
  return typeof d === "object" && d !== null && "hash" in d && typeof d.hash === "string" && "id" in d && typeof d.id === "string"
    && "name" in d && typeof d.name === "string" && "since" in d && typeof d.since === "number" && "seen" in d && typeof d.seen === "number";
}

function run(cmd: string, args: string[]): Promise<string> {
  // adb says why on stderr ("INSTALL_FAILED_…", "device offline"): that, not the command line, is the error.
  return new Promise((done, fail) => execFile(cmd, args, { timeout: 120_000 }, (err, out, errOut) => (err ? fail(new Error(String(errOut || out).trim().split("\n").at(-1) || err.message)) : done(out))));
}

/** Random letters and digits (no 0/O, 1/I). */
function token(n: number): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % abc.length]).join("");
}
