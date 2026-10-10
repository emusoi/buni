import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zip } from "./export.ts";

test("the zip opens elsewhere, names and bytes intact", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
  const out = join(tmpdir(), `buni-${crypto.randomUUID()}.zip`);
  await Bun.write(out, zip(new Map<string, string | Uint8Array>([["index.html", "<h1>Hé</h1>"], ["pricing/index.html", ""], ["icon.png", png]])));
  // Python's zipfile checks every crc as it reads.
  const read = Bun.spawnSync(["python3", "-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:list(z.read(n)) for n in z.namelist()}))", out]);
  expect(read.stderr.toString()).toBe("");
  expect(JSON.parse(read.stdout.toString())).toEqual({ "index.html": [...new TextEncoder().encode("<h1>Hé</h1>")], "pricing/index.html": [], "icon.png": [...png] });
});
