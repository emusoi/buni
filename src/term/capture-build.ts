import { join } from "node:path";

/** The editor's converter, also embedded in the standalone command. */
export async function captureSource(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "../editor/renderer/capture-agent.ts")],
    target: "browser", format: "iife", minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "building the HTML converter failed");
  return result.outputs[0]!.text();
}
