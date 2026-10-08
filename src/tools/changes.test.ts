import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "../format/parse.ts";
import { systemChanges } from "./changes.ts";

test("changes since a version: added, changed and removed, ignoring where cards sit", () => {
  const r = parseDoc(readFileSync(new URL("../../examples/portal.buni", import.meta.url), "utf8"));
  if (!r.ok) throw new Error("bad example");
  const before = r.doc;
  const after = structuredClone(before);
  after.parts["pg"] = { ...after.parts["pg"]!, x: 999, y: 1 };
  after.parts["jobs"] = { ...after.parts["jobs"]!, tech: "Redis (BullMQ)" };
  delete after.roles["buyer"];
  after.phases["v2"] = { id: "v2", name: "v2", index: "z" };
  expect(systemChanges(before, after)).toEqual([
    { collection: "parts", id: "jobs", name: "Jobs", what: "changed" },
    { collection: "phases", id: "v2", name: "v2", what: "added" },
    { collection: "roles", id: "buyer", name: "buyer", what: "removed" },
  ]);
});
