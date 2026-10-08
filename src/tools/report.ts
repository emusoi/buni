// The whole system design as one document to share: a cover with the intent, the map, then every
// part, call, table, shape, cache rule, trace and placement, and what is worth a look. Printed to PDF.
import { bodyTypes, type Doc, type Field, type Id, type Part, type PartKind, type Placement } from "../format/doc.ts";
import { accessText, decisionsInOrder, sectionsInOrder } from "./context.ts";
import { designNotes } from "./notes.ts";
import { environmentsInOrder, runtimeLabel } from "./topology.ts";
import { allCalls, callName, stalenessGrid, type Call } from "./calls.ts";

const CARD_W = 196;
const CARD_H = 78;
/** Left to right in the order a request travels: clients, services, queues, stores. */
const COLUMN: Record<PartKind, number> = { client: 0, service: 1, external: 1, queue: 2, cache: 3, store: 3 };

/** Where each part sits: where someone put it, else in its kind's column, in index order. */
function mapLayout(parts: readonly Part[]): Map<Id, { x: number; y: number }> {
  const used = [...new Set(parts.map((p) => COLUMN[p.kind]))].sort((a, b) => a - b);
  const rows = new Map<number, number>();
  const at = new Map<Id, { x: number; y: number }>();
  for (const p of parts) {
    const col = used.indexOf(COLUMN[p.kind]);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    at.set(p.id, p.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : { x: col * (CARD_W + 110), y: row * (CARD_H + 24) });
  }
  return at;
}

/** Every user string goes through this: the report is HTML and the design is free text. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const byIndex = <T extends { index: string; id: Id }>(xs: T[]): T[] =>
  xs.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));

const KIND: Record<Part["kind"], string> = { client: "Client", service: "Service", store: "Store", cache: "Cache", queue: "Queue", external: "External" };

function apiLabel(p: Part): string {
  return p.kind === "service" ? ` · ${{ rest: "REST", graphql: "GraphQL", none: "worker" }[p.api ?? "rest"]}` : "";
}

function fields(fs: readonly Field[]): string {
  if (fs.length === 0) return `<span class="dim">—</span>`;
  return fs.map((f) => `<code>${esc(f.name)}${f.optional ? "?" : ""}<span class="dim">: ${esc(f.type)}</span></code>`).join(" ");
}

/** The system map as an SVG: cards where they sit on the canvas, links as curves with what they carry. */
function mapSvg(doc: Doc): string {
  const parts = byIndex(Object.values(doc.parts));
  if (parts.length === 0) return `<p class="dim">No parts yet.</p>`;
  const at = mapLayout(parts);
  const xs = [...at.values()].map((p) => p.x);
  const ys = [...at.values()].map((p) => p.y);
  const minX = Math.min(...xs) - 40;
  const minY = Math.min(...ys) - 40;
  const w = Math.max(...xs) + CARD_W + 40 - minX;
  const h = Math.max(...ys) + CARD_H + 40 - minY;
  const links = Object.values(doc.links).flatMap((l) => {
    const a = at.get(l.from);
    const b = at.get(l.to);
    if (!a || !b) return [];
    const forward = b.x >= a.x;
    const x1 = forward ? a.x + CARD_W : a.x;
    const x2 = forward ? b.x : b.x + CARD_W;
    const y1 = a.y + CARD_H / 2;
    const y2 = b.y + CARD_H / 2;
    const mx = (x1 + x2) / 2;
    const carries = (l.carries ?? []).map((id) => doc.shapes[id]?.name ?? id);
    // On the map a label names two shapes at most; the parts pages list them all.
    const shown = carries.length > 2 ? `${carries.slice(0, 2).join(", ")} +${carries.length - 2}` : carries.join(", ");
    const label = esc(carries.length ? `${l.kind} · ${shown}` : l.kind);
    const dash = l.kind === "publishes" || l.kind === "subscribes" ? ` stroke-dasharray="5 4"` : "";
    const lw = label.length * 5.4 + 12;
    return [{ wire: `<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" class="wire"${dash} marker-end="url(#arrow)"/>`, label: `<g class="wire-label"><rect x="${mx - lw / 2}" y="${(y1 + y2) / 2 - 8}" width="${lw}" height="16" rx="4"/><text x="${mx}" y="${(y1 + y2) / 2 + 3.5}">${label}</text></g>` }];
  });
  const boxes = parts.map((p) => {
    const q = at.get(p.id) ?? { x: 0, y: 0 };
    return `<g class="card k-${p.kind}"><rect x="${q.x}" y="${q.y}" width="${CARD_W}" height="${CARD_H}" rx="8"/><text x="${q.x + 12}" y="${q.y + 22}" class="kind">${esc(KIND[p.kind].toUpperCase() + apiLabel(p).toUpperCase())}</text><text x="${q.x + 12}" y="${q.y + 44}" class="name">${esc(clip(p.name, 22))}</text><text x="${q.x + 12}" y="${q.y + 63}" class="tech">${esc(clip(p.tech ?? "", 32))}</text></g>`;
  });
  return `<svg class="map" viewBox="${minX} ${minY} ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8f8c84"/></marker></defs>${links.map((l) => l.wire).join("")}${boxes.join("")}${links.map((l) => l.label).join("")}</svg>`;
}

function callRow(doc: Doc, c: Call): string {
  const v = c.value;
  const kind = c.rest ? c.value.method : c.value.kind;
  const name = c.rest ? c.value.path : c.value.name;
  const io = c.rest
    ? `<div>takes ${fields(bodyTypes(doc, c.value, "request"))}</div><div>returns ${fields(bodyTypes(doc, c.value, "response"))}</div>`
    : `<div>args ${fields(c.value.args)}</div><div>returns <code>${esc(c.value.returns)}${c.value.nullable ? "" : "!"}</code></div>`;
  const tables = (ids: Id[]) => ids.map((id) => esc(doc.tables[id]?.name ?? id)).join(", ");
  const touch = [
    v.reads.length && `reads ${tables(v.reads)}`,
    v.writes.length && `writes ${tables(v.writes)}`,
    v.emits.length && `emits ${v.emits.map((id) => esc(doc.events[id]?.name ?? id)).join(", ")}`,
    v.access && `<b>who</b> ${esc(accessText(doc, v.access))}`,
    v.cache && `cached ${v.cache.ttlSeconds}s in ${esc(doc.parts[v.cache.part]?.name ?? v.cache.part)} as <code>${esc(v.cache.key)}</code>`,
    v.invalidates?.length && `makes stale ${v.invalidates.map((id) => { const x = allCalls(doc).find((y) => y.value.id === id); return esc(x ? callName(x) : id); }).join(", ")}`,
  ].filter(Boolean);
  const errors = (v.errors ?? []).map((e) => `<code>${esc(e.code)}</code> ${esc(e.when)}`).join("; ");
  return `<tr><td><span class="method m-${esc(kind.toLowerCase())}">${esc(kind)}</span></td><td><code class="strong">${esc(name)}</code><div class="dim">${esc(v.summary)}</div></td><td class="small">${io}</td><td class="small">${touch.join("<br>") || `<span class="dim">—</span>`}${errors ? `<div class="err">fails: ${errors}</div>` : ""}</td></tr>`;
}

function placementText(doc: Doc, pl: Placement): string {
  const cluster = pl.cluster ? doc.clusters[pl.cluster] : undefined;
  const bits = [
    pl.regions.join(", "),
    cluster && `${esc(cluster.name)}${pl.namespace ? ` / ${esc(pl.namespace)}` : ""}`,
    pl.service && esc(pl.service),
    pl.scale && (pl.scale.min === pl.scale.max ? `${pl.scale.min}×` : `${pl.scale.min}–${pl.scale.max}×${pl.scale.cpuTarget ? ` at ${pl.scale.cpuTarget}% CPU` : ""}`),
    pl.resources && esc([pl.resources.cpu, pl.resources.memory].filter(Boolean).join(" / ")),
    pl.replicas !== undefined && `${pl.replicas} standby`,
    pl.schedule && `runs <code>${esc(pl.schedule)}</code>`,
    pl.ingress && `<code>${esc(pl.ingress.host + (pl.ingress.path === "/" ? "" : pl.ingress.path))}</code>`,
    pl.secrets?.length && `secrets ${pl.secrets.map((s) => `<code>${esc(s)}</code>`).join(" ")}`,
  ].filter(Boolean);
  return bits.join(" · ");
}

/** What deserves attention before building. */
export function reportNotes(doc: Doc): string[] {
  return designNotes(doc);
}

export interface ReportOptions {
  title: string;
  /** "28 Sep 2026", shown on the cover. */
  date: string;
  /** Imported things by id → their file, noted where they appear. */
  owners?: Record<Id, string>;
}

/** The whole system as a printable HTML document. */
export function systemReport(doc: Doc, o: ReportOptions): string {
  const parts = byIndex(Object.values(doc.parts));
  const calls = allCalls(doc);
  const from = (id: Id) => (o.owners?.[id] ? ` <span class="from">${esc(o.owners[id])}</span>` : "");
  const sections: string[] = [];
  const count = (n: number, noun: string) => `<div class="stat"><b>${n}</b><span>${noun}${n === 1 ? "" : "s"}</span></div>`;

  // Cover and intent.
  const intent = sectionsInOrder(doc).map((s) => `<h3>${esc(s.heading)}</h3>${s.body.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("")}`).join("");
  const decisions = decisionsInOrder(doc).map((d) => `<li>${esc(d.text)} <span class="dim">— ${esc(d.by)}, ${esc(d.at.slice(0, 10))}</span></li>`).join("");
  sections.push(`<section class="cover"><div class="eyebrow">System design</div><h1>${esc(o.title)}</h1><div class="date">${esc(o.date)}</div>
    <div class="stats">${count(parts.length, "part")}${count(calls.length, "operation")}${count(Object.keys(doc.tables).length, "table")}${count(Object.keys(doc.shapes).length, "shape")}${count(Object.keys(doc.traces).length, "trace")}${count(Object.keys(doc.environments).length, "environment")}</div>
    ${intent ? `<div class="intent">${intent}</div>` : ""}${decisions ? `<h3>Decisions</h3><ul class="decisions">${decisions}</ul>` : ""}</section>`);

  sections.push(`<section><h2>Map</h2>${mapSvg(doc)}</section>`);

  // Why: requirements by phase, then what is still open.
  const nameOf = (id: Id) => { const c = calls.find((x) => x.value.id === id); return c ? callName(c) : (doc.parts[id] ?? doc.tables[id] ?? doc.events[id] ?? doc.shapes[id] ?? doc.traces[id] ?? doc.pages[id] ?? doc.flows[id])?.name ?? id; };
  const reqs = byIndex(Object.values(doc.requirements));
  if (reqs.length) {
    const phases = byIndex(Object.values(doc.phases));
    const groups: [string, typeof reqs][] = [...phases.map((ph): [string, typeof reqs] => [`${ph.name}${ph.goal ? ` — ${ph.goal}` : ""}`, reqs.filter((q) => q.phase === ph.id)]), ["No phase yet", reqs.filter((q) => !q.phase)]];
    sections.push(`<section><h2>Requirements <span class="dim">${reqs.length}</span></h2>${groups.filter(([, qs]) => qs.length).map(([h, qs]) => `<h3>${esc(h)}</h3><table class="calls"><tbody>${qs.map((q) => `<tr><td><span class="badge">${q.priority}</span></td><td><b>${esc(q.title)}</b>${q.detail ? `<div class="dim small">${esc(q.detail)}</div>` : ""}</td><td class="small">${q.servedBy.length ? q.servedBy.map((id) => esc(nameOf(id))).join(", ") : `<span class="err">nothing serves it yet</span>`}</td></tr>`).join("")}</tbody></table>`).join("")}</section>`);
  }
  const questions = byIndex(Object.values(doc.questions));
  if (questions.length) {
    const block = (q: (typeof questions)[number]) => `<div class="card"><div class="eyebrow">${q.kind === "assumption" ? "assumption" : q.status === "open" ? "open question" : "decided"}${q.about.length ? ` · ${esc(q.about.map(nameOf).join(", "))}` : ""}</div><h3>${esc(q.text)}</h3>${q.options.length ? `<ul>${q.options.map((o) => `<li>${o.name === q.chosen ? "<b>✓ " : ""}${esc(o.name)}${o.name === q.chosen ? "</b>" : ""}${o.pros ? `<div class="small">+ ${esc(o.pros)}</div>` : ""}${o.cons ? `<div class="small dim">− ${esc(o.cons)}</div>` : ""}</li>`).join("")}</ul>` : ""}</div>`;
    sections.push(`<section><h2>Questions and assumptions <span class="dim">${questions.filter((q) => q.status === "open" && q.kind === "question").length} open</span></h2><div class="grid">${questions.map(block).join("")}</div></section>`);
  }
  const roles = byIndex(Object.values(doc.roles));
  if (roles.length || calls.some((c) => c.value.access)) {
    sections.push(`<section><h2>Access</h2>${roles.length ? `<ul>${roles.map((r) => `<li><b>${esc(r.name)}</b>${r.description ? ` <span class="dim">— ${esc(r.description)}</span>` : ""}</li>`).join("")}</ul>` : ""}<table class="calls"><thead><tr><th>Call</th><th>Who may call</th></tr></thead><tbody>${calls.map((c) => `<tr><td><code>${esc(callName(c))}</code></td><td>${c.value.access ? esc(accessText(doc, c.value.access)) : `<span class="err">not said</span>`}</td></tr>`).join("")}</tbody></table></section>`);
  }

  // Parts.
  sections.push(`<section><h2>Parts</h2><div class="grid">${parts.map((p) => {
    const links = Object.values(doc.links).filter((l) => l.from === p.id || l.to === p.id).map((l) => {
      const other = doc.parts[l.from === p.id ? l.to : l.from]?.name ?? "";
      const carries = (l.carries ?? []).map((id) => doc.shapes[id]?.name ?? id).join(", ");
      const f = l.from === p.id ? l.failure : undefined;
      const failure = f ? [f.timeoutMs !== undefined && `${f.timeoutMs} ms timeout`, f.retries !== undefined && `${f.retries} retries`, f.idempotencyKey && `idempotent on ${f.idempotencyKey}`, f.fallback && `else ${f.fallback}`].filter(Boolean).join(", ") : "";
      return `<li>${l.from === p.id ? `<b>${l.kind}</b> ${esc(other)}` : `${esc(other)} <b>${l.kind}</b>`}${carries ? ` <span class="dim">· ${esc(carries)}</span>` : ""}${failure ? `<div class="small dim">${esc(failure)}</div>` : ""}</li>`;
    }).join("");
    const runs = Object.values(doc.placements).filter((pl) => pl.part === p.id).map((pl) => `<li><b>${esc(doc.environments[pl.environment]?.name ?? pl.environment)}</b> ${runtimeLabel(pl.runtime)} · ${placementText(doc, pl)}</li>`).join("");
    return `<div class="card"><div class="eyebrow">${KIND[p.kind]}${apiLabel(p)}${p.tech ? ` · ${esc(p.tech)}` : ""}</div><h3>${esc(p.name)}${from(p.id)}</h3><p>${esc(p.purpose)}</p>${p.ifDown ? `<p class="small"><b>If it is down:</b> ${esc(p.ifDown)}</p>` : ""}${links ? `<ul>${links}</ul>` : ""}${runs ? `<div class="sub">Runs</div><ul>${runs}</ul>` : ""}</div>`;
  }).join("")}</div></section>`);

  // API, one block per service with calls.
  for (const s of parts.filter((p) => p.kind === "service" && calls.some((c) => c.value.service === p.id))) {
    const own = calls.filter((c) => c.value.service === s.id);
    sections.push(`<section><h2>API · ${esc(s.name)}${from(s.id)} <span class="dim">${own.length} ${s.api === "graphql" ? "operations" : "endpoints"}</span></h2><table class="calls"><thead><tr><th></th><th>Call</th><th>Data in and out</th><th>Touches</th></tr></thead><tbody>${own.map((c) => callRow(doc, c)).join("")}</tbody></table></section>`);
  }

  // Data.
  for (const store of parts.filter((p) => p.kind === "store" && Object.values(doc.tables).some((t) => t.store === p.id))) {
    const tables = byIndex(Object.values(doc.tables).filter((t) => t.store === store.id));
    sections.push(`<section><h2>Data · ${esc(store.name)} <span class="dim">${tables.length} tables</span></h2><div class="grid">${tables.map((t) => `<div class="card table"><h3><code>${esc(t.name)}</code>${from(t.id)}</h3><table>${t.columns.map((c) => `<tr><td>${c.primary ? "🔑" : c.ref ? "↗" : ""}</td><td><code>${esc(c.name)}</code></td><td><code class="dim">${esc(c.type)}${c.nullable ? " null" : ""}${c.unique ? " unique" : ""}</code>${c.classification ? ` <span class="badge">${c.classification}</span>` : ""}</td><td class="dim small">${c.ref ? `→ ${esc(doc.tables[c.ref.table]?.name ?? c.ref.table)}.${esc(c.ref.column)}` : ""}</td></tr>`).join("")}</table></div>`).join("")}</div></section>`);
  }

  // Shapes.
  const shapes = byIndex(Object.values(doc.shapes));
  if (shapes.length) {
    sections.push(`<section><h2>Shapes <span class="dim">${shapes.length}</span></h2><div class="grid tight">${shapes.map((s) => `<div class="card"><h3><code>${esc(s.name)}</code>${s.values ? ` <span class="badge">enum</span>` : ""}${from(s.id)}</h3>${s.note ? `<p class="dim small">${esc(s.note)}</p>` : ""}<div class="small">${s.values ? s.values.map((v) => `<code>${esc(v)}</code>`).join(" · ") : fields(s.fields)}</div></div>`).join("")}</div></section>`);
  }

  // Cache.
  const { reads, writes, cell } = stalenessGrid(doc);
  if (reads.length) {
    sections.push(`<section><h2>Cache <span class="dim">${reads.length} cached reads</span></h2><table class="calls"><thead><tr><th>Cached read</th><th>Kept</th><th>Key</th><th>Made stale by</th><th>Risk</th></tr></thead><tbody>${reads.map((r) => {
      const by = writes.filter((w) => cell(w, r) === "set").map(callName);
      const risk = writes.filter((w) => cell(w, r) === "missing").map(callName);
      return `<tr><td><code class="strong">${esc(callName(r))}</code></td><td>${r.value.cache?.ttlSeconds}s in ${esc(doc.parts[r.value.cache?.part ?? ""]?.name ?? "")}</td><td><code>${esc(r.value.cache?.key ?? "")}</code></td><td class="small">${esc(by.join(", ")) || `<span class="dim">—</span>`}</td><td class="small ${risk.length ? "err" : "ok"}">${risk.length ? `stale if ${esc(risk.join(", "))} runs` : "fresh"}</td></tr>`;
    }).join("")}</tbody></table></section>`);
  }

  // Traces.
  const traces = byIndex(Object.values(doc.traces));
  if (traces.length) {
    sections.push(`<section><h2>Traces</h2>${traces.map((t) => {
      const budget = t.steps.filter((s) => !s.async).reduce((sum, s) => sum + (s.ms ?? 0), 0);
      const firstAsync = t.steps.findIndex((s) => s.async);
      const rows = t.steps.map((s, i) => {
        const via = s.via ? (calls.find((c) => c.value.id === s.via) ? callName(calls.find((c) => c.value.id === s.via) as Call) : doc.events[s.via]?.name ?? s.via) : "";
        const divider = i === firstAsync ? `<tr class="async-row"><td colspan="5">after the response</td></tr>` : "";
        return `${divider}<tr${s.async ? ` class="async"` : ""}><td class="n">${i + 1}</td><td>${esc(doc.parts[s.from]?.name ?? s.from)} → ${esc(doc.parts[s.to]?.name ?? s.to)}</td><td><b>${esc(s.action)}</b>${via && via !== s.action ? ` <span class="dim">${esc(via)}</span>` : ""}</td><td><code>${esc(s.carries ? doc.shapes[s.carries]?.name ?? s.carries : "")}</code></td><td class="dim">${s.ms !== undefined ? `${s.ms} ms` : ""}</td></tr>${s.ifFails ? `<tr${s.async ? ` class="async"` : ""}><td></td><td colspan="4" class="small err">if it fails: ${esc(s.ifFails)}</td></tr>` : ""}`;
      }).join("");
      return `<div class="trace"><h3>${esc(t.name)}${t.page ? ` <span class="dim">from ${esc(doc.pages[t.page]?.name ?? t.page)}</span>` : ""}${budget ? ` <span class="dim">· ~${budget} ms before the response</span>` : ""}</h3><table class="steps">${rows}</table></div>`;
    }).join("")}</section>`);
  }

  // Topology.
  const envs = environmentsInOrder(doc);
  if (envs.length) {
    sections.push(`<section><h2>Topology</h2>${envs.map((e) => {
      const placements = Object.values(doc.placements).filter((pl) => pl.environment === e.id);
      const clusters = Object.values(doc.clusters).filter((c) => c.environment === e.id);
      return `<div class="env"><h3>${esc(e.name)} <span class="dim">${esc(e.provider)} · ${esc(e.regions.join(", "))}</span></h3>${clusters.length ? `<p class="small">${clusters.map((c) => `<b>${esc(c.name)}</b> ${esc(c.kind)}${c.version ? ` ${esc(c.version)}` : ""} in ${esc(c.region)}`).join(" · ")}</p>` : ""}<table class="calls"><tbody>${placements.map((pl) => `<tr><td><b>${esc(doc.parts[pl.part]?.name ?? pl.part)}</b></td><td><span class="method">${runtimeLabel(pl.runtime)}</span></td><td class="small">${placementText(doc, pl)}</td></tr>`).join("")}</tbody></table></div>`;
    }).join("")}</section>`);
  }

  // Pages and what they use.
  const pages = Object.values(doc.pages).filter((p) => p.route !== undefined).sort((a, b) => (a.index < b.index ? -1 : 1));
  const rootOf = (id: Id) => { let n = doc.nodes[id]; while (n?.parent !== undefined) n = doc.nodes[n.parent]; return n?.id; };
  const pageRows = pages.flatMap((p) => {
    const used = new Set<string>();
    for (const c of Object.values(doc.connections)) if (c.page === p.id && c.endpoint) used.add(c.endpoint);
    for (const n of Object.values(doc.nodes)) if (n.bind && rootOf(n.id) === p.frame) used.add(n.bind.endpoint);
    const names = [...used].map((id) => { const c = calls.find((x) => x.value.id === id); return c ? callName(c) : id; });
    return [`<tr><td><b>${esc(p.name)}</b></td><td><code>${esc(p.route ?? "")}</code></td><td class="small">${names.length ? names.map((n) => `<code>${esc(n)}</code>`).join(" ") : `<span class="dim">—</span>`}</td></tr>`];
  });
  if (pageRows.length) sections.push(`<section><h2>Pages <span class="dim">${pages.length}</span></h2><table class="calls"><thead><tr><th>Page</th><th>Route</th><th>Calls and shows</th></tr></thead><tbody>${pageRows.join("")}</tbody></table></section>`);

  const notes = reportNotes(doc);
  const reviews = Object.values(doc.reviews);
  const threads = Object.values(doc.threads).filter((t) => t.state !== "resolved");
  if (reviews.length || threads.length) {
    sections.push(`<section><h2>Review</h2>${reviews.length ? `<table class="calls"><tbody>${reviews.map((r) => `<tr><td>${esc(nameOf(r.id))}</td><td><span class="badge">${r.state}</span></td><td class="dim small">${esc(r.by)}, ${esc(r.at.slice(0, 10))}</td></tr>`).join("")}</tbody></table>` : ""}${threads.map((t) => `<h3>On ${esc(nameOf(t.target))}</h3><ul>${t.posts.map((p) => `<li><b>${esc(p.author)}</b> ${esc(p.body)}</li>`).join("")}</ul>`).join("")}</section>`);
  }
  sections.push(`<section><h2>Worth a look</h2>${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p>Nothing to fix: every link says what it carries, every cached read goes stale when it should, and every part runs somewhere.</p>`}</section>`);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>${REPORT_CSS}</style></head><body>${sections.join("")}</body></html>`;
}

const REPORT_CSS = `
@page { size: A4 landscape; margin: 14mm 14mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10.5px/1.5 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #302f29; }
code { font: 9.5px ui-monospace, Menlo, monospace; }
.strong { font-weight: 700; font-size: 10.5px; }
section { break-before: page; }
section:first-child { break-before: auto; }
h1 { margin: 6px 0 4px; font-size: 34px; letter-spacing: -0.02em; }
h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: -0.01em; }
h3 { margin: 10px 0 4px; font-size: 12.5px; }
p { margin: 0 0 6px; }
.dim { color: #84837f; font-weight: 400; }
.small { font-size: 9.5px; }
.eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #84837f; }
.date { color: #84837f; margin-bottom: 18px; }
.stats { display: flex; gap: 10px; margin: 8px 0 20px; }
.stat { padding: 10px 14px; border-radius: 8px; background: #f6f6f3; min-width: 90px; }
.stat b { display: block; font-size: 20px; }
.stat span { color: #595853; }
.intent { columns: 2; column-gap: 28px; }
.intent h3 { break-after: avoid; }
.decisions { padding-left: 16px; }
.map { width: 100%; max-height: 165mm; }
.map .card rect { fill: #fff; stroke: #d9d7d1; }
.map .k-store rect { fill: #faf9f6; }
.map .k-external rect { stroke-dasharray: 4 3; }
.map .kind { font: 700 8.5px -apple-system, sans-serif; fill: #84837f; letter-spacing: 0.05em; }
.map .name { font: 700 13px -apple-system, sans-serif; fill: #302f29; }
.map .tech { font: 10px -apple-system, sans-serif; fill: #595853; }
.map .wire { fill: none; stroke: #8f8c84; stroke-width: 1.3; }
.map .wire-label rect { fill: #fff; stroke: #e2e0da; }
.map .wire-label text { font: 9px -apple-system, sans-serif; fill: #595853; text-anchor: middle; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.grid.tight { grid-template-columns: repeat(4, 1fr); }
.card { break-inside: avoid; padding: 10px 12px; border: 1px solid #e2e0da; border-radius: 8px; }
.card h3 { margin-top: 2px; }
.card ul { margin: 4px 0 0; padding-left: 14px; }
.card .sub { margin-top: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #84837f; }
.card.table table { width: 100%; border-collapse: collapse; }
.card.table td { padding: 1px 4px 1px 0; vertical-align: top; }
table.calls { width: 100%; border-collapse: collapse; }
table.calls th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #84837f; padding: 4px 8px; border-bottom: 1px solid #d9d7d1; }
table.calls td { padding: 6px 8px; border-bottom: 1px solid #ededE9; vertical-align: top; }
table.calls tr { break-inside: avoid; }
.method { display: inline-block; padding: 1px 6px; border-radius: 4px; font: 700 8.5px ui-monospace, Menlo, monospace; background: #ededE9; text-transform: uppercase; }
.m-get, .m-query { color: #3c7856; background: #e3eee7; }
.m-post, .m-mutation { color: #34458a; background: #e6e9f5; }
.m-put, .m-patch { color: #8a4f0e; background: #fbf3e6; }
.m-delete { color: #9a2a1f; background: #fbeeec; }
.m-subscription { color: #a33c6f; background: #f6e6ee; }
.err { color: #8a4f0e; }
.ok { color: #3c7856; }
.badge { font-size: 8px; padding: 0 4px; border-radius: 3px; background: #ededE9; color: #595853; }
.from { font: 600 8px -apple-system, sans-serif; padding: 1px 5px; border-radius: 4px; background: #eef0f6; color: #34458a; }
.trace { break-inside: avoid; margin-bottom: 14px; }
table.steps { width: 100%; border-collapse: collapse; }
table.steps td { padding: 4px 8px; border-bottom: 1px solid #ededE9; }
table.steps .n { width: 22px; color: #84837f; font-weight: 700; }
table.steps tr.async td { color: #595853; }
table.steps tr.async-row td { font-size: 8.5px; font-weight: 700; text-transform: uppercase; color: #8a4f0e; background: #fbf3e6; padding: 2px 8px; }
.env { break-inside: avoid; margin-bottom: 14px; }
.notes li { margin-bottom: 4px; }
`;
