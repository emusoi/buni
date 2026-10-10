// Release check: the standalone command edits from outside the source checkout.
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findBrowser } from "../src/term/chrome.ts";
import { parseDoc } from "../src/format/parse.ts";

const binary = process.argv[2];
if (!binary) throw new Error("usage: bun scripts/check-editor.ts <binary>");
const dir = await mkdtemp(join(tmpdir(), "buni-release-"));
await mkdir(join(dir, "design"));
await cp(join(import.meta.dir, "../examples/portal.buni"), join(dir, "design/portal.buni"));
const child = Bun.spawn([resolve(binary), "open", join(dir, "design/portal.buni"), "--no-open"], { cwd: dir, stdout: "pipe", stderr: "inherit" });
const output = child.stdout.getReader();
const deadline = setTimeout(() => child.kill(), 60_000);
function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
try {
  const first = new TextDecoder().decode((await output.read()).value);
  const address = first.match(/at (http:\/\/localhost:\d+\/\?file=\S+)/)?.[1];
  check(address !== undefined, "binary did not start the editor");
  const url = new URL(address);
  const html = await (await fetch(url)).text();
  const asset = html.match(/src="(\/assets\/client-[^"]+)"/)?.[1];
  check(asset !== undefined, "editor page has no bundled client");
  const script = await fetch(`${url.origin}${asset}`);
  check(script.ok && (await script.text()).length > 1000, "binary is missing its browser bundle");
  check((await fetch(`${url.origin}/fonts/manrope.woff2`)).ok, "binary is missing its fonts");
  const rpc = (name: string, args: (string | { name: string; route: string })[] = []) => fetch(`${url.origin}/rpc/${name}${url.search}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args),
  });
  const edit: { value: { ok: boolean } } = await (await rpc("edit", ["create_page", { name: "Release check", route: "/release" }])).json();
  check(edit.value.ok, "editor rejected an edit");
  const parsed = parseDoc(await readFile(join(dir, "design/portal.buni"), "utf8"));
  check(parsed.ok && Object.values(parsed.doc.pages).some((p) => p.name === "Release check"), "editor did not save the edit");
  if (findBrowser()) {
    const imported = Bun.spawn([resolve(binary), "call", join(dir, "design/portal.buni"), "import_html_page", JSON.stringify({
      html: '<style>#card{display:flex;gap:17px}</style><section id="card"><h1>Agent import</h1></section><footer>Outside</footer>',
      selector: "#card", source_file: "src/Card.tsx", page: { name: "Imported release check", width: 390 },
    })], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const status = await imported.exited;
    check(status === 0, `standalone agent import failed: ${await new Response(imported.stderr).text()}`);
    const after = parseDoc(await readFile(join(dir, "design/portal.buni"), "utf8"));
    check(after.ok && Object.values(after.doc.pages).some((p) => p.name === "Imported release check" && p.sources?.[0]?.file === "src/Card.tsx"), "standalone agent import did not save source context");
    console.log("standalone agent HTML import passed");
  }
  const example: { value: string } = await (await rpc("openExample")).json();
  const image = await fetch(`${url.origin}/files${example.value.slice(0, example.value.lastIndexOf("/"))}/assets/steel-rack.jpg`);
  check(image.ok && (await image.arrayBuffer()).byteLength > 1000, "binary is missing the bundled example image");
  console.log("standalone editor: assets, fonts, saved edits and bundled example passed");
} finally {
  clearTimeout(deadline);
  await output.cancel();
  child.kill();
  await child.exited;
  await rm(dir, { recursive: true, force: true });
}
