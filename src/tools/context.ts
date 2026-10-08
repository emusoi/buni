// A brief an agent can build from: the design doc, then the slice of the system that matters for
// one part, page, endpoint or operation, table or trace, with its neighbours. Without a focus, the whole system.
import { designNotes } from "./notes.ts";
import { screenText, terminalClientText } from "./terminal.ts";
import { placementLine, topologyText } from "./topology.ts";
import { bodyTypes, outline, pieceName, reviewablePieces, reviewOf, walkFlow, type Access, type Connection, type Decision, type Doc, type Endpoint, type Field, type Id, type Link, type Operation, type Page, type Part, type QueueEvent, type Section, type Shape, type Table, type Thread, type Trace } from "../format/doc.ts";

export function sectionsInOrder(doc: Doc): Section[] {
  return Object.values(doc.sections).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
}

export function decisionsInOrder(doc: Doc): Decision[] {
  return Object.values(doc.decisions).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

/** The design doc as plain text, for agents' context. */
export function docText(doc: Doc): string {
  const parts = sectionsInOrder(doc).map((s) => `## ${s.heading} (section ${s.id})\n${s.body}`);
  const decisions = decisionsInOrder(doc);
  if (decisions.length) parts.push(`## Decisions\n${decisions.map((d) => `- ${d.text} (${d.by}, ${d.at.slice(0, 10)}, decision ${d.id})`).join("\n")}`);
  return parts.join("\n\n");
}

export type Focus = { part: Id } | { page: Id } | { flow: Id } | { endpoint: Id } | { table: Id } | { trace: Id };

/** A REST endpoint or a GraphQL operation. */
type Call = Endpoint | Operation;
const isRest = (c: Call): c is Endpoint => "method" in c;
const label = (c: Call) => (isRest(c) ? `${c.method} ${c.path}` : `${c.kind} ${c.name}`);
/** Fields whose types a call uses: a REST request and response, or GraphQL arguments and the returned type. */
const typesOf = (doc: Doc, c: Call): Field[] => (isRest(c) ? [...bodyTypes(doc, c, "request"), ...bodyTypes(doc, c, "response")] : [...c.args, { name: c.name, type: c.returns }]);

const byIndex = <T extends { index: string; id: Id }>(xs: T[]): T[] =>
  xs.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));

function callsOf(doc: Doc): Call[] {
  return [...byIndex(Object.values(doc.endpoints)), ...byIndex(Object.values(doc.operations))];
}

function fields(fs: readonly Field[]): string {
  return fs.length ? `{ ${fs.map((f) => `${f.name}${f.optional ? "?" : ""}: ${f.type}`).join(", ")} }` : "{}";
}

function partLine(p: Part): string {
  const api = p.kind === "service" ? { rest: ", REST", graphql: ", GraphQL", none: ", worker" }[p.api ?? "rest"] : "";
  const terminal = terminalClientText(p);
  return `- ${p.kind}${api} **${p.name}** (${p.id})${p.tech ? `, ${p.tech}` : ""}: ${p.purpose}${terminal ? `\n  - ${terminal}` : ""}${p.ifDown ? `\n  - if it is down: ${p.ifDown}` : ""}`;
}

function linkLine(doc: Doc, l: Link): string {
  const name = (id: Id) => doc.parts[id]?.name ?? id;
  const carries = (l.carries ?? []).map((id) => doc.shapes[id]?.name ?? id);
  const f = l.failure;
  const failure = f && [f.timeoutMs !== undefined && `times out after ${f.timeoutMs} ms`, f.retries !== undefined && `retries ${f.retries}×`, f.idempotencyKey && `idempotent on ${f.idempotencyKey}`, f.fallback && `else ${f.fallback}`].filter(Boolean).join(", ");
  return `- ${name(l.from)} ${l.kind} ${name(l.to)}${carries.length ? `, carrying ${carries.join(", ")}` : ""}${l.note ? `: ${l.note}` : ""}${failure ? ` (${failure})` : ""}`;
}

function shapeBlock(s: Shape): string {
  const body = s.values ? `enum ${s.values.join(" | ")}` : fields(s.fields);
  return `- shape **${s.name}** ${body}${s.note ? `: ${s.note}` : ""}`;
}

/** Shapes named by these fields and links, and every shape those shapes use in turn. */
function shapesUsed(doc: Doc, fs: readonly Field[], links: readonly Link[] = []): Shape[] {
  const byName = new Map(Object.values(doc.shapes).map((s) => [s.name, s]));
  const out = new Map<Id, Shape>();
  const visit = (s: Shape | undefined) => {
    if (!s || out.has(s.id)) return;
    out.set(s.id, s);
    for (const f of s.fields) visit(byName.get(f.type.replace(/\[\]$/, "")));
  };
  for (const f of fs) visit(byName.get(f.type.replace(/\[\]$/, "")));
  for (const l of links) for (const id of l.carries ?? []) visit(doc.shapes[id]);
  return [...out.values()];
}

function tableBlock(doc: Doc, t: Table): string {
  const cols = t.columns.map((c) => {
    const bits = [c.type, c.primary && "primary key", c.unique && "unique", c.nullable ? "null" : "not null", c.classification];
    const ref = c.ref ? ` → ${doc.tables[c.ref.table]?.name ?? c.ref.table}.${c.ref.column}` : "";
    return `  - ${c.name}: ${bits.filter(Boolean).join(", ")}${ref}`;
  });
  return `- table **${t.name}** (${t.id}) in ${doc.parts[t.store]?.name ?? t.store}\n${cols.join("\n")}`;
}

function callBlock(doc: Doc, c: Call): string {
  const names = (ids: Id[], of: Record<Id, { name: string }>) => ids.map((id) => of[id]?.name ?? id).join(", ");
  const nameOf = (id: Id) => { const x = doc.endpoints[id] ?? doc.operations[id]; return x ? label(x) : id; };
  const lines = [`- **${label(c)}** (${c.id}) on ${doc.parts[c.service]?.name ?? c.service}: ${c.summary}`];
  // A body that is a shape is named, not spelled out: the shape is listed with the others below.
  const body = (e: Endpoint, side: "request" | "response") => {
    const shape = side === "request" ? e.requestShape : e.responseShape;
    return shape ? `${doc.shapes[shape]?.name ?? shape} (the whole body)` : fields(e[side]);
  };
  if (isRest(c)) lines.push(`  - request ${body(c, "request")}`, `  - response ${body(c, "response")}`);
  else lines.push(`  - args ${fields(c.args)}`, `  - returns ${c.returns}${c.nullable ? " (may be null)" : " (non-null)"}`);
  if (c.access) lines.push(`  - who may call: ${accessText(doc, c.access)}`);
  if (c.reads.length) lines.push(`  - reads ${names(c.reads, doc.tables)}`);
  if (c.writes.length) lines.push(`  - writes ${names(c.writes, doc.tables)}`);
  if (c.emits.length) lines.push(`  - emits ${names(c.emits, doc.events)}`);
  if (c.cache) lines.push(`  - cached in ${doc.parts[c.cache.part]?.name ?? c.cache.part} for ${c.cache.ttlSeconds}s under key "${c.cache.key}"`);
  if (c.invalidates?.length) lines.push(`  - makes stale: ${c.invalidates.map(nameOf).join(", ")}`);
  const stalers = callsOf(doc).filter((x) => x.invalidates?.includes(c.id));
  if (c.cache && stalers.length) lines.push(`  - made stale by: ${stalers.map(label).join(", ")}`);
  for (const e of c.errors ?? []) lines.push(`  - fails ${e.code} when ${e.when}`);
  return lines.join("\n");
}

export function accessText(doc: Doc, a: Access): string {
  const who = a.who === "roles" ? (a.roles ?? []).map((r) => doc.roles[r]?.name ?? r).join(", ") || "no role yet" : a.who;
  return `${who}${a.rule ? `; ${a.rule}` : ""}`;
}

function eventBlock(doc: Doc, ev: QueueEvent): string {
  const subs = Object.values(doc.links).filter((l) => l.kind === "subscribes" && l.to === ev.queue).map((l) => doc.parts[l.from]?.name ?? l.from);
  return `- event **${ev.name}** (${ev.id}) on ${doc.parts[ev.queue]?.name ?? ev.queue} ${fields(ev.payload)}${subs.length ? `, heard by ${subs.join(", ")}` : ""}`;
}

function traceBlock(doc: Doc, t: Trace): string {
  const name = (id: Id) => doc.parts[id]?.name ?? id;
  const via = (id: Id) => { const x = doc.endpoints[id] ?? doc.operations[id]; return x ? label(x) : doc.events[id]?.name ?? id; };
  const total = t.steps.filter((s) => !s.async).reduce((sum, s) => sum + (s.ms ?? 0), 0);
  const lines = [`- trace **${t.name}** (${t.id})${t.page ? ` from page ${doc.pages[t.page]?.name ?? t.page}` : ""}${total ? `, ~${total} ms before the response` : ""}`];
  t.steps.forEach((s, i) => {
    const bits = [s.via && `via ${via(s.via)}`, s.carries && `carrying ${doc.shapes[s.carries]?.name ?? s.carries}`, s.async && "async", s.ms !== undefined && `${s.ms} ms`].filter(Boolean);
    lines.push(`  ${i + 1}. ${name(s.from)} → ${name(s.to)}: ${s.action}${bits.length ? ` (${bits.join(", ")})` : ""}${s.ifFails ? `; if it fails: ${s.ifFails}` : ""}`);
  });
  return lines.join("\n");
}

function requirementLine(doc: Doc, q: Doc["requirements"][Id]): string {
  const served = q.servedBy.map((id) => nameOf(doc, id));
  return `- [${q.priority}] ${q.title} (${q.id})${q.detail ? `: ${q.detail}` : ""}${served.length ? `; served by ${served.join(", ")}` : "; nothing serves it yet"}`;
}

function questionLine(doc: Doc, q: Doc["questions"][Id]): string {
  const about = q.about.length ? ` about ${q.about.map((id) => nameOf(doc, id)).join(", ")}` : "";
  if (q.kind === "assumption") return `- assume: ${q.text}${about}${q.status === "decided" ? " (confirmed)" : ""}`;
  const options = q.options.map((o) => `  - ${o.name}${o.name === q.chosen ? " ← chosen" : ""}${o.pros ? `; for: ${o.pros}` : ""}${o.cons ? `; against: ${o.cons}` : ""}`);
  return [`- ${q.status === "open" ? "OPEN" : "decided"}: ${q.text} (${q.id})${about}`, ...options].join("\n");
}

/** A discussion as a builder reads it, with the id to reply in it or mark it addressed. */
function threadLine(doc: Doc, t: Thread): string {
  return `- on ${nameOf(doc, t.target)} (thread ${t.id}${t.state === "addressed" ? ", addressed" : ""}): ${t.posts.map((p) => `${p.author}: ${p.body}`).join(" / ")}`;
}

/** Where review stands: what waits on someone, then what nobody has proposed yet. */
function reviewLines(doc: Doc): string[] {
  const pieces = reviewablePieces(doc);
  const waiting = pieces.flatMap((id) => {
    const r = reviewOf(doc, id);
    if (r?.changed) return [`- ${nameOf(doc, id)}: approved by ${r.by}, then changed${r.changes.length ? ` (${r.changes.map((c) => c.field).join(", ")})` : ""}; review it again`];
    if (r?.state === "proposed") return [`- ${nameOf(doc, id)}: proposed by ${r.by}, waiting on a reviewer`];
    if (r?.state === "changes") return [`- ${nameOf(doc, id)}: changes asked by ${r.by}; see Discussion`];
    return [];
  });
  const fresh = pieces.filter((id) => !doc.reviews[id]);
  const shown = fresh.slice(0, 40).map((id) => nameOf(doc, id)).join(", ");
  return [...waiting, ...(fresh.length ? [`- Not reviewed yet (${fresh.length}): ${shown}${fresh.length > 40 ? `, and ${fresh.length - 40} more` : ""}. Propose what is ready with review.`] : [])];
}

/** Any system piece's name, for lists that mix kinds. */
const nameOf = pieceName;

/** Why these pieces exist, what is still open about them, and what people are saying. */
function processSections(doc: Doc, ids: Iterable<Id>): [string, string[]][] {
  const set = new Set(ids);
  const threads = Object.values(doc.threads).filter((t) => set.has(t.target) && t.state !== "resolved");
  return [
    ["Why", byIndex(Object.values(doc.requirements)).filter((q) => q.servedBy.some((id) => set.has(id))).map((q) => requirementLine(doc, q))],
    ["Open questions", byIndex(Object.values(doc.questions)).filter((q) => q.status === "open" && q.about.some((id) => set.has(id))).map((q) => questionLine(doc, q))],
    ["Discussion", threads.map((t) => threadLine(doc, t))],
    // A builder must know when an approval no longer covers the piece: building it is building something unreviewed.
    ["Review", [...set].flatMap((id) => {
      const r = reviewOf(doc, id);
      if (!r) return [];
      const what = r.changes.length ? ` (${r.changes.map((c) => c.field).join(", ")})` : "";
      const state =
        r.changed ? `approved by ${r.by} on ${r.at.slice(0, 10)}, then changed${what}: not approved as it stands; ask before building it`
        : r.state === "changes" ? `changes asked by ${r.by} on ${r.at.slice(0, 10)}: make them (see Discussion), mark the thread addressed, then review it as proposed`
        : `${r.state} (${r.by}, ${r.at.slice(0, 10)})`;
      return [`- ${nameOf(doc, id)}: ${state}`];
    })],
  ];
}

/** One link as a builder reads it: from which page and layer, on what trigger, calling what, to where, and when. */
function connectionLine(doc: Doc, c: Connection): string {
  const calls = c.endpoint ? `, calls ${nameOf(doc, c.endpoint)}` : "";
  const when = c.condition ? ` (only when ${c.condition.charAt(0).toLowerCase()}${c.condition.slice(1)})` : c.nav ? " (navigation, on every screen)" : "";
  return `- ${doc.pages[c.page]?.name ?? c.page}: ${c.trigger}${c.key ? ` ${c.key}` : ""} on "${doc.nodes[c.node]?.name ?? c.node}"${calls} → ${doc.pages[c.to]?.name ?? c.to}${when}`;
}

/** The page's layers as an outline, so the brief carries the screen's structure and words, not only its contracts. */
function screenOutline(doc: Doc, page: Page): string[] {
  const frame = doc.nodes[page.frame];
  if (!frame) return [];
  const lines: string[] = [];
  outline(doc, frame, 0, lines);
  return ["```", ...lines, "```"];
}

/** Where pages use a call: links that call it and nodes that show its fields. */
function uiUses(doc: Doc, call: Id): string[] {
  const out: string[] = [];
  for (const c of Object.values(doc.connections)) {
    if (c.endpoint !== call) continue;
    // Named, not "it": a service's brief lists every endpoint's uses together.
    const next = doc.pages[c.to]?.name;
    out.push(`- ${doc.pages[c.page]?.name ?? c.page}: ${c.trigger} on "${doc.nodes[c.node]?.name ?? c.node}" calls ${nameOf(doc, call)}${next && c.to !== c.page ? `, then goes to ${next}` : ""}`);
  }
  for (const n of Object.values(doc.nodes)) {
    if (n.bind?.endpoint !== call) continue;
    const page = Object.values(doc.pages).find((p) => rootOf(doc, n.id) === p.frame);
    out.push(`- ${page?.name ?? "a component"}: "${n.name}" (${n.id}) shows ${n.bind.field} from ${nameOf(doc, call)}`);
  }
  return out;
}

function rootOf(doc: Doc, id: Id): Id {
  let n = doc.nodes[id];
  while (n?.parent !== undefined) n = doc.nodes[n.parent];
  return n?.id ?? id;
}

/** Everything a set of calls touches, as sections. */
function contractSections(doc: Doc, calls: Call[], links: readonly Link[] = []): [string, string[]][] {
  const tables = new Set(calls.flatMap((c) => [...c.reads, ...c.writes]));
  // Tables a touched table points at, so foreign keys read whole.
  for (const id of [...tables]) for (const c of doc.tables[id]?.columns ?? []) if (c.ref) tables.add(c.ref.table);
  const events = new Set(calls.flatMap((c) => c.emits));
  const payloads = [...events].flatMap((id) => doc.events[id]?.payload ?? []);
  const rest = calls.filter(isRest);
  const gql = calls.filter((c): c is Operation => !isRest(c));
  return [
    ["Endpoints", rest.map((c) => callBlock(doc, c))],
    ["GraphQL operations", gql.map((c) => callBlock(doc, c))],
    ["Shapes", shapesUsed(doc, [...calls.flatMap((c) => typesOf(doc, c)), ...payloads], links).map(shapeBlock)],
    ["Tables", [...tables].flatMap((id) => (doc.tables[id] ? [tableBlock(doc, doc.tables[id])] : []))],
    ["Events", [...events].flatMap((id) => (doc.events[id] ? [eventBlock(doc, doc.events[id])] : []))],
  ];
}

function slice(doc: Doc, focus: Focus): { title: string; sections: [string, string[]][] } | string {
  const calls = callsOf(doc);
  const tracesThrough = (pred: (t: Trace) => boolean) => byIndex(Object.values(doc.traces)).filter(pred).map((t) => traceBlock(doc, t));

  if ("flow" in focus) {
    // A flow is the slice to build end to end: its pages in walking order, how they link, and everything they call.
    const flow = doc.flows[focus.flow];
    if (!flow) return `flow "${focus.flow}" does not exist`;
    const walk = walkFlow(doc, flow.start);
    const pages = walk.pages.flatMap((id) => (doc.pages[id] ? [doc.pages[id]] : []));
    const onFlow = new Set(pages.map((p) => p.frame));
    const called = new Set<Id>();
    for (const c of Object.values(doc.connections)) if (walk.pages.includes(c.page) && c.endpoint) called.add(c.endpoint);
    for (const n of Object.values(doc.nodes)) if (n.bind && onFlow.has(rootOf(doc, n.id))) called.add(n.bind.endpoint);
    const used = calls.filter((c) => called.has(c.id));
    const clients = [...new Set(pages.flatMap((p) => (p.client && doc.parts[p.client] ? [p.client] : [])))];
    const pageName = (id: Id) => doc.pages[id]?.name ?? id;
    return {
      title: `flow ${flow.name}`,
      sections: [
        ["Pages, in order", pages.map((p, i) => `${i + 1}. ${p.name} (${p.id})${p.route ? ` ${p.route}` : ""}${p.terminal ? `: ${screenText(doc, p)}` : ""}`)],
        ["How they link", walk.links.map((c) => `- ${pageName(c.page)} → ${pageName(c.to)}: ${c.trigger === "key" ? `key ${c.key}` : `${c.trigger} ${doc.nodes[c.node]?.name ?? c.node}`}${c.condition ? ` (when ${c.condition})` : ""}`)],
        ["Clients", clients.flatMap((id) => (doc.parts[id] ? [partLine(doc.parts[id])] : []))],
        ...contractSections(doc, used),
        ["Traces", tracesThrough((t) => t.page !== undefined && walk.pages.includes(t.page))],
        ...processSections(doc, [flow.id, ...walk.pages, ...used.map((c) => c.id)]),
      ],
    };
  }

  if ("trace" in focus) {
    const t = doc.traces[focus.trace];
    if (!t) return `trace "${focus.trace}" does not exist`;
    const used = calls.filter((c) => t.steps.some((s) => s.via === c.id));
    const partIds = [...new Set(t.steps.flatMap((s) => [s.from, s.to]))];
    const carried = t.steps.flatMap((s) => (s.carries && doc.shapes[s.carries] ? [{ name: "", type: doc.shapes[s.carries]!.name }] : []));
    const contracts = contractSections(doc, used);
    const shapes = contracts.find(([h]) => h === "Shapes");
    if (shapes) shapes[1] = shapesUsed(doc, [...used.flatMap((c) => typesOf(doc, c)), ...carried]).map(shapeBlock);
    return {
      title: `trace ${t.name}`,
      sections: [["Trace", [traceBlock(doc, t)]], ["Parts", partIds.flatMap((id) => (doc.parts[id] ? [partLine(doc.parts[id])] : []))], ...contracts, ...processSections(doc, [t.id, ...used.map((c) => c.id), ...partIds])],
    };
  }

  if ("endpoint" in focus) {
    const c = calls.find((x) => x.id === focus.endpoint);
    if (!c) return `no endpoint or operation "${focus.endpoint}"`;
    const service = doc.parts[c.service];
    return {
      title: label(c),
      sections: [
        ["Part", service ? [partLine(service)] : []],
        ...contractSections(doc, [c]),
        ["Used by pages", uiUses(doc, c.id)],
        ["Traces", tracesThrough((t) => t.steps.some((s) => s.via === c.id))],
        ...processSections(doc, [c.id, c.service]),
      ],
    };
  }

  if ("table" in focus) {
    const t = doc.tables[focus.table];
    if (!t) return `table "${focus.table}" does not exist`;
    const related = Object.values(doc.tables).filter((x) => x.id !== t.id && (t.columns.some((c) => c.ref?.table === x.id) || x.columns.some((c) => c.ref?.table === t.id)));
    const touching = calls.filter((c) => c.reads.includes(t.id) || c.writes.includes(t.id));
    const store = doc.parts[t.store];
    return {
      title: `table ${t.name}`,
      sections: [
        ["Part", store ? [partLine(store)] : []],
        ["Tables", [t, ...related].map((x) => tableBlock(doc, x))],
        ["Touched by", touching.map((c) => callBlock(doc, c))],
        ...processSections(doc, [t.id, t.store]),
      ],
    };
  }

  if ("page" in focus) {
    const page = doc.pages[focus.page];
    if (!page) return `page "${focus.page}" does not exist`;
    const onPage = (id: Id) => rootOf(doc, id) === page.frame;
    const called = new Set<Id>();
    for (const c of Object.values(doc.connections)) if (c.page === page.id && c.endpoint) called.add(c.endpoint);
    for (const n of Object.values(doc.nodes)) if (n.bind && onPage(n.id)) called.add(n.bind.endpoint);
    const used = calls.filter((c) => called.has(c.id));
    const client = page.client === undefined ? undefined : doc.parts[page.client];
    // The screen and its states share a route: whoever builds one builds them all.
    const siblings = page.route === undefined ? [] : Object.values(doc.pages).filter((p) => p.route === page.route && p.id !== page.id);
    return {
      title: `page ${page.name}${page.route ? ` (${page.route}${page.state ? `, state ${page.state}` : ""})` : ""}`,
      sections: [
        ["Part", client ? [partLine(client)] : []],
        ["States", siblings.map((p) => `- ${p.state ? `state **${p.state}**` : "the screen itself"}: page ${p.name} (${p.id})`)],
        // How a person gets here, and where each link on the page goes: the routing a builder wires up.
        ["Arrives from", Object.values(doc.connections).filter((c) => c.to === page.id && c.page !== page.id).map((c) => connectionLine(doc, c))],
        ["Links out", Object.values(doc.connections).filter((c) => c.page === page.id).sort((a, b) => Number(Boolean(a.condition)) - Number(Boolean(b.condition))).map((c) => connectionLine(doc, c))],
        ["Screen", screenOutline(doc, page)],
        ["Terminal", page.terminal ? [`- ${screenText(doc, page)}`] : []],
        ...contractSections(doc, used),
        ["On this page", used.flatMap((c) => uiUses(doc, c.id).filter((l) => l.startsWith(`- ${page.name}:`)))],
        ["Traces", tracesThrough((t) => t.page === page.id)],
        ...processSections(doc, [page.id, ...used.map((c) => c.id)]),
      ],
    };
  }

  const part = doc.parts[focus.part];
  if (!part) return `part "${focus.part}" does not exist`;
  const links = Object.values(doc.links).filter((l) => l.from === part.id || l.to === part.id);
  const neighbours = [...new Set(links.map((l) => (l.from === part.id ? l.to : l.from)))].flatMap((id) => (doc.parts[id] ? [doc.parts[id]] : []));
  const own = calls.filter((c) => c.service === part.id);
  // A client's contract is what its pages call; a service's is what it serves.
  const calledByPages = new Set(Object.values(doc.connections).filter((c) => doc.pages[c.page]?.client === part.id && c.endpoint).map((c) => c.endpoint));
  const contract = part.kind === "client" ? calls.filter((c) => calledByPages.has(c.id)) : own;
  const sections: [string, string[]][] = [
    ["Part", [partLine(part)]],
    ["Links", links.map((l) => linkLine(doc, l))],
    ["Neighbours", neighbours.map(partLine)],
    ...contractSections(doc, contract, links),
  ];
  if (part.kind === "cache") sections.push(["Cached here", calls.filter((c) => c.cache?.part === part.id).map((c) => callBlock(doc, c))]);
  if (part.kind === "store") sections.push(["Tables", byIndex(Object.values(doc.tables).filter((t) => t.store === part.id)).map((t) => tableBlock(doc, t))]);
  if (part.kind === "queue") sections.push(["Events", byIndex(Object.values(doc.events).filter((e) => e.queue === part.id)).map((e) => eventBlock(doc, e))]);
  if (part.kind === "client") {
    const screen = (p: Page) => (p.terminal ? `: ${screenText(doc, p)}` : "");
    const listed = Object.values(doc.pages).filter((p) => p.client === part.id).map((p) => `- ${p.name} (${p.id})${p.route ? ` ${p.route}` : ""}${screen(p)}`);
    // The drawing is the spec: a builder reads each screen cell by cell and can keep it as a golden file.
    const asText = "Build each screen to match it cell for cell. Read one as the terminal shows it, borders and colours included, with read_screen {page}, or `buni shot FILE PAGE out.txt` (`.ans` in colour); keep it as a golden file in the screen's tests. On a 16-colour screen var(--term-red) is the terminal's red (ANSI 1, bright forms 9–15), and var(--term-fg) and var(--term-bg) its default colours; a bar in --term-fg on --term-bg swapped is reverse video.";
    sections.push([part.terminal ? "Screens" : "Pages", part.terminal && listed.length ? [...listed, "", asText] : listed]);
  }
  if (part.kind === "service") sections.push(["Used by pages", own.flatMap((c) => uiUses(doc, c.id))]);
  sections.push(["Traces", tracesThrough((t) => t.steps.some((s) => s.from === part.id || s.to === part.id))]);
  sections.push(["Runs", Object.values(doc.placements).filter((p) => p.part === part.id).map((p) => placementLine(doc, p))]);
  sections.push(...processSections(doc, [part.id, ...contract.map((c) => c.id), ...Object.values(doc.tables).filter((t) => t.store === part.id).map((t) => t.id)]));
  return { title: `${part.kind} ${part.name}`, sections };
}

function whole(doc: Doc): { title: string; sections: [string, string[]][] } {
  const parts = byIndex(Object.values(doc.parts));
  const calls = callsOf(doc);
  const reqs = byIndex(Object.values(doc.requirements));
  const phases = byIndex(Object.values(doc.phases));
  const byPhase = [
    ...phases.map((ph) => [`### ${ph.name}${ph.goal ? `: ${ph.goal}` : ""}`, ...reqs.filter((q) => q.phase === ph.id).map((q) => requirementLine(doc, q))]),
    ...(reqs.some((q) => !q.phase) ? [[...(phases.length ? ["### No phase yet"] : []), ...reqs.filter((q) => !q.phase).map((q) => requirementLine(doc, q))]] : []),
  ].filter((g) => g.length > 1 || !g[0]?.startsWith("###")).flat();
  return {
    title: "the whole system",
    sections: [
      ["Requirements", byPhase],
      ["Questions and assumptions", byIndex(Object.values(doc.questions)).map((q) => questionLine(doc, q))],
      ["Roles", byIndex(Object.values(doc.roles)).map((r) => `- **${r.name}** (${r.id})${r.description ? `: ${r.description}` : ""}`)],
      ["Parts", parts.map(partLine)],
      ["Links", Object.values(doc.links).map((l) => linkLine(doc, l))],
      ["Endpoints", calls.filter(isRest).map((c) => callBlock(doc, c))],
      ["GraphQL operations", calls.filter((c) => !isRest(c)).map((c) => callBlock(doc, c))],
      ["Tables", byIndex(Object.values(doc.tables)).map((t) => tableBlock(doc, t))],
      ["Events", byIndex(Object.values(doc.events)).map((e) => eventBlock(doc, e))],
      ["Shapes", byIndex(Object.values(doc.shapes)).map(shapeBlock)],
      ["Traces", byIndex(Object.values(doc.traces)).map((t) => traceBlock(doc, t))],
      ["Topology", topologyText(doc)],
      ["Worth a look", designNotes(doc).map((n) => `- ${n}`)],
      ["Discussion", Object.values(doc.threads).filter((t) => t.state !== "resolved").map((t) => threadLine(doc, t))],
      ["Review", reviewLines(doc)],
      ["Pages", Object.values(doc.pages).filter((p) => p.route !== undefined).map((p) => `- ${p.name} (${p.id}) ${p.route}${p.client ? ` in ${doc.parts[p.client]?.name ?? p.client}` : ""}${p.widths?.length ? `; must also work at ${p.widths.join(", ")} px (layers' "at" styles)` : ""}`)],
      ["Terminal screens", Object.values(doc.pages).filter((p) => p.terminal).map((p) => `- ${p.name} (${p.id}) in ${doc.parts[p.client ?? ""]?.name ?? p.client}: ${screenText(doc, p)}`)],
    ],
  };
}

/** Markdown brief for `focus`, or the error when the focus names nothing. */
export function contextText(doc: Doc, focus?: Focus): { ok: true; text: string } | { ok: false; error: string } {
  const s = focus ? slice(doc, focus) : whole(doc);
  if (typeof s === "string") return { ok: false, error: s };
  const intent = docText(doc);
  const body = s.sections.filter(([, lines]) => lines.length).map(([h, lines]) => `## ${h}\n${lines.join("\n")}`);
  return { ok: true, text: [`# Context: ${s.title}`, ...(intent ? [`## Intent\n${intent.replace(/^## /gm, "### ")}`] : []), ...body].join("\n\n") };
}

/** "part:quote-api" → { part: "quote-api" }; "operation:" is the same as "endpoint:". */
export function parseFocus(arg: string): Focus | undefined {
  const [kind, id] = arg.split(/:(.*)/s);
  if (!id) return undefined;
  if (kind === "part") return { part: id };
  if (kind === "page") return { page: id };
  if (kind === "flow") return { flow: id };
  if (kind === "endpoint" || kind === "operation") return { endpoint: id };
  if (kind === "table") return { table: id };
  if (kind === "trace") return { trace: id };
  return undefined;
}
