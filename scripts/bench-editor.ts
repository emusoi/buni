// bun scripts/bench-editor.ts path/to/large.buni [runs]
// Writes stay in memory: the supplied design is never edited.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { parseDoc, validateDoc } from "../src/format/parse.ts";
import { serializeDoc } from "../src/format/serialize.ts";
import { renderComponent, renderPage } from "../src/tools/html.ts";
import { Workspace, type Store } from "../src/tools/workspace.ts";
import { Tokens } from "../src/editor/renderer/Tokens.tsx";
import { resolve } from "node:path";

const given = process.argv[2];
if (!given) throw new Error("usage: bun scripts/bench-editor.ts design.buni [runs]");
const file = resolve(given);
const runs = Number(process.argv[3] ?? 3);
if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a positive integer");
const times = new Map<string, number[]>();
async function measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const samples = times.get(name) ?? [];
  samples.push(performance.now() - start);
  times.set(name, samples);
  return result;
}
const text = await Bun.file(file).text();
const parsed = await measure("parse", () => parseDoc(text));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const doc = parsed.doc;
let htmlChars = 0;
let cssChars = 0;
for (let i = 0; i < runs; i++) {
  await measure("validate", () => validateDoc(doc));
  await measure("serialize", () => serializeDoc(doc));
  await measure("snapshot_gzip", () => Bun.gzipSync(JSON.stringify({ view: doc }), { level: 6 }));
  htmlChars = 0;
  cssChars = 0;
  await measure("render_boards", () => {
    // Measure without retaining every rendered board at once.
    for (const [ids, render] of [[Object.keys(doc.pages), renderPage], [Object.keys(doc.shared), renderComponent]] as const) {
      for (const id of ids) {
        const output = render(doc, id);
        htmlChars += output.html.length;
        cssChars += output.css.length;
      }
    }
  });
  await measure("token_panel", () => renderToString(createElement(Tokens, { doc, onError: () => {} })));
  Bun.gc(true);
}
const memory = new Map([[file, text]]);
const store: Store = {
  read: async path => memory.get(path) ?? await Bun.file(path).text(),
  write: async (path, value) => void memory.set(path, value),
  remove: async path => void memory.delete(path),
};
const workspace = await measure("workspace_open", () => Workspace.open(file, store));
for (let i = 0; i < runs; i++) {
  const result = await measure("token_edit", () => workspace.call("benchmark", "tokens", { set: { "--buni-benchmark": `${i}px` } }));
  if (!result.ok) throw new Error(result.reply);
}
const timings = Object.fromEntries([...times].map(([name, samples]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return [name, { samplesMs: samples, medianMs: sorted[Math.floor(sorted.length / 2)] }];
}));
console.log(JSON.stringify({ file, fileBytes: Buffer.byteLength(text), pages: Object.keys(doc.pages).length,
  components: Object.keys(doc.shared).length, nodes: Object.keys(doc.nodes).length, tokens: Object.keys(doc.tokens).length,
  htmlChars, cssChars, timings }, undefined, 2));
