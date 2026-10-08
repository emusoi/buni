import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Doc, TextNode } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { append, propose, settle, view, type Change, type ChangeSet, type Session } from "./oplog.ts";

function example(): Doc {
  const r = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
  if (!r.ok) throw new Error("example is invalid");
  return r.doc;
}

function text(doc: Doc, id: string): TextNode {
  const n = doc.nodes[id];
  if (n?.kind !== "text") throw new Error(`${id} is not a text node`);
  return n;
}

const headline = (doc: Doc): TextNode => text(doc, "home-headline");

function restyle(id: string, label: string, doc: Doc, style: Record<string, string>): Change {
  const n = text(doc, id);
  return { id, label, ops: [{ kind: "put", collection: "nodes", value: { ...n, style: { ...n.style, ...style } } }] };
}

const toggle: TextNode = {
  id: "billing-toggle", kind: "text", parent: "pricing-frame", index: "a2", name: "Billing toggle", style: {}, text: "Monthly · Yearly −20%",
};

function pricingTiers(doc: Doc): ChangeSet {
  return {
    id: "pricing-tiers",
    author: "pi",
    prompt: "Make the middle plan the obvious pick and add yearly billing.",
    changes: [
      { ...restyle("home-headline", "Heading size", doc, { fontSize: "34px" }), id: "heading" },
      { id: "toggle", label: "Billing toggle", ops: [{ kind: "put", collection: "nodes", value: toggle }] },
      { ...restyle("pricing-title", "Title color", doc, { color: "#000" }), id: "title" },
    ],
  };
}

function proposed(session: Session, set: ChangeSet): Session {
  const r = propose(session, set);
  if (!r.ok) throw new Error(JSON.stringify(r.rejected));
  return r.session;
}

describe("propose", () => {
  test("pending work shows in the view but not in the base", () => {
    const base = example();
    const s = proposed({ base, pending: [] }, pricingTiers(base));
    expect(headline(view(s).doc).style.fontSize).toBe("34px");
    expect(headline(s.base).style.fontSize).toBe("44px");
  });

  test("a change that breaks the document is refused, with the reason", () => {
    const base = example();
    const bad: ChangeSet = {
      id: "bad", author: "pi",
      changes: [{ id: "orphan", label: "Orphan", ops: [{ kind: "put", collection: "nodes", value: { ...toggle, parent: "ghost" } }] }],
    };
    const r = propose({ base, pending: [] }, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejected[0]?.change).toBe("orphan");
      expect(r.rejected[0]?.errors).toContainEqual({ path: "nodes.billing-toggle.parent", message: 'parent "ghost" does not exist' });
    }
  });

  test("the same change set can't be pending twice", () => {
    const base = example();
    const s = proposed({ base, pending: [] }, pricingTiers(base));
    expect(propose(s, pricingTiers(base)).ok).toBe(false);
  });
});

describe("append", () => {
  test("tool calls grow one set, one change each, and each must still apply", () => {
    const base = example();
    const meta = { id: "pi-1", author: "pi" };
    const first = append({ base, pending: [] }, meta, { id: "add", label: "Add toggle", ops: [{ kind: "put", collection: "nodes", value: toggle }] });
    if (!first.ok) throw new Error("first append failed");
    const second = append(first.session, meta, {
      id: "note", label: "Explain toggle",
      ops: [{ kind: "put", collection: "comments", value: { id: "c2", node: "billing-toggle", state: "open", posts: [{ author: "pi", body: "Yearly saves 20%.", at: "2026-09-23T10:00:00Z" }] } }],
    });
    if (!second.ok) throw new Error("second append failed");
    expect(second.session.pending.map((s) => s.changes.map((c) => c.id))).toEqual([["add", "note"]]);

    const broken = append(second.session, meta, { id: "bad", label: "Bad", ops: [{ kind: "delete", collection: "nodes", id: "pricing-frame" }] });
    expect(broken.ok).toBe(false);
    expect(append(second.session, meta, { id: "add", label: "Again", ops: [] }).ok).toBe(false);
  });
});

describe("settle", () => {
  test("keeps only the chosen changes, in order", () => {
    const base = example();
    const s = proposed({ base, pending: [] }, pricingTiers(base));
    const { base: next, session, dropped } = settle(s, "pricing-tiers", ["heading", "toggle"]);
    expect(dropped).toEqual([]);
    expect(headline(next).style.fontSize).toBe("34px");
    expect(next.nodes["billing-toggle"]).toEqual(toggle);
    expect(text(next, "pricing-title").style.color).toBeUndefined();
    expect(session.pending).toEqual([]);
  });

  test("a kept change that needs a dropped one is dropped too, never left half-applied", () => {
    const base = example();
    const set: ChangeSet = {
      id: "s", author: "pi",
      changes: [
        { id: "add", label: "Add toggle", ops: [{ kind: "put", collection: "nodes", value: toggle }] },
        { id: "note", label: "Explain toggle", ops: [{ kind: "put", collection: "comments", value: { id: "c2", node: "billing-toggle", state: "open", posts: [{ author: "pi", body: "Yearly saves 20%.", at: "2026-09-23T10:00:00Z" }] } }] },
        restyle("home-headline", "Heading size", base, { fontSize: "34px" }),
      ],
    };
    const s = proposed({ base, pending: [] }, set);
    const { base: next, dropped } = settle(s, "s", ["note", "home-headline"]);
    expect(dropped.map((d) => d.change)).toEqual(["note"]);
    expect(next.comments.c2).toBeUndefined();
    expect(next.nodes["billing-toggle"]).toBeUndefined();
    expect(headline(next).style.fontSize).toBe("34px");
  });

  test("other pending sets survive, and must be settled in dependency order", () => {
    const base = example();
    const addToggle: ChangeSet = { id: "a", author: "pi-1", changes: [{ id: "add", label: "Add toggle", ops: [{ kind: "put", collection: "nodes", value: toggle }] }] };
    const s1 = proposed({ base, pending: [] }, addToggle);
    const comment: ChangeSet = {
      id: "b", author: "Jones",
      changes: [{ id: "note", label: "Comment", ops: [{ kind: "put", collection: "comments", value: { id: "c2", node: "billing-toggle", state: "open", posts: [{ author: "Jones", body: "Yearly first?", at: "2026-09-23T10:00:00Z" }] } }] }],
    };
    const s2 = proposed(s1, comment);

    const early = settle(s2, "b", ["note"]);
    expect(early.dropped.map((d) => d.change)).toEqual(["note"]);

    const first = settle(s2, "a", ["add"]);
    expect(first.session.pending.map((p) => p.id)).toEqual(["b"]);
    expect(view(first.session).rejected).toEqual([]);
    const second = settle(first.session, "b", ["note"]);
    expect(second.dropped).toEqual([]);
    expect(second.base.comments.c2?.node).toBe("billing-toggle");
  });

  test("tokens and deletes", () => {
    const base = example();
    const set: ChangeSet = {
      id: "t", author: "Jones",
      changes: [
        { id: "tok", label: "Accent", ops: [{ kind: "token", name: "--color-accent", value: "#2433A6" }, { kind: "token", name: "--color-ink" }] },
        { id: "del", label: "Remove comment", ops: [{ kind: "delete", collection: "comments", id: "c1" }] },
      ],
    };
    const { base: next } = settle(proposed({ base, pending: [] }, set), "t", ["tok", "del"]);
    expect(next.tokens).toEqual({ "--color-paper": "#FFFFFF", "--color-accent": "#2433A6" });
    expect(next.comments.c1).toBeUndefined();
  });

  test("the document changes are made from is left as it was", () => {
    const base = example();
    const before = structuredClone(base);
    const set: ChangeSet = {
      id: "t", author: "Jones",
      changes: [
        { id: "tok", label: "Accent", ops: [{ kind: "token", name: "--color-accent", value: "#2433A6" }] },
        { id: "del", label: "Remove comment", ops: [{ kind: "delete", collection: "comments", id: "c1" }] },
        { ...restyle("home-headline", "Heading size", base, { fontSize: "34px" }), id: "heading" },
      ],
    };
    const { base: next } = settle(proposed({ base, pending: [] }, set), "t", ["tok", "del", "heading"]);
    expect(base).toEqual(before);
    // Untouched collections are shared, not copied.
    expect(next.pages).toBe(base.pages);
  });
});
