---
name: architecture
description: Designing a system before it is built and how it ships — who uses it, parts and links, API contracts (REST and GraphQL), builds, environments, Kubernetes clusters, namespaces and workloads, releases and migrations, planned changes and plays — with buni's architecture tools, then checking it and exporting drafts (manifests, Argo CD, CI, a brief). Read before designing a system, its deploy path, or a change to either.
---
# Designing the software path

The architecture is the app behind the screens, from code to running pods: what the parts are and how they talk, how
each is built, where it runs, how it ships, and how a change gets there. buni designs it before and while it is built;
nothing in it is live state. Work top down, one layer at a time, and read it back with `read_architecture` as you go.

## Two ways to write it
The tools below build it a call at a time. The same architecture is also plain YAML a person writes by hand:
`read_architecture_text` (`buni arch FILE text`) gives every section, each a map keyed by id, with defaults left out;
`write_architecture_text {text}` (`buni arch FILE write PATH|-`, or `buni arch FILE edit` in `$EDITOR`) replaces the
whole architecture with what the text says, as one edit one undo takes back. A refused text names the line, path and
rule. People may sketch the system this way and hand it over; you may too, when writing many things at once is
clearer than many calls: read the text first, change it, write it back.

## Order of work
0. **Context.** Who uses it and what it relies on: a `person` part per kind of user (buyer, merchant) and an
   `external` part per outside service, each linked to the parts they talk to. The map's Context level draws them
   round the system as one box; it is the first thing a person reads.
1. **Parts and links.** `set_part` for every client, service, worker, store, queue, outside service and edge piece
   (DNS, CDN, firewall, load balancer). A database or queue the cloud runs gets `managed` ("RDS Postgres Multi-AZ") and
   never a workload. `link_parts` says who starts each conversation (`calls`, `reads`, `writes`, `publishes`,
   `subscribes`; edge → what it fronts is `routes`) and what passes along it (`carries`). `set_group` draws the system
   or team boundary. Stop here and read `read_architecture {level:"system"}`: every part should have a reason to exist.
1b. **API contracts.** Before code, say what each service offers: `set_api {part, kind: "rest"|"graphql", spec}`, then
   `set_operation` per REST operation (`method`, `path`, `about`, `request`, `responses`) or GraphQL field (`type`,
   `field`, `returns`). A GraphQL field served by a REST call names it in `resolves`. The editor's API view draws them.
2. **Builds.** `set_build` on each part that is built: repo, path, Dockerfile, steps in order, what it makes, where it
   goes. Parts that run in the cluster need one.
3. **Environments.** `set_environment` preview, staging, prod by `order`; the cluster each runs on.
4. **Cluster, namespaces, workloads.** `set_cluster` (pools, add-ons, GitOps repo), `set_namespace` per team or
   concern, then `set_workload` per part per environment. A long-running workload gets probes, requests and limits,
   replicas; one that takes traffic gets `service` and, from outside, `ingress`; `egress` lists the parts its
   NetworkPolicy lets it reach (match the links). Migrations are a `Job` with `before: true`; nightly work is a `CronJob`.
5. **Releases and migrations.** `set_release` per release or release path: parts, path through environments, strategy
   (`canary` with steps ending at 100 and a hold needs a `Rollout`), the checks each step passes, rollback, and the
   Jobs that run first. `set_migration` for each schema change: `additive` ships with the code; `breaking` needs the
   old code gone first, so split it.
6. **Plans for changes.** A change not built yet is a plan: `set_plan {name, issue, releases}`, then the parts, links,
   workloads and migrations it adds with `status: "planned"` and `plan`. What it takes out is `status: "removed"`.
   Merging (`merge_plan`) is the person's call, never yours.
7. **Plays.** `set_play` walks the design step by step, each step touching ids: one `request` (a user action through
   the parts), one `release` (build → push → sync → migrate → canary steps with their checks), and the `failure` that
   follows when a check fails (`fails {at, then}`): what rolls back and what stays.
8. **Check.** `check_architecture` lists what would break or leak at deploy time, worst first, each with the call that
   fixes it. Fix P1 and P2; a P3 you keep on purpose, say why in the doc.
9. **Export drafts.** `export_architecture {format}`: `manifests` (Kubernetes YAML per workload and a kustomization per
   namespace), `argocd` (an Application per part per environment), `ci` (a GitHub Actions workflow per built part),
   `brief` (Markdown), `openapi` (an OpenAPI 3.1 openapi.yaml per REST API), `graphql` (a schema.graphql per GraphQL
   API). They land in `architecture/FORMAT/` next to the design and say they are drafts: hand them over
   for review, never apply them.

## Compact example
```
set_part {"name":"Returns API","kind":"service","tech":"Node 22"}
set_part {"name":"Main database","kind":"store","tech":"Postgres 16","managed":"RDS Postgres"}
set_part {"name":"Buyer","kind":"person","about":"Returns items from an order"}
link_parts {"from":"buyer","to":"returns-api","kind":"calls","carries":"Return"}
set_api {"part":"returns-api","kind":"rest","spec":"openapi.yaml"}
set_operation {"part":"returns-api","method":"POST","path":"/returns/{id}/refund","about":"Refunds a return once the parcel is scanned","request":"RefundRequest { amount, reason }","responses":["202 Refund queued","409 Not scanned yet"]}
link_parts {"from":"returns-api","to":"main-database","kind":"writes","carries":"Return"}
set_build {"part":"returns-api","repo":"github.com/acme/parcel","path":"api/","dockerfile":"Dockerfile","steps":["lint","test","build","scan","sign"],"artifact":"api image","registry":"ECR"}
set_cluster {"name":"EKS prod","provider":"eks","addons":["Argo CD","Argo Rollouts","External Secrets"],"gitops":{"tool":"argocd","repo":"parcel-deploy"}}
set_environment {"name":"prod","cluster":"eks-prod"}
set_namespace {"cluster":"eks-prod","name":"returns"}
set_workload {"part":"returns-api","environment":"prod","namespace":"eks-prod-returns","kind":"Rollout","replicas":{"min":3,"max":10},"scale":{"by":"cpu","target":"70%"},"keep":2,"resources":{"cpu":"250m","memory":"512Mi","limitCpu":"1","limitMemory":"1Gi"},"probes":{"ready":"/health","live":"/live"},"service":{"port":8080},"egress":["main-database"]}
set_release {"name":"v42","parts":["returns-api"],"path":["prod"],"manifests":"parcel-deploy/apps/returns-api","strategy":{"kind":"canary","steps":[10,50,100],"hold":"15 min"},"checks":["error rate < 1%"],"rollback":"Argo Rollouts aborts to the last good image."}
check_architecture {}
export_architecture {"format":"manifests","environment":"prod"}
```

## Habits
- One thing per call, ids from the replies; read the brief after each layer, not only at the end.
- Name things as the cluster will: workload, namespace and pool names are Kubernetes names.
- Every secret a workload lists belongs to the part that talks to that service, and comes from a part that holds
  secrets (Secrets Manager, Vault).
- A plan is a proposal: mark it, show it, let the person merge or discard it.
