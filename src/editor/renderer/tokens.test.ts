import { expect, test } from "bun:test";
import { emptyDoc, type Node } from "buni/format/doc.ts";
import { tokenUses } from "./Tokens.tsx";

test("token counts match the number of layers with exact references", () => {
  const doc = emptyDoc();
  const node = (id: string, style: Node["style"]): Node => ({ id, kind: "frame", name: id, index: "a0", style });
  doc.nodes = {
    a: node("a", { color: "var(--ink)", border: "1px solid var(--ink)", background: "linear-gradient(var(--paper), var(--ink))" }),
    b: node("b", { color: "var(--ink-light)", fontFamily: "var(--font)", padding: "var(--gap) var(--gap)" }),
    c: node("c", { color: "var(--ink)", background: "var(--paper, white)" }),
    d: node("d", {}),
  };
  const counts = tokenUses(doc.nodes);
  expect(counts.get("--ink")).toBe(2);
  expect(counts.get("--paper")).toBe(1);
  expect(counts.get("--ink-light")).toBe(1);
  expect(counts.get("--gap")).toBe(1);
  expect(counts.get("--font")).toBe(1);
  expect(counts.get("--unused")).toBeUndefined();
  for (const name of counts.keys()) {
    const before = Object.values(doc.nodes).filter(n => Object.values(n.style).some(v => v.includes(`var(${name})`))).length;
    expect(counts.get(name)).toBe(before);
  }
});
