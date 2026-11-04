import { expect, test } from "bun:test";
import { emptyDoc, type Doc, type Node } from "buni/format/doc.ts";
import { curvePoints, momentTimes, motionEnd, motionSentence } from "./moments.ts";

const frame = (id: string, parent: string | undefined, index: string, extra: Partial<Node> = {}): Node =>
  ({ id, ...(parent ? { parent } : {}), index, name: id, style: {}, kind: "frame", ...extra }) as Node; // Test fixture

test("a motion reads as one sentence", () => {
  expect(motionSentence({ trigger: "load", effect: "rise", durationMs: 320, easing: "out" })).toBe("On load, rises in over 320 ms, easing out.");
  expect(motionSentence({ trigger: "scroll", effect: "fade", durationMs: 400, delayMs: 100, easing: "in-out", staggerMs: 80 }))
    .toBe("Into view, its children fades in one by one, 80 ms apart, as it scrolls through 400 ms of reading, after 100 ms, easing in-out.");
  expect(motionSentence({ trigger: "hover", effect: "lift", durationMs: 150, easing: "out", curve: "cubic-bezier(0.1, 0.2, 0.3, 1)" })).toBe("On hover, lifts in 150 ms, on its own curve.");
  expect(curvePoints({ easing: "out" })).toEqual([0.22, 1, 0.36, 1]);
  expect(curvePoints({ easing: "out", curve: "cubic-bezier(0.1, 0.2, 0.3, 1)" })).toEqual([0.1, 0.2, 0.3, 1]);
  expect(curvePoints({ easing: "linear" })).toEqual([0, 0, 1, 1]);
});

test("a page's moments run from rest to the last arrival, staggers counted", () => {
  const doc: Doc = { ...emptyDoc(), nodes: {} };
  doc.pages.p = { id: "p", name: "Home", route: "/", frame: "root" } as Doc["pages"][string];
  expect(motionEnd({ ...doc, nodes: { root: frame("root", undefined, "a") } }, "p")).toBe(0);
  doc.nodes.root = frame("root", undefined, "a");
  doc.nodes.hero = frame("hero", "root", "a", { motion: [{ trigger: "load", effect: "rise", durationMs: 600, delayMs: 100, easing: "out" }, { trigger: "hover", effect: "lift", durationMs: 5000, easing: "out" }] });
  doc.nodes.list = frame("list", "root", "b", { motion: [{ trigger: "scroll", effect: "fade", durationMs: 400, easing: "out", staggerMs: 300 }] });
  doc.nodes.one = frame("one", "list", "a");
  doc.nodes.two = frame("two", "list", "b");
  doc.nodes.three = frame("three", "list", "c");
  // hero ends at 700; the list's third child starts 600 late and ends at 1000; hover never counts.
  expect(motionEnd(doc, "p")).toBe(1000);
  expect(momentTimes(1000, 6)).toEqual([0, 200, 400, 600, 800, 1000]);
  expect(momentTimes(700, 1)).toEqual([700]);
});

test("a take's picture fits its card: a wide page by width, a phone screen by height", async () => {
  const { fit } = await import("./TakesSheet.tsx");
  expect(fit(1440, 900)).toEqual({ scale: 212 / 900, w: 339, h: 212 });
  expect(fit(390, 844)).toEqual({ scale: 212 / 844, w: 98, h: 212 });
});

test("a page at one of its versions: the layers then, not the ones added since", async () => {
  const { docAtVersion } = await import("./pageVersions.ts");
  const doc: Doc = { ...emptyDoc(), nodes: {} };
  doc.pages.p = { id: "p", name: "Home", route: "/", frame: "root" } as Doc["pages"][string];
  doc.nodes.root = frame("root", undefined, "a");
  doc.nodes.old = frame("old", "root", "a", { name: "Old" });
  doc.nodes.added = frame("added", "root", "b", { name: "Added since" });
  doc.nodes.elsewhere = frame("elsewhere", undefined, "a");
  const v = { id: "v", page: "p", n: 1, at: "2026-11-04T00:00:00Z", by: "you", nodes: { root: frame("root", undefined, "a"), old: frame("old", "root", "a", { name: "Old as it was" }) } };
  const then = docAtVersion(doc, v);
  expect(Object.keys(then.nodes).sort()).toEqual(["elsewhere", "old", "root"]);
  expect(then.nodes.old?.name).toBe("Old as it was");
  expect(doc.nodes.added).toBeDefined();
});

test("what differs between a page and one of its versions: gone, new, text, style, moved", async () => {
  const { diffVersion, diffCss } = await import("./pageVersions.ts");
  const doc: Doc = { ...emptyDoc(), nodes: {} };
  doc.pages.p = { id: "p", name: "Home", route: "/", frame: "root" } as Doc["pages"][string];
  doc.nodes.root = frame("root", undefined, "a");
  doc.nodes.title = { id: "title", parent: "root", index: "a", name: "Title", style: { color: "red" }, kind: "text", text: "Now" } as Node;
  doc.nodes.added = frame("added", "root", "b", { name: "Added" });
  doc.nodes.moved = frame("moved", "root", "c", { name: "Moved" });
  const v = { id: "v", page: "p", n: 1, at: "2026-11-04T00:00:00Z", by: "you", nodes: {
    root: frame("root", undefined, "a"),
    title: { id: "title", parent: "root", index: "a", name: "Title", style: { color: "blue" }, kind: "text", text: "Then" } as Node,
    gone: frame("gone", "root", "b", { name: "Gone" }),
    moved: frame("moved", "root", "a0", { name: "Moved" }),
  } };
  const d = diffVersion(doc, v);
  expect(d.added.map((n) => n.name)).toEqual(["Added"]);
  expect(d.removed.map((n) => n.name)).toEqual(["Gone"]);
  expect(d.changed.map((c) => [c.node.name, c.what])).toEqual([["Title", "text · color"], ["Moved", "moved"]]);
  expect(diffCss(d, "then")).toContain(".b-gone{");
  expect(diffCss(d, "then")).not.toContain(".b-added{");
  expect(diffCss(d, "now")).toContain(".b-added{");
});
