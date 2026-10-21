// The software path (idea to respond) and the deploy path (commit to production) as lanes, left to right.
import type { ReactNode } from "react";
import { workloadName, type Architecture, type Environment, type Stage } from "buni/format/doc.ts";
import { environmentsInOrder, releasesOf, strategyText } from "./model.ts";
import { edgeChain } from "./layout.ts";

export function Lane({ title, sub, live, gate, children }: { title: string; sub?: string | undefined; live?: boolean; gate?: boolean; children: ReactNode }) {
  return (
    <section className={`arch-lane${live ? " current" : ""}`}>
      <div className="arch-lane-head"><b>{title}</b>{sub && <span className="arch-sub">{sub}</span>}</div>
      {children}
      {gate && <span className="arch-gate-mark" aria-hidden>◆</span>}
    </section>
  );
}
export const Item = ({ title, lines, children }: { title: string; lines?: (string | undefined)[]; children?: ReactNode }) => (
  <div className="arch-item"><b>{title}</b>{lines?.filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}{children}</div>
);
export const Bullets = ({ items }: { items: readonly string[] }) => <>{items.map((s) => <div key={s} className="arch-bullet"><i />{s}</div>)}</>;
export const Pills = ({ items, link, onClick }: { items: readonly string[]; link?: boolean; onClick?: () => void }) => (
  <div className="arch-pills">{items.map((s) => onClick ? <button key={s} type="button" className="arch-pill link" onClick={onClick}>{s}</button> : <span key={s} className={`arch-pill${link ? " link" : ""}`}>{s}</span>)}</div>
);
export const Gate = ({ text }: { text: string }) => <div className="arch-gate">{text}</div>;
export const Note = ({ title, lines }: { title: string; lines: string[] }) => (
  <div className="arch-note"><b>{title}</b>{lines.map((l) => <span key={l}>{l}</span>)}</div>
);

/** "Roll back: Argo Rollouts abort → last good image" as a card titled "Roll back"; one with no lead, whole. */
function stepCard(step: string) {
  const m = step.match(/^([^:→]{2,30}?)(?::\s*| (?=→))(.+)$/);
  return m ? <Item key={step} title={m[1]!.trim()} lines={[m[2]!.trim()]} /> : <Item key={step} title={step} />;
}

export function SoftwarePath({ arch, env, onSee }: { arch: Architecture; env: Environment | undefined; onSee: (view: "deploy" | "kubernetes") => void }) {
  const stages = Object.values(arch.stages).sort((a, b) => a.order - b.order);
  if (!stages.length) return <div className="arch-flows-empty"><p>No software path yet. Ask your coding agent to lay it out with <code>set_stage</code>: idea, code, review, build, ship, run, watch, respond, and the gate between each.</p></div>;
  const cluster = env?.cluster ? arch.clusters[env.cluster] : undefined;
  const running = Object.values(arch.workloads).filter((w) => w.environment === env?.id && !w.before && w.kind !== "Job" && w.kind !== "CronJob" && w.status !== "planned");
  const managed = Object.values(arch.parts).filter((p) => p.managed);
  const isRun = (s: Stage) => /^run/i.test(s.name);
  const last = stages.at(-1);
  return (
    <div className="arch-page">
      <div className="arch-lanes">
        {stages.map((s, i) => (
          <Lane key={s.id} title={s.name} sub={isRun(s) && cluster ? `${cluster.name}${env?.region ? ` · ${env.region}` : ""}` : s.tools} live={isRun(s)}>
            {isRun(s) ? (
              <>
                {edgeChain(arch).length > 0 && <Item title="Edge" lines={[edgeChain(arch).map((p) => p.name).join(" → ")]} />}
                {running.length > 0 && <Item title="Workloads" lines={[running.map((w) => `${workloadName(arch, w)} ×${w.replicas?.min ?? 1}${w.replicas?.max && w.replicas.max > w.replicas.min ? `–${w.replicas.max}` : ""}`).join(" · ")]} />}
                {managed.length > 0 && <Item title="Managed" lines={[managed.map((p) => p.managed!.split(" ")[0]).filter((x, k, all) => all.indexOf(x) === k).join(" · ")]} />}
                <span className="arch-sub">See</span>
                <Pills items={["Kubernetes →"]} onClick={() => onSee("kubernetes")} />
              </>
            ) : i === 0 || !s.gate ? (s.steps ?? []).map(stepCard) : <Bullets items={s.steps ?? []} />}
            {s.makes?.length ? <><span className="arch-sub">Makes</span><Pills items={s.makes} /></> : null}
            {/^ship/i.test(s.name) && <><span className="arch-sub">See</span><Pills items={["Deploy path →"]} onClick={() => onSee("deploy")} /></>}
            {s === last && s.about && <span className="arch-loops">{s.about.split(":")[0]}</span>}
            {s.gate && <Gate text={`Gate: ${s.gate}`} />}
          </Lane>
        ))}
      </div>
      {last?.about && <div className="arch-loop"><span>↺</span><span>{last.name} feeds {stages[0]!.name}: {last.about.replace(/^[^:]*:\s*/, "")}</span></div>}
    </div>
  );
}

export function DeployPath({ arch, env }: { arch: Architecture; env: Environment | undefined }) {
  const envs = environmentsInOrder(arch);
  const built = Object.values(arch.parts).filter((p) => p.build);
  const repos = [...new Set(built.map((p) => p.build!.repo))];
  const steps = [...new Set(built.flatMap((p) => p.build!.steps ?? []))];
  const artifacts = [...new Set(built.flatMap((p) => (p.build!.artifact ? [p.build!.artifact] : [])))];
  const stage = (name: string) => Object.values(arch.stages).find((s) => s.name.toLowerCase() === name);
  const secrets = [...new Set(Object.values(arch.workloads).flatMap((w) => w.secrets ?? []))];
  const readers = [...new Set(Object.values(arch.workloads).filter((w) => w.secrets?.length).map((w) => arch.parts[w.part]?.name ?? w.part))];
  const vault = Object.values(arch.parts).find((p) => /secret/i.test(p.managed ?? ""));
  const migrations = Object.values(arch.migrations);
  const edge = edgeChain(arch);
  return (
    <div className="arch-page">
      <div className="arch-lanes gated">
        <Lane title="Commit" sub="main · pull requests" gate>
          {repos.map((r) => <Item key={r} title={r.split("/").at(-1) ?? r} lines={[r.replace(/^https?:\/\//, "")]} />)}
          {stage("review")?.gate && <Gate text={`Gate to next: ${stage("review")!.gate}`} />}
        </Lane>
        <Lane title="Build" sub={stage("build")?.tools} gate>
          <Bullets items={steps} />
          {artifacts.length > 0 && <><span className="arch-sub">Makes</span><div className="arch-pills column">{artifacts.map((a) => <span key={a} className="arch-pill">{a}</span>)}</div></>}
          {stage("build")?.gate && <Gate text={`Gate to next: ${stage("build")!.gate}`} />}
        </Lane>
        {envs.map((e, i) => {
          const last = i === envs.length - 1;
          const live = e.id === (env?.id ?? envs.at(-1)?.id);
          const cluster = e.cluster ? arch.clusters[e.cluster] : undefined;
          const here = Object.values(arch.workloads).filter((w) => w.environment === e.id && !w.before)
            .sort((a, b) => Number(a.status === "planned") - Number(b.status === "planned") || Number(a.kind === "CronJob") - Number(b.kind === "CronJob") || a.id.localeCompare(b.id));
          return (
            <Lane key={e.id} title={e.name} sub={[e.preview ? "one per pull request" : undefined, e.provider, e.region].filter(Boolean).join(" · ")} live={live} gate={!last}>
              {last && edge.length > 0 && (
                <div className="arch-edge">{edge.map((p, k) => <span key={p.id} className="arch-edge-hop"><span className="arch-pill link">{p.name}</span>{k < edge.length - 1 && <span>→</span>}</span>)}</div>
              )}
              {cluster ? (
                <>
                  {here.map((w) => {
                    const r = releasesOf(arch, w.part).find((x) => x.path.includes(e.id));
                    return (
                      <Item key={w.id} title={w.kind === "CronJob" || w.kind === "Job" ? workloadName(arch, w) : arch.parts[w.part]?.name ?? w.part} lines={[`${w.kind.toLowerCase()} ×${w.replicas?.min ?? 1}${w.replicas?.max && w.replicas.max > w.replicas.min ? `–${w.replicas.max}` : ""} · ${cluster.name}${w.status === "planned" ? " · planned" : ""}`]}>
                        {last && r && r.strategy.kind !== "rolling" && <span className="arch-green">{strategyText(r)}{r.checks?.[0] ? `, rolls back unless ${r.checks[0]}` : ""}</span>}
                      </Item>
                    );
                  })}
                  {Object.values(arch.parts).filter((p) => p.managed && p.kind !== "external" && !/registry|secret/i.test(`${p.tech} ${p.managed}`)).map((p) => <Item key={p.id} title={p.name} lines={[`managed · ${p.managed}`]} />)}
                </>
              ) : (
                built.filter((p) => !p.managed && p.status !== "planned").map((p) => <Item key={p.id} title={p.name} lines={[`${p.build?.artifact ?? "build"} · ${e.provider ?? "provider"}`]} />)
              )}
            </Lane>
          );
        })}
      </div>
      <div className="arch-notes">
        {secrets.length > 0 && <Note title="Config and secrets" lines={[`${secrets.join(", ")}${vault ? ` in ${vault.managed}` : ""}`, `read by ${readers.join(", ")}; set per environment`]} />}
        {migrations.length > 0 && <Note title="Data" lines={migrations.map((m) => `${m.name} on ${arch.parts[m.store]?.name ?? m.store}${m.release ? ` runs before ${arch.releases[m.release]?.name ?? m.release}` : ""} (${m.safe})`)} />}
      </div>
    </div>
  );
}
