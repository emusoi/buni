// bun scripts/stress-design.ts /tmp/buni-stress/design.buni [pages]
// Reproducible canvas stress fixture; use with bench-editor.ts and profile-editor.ts.
import { emptyDoc } from "../src/format/doc.ts";
import { validateDoc } from "../src/format/parse.ts";
import { serializeDoc } from "../src/format/serialize.ts";
import { generateNKeysBetween } from "fractional-indexing";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const target = process.argv[2];
const count = Number(process.argv[3] ?? 1000);
if (!target || !Number.isInteger(count) || count < 2 || count > 10000) throw new Error("usage: stress-design.ts output.buni [2–10000 pages]");
const doc = emptyDoc();
doc.tokens["--accent"] = "#345c55";
const order = generateNKeysBetween(null, null, count);
const layers = generateNKeysBetween(null, null, 31);
const columns = Math.ceil(Math.sqrt(count * 900 / 1280));
for (let i = 0; i < count; i++) {
  const id = `screen-${i}`;
  const root = `frame-${i}`;
  doc.pages[id] = { id, frame: root, name: `Screen ${i + 1}`, route: `/screen-${i + 1}`, index: order[i]!, x: (i % columns) * 1440, y: Math.floor(i / columns) * 1120, widths: [390] };
  doc.nodes[root] = { id: root, kind: "frame", name: `Screen ${i + 1}`, index: "a0", style: { width: "1280px", height: "900px", padding: "32px", background: "#f4f6f5", fontFamily: "Arial", display: "flex", flexDirection: "column", gap: "8px" }, at: { "390": { background: "#dbeafe", padding: "16px" } } };
  for (let j = 0; j < 30; j++) {
    const node = `text-${i}-${j}`;
    doc.nodes[node] = { id: node, kind: "text", parent: root, index: layers[j]!, name: j ? `Row ${j}` : `Heading ${i + 1}`, tag: j ? "p" : "h1", text: j ? `Order ${i * 30 + j} · Scheduled · Warehouse ${j % 5 + 1}` : `Screen ${i + 1}`, style: { margin: "0", fontSize: j ? "16px" : "32px", color: j ? "#273f39" : "var(--accent)", ...(j ? { background: "white", padding: "3px 12px" } : {}) } };
  }
  const button = `next-${i}`;
  doc.nodes[button] = { id: button, kind: "text", parent: root, index: layers[30]!, name: "Next screen", tag: "button", text: "Next screen", style: { background: "var(--accent)", color: "white", padding: "12px", border: "none" } };
  const link = `connection-${i}`;
  doc.connections[link] = { id: link, page: id, node: button, to: `screen-${(i + 1) % count}`, trigger: "click", transition: "none", durationMs: 0 };
}
const errors = validateDoc(doc);
if (errors.length) throw new Error(JSON.stringify(errors));
const file = resolve(target);
await mkdir(dirname(file), { recursive: true });
await writeFile(file, serializeDoc(doc), { flag: "wx" });
console.log(JSON.stringify({ file, pages: count, nodes: Object.keys(doc.nodes).length, connections: count }));
