// The person's buni settings, ~/.buni/settings.json (BUNI_HOME moves it): kept as one object, so a change to one key
// leaves the others (an agent's model, inspiration folders) as they were.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const settingsFile = () => join(process.env.BUNI_HOME ?? join(homedir(), ".buni"), "settings.json");

export async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(await readFile(settingsFile(), "utf8"));
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
  } catch { return {}; }
}

export async function updateSettings(change: (s: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const next = change(await readSettings());
  await mkdir(dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), `${JSON.stringify(next, null, 2)}\n`);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Designs opened lately, newest first: what the extension offers as somewhere for a site's captures to go. */
export async function recentDesigns(): Promise<string[]> {
  return strings((await readSettings()).recent);
}
export async function rememberDesign(file: string): Promise<void> {
  const path = resolve(file);
  await updateSettings((s) => ({ ...s, recent: [path, ...strings(s.recent).filter((f) => f !== path)].slice(0, 30) }));
}

/** The design a site's captures go into, if the person chose one: the longest site that the host ends with. */
export async function siteDesign(host: string): Promise<string | undefined> {
  const sites = (await readSettings()).sites;
  if (typeof sites !== "object" || sites === null) return undefined;
  const h = host.replace(/^www\./, "");
  const match = Object.entries(sites).filter(([site, file]) => typeof file === "string" && (h === site || h.endsWith(`.${site}`))).sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] as string | undefined;
}
export async function linkSite(host: string, file: string | undefined): Promise<void> {
  const site = host.replace(/^www\./, "");
  await updateSettings((s) => {
    const sites = typeof s.sites === "object" && s.sites !== null ? { ...(s.sites as Record<string, unknown>) } : {};
    if (file) sites[site] = resolve(file); else delete sites[site];
    return { ...s, sites };
  });
}
/** Every design some site's captures go into. */
export async function linkedDesigns(): Promise<string[]> {
  const sites = (await readSettings()).sites;
  return typeof sites === "object" && sites !== null ? [...new Set(Object.values(sites).filter((f): f is string => typeof f === "string"))] : [];
}
