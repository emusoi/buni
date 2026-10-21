import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDoc } from "buni/format/parse.ts";
import { architectureOf, type Architecture } from "buni/format/doc.ts";
import { codeLayout, columnsOf, route, routeLinks, runtimeLayout, systemLayout, type MapBox, type MapLayout, type Rect } from "./layout.ts";
import { planChanges } from "./Proposals.tsx";
import { canaryAt, cardHeight, cronText, environmentOf, flowLook, payloadOf, previousVersion } from "./model.ts";

const r = parseDoc(readFileSync(new URL(import.meta.resolve("buni/examples/parcel.buni")), "utf8"));
if (!r.ok) throw new Error("example does not parse");
const arch: Architecture = architectureOf(r.doc);
const prod = environmentOf(arch, "prod");

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const orthogonal = (l: MapLayout) => l.links.every((x) => x.points.every((p, i) => i === 0 || p[0] === x.points[i - 1]![0] || p[1] === x.points[i - 1]![1]));
const box = (l: MapLayout, key: string) => l.boxes.find((b) => b.key === key);

test("every level lays out the same way twice, with no card over another and every link at right angles", () => {
  for (const make of [() => systemLayout(arch), () => runtimeLayout(arch, prod), () => codeLayout(arch, prod)]) {
    const [a, b] = [make(), make()];
    expect(a).toEqual(b);
    for (const [i, x] of a.boxes.entries()) for (const y of a.boxes.slice(i + 1)) expect(overlap(x, y)).toBe(false);
    expect(orthogonal(a)).toBe(true);
    expect(a.links.length).toBeGreaterThan(0);
  }
});

test("system columns follow the data: a client before its API, a subscriber after its queue, the database last", () => {
  const parts = Object.values(arch.parts).filter((p) => p.group);
  const col = columnsOf(parts, Object.values(arch.links));
  expect(col.get("buyer-portal")).toBe(0);
  expect(col.get("returns-api")).toBe(1);
  expect(col.get("worker")!).toBeGreaterThanOrEqual(col.get("jobs")!);
  expect(col.get("main-database")).toBe(Math.max(...col.values()));
  const sys = systemLayout(arch);
  // Outside services sit below the group; edge parts aren't on the system map.
  const frame = sys.frames[0]!;
  expect(box(sys, "shippo")!.y).toBeGreaterThan(frame.y + frame.h);
  expect(box(sys, "alb")).toBeUndefined();
  expect(box(sys, "credit-ledger")!.card.tone).toBe("planned");
});

test("runtime: edge on the left, workloads inside their namespace inside the cluster, managed services to the right", () => {
  const rt = runtimeLayout(arch, prod);
  const cluster = rt.frames.find((f) => f.key === "eks-prod")!;
  const inside = (b: MapBox | undefined, f: Rect) => b !== undefined && b.x >= f.x && b.x + b.w <= f.x + f.w && b.y >= f.y && b.y + b.h <= f.y + f.h;
  expect(box(rt, "alb")!.x + box(rt, "alb")!.w).toBeLessThan(cluster.x);
  expect(inside(box(rt, "returns-api-prod"), rt.frames.find((f) => f.key === "eks-prod-returns")!)).toBe(true);
  expect(inside(box(rt, "worker-prod"), cluster)).toBe(true);
  expect(box(rt, "main-database")!.x).toBeGreaterThan(cluster.x + cluster.w);
  // Staging's workloads aren't on prod's map; the migration job is drawn to run at deploy, linked to what it migrates.
  expect(box(rt, "returns-api-staging")).toBeUndefined();
  expect(box(rt, "db-migrate-prod")!.card.tone).toBe("deploy");
  expect(rt.links.find((l) => l.from === "db-migrate-prod" && l.to === "main-database")?.tone).toBe("deploy");
  // The edge's chain reaches the API through its Ingress.
  expect(rt.links.find((l) => l.key === "alb-routes-returns-api")?.to).toBe("returns-api-prod#ingress");
  // Selecting the part lights its serving workload, not its migration job.
  expect(box(rt, "returns-api-prod")!.ids).toContain("returns-api");
  expect(box(rt, "db-migrate-prod")!.ids).not.toContain("returns-api");
});

test("a route goes round a box in its way", () => {
  const blocker: Rect = { x: 100, y: -20, w: 50, h: 60 };
  const pts = route([0, 10], [300, 10], "right", 200, [blocker]);
  expect(pts.length).toBeGreaterThan(2);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const crosses = Math.max(a[0], b[0]) > blocker.x && Math.min(a[0], b[0]) < blocker.x + blocker.w && Math.max(a[1], b[1]) > blocker.y && Math.min(a[1], b[1]) < blocker.y + blocker.h;
    expect(crosses).toBe(false);
  }
});

test("links leaving one side share it, and links across one gap turn in lanes of their own", () => {
  const card = { label: "", name: "", tone: "live" as const };
  const boxes: MapBox[] = [
    { key: "a", ids: [], card, x: 0, y: 0, w: 100, h: 60 },
    { key: "b", ids: [], card, x: 300, y: -100, w: 100, h: 60 },
    { key: "c", ids: [], card, x: 300, y: 100, w: 100, h: 60 },
  ];
  const [ab, ac] = routeLinks(boxes, [{ key: "ab", ids: [], from: "a", to: "b", tone: "live" }, { key: "ac", ids: [], from: "a", to: "c", tone: "live" }]);
  expect(ab!.points[0]![1]).toBeLessThan(ac!.points[0]![1]);
  expect(ab!.points[1]![0]).not.toBe(ac!.points[1]![0]);
});

test("model text: cron, versions, canary steps, card heights", () => {
  expect(cronText("0 2 * * *")).toBe("02:00 UTC");
  expect(cronText("*/5 * * * *")).toBe("*/5 * * * *");
  expect(previousVersion("v42")).toBe("v41");
  const play = arch.plays["release-v42"]!;
  expect([4, 5, 6].map((i) => canaryAt(arch, play, i)?.percent)).toEqual([10, 50, 100]);
  expect(canaryAt(arch, play, 0)).toBeUndefined();
  const small = cardHeight({ label: "x", name: "y", tone: "live" }, 200);
  expect(cardHeight({ label: "x", name: "y", chips: [["a", "b"]], tone: "live" }, 200)).toBeGreaterThan(small);
});

test("a request lights its whole path, numbered where each hop lands; a release lights only the step it is on", () => {
  const req = flowLook(arch, arch.plays["buyer-starts-a-return"]!, 2, true);
  expect(req.lit.has("worker-calls-shippo")).toBe(true);
  expect(req.badges.get("jobs")).toBe(3);
  expect(req.badges.get("shippo")).toBe(5);
  const rel = flowLook(arch, arch.plays["release-v42"]!, 4, false);
  expect([...rel.lit]).toEqual(["returns-api-prod"]);
  expect(rel.shown.has("db-migrate-prod")).toBe(true);
  expect(rel.shown.has("worker-prod")).toBe(false);
  // On the System map a touched workload lights its part.
  expect(flowLook(arch, arch.plays["release-v42"]!, 4, true).lit.has("returns-api")).toBe(true);
  expect(payloadOf("publishes RefundJob { returnId, amount, reason }")).toBe("RefundJob { returnId, amount, reason }");
});

test("a proposal draws its plan's additions as added, and lists them", () => {
  const sys = systemLayout(arch, "store-credit");
  expect(box(sys, "credit-ledger")!.card.tone).toBe("added");
  expect(sys.links.find((l) => l.key === "credit-ledger-writes-main-database")?.tone).toBe("added");
  expect(box(sys, "returns-api")!.card.tone).toBe("live");
  const changes = planChanges(arch, "store-credit");
  expect(changes.length).toBeGreaterThan(0);
  expect(changes.every((c) => c.added)).toBe(true);
  expect(changes.some((c) => c.text.startsWith("Credit ledger, a new"))).toBe(true);
});

test("a part just added, in no group and linked to nothing, still shows on the System map", () => {
  const fresh = { ...arch, parts: { ...arch.parts, lone: { id: "lone", name: "Lone", kind: "service" as const } } };
  expect(box(systemLayout(fresh), "lone")).toBeDefined();
  // Managed services nothing links to (the registry, the vault) stay off it, as before.
  expect(box(systemLayout(arch), "ecr")).toBeUndefined();
});
