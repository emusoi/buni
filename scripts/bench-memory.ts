// bun scripts/bench-memory.ts path/to/large.buni
// Measure one retained design after releasing the input text; never edits the file.
import { gcAndSweep, heapStats } from "bun:jsc";
import { resolve } from "node:path";
import { parseDoc } from "../src/format/parse.ts";
import type { Doc } from "../src/format/doc.ts";

const given = process.argv[2];
if (!given) throw new Error("usage: bun scripts/bench-memory.ts design.buni");
const file = resolve(given);
gcAndSweep();
const before = heapStats().heapSize;
const start = performance.now();
async function read(): Promise<Doc> {
  const result = parseDoc(await Bun.file(file).text());
  if (!result.ok) throw new Error(JSON.stringify(result.errors.slice(0, 3)));
  return result.doc;
}
const doc = await read();
const parseMs = performance.now() - start;
await Bun.sleep(1);
gcAndSweep();
const heap = heapStats();
console.log(JSON.stringify({ file, fileBytes: Bun.file(file).size, parseMs,
  pages: Object.keys(doc.pages).length, components: Object.keys(doc.shared).length,
  nodes: Object.keys(doc.nodes).length, retainedHeapBytes: heap.heapSize - before,
  heapBytes: heap.heapSize, rssBytes: process.memoryUsage().rss }, undefined, 2));
