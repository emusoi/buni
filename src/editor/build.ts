import { basename, join } from "node:path";

export interface EditorSource {
  path: string;
  body: Uint8Array<ArrayBuffer>;
  type: string;
}

export interface EditorSources {
  files: EditorSource[];
  client: string;
  styles: string;
}

/** Built from source here, embedded ahead of time in the standalone command. */
export async function editorSources(): Promise<EditorSources> {
  const r = await Bun.build({
    entrypoints: [join(import.meta.dir, "client.ts")],
    target: "browser", format: "esm", splitting: true, minify: true,
    naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]" },
    define: { "import.meta.env": '{"MODE":"production"}', "process.env.NODE_ENV": '"production"' },
  });
  if (!r.success) throw new AggregateError(r.logs, "building the editor failed");
  const files: EditorSource[] = [];
  let client = "";
  for (const out of r.outputs) {
    const path = `/assets/${basename(out.path)}`;
    files.push({ path, body: new Uint8Array(await out.arrayBuffer()), type: "text/javascript; charset=utf-8" });
    if (out.kind === "entry-point") client = path;
  }
  // The terminal's own stylesheet goes in with ours.
  const xterm = await Bun.file(require.resolve("@xterm/xterm/css/xterm.css")).text();
  const css = (await Bun.file(join(import.meta.dir, "renderer/styles.css")).text()).replaceAll('url("fonts/', 'url("/fonts/') + xterm;
  const styles = new TextEncoder().encode(css);
  const add = (name: string, body: Uint8Array<ArrayBuffer>): string => {
    const path = `/assets/${name}-${Bun.hash(body).toString(36)}.css`;
    files.push({ path, body, type: "text/css; charset=utf-8" });
    return path;
  };
  return { files, client, styles: add("styles", styles) };
}
