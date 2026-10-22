// The tablet app (android/: Kotlin and Jetpack Compose), built on this Mac with its Gradle wrapper. Built once per
// change of its sources and kept in ~/.buni/tablet, so opening a design on the tablet doesn't wait for Gradle.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const APP_ID = "app.emusoi.buni";
export const APP_ACTIVITY = `${APP_ID}/.MainActivity`;
const PROJECT = join(import.meta.dir, "..", "..", "android");
const HOME = join(homedir(), ".buni", "tablet");
/** Build outputs and caches: not sources, so they don't change the app's version. */
const SKIP = new Set(["build", ".gradle", ".kotlin", "local.properties", ".idea"]);

/** The Android SDK: ANDROID_HOME, or where Android Studio puts it, or next to adb. */
export function androidSdk(adb?: string): string | undefined {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const candidates = [home, join(homedir(), "Library", "Android", "sdk"), adb && dirname(dirname(adb))].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(join(p, "platform-tools")) || existsSync(join(p, "platforms")));
}

/** A JDK Gradle runs on (17 to 21): BUNI_JAVA_HOME, Homebrew's, or Android Studio's own. */
function gradleJdk(): string | undefined {
  const brew = ["openjdk@21", "openjdk@17"].map((f) => join("/opt/homebrew/opt", f, "libexec/openjdk.jdk/Contents/Home"));
  const candidates = [process.env.BUNI_JAVA_HOME, ...brew, "/Applications/Android Studio.app/Contents/jbr/Contents/Home"].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(join(p, "bin", "java")));
}

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else out.push(p);
  }
  return out.sort();
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>): Promise<string> {
  return new Promise((done, fail) => execFile(cmd, args, { cwd, env: { ...process.env, ...env }, timeout: 15 * 60_000, maxBuffer: 32 << 20 },
    (err, out, errOut) => (err ? fail(new Error(`Building the tablet app failed: ${(errOut || out || err.message).split("\n").filter((l) => /error|wrong|e: /i.test(l)).slice(0, 6).join("\n") || err.message}`)) : done(out))));
}

/** The app's APK, built with Gradle if its sources changed since the last build; the path to it. */
export async function buildApk(adb?: string): Promise<string> {
  const sdk = androidSdk(adb);
  if (!sdk) throw new Error("Building the tablet app needs the Android SDK (Android Studio installs it); set ANDROID_HOME if it's elsewhere.");
  const jdk = gradleJdk();
  if (!jdk) throw new Error("Building the tablet app needs a JDK 17–21 for Gradle (brew install openjdk@21), or set BUNI_JAVA_HOME.");
  const files = await sources(PROJECT);
  const hasher = new Bun.CryptoHasher("sha256");
  for (const f of files) hasher.update(f.slice(PROJECT.length)).update(await readFile(f));
  const version = hasher.digest("hex").slice(0, 12);
  const out = join(HOME, `buni-${version}.apk`);
  if (existsSync(out)) return out;
  await run(join(PROJECT, "gradlew"), ["assembleDebug", "--quiet", "--console=plain"], PROJECT, { JAVA_HOME: jdk, ANDROID_HOME: sdk });
  await mkdir(HOME, { recursive: true });
  await copyFile(join(PROJECT, "app", "build", "outputs", "apk", "debug", "app-debug.apk"), out);
  return out;
}
