// Builds the buni command as one self-contained file: bun scripts/compile.ts [target] [outfile]
// target is a Bun compile target (bun-darwin-arm64, bun-darwin-x64, bun-linux-x64, bun-linux-arm64); default: this machine.

/** The platforms buni is released for. */
const TARGETS: readonly Bun.Build.CompileTarget[] = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64", "bun-linux-arm64"];
const [given, outfile = "dist/buni"] = process.argv.slice(2);
const target = TARGETS.find((t) => t === given);
if (given && !target) throw new Error(`unknown target "${given}"; one of ${TARGETS.join(", ")}`);

const r = await Bun.build({
  entrypoints: ["src/cli.ts"],
  compile: { ...(target ? { target } : {}), outfile },
  minify: true,
});
if (!r.success) {
  for (const log of r.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${outfile}${target ? ` for ${target}` : ""}`);
