import { captureSource } from "../src/term/capture-build.ts";
import { editorSources } from "../src/editor/build.ts";
// Builds the buni command as one self-contained file: bun scripts/compile.ts [target] [outfile]
// target is a Bun compile target (bun-darwin-arm64, bun-darwin-x64, bun-linux-x64, bun-linux-arm64); default: this machine.

/** The platforms buni is released for. */
const TARGETS: readonly Bun.Build.CompileTarget[] = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64", "bun-linux-arm64"];
const [given, outfile = "dist/buni"] = process.argv.slice(2);
const target = TARGETS.find((t) => t === given);
if (given && !target) throw new Error(`unknown target "${given}"; one of ${TARGETS.join(", ")}`);

const capture = await captureSource();
const sources = await editorSources();
const embedded = JSON.stringify({ ...sources, files: sources.files.map(({ body, ...file }) => ({ ...file, body: Buffer.from(body).toString("base64") })) });

const r = await Bun.build({
  entrypoints: ["src/cli.ts"],
  compile: { ...(target ? { target } : {}), outfile },
  minify: true,
  plugins: [{
    name: "embedded-editor",
    setup(build) {
      build.onLoad({ filter: /[/\\]term[/\\]capture-build\.ts$/ }, () => ({
        contents: `export async function captureSource() { return ${JSON.stringify(capture)}; }`, loader: "js",
      }));
      build.onLoad({ filter: /[/\\]editor[/\\]build\.ts$/ }, () => ({
        contents: `export async function editorSources() { const source = ${embedded}; return { ...source, files: source.files.map(file => ({ ...file, body: Uint8Array.fromBase64(file.body) })) }; }`,
        loader: "js",
      }));
    },
  }],
});
if (!r.success) {
  for (const log of r.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${outfile}${target ? ` for ${target}` : ""}`);
