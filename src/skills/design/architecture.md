---
name: architecture
description: Designing how an app is built and shipped — parts and links, builds, environments, Kubernetes clusters, namespaces and workloads, releases and migrations, planned changes and plays — with buni's architecture tools, then checking it and exporting drafts (manifests, Argo CD, CI, a brief). Read before designing a system, its deploy path, or a change to either.
---
# Designing the software path

The architecture is the app behind the screens, from code to running pods: what the parts are and how they talk, how
each is built, where it runs, how it ships, and how a change gets there. buni designs it before and while it is built;
nothing in it is live state. Work top down, one layer at a time, and read it back with `read_architecture` as you go.

## Order of work
1. **Parts and links.** `set_part` for every client, service, worker, store, queue, outside service and edge piece
   (DNS, CDN, firewall, load balancer). A database or queue the cloud runs gets `managed` ("RDS Postgres Multi-AZ") and
   never a workload. `link_parts` says who starts each conversation (`calls`, `reads`, `writes`, `publishes`,
   `subscribes`; edge → what it fronts is `routes`) and what passes along it (`carries`). `set_group` draws the system
   or team boundary. Stop here and read `read_architecture {level:"system"}`: every part should have a reason to exist.
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
   `brief` (Markdown). They land in `architecture/FORMAT/` next to the design and say they are drafts: hand them over
   for review, never apply them.

## Compact example
```
set_part {"name":"Returns API","kind":"service","tech":"Node 22"}
set_part {"name":"Main database","kind":"store","tech":"Postgres 16","managed":"RDS Postgres"}
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
