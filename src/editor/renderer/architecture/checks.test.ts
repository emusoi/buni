import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { architectureOf, emptyArchitecture, emptyDoc, type Doc } from "buni/format/doc.ts";
import { checkArchitecture } from "buni/tools/arch-check.ts";
import { Workspace } from "buni/tools/workspace.ts";
import { findingsAbout, noticeFor, placeFor } from "./checks.ts";

function shop(): Doc {
  return {
    ...emptyDoc(),
    architecture: {
      ...emptyArchitecture(),
      parts: {
        api: { id: "api", name: "API", kind: "service", build: { repo: "github.com/acme/shop", path: "api/", steps: ["test"] } },
        db: { id: "db", name: "DB", kind: "store", managed: "RDS" },
      },
      links: { l: { id: "l", from: "api", to: "db", kind: "writes" } },
      clusters: { k: { id: "k", name: "Kind", provider: "kind" } },
      environments: {
        dev: { id: "dev", name: "dev", order: 1, cluster: "k" },
        prod: { id: "prod", name: "prod", order: 2, cluster: "k" },
      },
      namespaces: { ns: { id: "ns", cluster: "k", name: "shop" } },
      workloads: {
        w: { id: "w", part: "api", environment: "dev", namespace: "ns", kind: "Deployment", replicas: { min: 2 }, resources: { cpu: "100m", memory: "128Mi" }, service: { port: 3000 } },
        wp: { id: "wp", part: "api", environment: "prod", namespace: "ns", kind: "Deployment", replicas: { min: 2 }, resources: { cpu: "100m", memory: "128Mi", limitCpu: "500m", limitMemory: "256Mi" }, probes: { ready: "/health", live: "/live" }, service: { port: 3000 } },
      },
    },
  };
}

test("a part carries this environment's workloads, and a chip beside a card is not marked again", () => {
  const doc = shop();
  const arch = architectureOf(doc);
  const findings = checkArchitecture(doc);
  const dev = findingsAbout(arch, "api", findings, "dev");
  expect(dev.some((f) => f.id === "w" && f.rule === "no-probes" && f.apply?.tool === "set_workload")).toBe(true);
  expect(dev.some((f) => f.id === "wp")).toBe(false);
  const onWorkload = findingsAbout(arch, "w", findings, "dev");
  expect(onWorkload.some((f) => f.rule === "no-probes")).toBe(true);
  expect(onWorkload.some((f) => f.id === "api")).toBe(true);
  expect(noticeFor(arch, { ids: ["w"] }, findings, "dev")?.severity).toBe("p2");
  expect(noticeFor(arch, { ids: [] }, findings, "dev")).toBeUndefined();
});

test("a finding opens on the view that draws its thing", () => {
  const arch = architectureOf(shop());
  expect(placeFor(arch, "w")).toEqual({ view: "map", level: "runtime", env: "dev" });
  expect(placeFor(arch, "api")).toEqual({ view: "map", level: "system" });
  expect(placeFor(arch, "l")).toEqual({ view: "map", level: "system" });
  expect(placeFor(arch, "k")).toEqual({ view: "kubernetes", env: "dev" });
  expect(placeFor(arch, "ns")).toEqual({ view: "kubernetes", env: "dev" });
  expect(placeFor(arch, "prod")).toEqual({ view: "deploy", env: "prod" });
  arch.parts.dns = { id: "dns", name: "DNS", kind: "edge" };
  arch.links.edge = { id: "edge", from: "dns", to: "api", kind: "routes" };
  expect(placeFor(arch, "dns")).toEqual({ view: "map", level: "runtime" });
  expect(placeFor(arch, "edge")).toEqual({ view: "map", level: "runtime" });
  arch.releases.v = { id: "v", name: "v", parts: ["api"], path: ["dev"], strategy: { kind: "rolling" } };
  expect(placeFor(arch, "v")).toEqual({ view: "deploy" });
  arch.plays.go = { id: "go", name: "Ship", kind: "release", release: "v", steps: [] };
  expect(placeFor(arch, "v")).toEqual({ view: "flows", play: "go" });
  expect(placeFor(arch, "go")).toEqual({ view: "flows", play: "go" });
  arch.plans.credit = { id: "credit", name: "Credit" };
  expect(placeFor(arch, "credit")).toEqual({ view: "proposals", plan: "credit" });
  arch.stages.idea = { id: "idea", name: "Idea", order: 1 };
  expect(placeFor(arch, "idea")).toEqual({ view: "software" });
  arch.migrations.m = { id: "m", name: "m", store: "db", change: "add", safe: "additive" };
  expect(placeFor(arch, "m")).toEqual({ view: "deploy" });
  expect(placeFor(arch, "nope")).toBeUndefined();
});

test("Fix is a call the tools accept, and the finding leaves once it lands", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "buni-arch-check-")), "parcel.buni");
  await copyFile(new URL(import.meta.resolve("buni/examples/parcel.buni")).pathname, file);
  const ws = await Workspace.open(file);
  expect((await ws.call("you", "set_workload", { id: "returns-api-prod", probes: null })).ok).toBe(true);
  const found = checkArchitecture(ws.view()).find((f) => f.rule === "no-probes" && f.id === "returns-api-prod");
  expect(found?.apply?.tool).toBe("set_workload");
  const applied = await ws.call("you", "set_workload", found!.apply!.args);
  expect(applied.ok).toBe(true);
  expect(checkArchitecture(ws.view()).some((f) => f.rule === "no-probes" && f.id === "returns-api-prod")).toBe(false);
});
