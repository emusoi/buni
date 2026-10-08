---
name: deployment
description: Designing where the system runs — environments, regions, clusters, and how each part runs in the words platforms use (Kubernetes Deployments, StatefulSets, CronJobs, serverless functions, managed services) — so an engineer or agent can stand it up without guessing. Read before set_environment, set_cluster or place.
---
# Deployment topology

This is a design, not a config file: say how each part runs and why, in the platform's own words, and leave the YAML to whoever builds it.

## Environments
- One per copy of the system people rely on: `prod`, `staging`, maybe `preview`. Name the provider as chosen ("aws", "fly", "vercel") and the regions it runs in, as the provider spells them.
- Start in one region. Add a second only for a named reason: users far away, a residency rule, surviving a region outage. Write it as a decision.
- Staging mirrors prod's shape at smaller scale; if a part isn't in staging, say why in its note.

## Runtimes
- **Kubernetes**: `deployment` for stateless services and workers, `statefulset` for anything that keeps data on disk, `cronjob` for scheduled work, `job` for one-off runs, `daemonset` for one-per-node agents. Each needs a cluster and a namespace; group a team's parts in one namespace.
- **container** for a service or worker on a managed container platform without Kubernetes (ECS Fargate, Cloud Run, Fly Machines, App Runner): name the platform in `service`. The usual first choice for a small team.
- **function** for spiky or rare traffic and scale to zero; **static** for clients served from a CDN; **vm** only when nothing else fits.
- **managed** for stores, caches and queues by default (RDS, Cloud SQL, ElastiCache, SQS): name the service. Run your own database on a StatefulSet only with a reason written down.
- buni refuses runtimes that don't fit a part: a store isn't a CronJob, a client isn't a StatefulSet, an external is someone else's to run.

## Scale and size
- `scale` min and max are pods (or function instances); set a CPU target when it autoscales. Keep min ≥ 2 for anything on the request path in prod, so one pod dying isn't an outage.
- `resources` in Kubernetes quantities (`250m`, `256Mi`): what one pod asks for. Start small and say so.
- `replicas` on stores and caches are standbys: at least one in prod for anything you can't lose.

## Traffic, config and secrets
- `ingress` is where outside traffic enters: a host and a path. Only clients and services with an API take it; workers never do.
- List the names of the config and secrets each part reads (`DATABASE_URL`, `STRIPE_KEY`). Values never go in the design.

## Check the shape
- Every part (but externals) is placed in every environment; the brief lists what isn't.
- Parts that talk should share a region. A link across regions pays the distance on every call; the brief flags it, and the trace's time budget should include it.
