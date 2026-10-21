import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyArchitecture, emptyDoc, type Doc } from "../format/doc.ts";
import { parseDoc } from "../format/parse.ts";
import { checkArchitecture, checkText } from "./arch-check.ts";
import { DRAFT, exportArchitecture, yamlFile } from "./arch-export.ts";
import type { YamlMap } from "./yaml.ts";
import { toolNames } from "./tools.ts";
import { Workspace } from "./workspace.ts";

const parcelPath = new URL("../../examples/parcel.buni", import.meta.url).pathname;

function parcel(): Doc {
  const r = parseDoc(readFileSync(parcelPath, "utf8"));
  if (!r.ok) throw new Error("parcel is invalid");
  return r.doc;
}

const noBrief = () => "";

/** One service, one managed database, one workload: small enough to read its manifest whole. */
function shop(): Doc {
  return {
    ...emptyDoc(),
    architecture: {
      ...emptyArchitecture(),
      parts: {
        api: { id: "api", name: "Quote API", kind: "service", build: { repo: "github.com/acme/shop", path: "api/", steps: ["test", "build"], artifact: "api image", registry: "ghcr.io/acme" } },
        db: { id: "db", name: "Main DB", kind: "store", tech: "Postgres 16", managed: "RDS" },
      },
      links: { l: { id: "l", from: "api", to: "db", kind: "writes" } },
      clusters: { k: { id: "k", name: "Kind", provider: "kind" } },
      environments: { dev: { id: "dev", name: "dev", order: 1, cluster: "k" } },
      namespaces: { ns: { id: "ns", cluster: "k", name: "shop" } },
      workloads: {
        w: {
          id: "w", part: "api", environment: "dev", namespace: "ns", kind: "Deployment", image: "api:1", replicas: { min: 2 }, keep: 1,
          resources: { cpu: "100m", memory: "128Mi", limitMemory: "256Mi" }, probes: { ready: "/ready", live: "pgrep node" }, service: { port: 3000 }, config: ["api-config"], egress: ["db"],
        },
      },
    },
  };
}

describe("YAML", () => {
  test("quotes what YAML would misread, and reads back as written", () => {
    const value: YamlMap = { on: "yes", n: "1", flag: "-c", empty: "", colon: "a: b", ref: "${{ github.sha }}", plain: "api:4f2c9a1", script: "set -e\nmake test", list: [], map: {}, deep: [[1, 2], { a: true }] };
    const text = yamlFile(["about"], [{ notes: ["a note"], value }, { value: { b: 2 } }]);
    expect(text.split("\n").slice(0, 3)).toEqual([`# ${DRAFT}`, "# about", "# a note"]);
    expect(text).toContain('"on": "yes"\n"n": "1"\nflag: "-c"\nempty: ""\ncolon: "a: b"');
    expect(text).toContain("plain: api:4f2c9a1\nscript: |-\n  set -e\n  make test\n");
    expect(Bun.YAML.parse(text)).toEqual([value, { b: 2 }]);
  });
});

describe("check_architecture", () => {
  test("parcel comes out clean", () => {
    expect(checkArchitecture(parcel())).toEqual([]);
  });

  test("finds what would break at deploy time, worst first, each with the call that fixes it", () => {
    const doc = structuredClone(parcel());
    const a = doc.architecture!;
    delete a.workloads["returns-api-prod"]!.probes;
    a.migrations["0042-store-credit"]!.safe = "breaking";
    delete a.releases.v42!.before;
    delete a.releases.v43!.rollback;
    a.releases.v42!.strategy = { kind: "canary" };
    delete a.links["alb-routes-returns-api"];
    delete a.environments.staging!.cluster;
    a.workloads["worker-prod"]!.egress = ["main-database", "jobs"];
    const found = checkArchitecture(doc);
    const got = found.map((f) => `${f.severity} ${f.rule} ${f.id}`);
    expect(got.slice(0, 5)).toEqual([
      "p1 breaking-migration 0042-store-credit",
      "p1 no-cluster db-migrate-staging", "p1 no-cluster returns-api-staging", "p1 no-cluster worker-staging",
      "p2 canary-no-steps v42",
    ]);
    expect(got).toEqual(expect.arrayContaining([
      "p2 egress-blocked worker-prod", "p2 ingress-no-edge returns-api-prod", "p2 no-probes returns-api-prod", "p2 no-rollback v43",
    ]));
    for (const f of found) expect(toolNames).toContain(f.fix.split(" ")[0] as (typeof toolNames)[number]);
    const text = checkText(a, found);
    expect(text).toStartWith(`Architecture: ${found.length} findings (4 P1,`);
    expect(text).toContain('P2 egress-blocked · worker-prod: Worker calls Resend, calls Shippo, calls Shopify, writes Labels, but the NetworkPolicy of Deployment worker in prod doesn\'t let it out there.\n   Fix: set_workload {"id":"worker-prod","egress":["main-database","jobs","resend","shippo","shopify","labels"]}');
  });

  test("secrets: something holds them, and they sit with the part that uses them", () => {
    const doc = shop();
    const a = doc.architecture!;
    a.parts.stripe = { id: "stripe", name: "Stripe", kind: "external" };
    a.workloads.w!.secrets = ["stripe-key"];
    expect(checkArchitecture(doc).map((f) => f.rule)).toEqual(expect.arrayContaining(["secret-no-store", "secret-unused"]));
  });
});

describe("export_architecture", () => {
  test("a workload's manifest, exactly", () => {
    const files = exportArchitecture(shop(), "manifests", undefined, noBrief);
    expect([...files.keys()]).toEqual(["dev/shop/namespace.yaml", "dev/shop/quote-api.yaml", "dev/shop/kustomization.yaml"]);
    expect(files.get("dev/shop/quote-api.yaml")).toBe(`# ${DRAFT}
# Deployment quote-api in dev, namespace shop: runs Quote API.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quote-api
  namespace: shop
  labels:
    app.kubernetes.io/name: quote-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: quote-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: quote-api
    spec:
      containers:
        - name: quote-api
          image: api:1
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - configMapRef:
                name: api-config
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
          livenessProbe:
            exec:
              command:
                - sh
                - "-c"
                - pgrep node
---
apiVersion: v1
kind: Service
metadata:
  name: quote-api
  namespace: shop
  labels:
    app.kubernetes.io/name: quote-api
spec:
  selector:
    app.kubernetes.io/name: quote-api
  ports:
    - name: http
      port: 3000
      targetPort: 3000
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: quote-api
  namespace: shop
  labels:
    app.kubernetes.io/name: quote-api
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: quote-api
---
# Lets quote-api reach DNS and Main DB, nothing else.
# Main DB (RDS) is outside the cluster: port 5432 to anywhere; narrow it with an ipBlock.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: quote-api
  namespace: shop
  labels:
    app.kubernetes.io/name: quote-api
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: quote-api
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - ports:
        - protocol: TCP
          port: 5432
`);
  });

  test("parcel's manifests, Applications and workflows all parse, and carry what the design says", () => {
    const doc = parcel();
    for (const format of ["manifests", "argocd", "ci"] as const) {
      const files = exportArchitecture(doc, format, undefined, noBrief);
      expect(files.size).toBeGreaterThan(0);
      for (const [path, text] of files) {
        expect(text, path).toStartWith(`# ${DRAFT}`);
        expect(() => Bun.YAML.parse(text), path).not.toThrow();
      }
    }
    const docs = (text: string | undefined): { kind?: string; metadata?: { annotations?: Record<string, string> }; spec?: unknown }[] => {
      const v: unknown = Bun.YAML.parse(text ?? "");
      return (Array.isArray(v) ? v : [v]) as { kind?: string }[];
    };
    const prod = exportArchitecture(doc, "manifests", "prod", noBrief);
    expect([...prod.keys()].every((k) => k.startsWith("prod/"))).toBe(true);
    const api = docs(prod.get("prod/returns/returns-api.yaml"));
    expect(api.map((d) => d.kind)).toEqual(["ServiceAccount", "Rollout", "Service", "Ingress", "HorizontalPodAutoscaler", "PodDisruptionBudget", "NetworkPolicy"]);
    expect(api[1]?.spec).toMatchObject({ strategy: { canary: { steps: [{ setWeight: 10 }, { pause: { duration: "15m" } }, { setWeight: 50 }, { pause: { duration: "15m" } }] } } });
    expect(prod.get("prod/returns/returns-api.yaml")).toContain("# Checks to wire as an AnalysisTemplate: error rate < 1%");
    expect(docs(prod.get("prod/worker/worker.yaml")).map((d) => d.kind)).toEqual(["ServiceAccount", "ExternalSecret", "ExternalSecret", "Deployment", "ScaledObject", "NetworkPolicy"]);
    // shippo-key is the worker's here; the CronJob beside it in jobs gets its own.
    expect(docs(prod.get("prod/jobs/nightly-labels.yaml")).map((d) => d.kind)).toEqual(["ExternalSecret", "CronJob", "NetworkPolicy"]);
    expect(docs(prod.get("prod/jobs/db-migrate.yaml"))[0]?.metadata?.annotations).toEqual({ "argocd.argoproj.io/hook": "PreSync", "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation" });
    expect(Bun.YAML.parse(prod.get("prod/returns/kustomization.yaml") ?? "")).toEqual({ apiVersion: "kustomize.config.k8s.io/v1beta1", kind: "Kustomization", namespace: "returns", resources: ["namespace.yaml", "credit-ledger.yaml", "returns-api.yaml"] });
    expect(prod.get("prod/returns/credit-ledger.yaml")).toContain("# Planned in plan store-credit: not live yet.");

    const apps = exportArchitecture(doc, "argocd", undefined, noBrief);
    expect([...apps.keys()].sort()).toEqual(["prod/credit-ledger-prod.yaml", "prod/returns-api-prod.yaml", "prod/worker-prod.yaml", "staging/returns-api-staging.yaml", "staging/worker-staging.yaml"]);
    expect(Bun.YAML.parse(apps.get("prod/returns-api-prod.yaml") ?? "")).toMatchObject({ kind: "Application", spec: { source: { repoURL: "parcel-deploy", path: "apps/returns-api/prod" }, destination: { namespace: "returns" } } });

    const ci = exportArchitecture(doc, "ci", undefined, noBrief);
    const flow: unknown = Bun.YAML.parse(ci.get("returns-api.yml") ?? "");
    expect(JSON.stringify(flow)).toContain("docker/build-push-action@v6");
    expect(JSON.stringify(flow)).toContain("cosign sign --yes");
    expect(ci.get("buyer-portal.yml")).not.toContain("build-push-action");
  });

  test("the tool writes drafts inside the design's folder, and nowhere else", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buni-arch-export-"));
    const file = join(dir, "parcel.buni");
    await copyFile(parcelPath, file);
    const ws = await Workspace.open(file);
    const r = await ws.call("claude", "export_architecture", { format: "brief", environment: "prod" });
    expect(r).toMatchObject({ ok: true });
    expect(r.reply).toContain("Wrote 1 draft file to architecture/brief/");
    const brief = await readFile(join(dir, "architecture", "brief", "architecture.md"), "utf8");
    expect(brief).toStartWith(`<!-- ${DRAFT} -->\n# Architecture · prod\n\n## System`);
    expect((await ws.call("claude", "export_architecture", { format: "ci", out: "drafts/ci" })).ok).toBe(true);
    expect((await readdir(join(dir, "drafts", "ci"))).sort()).toEqual(["buyer-portal.yml", "credit-ledger.yml", "merchant-dashboard.yml", "returns-api.yml", "worker.yml"]);
    for (const out of ["../elsewhere", ".", "/tmp/x"]) expect((await ws.call("claude", "export_architecture", { format: "ci", out })).reply).toBe("Write into a folder inside the design's folder.");
    expect((await ws.call("claude", "export_architecture", { format: "manifests", environment: "preview" })).reply).toBe("Nothing to export as manifests: no workloads run there.");
    expect((await ws.call("claude", "check_architecture", {})).reply).toStartWith("Architecture: no findings across");
  });
});
