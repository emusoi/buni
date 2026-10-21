// The architecture as draft files to start the real ones from: Kubernetes manifests per workload, Argo CD
// Applications, GitHub Actions workflows and a Markdown brief. Drafts: every file says so, and a person reviews them
// before anything is applied. YAML comes from yaml.ts's small emitter.
import { architectureOf, k8sName, workloadName, type Architecture, type Cluster, type Doc, type Environment, type Id, type Namespace, type Part, type Release, type Workload } from "../format/doc.ts";
import { ToolError } from "./kit.ts";
import { filled, yamlLines, type YamlMap } from "./yaml.ts";

export const EXPORT_FORMATS = ["manifests", "argocd", "ci", "brief"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const DRAFT = "Draft from buni — review before applying.";

// ---- YAML ----

export interface YamlDoc {
  /** Lines said above the document, as # comments. */
  notes?: string[];
  value: YamlMap;
}

/** A YAML file: the draft line and `about` on top, then each document, separated by ---. */
export function yamlFile(about: readonly string[], docs: readonly YamlDoc[]): string {
  const comment = (l: string) => `# ${l}`.trimEnd();
  const head = [DRAFT, ...about].map(comment);
  const body = docs.map((d, i) => [...(i > 0 ? ["---"] : []), ...(d.notes ?? []).map(comment), ...yamlLines(d.value, "")].join("\n"));
  return `${[...head, ...body].join("\n")}\n`;
}

// ---- Shared lookups ----

function environmentsFor(arch: Architecture, environment: string | undefined): Environment[] {
  const all = Object.values(arch.environments).sort((a, b) => a.order - b.order);
  if (environment === undefined) return all;
  const env = all.find((e) => e.id === environment || e.name === environment);
  if (!env) throw new ToolError(`environment "${environment}" does not exist; there are ${all.map((e) => e.id).join(", ") || "none"}`);
  return [env];
}

const byId = <T extends { id: Id }>(a: T, b: T) => a.id.localeCompare(b.id);
const clusterOf = (arch: Architecture, e: Environment): Cluster | undefined => (e.cluster === undefined ? undefined : arch.clusters[e.cluster]);
const hasAddon = (c: Cluster | undefined, re: RegExp) => (c?.addons ?? []).some((a) => re.test(a));
/** The canary or blue-green release that ships a part through an environment, if any. */
const shiftingRelease = (arch: Architecture, part: Id, env: Id): Release | undefined =>
  Object.values(arch.releases).sort(byId).find((r) => r.parts.includes(part) && r.path.includes(env) && r.strategy.kind !== "rolling");
/** The image's name without its tag: "api:4f2c9a1" → "api". */
const imageName = (image: string) => image.replace(/[:@].*$/, "").split("/").at(-1) ?? image;
const planNote = (x: { status?: string; plan?: Id }) => (x.status === "planned" ? [`Planned${x.plan ? ` in plan ${x.plan}` : ""}: not live yet.`] : []);

// ---- Kubernetes manifests ----

/** The pod label a node pool is picked by, as each provider (or Karpenter) sets it. */
function poolLabel(c: Cluster | undefined): string {
  if (hasAddon(c, /karpenter/i)) return "karpenter.sh/nodepool";
  return byProvider(c, { eks: "eks.amazonaws.com/nodegroup", gke: "cloud.google.com/gke-nodepool", aks: "kubernetes.azure.com/agentpool" }) ?? "node-pool";
}

const byProvider = (c: Cluster | undefined, m: Partial<Record<Cluster["provider"], string>>) => (c ? m[c.provider] : undefined);

/** The annotation a service account assumes its cloud role by. */
const roleAnnotation = (c: Cluster | undefined) =>
  byProvider(c, { eks: "eks.amazonaws.com/role-arn", gke: "iam.gke.io/gcp-service-account", aks: "azure.workload.identity/client-id" }) ?? "cloud-role";

/** "spot=true:NoSchedule" (effect optional) as a toleration. */
function toleration(taint: string): YamlMap {
  const [kv = "", effect = "NoSchedule"] = taint.split(":");
  const [key = kv, value] = kv.split("=");
  return { key, operator: value === undefined ? "Exists" : "Equal", value, effect };
}

/** "15 min" → "15m": a pause Argo Rollouts reads; undefined for anything else (the step then waits for a person). */
function duration(hold: string | undefined): string | undefined {
  const m = hold?.match(/^\s*(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour)s?\s*$/i);
  return m ? `${m[1]}${(m[2] ?? "m")[0]?.toLowerCase()}` : undefined;
}

/** The port a part outside the cluster is reached on, from what it is. */
function portOf(p: Part): number {
  const what = `${p.tech ?? ""} ${p.managed ?? ""} ${p.name}`;
  const known: [RegExp, number][] = [[/postgres/i, 5432], [/mysql|aurora|maria/i, 3306], [/redis|valkey|elasticache/i, 6379], [/mongo/i, 27017], [/kafka|msk/i, 9092]];
  return known.find(([re]) => re.test(what))?.[1] ?? 443;
}

/** KEDA's trigger for the queue a worker drains. */
function queueTrigger(arch: Architecture, w: Workload, env: Environment): { trigger: YamlMap; note?: string } {
  const queue = Object.values(arch.links).find((l) => l.from === w.part && l.kind === "subscribes" && arch.parts[l.to]?.kind === "queue")?.to
    ?? w.egress?.find((id) => arch.parts[id]?.kind === "queue");
  const q = queue === undefined ? undefined : arch.parts[queue];
  const depth = w.scale?.target.match(/\d+/)?.[0] ?? "100";
  const what = q ? `${q.tech ?? ""} ${q.managed ?? ""}` : "";
  const name = q ? k8sName(q.name) : "QUEUE";
  if (/sqs/i.test(what)) return { trigger: { type: "aws-sqs-queue", metadata: { queueURL: `QUEUE_URL_OF_${name}`, queueLength: depth, awsRegion: env.region ?? "REGION" }, authenticationRef: { name: "keda-aws" } }, note: `KEDA reads ${q?.name}'s depth: fill in its queue URL and the TriggerAuthentication.` };
  if (/rabbit/i.test(what)) return { trigger: { type: "rabbitmq", metadata: { queueName: name, mode: "QueueLength", value: depth } } };
  if (/kafka|msk/i.test(what)) return { trigger: { type: "kafka", metadata: { topic: name, lagThreshold: depth } } };
  if (/redis/i.test(what)) return { trigger: { type: "redis", metadata: { listName: name, listLength: depth } } };
  return { trigger: { type: "QUEUE_TYPE", metadata: { queue: name, depth } }, note: `Which KEDA scaler reads ${q?.name ?? "the queue"} isn't in the design: set its type.` };
}

/** One workload's documents: its account and secrets (once a namespace), itself, and what it needs around it. */
function workloadDocs(arch: Architecture, env: Environment, ns: Namespace, w: Workload, claimed: Set<string>): YamlDoc[] {
  const cluster = clusterOf(arch, env);
  const name = workloadName(arch, w);
  const labels = { "app.kubernetes.io/name": name };
  const meta = (extra: YamlMap = {}): YamlMap => ({ name, namespace: ns.name, labels, ...extra });
  const port = w.service?.port;
  const probe = (p: string): YamlMap => (p.startsWith("/") ? { httpGet: { path: p, port: port ?? 8080 } } : { exec: { command: ["sh", "-c", p] } });
  const res = w.resources;
  const requests = { cpu: res?.cpu, memory: res?.memory };
  const limits = { cpu: res?.limitCpu, memory: res?.limitMemory };
  const envFrom = [...(w.config ?? []).map((c) => ({ configMapRef: { name: c } })), ...(w.secrets ?? []).map((s) => ({ secretRef: { name: s } }))];
  const pool = w.nodes === undefined ? undefined : cluster?.pools?.find((p) => p.name === w.nodes);
  const job = w.kind === "Job" || w.kind === "CronJob";
  const template: YamlMap = {
    metadata: { labels },
    spec: {
      serviceAccountName: w.account?.name,
      nodeSelector: w.nodes === undefined ? undefined : { [poolLabel(cluster)]: w.nodes },
      tolerations: pool?.taint ? [toleration(pool.taint)] : undefined,
      restartPolicy: job ? "Never" : undefined,
      containers: [{
        name,
        image: w.image ?? `${name}:TAG`,
        ports: port ? [{ name: "http", containerPort: port }] : undefined,
        envFrom: envFrom.length ? envFrom : undefined,
        resources: res ? { requests: filled(requests) ? requests : undefined, limits: filled(limits) ? limits : undefined } : undefined,
        readinessProbe: w.probes?.ready ? probe(w.probes.ready) : undefined,
        livenessProbe: w.probes?.live ? probe(w.probes.live) : undefined,
      }],
    },
  };
  const selector = { matchLabels: labels };
  const replicas = w.replicas?.min;
  const docs: YamlDoc[] = [];

  if (w.account && !claimed.has(`account:${w.account.name}`)) {
    claimed.add(`account:${w.account.name}`);
    docs.push({ value: { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: w.account.name, namespace: ns.name, annotations: w.account.role ? { [roleAnnotation(cluster)]: w.account.role } : undefined } } });
  }
  const store = Object.values(arch.parts).find((p) => /secret|vault/i.test(`${p.managed ?? ""} ${p.tech ?? ""} ${p.name}`));
  for (const s of w.secrets ?? []) {
    if (claimed.has(`secret:${s}`)) continue;
    claimed.add(`secret:${s}`);
    docs.push({
      notes: [`${s} comes from ${store?.name ?? "the secret store"} through External Secrets.`],
      value: {
        apiVersion: "external-secrets.io/v1beta1", kind: "ExternalSecret", metadata: { name: s, namespace: ns.name },
        spec: { refreshInterval: "1h", secretStoreRef: { kind: "ClusterSecretStore", name: store ? k8sName(store.name) : "secret-store" }, target: { name: s }, dataFrom: [{ extract: { key: s } }] },
      },
    });
  }

  const release = w.kind === "Rollout" ? shiftingRelease(arch, w.part, env.id) : undefined;
  switch (w.kind) {
    case "Deployment":
      docs.push({ value: { apiVersion: "apps/v1", kind: "Deployment", metadata: meta(), spec: { replicas, selector, template } } });
      break;
    case "StatefulSet":
      docs.push({ value: { apiVersion: "apps/v1", kind: "StatefulSet", metadata: meta(), spec: { serviceName: name, replicas, selector, template } } });
      break;
    case "DaemonSet":
      docs.push({ value: { apiVersion: "apps/v1", kind: "DaemonSet", metadata: meta(), spec: { selector, template } } });
      break;
    case "Job":
      docs.push({
        notes: w.before ? ["Runs before each sync: an Argo CD PreSync hook, so the release waits for it."] : [],
        value: {
          apiVersion: "batch/v1", kind: "Job",
          metadata: meta(w.before ? { annotations: { "argocd.argoproj.io/hook": "PreSync", "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation" } } : {}),
          spec: { backoffLimit: 1, template },
        },
      });
      break;
    case "CronJob":
      docs.push({ value: { apiVersion: "batch/v1", kind: "CronJob", metadata: meta(), spec: { schedule: w.schedule ?? "", concurrencyPolicy: "Forbid", jobTemplate: { spec: { backoffLimit: 1, template } } } } });
      break;
    case "Rollout": {
      const s = release?.strategy;
      const pause = duration(s?.hold);
      const steps = (s?.steps ?? []).filter((n) => n < 100).flatMap((n): YamlMap[] => [{ setWeight: n }, { pause: pause ? { duration: pause } : {} }]);
      const strategy: YamlMap = s?.kind === "blue-green"
        ? { blueGreen: { activeService: name, previewService: `${name}-preview`, autoPromotionEnabled: false } }
        : { canary: steps.length ? { steps } : {} };
      const notes = !release
        ? ["No canary or blue-green release ships this part here: set_release adds the steps."]
        : [
            `Release ${release.name}: ${s?.kind}${s?.steps ? ` ${s.steps.join(" → ")}%` : ""}${s?.hold ? `, holding ${s.hold} a step` : ""}.`,
            ...(release.checks?.length ? [`Checks to wire as an AnalysisTemplate: ${release.checks.join("; ")}.`] : []),
            ...(s?.hold && !pause ? [`"${s.hold}" isn't a duration: each pause waits for a person to promote.`] : []),
          ];
      docs.push({ notes, value: { apiVersion: "argoproj.io/v1alpha1", kind: "Rollout", metadata: meta(), spec: { replicas, selector, template, strategy } } });
      break;
    }
  }

  if (port) {
    const service = (n: string): YamlMap => ({ apiVersion: "v1", kind: "Service", metadata: { name: n, namespace: ns.name, labels }, spec: { selector: labels, ports: [{ name: "http", port, targetPort: port }] } });
    docs.push({ value: service(name) });
    if (release?.strategy.kind === "blue-green") docs.push({ notes: ["The new version answers here until it is promoted."], value: service(`${name}-preview`) });
  }
  if (w.ingress) {
    const alb = hasAddon(cluster, /lb controller|load balancer/i);
    docs.push({
      value: {
        apiVersion: "networking.k8s.io/v1", kind: "Ingress",
        metadata: meta(alb ? { annotations: { "alb.ingress.kubernetes.io/scheme": "internet-facing", "alb.ingress.kubernetes.io/target-type": "ip" } } : {}),
        spec: {
          ingressClassName: alb ? "alb" : "nginx",
          rules: [{ host: w.ingress.host, http: { paths: [{ path: w.ingress.path ?? "/", pathType: "Prefix", backend: { service: { name, port: { number: port ?? 80 } } } }] } }],
        },
      },
    });
  }
  const target = { apiVersion: w.kind === "Rollout" ? "argoproj.io/v1alpha1" : "apps/v1", kind: w.kind, name };
  const max = w.replicas?.max ?? replicas ?? 1;
  if (w.scale?.by === "cpu" || w.scale?.by === "memory") {
    const pct = Number.parseInt(w.scale.target, 10);
    docs.push({
      notes: Number.isFinite(pct) ? [] : [`Target "${w.scale.target}" isn't a percentage: set averageUtilization.`],
      value: {
        apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler", metadata: meta(),
        spec: { scaleTargetRef: target, minReplicas: replicas ?? 1, maxReplicas: max, metrics: [{ type: "Resource", resource: { name: w.scale.by, target: { type: "Utilization", averageUtilization: Number.isFinite(pct) ? pct : 70 } } }] },
      },
    });
  } else if (w.scale?.by === "queue") {
    const { trigger, note } = queueTrigger(arch, w, env);
    docs.push({ notes: note ? [note] : [], value: { apiVersion: "keda.sh/v1alpha1", kind: "ScaledObject", metadata: meta(), spec: { scaleTargetRef: target, minReplicaCount: replicas ?? 0, maxReplicaCount: max, triggers: [trigger] } } });
  }
  if (w.keep !== undefined) docs.push({ value: { apiVersion: "policy/v1", kind: "PodDisruptionBudget", metadata: meta(), spec: { minAvailable: w.keep, selector } } });
  if (w.egress?.length) {
    const notes: string[] = [];
    const rules: YamlMap[] = [{ to: [{ namespaceSelector: {}, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] }];
    for (const id of w.egress) {
      const p = arch.parts[id];
      if (!p) continue;
      const inside = Object.values(arch.workloads).find((x) => x.part === id && x.environment === env.id && !x.before);
      const theirs = inside && arch.namespaces[inside.namespace];
      if (inside && theirs) {
        rules.push({ to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": theirs.name } }, podSelector: { matchLabels: { "app.kubernetes.io/name": workloadName(arch, inside) } } }] });
      } else {
        rules.push({ ports: [{ protocol: "TCP", port: portOf(p) }] });
        notes.push(`${p.name}${p.managed ? ` (${p.managed})` : p.kind === "external" ? " (outside service)" : ""} is outside the cluster: port ${portOf(p)} to anywhere; narrow it with an ipBlock.`);
      }
    }
    const reach = ["DNS", ...w.egress.map((id) => arch.parts[id]?.name ?? id)];
    docs.push({ notes: [`Lets ${name} reach ${reach.slice(0, -1).join(", ")} and ${reach.at(-1)}, nothing else.`, ...notes], value: { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: meta(), spec: { podSelector: selector, policyTypes: ["Egress"], egress: rules } } });
  }
  return docs;
}

function manifests(arch: Architecture, envs: readonly Environment[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const env of envs) {
    const here = Object.values(arch.workloads).filter((w) => w.environment === env.id).sort(byId);
    for (const ns of Object.values(arch.namespaces).filter((n) => here.some((w) => w.namespace === n.id)).sort(byId)) {
      const dir = `${env.id}/${ns.name}`;
      const claimed = new Set<string>();
      const resources = ["namespace.yaml"];
      files.set(`${dir}/namespace.yaml`, yamlFile([`Namespace ${ns.name} in ${env.name}${ns.owners ? `, owned by ${ns.owners}` : ""}.`], [{ value: { apiVersion: "v1", kind: "Namespace", metadata: { name: ns.name } } }]));
      for (const w of here.filter((x) => x.namespace === ns.id)) {
        const name = workloadName(arch, w);
        const part = arch.parts[w.part];
        files.set(`${dir}/${name}.yaml`, yamlFile([`${w.kind} ${name} in ${env.name}, namespace ${ns.name}: runs ${part?.name ?? w.part}.`, ...planNote(w)], workloadDocs(arch, env, ns, w, claimed)));
        resources.push(`${name}.yaml`);
      }
      files.set(`${dir}/kustomization.yaml`, yamlFile([`Everything buni draws in namespace ${ns.name} in ${env.name}.`], [{ value: { apiVersion: "kustomize.config.k8s.io/v1beta1", kind: "Kustomization", namespace: ns.name, resources } }]));
    }
  }
  return files;
}

// ---- Argo CD ----

function argocd(arch: Architecture, envs: readonly Environment[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const env of envs) {
    const cluster = clusterOf(arch, env);
    const gitops = cluster?.gitops;
    if (!cluster || gitops?.tool !== "argocd") continue;
    const here = Object.values(arch.workloads).filter((w) => w.environment === env.id).sort(byId);
    for (const part of Object.values(arch.parts).filter((p) => here.some((w) => w.part === p.id)).sort(byId)) {
      const mine = here.filter((w) => w.part === part.id);
      const main = mine.find((w) => !w.before) ?? mine[0];
      const ns = main && arch.namespaces[main.namespace];
      const release = Object.values(arch.releases).sort(byId).find((r) => r.parts.includes(part.id) && r.path.includes(env.id) && r.manifests);
      const manifests = release?.manifests?.startsWith(`${gitops.repo}/`) ? release.manifests.slice(gitops.repo.length + 1) : release?.manifests;
      const path = manifests ? `${manifests}/${env.id}` : `${gitops.path ?? env.id}/${k8sName(part.name)}`;
      const name = `${k8sName(part.name)}-${env.id}`;
      const shifting = shiftingRelease(arch, part.id, env.id);
      files.set(`${env.id}/${name}.yaml`, yamlFile([
        `${part.name} in ${env.name}: Argo CD syncs ${gitops.repo}/${path} into ${cluster.name}.`,
        "repoURL and path are as the design names them: point them at the real deploy repo.",
        ...(shifting ? [`Release ${shifting.name} is ${shifting.strategy.kind}: Argo Rollouts shifts the traffic once Argo CD syncs.`] : []),
        ...(mine.some((w) => w.before) ? [`Runs ${mine.filter((w) => w.before).map((w) => workloadName(arch, w)).join(", ")} first, as a PreSync hook.`] : []),
        ...planNote(part),
      ], [{
        value: {
          apiVersion: "argoproj.io/v1alpha1", kind: "Application",
          metadata: { name, namespace: "argocd", labels: { "app.kubernetes.io/part-of": k8sName(part.name) } },
          spec: {
            project: "default",
            source: { repoURL: gitops.repo, targetRevision: "HEAD", path },
            destination: { server: "https://kubernetes.default.svc", namespace: ns?.name },
            syncPolicy: { automated: { prune: true, selfHeal: true }, syncOptions: ["CreateNamespace=true"] },
          },
        },
      }]));
    }
  }
  return files;
}

// ---- GitHub Actions ----

function ci(arch: Architecture, envs: readonly Environment[]): Map<string, string> {
  const files = new Map<string, string>();
  const region = envs.at(-1)?.region;
  for (const part of Object.values(arch.parts).filter((p) => p.build).sort(byId)) {
    const b = part.build;
    if (!b) continue;
    const name = k8sName(part.name);
    const image = b.dockerfile !== undefined || /image|container/i.test(b.artifact ?? "");
    const ecr = /ecr/i.test(b.registry ?? "");
    const ran = Object.values(arch.workloads).find((w) => w.part === part.id && w.image)?.image;
    const repo = ran ? imageName(ran) : name;
    const ref = `${ecr ? "${{ steps.registry.outputs.registry }}" : b.registry ?? "REGISTRY"}/${repo}`;
    const dir = b.path?.replace(/\/+$/, "");
    const on = { paths: [dir ? `${dir}/**` : "**", `.github/workflows/${name}.yml`] };
    const login: YamlMap[] = ecr
      ? [
          { name: "AWS credentials", uses: "aws-actions/configure-aws-credentials@v4", with: { "role-to-assume": "ROLE_ARN", "aws-region": region ?? "REGION" } },
          { name: "Log in to ECR", id: "registry", uses: "aws-actions/amazon-ecr-login@v2" },
        ]
      : [{ name: `Log in to ${b.registry ?? "the registry"}`, uses: "docker/login-action@v3", with: { registry: b.registry ?? "REGISTRY", username: "${{ github.actor }}", password: "${{ secrets.REGISTRY_TOKEN }}" } }];
    const steps: YamlMap[] = [{ uses: "actions/checkout@v4" }];
    for (const step of b.steps?.length ? b.steps : ["build"]) {
      if (image && /\bbuild\b|docker|image/i.test(step)) {
        steps.push(...login, {
          name: `Build and push ${repo}`, id: "build", uses: "docker/build-push-action@v6",
          with: { context: dir ?? ".", file: b.dockerfile ? `${dir ? `${dir}/` : ""}${b.dockerfile}` : undefined, push: "${{ github.event_name == 'push' }}", tags: `${ref}:\${{ github.sha }}` },
        });
      } else if (image && /scan|cve|vuln/i.test(step)) {
        steps.push({ name: step, uses: "aquasecurity/trivy-action@0.28.0", with: { "image-ref": `${ref}:\${{ github.sha }}`, severity: "CRITICAL", "exit-code": "1" } });
      } else if (image && /sign|cosign/i.test(step)) {
        steps.push({ uses: "sigstore/cosign-installer@v3" }, { name: step, if: "github.event_name == 'push'", run: `cosign sign --yes ${ref}@\${{ steps.build.outputs.digest }}` });
      } else steps.push({ name: step, run: `echo "TODO ${step.replace(/["\\$`]/g, "")}"` });
    }
    files.set(`${name}.yml`, yamlFile([
      `${part.name}: built from ${b.repo}${b.path ? ` ${b.path}` : ""}${b.artifact ? `, makes ${b.artifact}` : ""}${b.registry ? ` for ${b.registry}` : ""}.`,
      "Goes in .github/workflows/; the TODO steps are the design's names for them, so give each its command.",
      ...planNote(part),
    ], [{
      value: {
        name: part.name,
        on: { push: { branches: ["main"], ...on }, pull_request: on },
        permissions: { contents: "read", "id-token": image ? "write" : undefined },
        jobs: { build: { "runs-on": "ubuntu-latest", defaults: dir ? { run: { "working-directory": dir } } : undefined, steps } },
      },
    }]));
  }
  return files;
}

/**
 * The architecture as draft files, by path inside the export folder. `brief` is read_architecture's text (passed in:
 * the brief lives with the tools, which use this file).
 */
export function exportArchitecture(doc: Doc, format: ExportFormat, environment: string | undefined, brief: () => string): Map<string, string> {
  const arch = architectureOf(doc);
  const envs = environmentsFor(arch, environment);
  switch (format) {
    case "manifests": return manifests(arch, envs);
    case "argocd": return argocd(arch, envs);
    case "ci": return ci(arch, envs);
    case "brief": return new Map([["architecture.md", `<!-- ${DRAFT} -->\n# Architecture${environment === undefined ? "" : ` · ${envs[0]?.name}`}\n\n${brief()}\n`]]);
  }
}
