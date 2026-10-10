import { expect, test } from "bun:test";
import { blocks } from "./Prose.tsx";

test("doc markdown reads as paragraphs and lists", () => {
  expect(blocks("Goals\n- A buyer returns alone.\n- Money never moves twice.\n\nNon-goals for v1\n1. Exchanges\n2. Other platforms")).toEqual([
    { kind: "p", lines: ["Goals"] },
    { kind: "ul", items: ["A buyer returns alone.", "Money never moves twice."] },
    { kind: "p", lines: ["Non-goals for v1"] },
    { kind: "ol", items: ["Exchanges", "Other platforms"] },
  ]);
  expect(blocks("One line\nand the next\n\n\nA new paragraph")).toEqual([{ kind: "p", lines: ["One line", "and the next"] }, { kind: "p", lines: ["A new paragraph"] }]);
});
