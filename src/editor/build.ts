import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface EditorSource {
  path: string;
  body: Uint8Array<ArrayBuffer>;
  type: string;
}

export interface EditorSources {
  files: EditorSource[];
  client: string;
  styles: string;
  xyflow: string;
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
  const css = (await Bun.file(join(import.meta.dir, "renderer/styles.css")).text()).replaceAll('url("fonts/', 'url("/fonts/');
  const styles = new TextEncoder().encode(css);
  const xyflow = await Bun.file(fileURLToPath(import.meta.resolve("@xyflow/react/dist/style.css"))).bytes();
  const add = (name: string, body: Uint8Array<ArrayBuffer>): string => {
    const path = `/assets/${name}-${Bun.hash(body).toString(36)}.css`;
    files.push({ path, body, type: "text/css; charset=utf-8" });
    return path;
  };
  return { files, client, styles: add("styles", styles), xyflow: add("xyflow", xyflow) };
}
