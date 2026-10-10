import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Doc, Node } from "buni/format/doc.ts";
import { parseDoc } from "buni/format/parse.ts";
import { applyChange, type Op } from "buni/oplog/oplog.ts";
import { touchedBoards } from "./Canvas.tsx";

const base = (() => {
  const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
  if (!r.ok) throw new Error("example is invalid");
  return r.doc;
})();

function edited(ops: Op[]): Doc {
  const r = applyChange(base, { id: "c", label: "edit", ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
}
const restyle = (n: Node | undefined): Op => {
  if (!n) throw new Error("no such node");
  return { kind: "put", collection: "nodes", value: { ...n, style: { ...n.style, color: "#000" } } };
};

test("an edit redraws only the boards it touched", () => {
  expect(touchedBoards(base, edited([restyle(base.nodes["home-headline"])]))).toEqual(new Set(["home"]));
  expect(touchedBoards(base, edited([{ kind: "delete", collection: "comments", id: "c1" }, { kind: "delete", collection: "nodes", id: "home-headline" }]))).toEqual(new Set(["home"]));
  expect(touchedBoards(base, edited([{ kind: "delete", collection: "comments", id: "c1" }]))).toEqual(new Set());
  // Tokens and components show on every board.
  expect(touchedBoards(base, edited([{ kind: "token", name: "--color-ink", value: "#111" }]))).toBeUndefined();
  expect(touchedBoards(base, edited([restyle(base.nodes["nav-root"])]))).toBeUndefined();
});
