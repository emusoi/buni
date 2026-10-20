import { join } from "node:path";

/** A script that runs in a page, built for the browser from the editor's renderer folder. */
async function pageScript(entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "../editor/renderer", entry)],
    target: "browser", format: "iife", minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, `building ${entry} failed`);
  return result.outputs[0]!.text();
}

/** The editor's converter, also embedded in the standalone command. */
export const captureSource = (): Promise<string> => pageScript("capture-agent.ts");
/** The UI review's checks, run in a rendered page. */
export const reviewSource = (): Promise<string> => pageScript("review-agent.ts");
