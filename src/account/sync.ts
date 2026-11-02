// A design edited here, mirrored on the buni server while `buni open` runs: every change goes up a moment after it
// settles, as one change there, so the people and agents on the server see it as it happens. One way: what the
// server holds is a copy, and the next push puts it back to what this machine has.
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseDoc } from "../format/parse.ts";
import type { Editor } from "../editor/server.ts";
import type { Account } from "./account.ts";
import { push, type Upload } from "./remote.ts";

const SETTLE_MS = 1500;

/** Starts mirroring; returns how to stop. `log` hears where the copy is, once, and any push that failed. */
export function mirror(account: Account, editor: Editor, design: string, localFile: string, log: (line: string) => void, root?: string): () => void {
  const name = basename(localFile, ".buni");
  const host = new URL(account.server).host;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pushing = false;
  let again = false;
  let sentText = "";
  let sentAssets = "";
  let told = false;
  const pushNow = async () => {
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      const text = await editor.text(design);
      if (text === sentText) return;
      const parsed = parseDoc(text, { refs: false });
      const paths = parsed.ok ? Object.values(parsed.doc.attachments).map((a) => a.path).sort() : [];
      // Attachments travel when the set of them changes: pictures are the heavy part, and they rarely do.
      const key = paths.join("\n");
      const assets: Upload[] = key === sentAssets ? [] : (await Promise.all(paths.map(async (p) => {
        const bytes = await readFile(join(dirname(localFile), p)).catch(() => undefined);
        return bytes ? [{ name: basename(p), base64: bytes.toString("base64") }] : [];
      }))).flat();
      const there = await push(account, name, text, assets, root);
      sentText = text;
      sentAssets = key;
      if (!told) { told = true; log(`Mirrored on ${host}: ${account.server}/?file=${encodeURIComponent(there)}`); }
    } catch (e) {
      log(`Couldn't mirror to ${host}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      pushing = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void pushNow(), SETTLE_MS); };
  const off = editor.onChange(design, schedule);
  void pushNow();
  return () => { clearTimeout(timer); void off.then((stop) => stop()); };
}
