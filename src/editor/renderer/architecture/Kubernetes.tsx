// Kubernetes: the environment's cluster as columns: its node pools and add-ons, one column per namespace with each
// workload and the objects it makes (HPA, PDB, Service, config, service account), and what runs outside it.
import { workloadName, type Architecture, type Environment, type Id, type Workload } from "buni/format/doc.ts";
import { cronText, releasesOf, strategyText } from "./model.ts";
import { edgeChain } from "./layout.ts";
import { Item, Lane, Note, Pills } from "./Paths.tsx";

const range = (w: Workload) => (w.replicas ? `×${w.replicas.min}${w.replicas.max && w.replicas.max > w.replicas.min ? `–${w.replicas.max}` : ""}` : "");

function WorkloadCards({ arch, w, onSelect }: { arch: Architecture; w: Workload; onSelect: (id: Id) => void }) {
  const r = releasesOf(arch, w.part).find((x) => x.path.includes(w.environment));
  const res = w.resources;
  const how = w.kind === "Rollout" && r ? r.strategy.kind : w.nodes && arch.clusters[arch.namespaces[w.namespace]?.cluster ?? ""]?.pools?.find((p) => p.name === w.nodes)?.spot ? "spot" : undefined;
  const cards = [
    <Item key="w" onPick={() => onSelect(w.id)} title={workloadName(arch, w)} lines={[
      [`${w.kind} ${range(w)}`.trim(), how, w.status === "planned" ? "planned" : undefined].filter(Boolean).join(" · "),
      w.before ? "runs before each sync; must finish before rollout" : undefined,
      w.schedule ? `${cronText(w.schedule)} · one at a time` : undefined,
      res ? [res.cpu || res.memory ? `req ${[res.cpu, res.memory].filter(Boolean).join("/")}` : "", res.limitCpu || res.limitMemory ? `lim ${[res.limitCpu, res.limitMemory].filter(Boolean).join("/")}` : ""].filter(Boolean).join(" · ") : undefined,
    ]}>
      {(w.probes?.ready || w.probes?.live) && <span className="arch-green">{[w.probes.ready && `readiness ${w.probes.ready}`, w.probes.live && `liveness ${w.probes.live}`].filter(Boolean).join(" · ")}</span>}
    </Item>,
  ];
  if (w.scale) cards.push(w.scale.by === "queue"
    ? <Item key="scale" title="ScaledObject" lines={[`KEDA · ${w.scale.target}`]} />
    : <Item key="scale" title="HPA" lines={[`${w.scale.by} ${w.scale.target} · ${range(w).slice(1)}`]} />);
  if (w.keep) cards.push(<Item key="pdb" title="PDB" lines={[`minAvailable ${w.keep}`]} />);
  if (w.service || w.ingress) cards.push(<Item key="svc" title={w.ingress ? "Service + Ingress" : "Service"} lines={[w.service ? `ClusterIP :${w.service.port}` : undefined, w.ingress ? `${w.ingress.host}${w.ingress.path && w.ingress.path !== "/" ? w.ingress.path : ""}` : undefined]} />);
  if (w.config?.length || w.secrets?.length) cards.push(<Item key="cfg" title="Config" lines={[...(w.config ?? []).map((c) => `ConfigMap ${c}`), ...(w.secrets ?? []).map((s) => `ExternalSecret ${s}`)]} />);
  if (w.account) cards.push(<Item key="sa" title="ServiceAccount" lines={[`${w.account.name}${w.account.role ? ` → ${w.account.role}` : ""}`]} />);
  return <div className={`arch-group${w.status === "planned" ? " planned" : w.before ? " deploy" : ""}`}>{cards}</div>;
}

export function Kubernetes({ arch, env, onSelect }: { arch: Architecture; env: Environment | undefined; onSelect: (id: Id) => void }) {
  const cluster = env?.cluster ? arch.clusters[env.cluster] : undefined;
  if (!env || !cluster) {
    return <div className="arch-flows-empty"><p>{env ? `${env.name} has no cluster${env.provider ? `: it runs on ${env.provider}` : ""}.` : "No environments yet."} Pick an environment with one, add a cluster with + Add and choose it on the environment, or ask your coding agent to add it with <code>set_cluster</code> and <code>set_environment</code>.</p></div>;
  }
  const namespaces = Object.values(arch.namespaces).filter((n) => n.cluster === cluster.id).sort((a, b) => a.name.localeCompare(b.name));
  const workloads = Object.values(arch.workloads).filter((w) => w.environment === env.id);
  const managed = Object.values(arch.parts).filter((p) => p.managed);
  const name = (id: string) => arch.parts[id]?.name ?? id;
  const front = workloads.find((w) => w.ingress);
  const scales = [...new Set(workloads.flatMap((w) => (w.scale ? [w.scale.by === "queue" ? "KEDA on queue depth" : `HPA on ${w.scale.by}`] : [])))];
  const spot = workloads.filter((w) => cluster.pools?.find((p) => p.name === w.nodes)?.spot).map((w) => workloadName(arch, w));
  const rollouts = workloads.flatMap((w) => (w.kind === "Rollout" ? releasesOf(arch, w.part).filter((r) => r.path.includes(env.id)).map(strategyText) : []));
  return (
    <div className="arch-page">
      <div className="arch-lanes">
        <Lane title="Cluster" sub={`${cluster.name} · ${cluster.provider.toUpperCase()} ${cluster.version ?? ""} · ${env.name}`} onPick={() => onSelect(cluster.id)}>
          {cluster.pools?.length ? <span className="arch-sub">Node pools</span> : null}
          {cluster.pools?.map((p) => (
            <Item key={p.name} title={p.name} lines={[`${p.machine ?? "nodes"} ×${p.min}–${p.max}`, [p.spot ? "spot" : "on-demand", p.taint ? `taint ${p.taint}` : cluster.zones ? `${cluster.zones} AZs` : undefined].filter(Boolean).join(" · ")]} />
          ))}
          {cluster.addons?.length ? <><span className="arch-sub">Add-ons</span><Pills items={cluster.addons} /></> : null}
        </Lane>
        {namespaces.map((ns) => {
          const mine = workloads.filter((w) => w.namespace === ns.id);
          const egress = [...new Set(mine.flatMap((w) => w.egress ?? []))];
          return (
            <Lane key={ns.id} title={ns.name} sub={`namespace${ns.owners ? ` · ${ns.owners}` : ""}`} onPick={() => onSelect(ns.id)}>
              {mine.map((w) => <WorkloadCards key={w.id} arch={arch} w={w} onSelect={onSelect} />)}
              {egress.length > 0 && <Item title="NetworkPolicy" lines={[`egress: ${egress.map(name).join(", ")} only`]} />}
              {!mine.length && <span className="arch-sub">Nothing runs here in {env.name}.</span>}
            </Lane>
          );
        })}
        {managed.length > 0 && (
          <Lane title="Outside the cluster" sub={`${env.provider ?? "cloud"} · managed`} live>
            {managed.map((p) => <Item key={p.id} title={p.managed!.split(" · ")[0]!} lines={[p.name !== p.managed ? p.name : undefined, p.about?.replace(/\.$/, "")]} />)}
          </Lane>
        )}
      </div>
      <div className="arch-notes">
        {front && <Note title="Traffic" lines={[[...edgeChain(arch).slice(-1).map((p) => p.name), "Ingress", "Service", `${workloadName(arch, front)} pods`].join(" → "), "NetworkPolicies: each namespace reaches only what it names"]} />}
        {(scales.length > 0 || spot.length > 0) && <Note title="Scaling" lines={[scales.join(", "), ...(spot.length ? [`spot nodes for ${spot.join(", ")}`] : [])].filter(Boolean)} />}
        {(cluster.gitops || rollouts.length > 0) && <Note title="Delivery" lines={[...(cluster.gitops ? [`${cluster.gitops.tool === "argocd" ? "Argo CD" : "Flux"} syncs ${cluster.gitops.repo}${cluster.gitops.path ? `/${cluster.gitops.path}` : ""}`] : []), ...rollouts.map((s) => `Rollouts ${s}`)]} />}
      </div>
    </div>
  );
}
