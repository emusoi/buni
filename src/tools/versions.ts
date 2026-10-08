// Named versions of a design, kept in its folder (.versions/) so moving or deleting the design takes them along.
// The newest is also written beside the file as .version, the baseline Review compares against.
import { dirname, join } from "node:path";
import type { VersionInfo } from "./protocol.ts";
import { serializeDoc } from "../format/serialize.ts";
import { parseDoc } from "../format/parse.ts";
import type { CallResult, Store, Workspace } from "./workspace.ts";

const indexPath = (path: string) => join(dirname(path), ".versions", "index.json");
const versionPath = (path: string, id: string) => join(dirname(path), ".versions", `${id}.buni`);

/** The saved versions of a design, newest first; none when nothing is saved or the index doesn't read. */
export async function versionsOf(store: Store, path: string): Promise<VersionInfo[]> {
  const text = await store.read(indexPath(path)).catch(() => undefined);
  if (!text) return [];
  let list: unknown;
  try { list = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.flatMap((v): VersionInfo[] => {
    if (typeof v !== "object" || v === null) return [];
    const { id, name, at, by } = v as Record<string, unknown>;
    return typeof id === "string" && typeof at === "string" ? [{ id, name: typeof name === "string" ? name : "", at, by: typeof by === "string" ? by : "you" }] : [];
  });
}

export async function saveVersion(store: Store, ws: Workspace, name: unknown): Promise<VersionInfo> {
  const text = serializeDoc(ws.view());
  await store.write(`${ws.path}.version`, text);
  const at = new Date().toISOString();
  const version: VersionInfo = { id: at.replace(/[:.]/g, "-"), name: typeof name === "string" ? name.trim().slice(0, 80) : "", at, by: "you" };
  await store.write(versionPath(ws.path, version.id), text);
  await store.write(indexPath(ws.path), JSON.stringify([version, ...(await versionsOf(store, ws.path))], null, 2));
  return version;
}

/** Makes the design match a saved version, as one edit undo takes back. */
export async function restoreVersion(store: Store, ws: Workspace, id: unknown): Promise<CallResult> {
  const v = (await versionsOf(store, ws.path)).find((x) => x.id === id);
  if (!v) return { ok: false, reply: "No such version." };
  const saved = parseDoc(await store.read(versionPath(ws.path, v.id)));
  if (!saved.ok) return { ok: false, reply: "That version doesn't read as a .buni file." };
  return ws.restore("you", `Restore ${v.name ? `"${v.name}"` : `the version of ${v.at.slice(0, 16).replace("T", " ")}`}`, saved.doc);
}
