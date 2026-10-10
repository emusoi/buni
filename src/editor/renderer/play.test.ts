import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { findIssues, firstPage, flowFor, flowSteps, isPrefix, keyLinkFor, notesOn, notesPrompt, type KeyPress } from "./play.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/portal.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");
const doc = r.doc;

test("a page plays in the flow that reaches it, in walking order", () => {
  const flow = flowFor(doc, "pricing");
  expect(flow?.id).toBe("get-a-quote");
  expect(flowSteps(doc, flow, "pricing")).toEqual(["home", "pricing"]);
  expect(flowSteps(doc, undefined, "pricing")).toEqual(["pricing"]);
  // Playing a flow from a page it never reaches starts at the flow's start, not on that page.
  expect([firstPage(doc, flow, "pricing"), firstPage(doc, flow, "elsewhere"), firstPage(doc, undefined, "elsewhere")]).toEqual(["pricing", "home", "elsewhere"]);
});

test("a state reached by a plain link plays as its screen's step, not one of its own", () => {
  const d = structuredClone(doc);
  const pricing = d.pages["pricing"];
  const link = Object.values(d.connections).find((c) => c.page === "home" && c.to === "pricing");
  if (!pricing || !link) throw new Error("the example links home to pricing");
  d.pages["sold-out"] = { ...pricing, id: "sold-out", name: "Pricing, sold out", state: "Sold out" };
  d.connections["to-sold-out"] = { ...link, id: "to-sold-out", node: "pricing", page: "pricing", to: "sold-out" };
  expect(flowSteps(d, flowFor(d, "pricing"), "pricing")).toEqual(["home", "pricing"]);
});

test("issues: a screen with no way back, and a link-looking layer that goes nowhere", () => {
  const issues = findIssues(doc, ["home", "pricing"]);
  expect(issues.map((i) => i.title)).toContain("Pricing has no way back");
  const withDead = structuredClone(doc);
  const cta = withDead.nodes["home-cta"];
  if (cta?.kind === "text") cta.tag = "a";
  withDead.connections = {};
  expect(findIssues(withDead, ["home"]).map((i) => i.node)).toEqual(["home-cta"]);
});

test("open notes on the played pages become one request for the agent", () => {
  const d = structuredClone(doc);
  d.comments = { n1: { id: "n1", node: "home-cta", state: "open", posts: [{ author: "you", body: "Make this bolder", at: "2026-09-24T00:00:00Z" }] } };
  const notes = notesOn(d, ["home", "pricing"]);
  expect(notes.map((n) => n.page)).toEqual(["home"]);
  const text = notesPrompt(d, "Get a quote", notes, []);
  expect(text).toContain("1. Home · ");
  expect(text).toContain("(node home-cta, thread n1): Make this bolder");
});

test("a key press follows the screen's key link, written the way people write keys", () => {
  const links = [{ key: "?", to: "help" }, { key: "C-k", to: "palette" }, { key: "Esc", to: "home" }, { key: "prefix g", to: "agents" }, { key: "shift+tab", to: "back" }];
  const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, ctrl: false, alt: false, shift: false, meta: false, ...mods });
  expect(keyLinkFor(links, press("?", { shift: true }), false)?.to).toBe("help");
  expect(keyLinkFor(links, press("k", { ctrl: true }), false)?.to).toBe("palette");
  expect(keyLinkFor(links, press("Escape"), false)?.to).toBe("home");
  expect(keyLinkFor(links, press("Tab", { shift: true }), false)?.to).toBe("back");
  // A tmux binding answers only after the prefix.
  expect(keyLinkFor(links, press("g"), false)).toBeUndefined();
  expect(isPrefix(press("b", { ctrl: true }))).toBe(true);
  expect(keyLinkFor(links, press("g"), true)?.to).toBe("agents");
});
