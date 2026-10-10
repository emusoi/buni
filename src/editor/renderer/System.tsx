import { Sources } from "./Sources.tsx";
import { Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Background, Controls, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow, useNodesState, type Connection, type Edge, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { AlertTriangle, CircleHelp, ListChecks, Stamp, Boxes, ChevronDown, ChevronRight, Cloud, Braces, CircleCheck, Copy, Database,  FileText, Globe, Inbox, KeyRound, Link2, Monitor, Network, Plus, Route, Server, Shapes as ShapesIcon, Table2, Zap, type LucideIcon } from "lucide-react";
import { pageLabel, reviewOf, statesOf, type Doc, type Field, type Id, type Part, type PartKind, type Shape, type Table } from "buni/format/doc.ts";
import { contextText, type Focus } from "buni/tools/context.ts";
import type { EditTool } from "../api.ts";
import { ApiCanvas, CacheCanvas, FromBadge, OwnersContext, ShapesCanvas, StaleNote, TopologyCanvas, TraceCanvas } from "./SystemCanvas.tsx";
import { ClusterForm, EndpointForm, EnvironmentForm, EventForm, LinkForm, OperationForm, PartForm, PhaseForm, PlacementForm, QuestionForm, RequirementForm, RoleForm, ShapeForm, TableForm, TraceForm } from "./SystemEdit.tsx";
import { AccessCanvas, ChangesCanvas, ProcessPanel, QuestionsCanvas, REVIEW_KINDS, RequirementsCanvas, ReviewCanvas, reviewItems, waitingOn, type ReviewKind } from "./SystemProcess.tsx";
import { Thumb } from "./Journey.tsx";
import { TryIt } from "./TryIt.tsx";
import { planNotes, systemNotes } from "buni/tools/notes.ts";
import { placementOf, runtimeLabel } from "buni/tools/topology.ts";
import {
  CARD_H, CARD_W, PLAN_VIEWS, TABLE_HEAD, TABLE_ROW, TABLE_W, allCalls, callName, callOf, erLayout, linkKindFor, positionOf,
  stalenessGrid, systemLayout, type Call, type SystemSelection, type SystemView,
} from "./system.ts";

export const KIND_ICON: Record<PartKind, LucideIcon> = { client: Monitor, service: Server, store: Database, cache: Zap, queue: Inbox, external: Globe };
const KIND_LABEL: Record<PartKind, string> = { client: "Client", service: "Service", store: "Store", cache: "Cache", queue: "Queue", external: "External" };
export const VIEW_META: Record<SystemView, { label: string; icon: LucideIcon }> = {
  map: { label: "Map", icon: Network },
  api: { label: "API", icon: Braces },
  data: { label: "Data", icon: Database },
  shapes: { label: "Shapes", icon: ShapesIcon },
  cache: { label: "Cache", icon: Zap },
  traces: { label: "Traces", icon: Route },
  topology: { label: "Runs", icon: Cloud },
  requirements: { label: "Requirements", icon: ListChecks },
  questions: { label: "Questions", icon: CircleHelp },
  access: { label: "Access", icon: KeyRound },
  review: { label: "Review", icon: Stamp },
  brief: { label: "Brief", icon: FileText },
};

/** The count beside each view in the sidebar. */
export function viewCount(doc: Doc, view: SystemView): string {
  const n = (x: number, noun: string) => `${x} ${noun}${x === 1 ? "" : "s"}`;
  switch (view) {
    case "map": return n(Object.keys(doc.parts).length, "part");
    case "api": return n(Object.keys(doc.endpoints).length + Object.keys(doc.operations).length, "op");
    case "data": return n(Object.keys(doc.tables).length, "table");
    case "shapes": return String(Object.keys(doc.shapes).length);
    case "cache": return n(allCalls(doc).filter((c) => c.value.cache).length, "rule");
    case "traces": return String(Object.keys(doc.traces).length);
    case "topology": return n(Object.keys(doc.environments).length, "env");
    case "requirements": return n(Object.keys(doc.requirements).length, "req");
    case "questions": return `${Object.values(doc.questions).filter((q) => q.status === "open" && q.kind === "question").length} open`;
    case "access": return n(Object.keys(doc.roles).length, "role");
    case "review": { const x = Object.values(doc.reviews).filter((r) => r.state === "proposed" || r.state === "changes").length; return x ? `${x} waiting` : ""; }
    case "brief": return "";
  }
}

const apiStyle = (p: Part) => (p.kind === "service" ? p.api ?? "rest" : undefined);

function ApiBadge({ part }: { part: Part }) {
  const style = apiStyle(part);
  if (!style) return null;
  return <span className={`sys-api api-${style}`}>{{ rest: "REST", graphql: "GraphQL", none: "Worker" }[style]}</span>;
}

function MethodBadge({ call }: { call: Call }) {
  if (call.rest) return <span className={`sys-method m-${call.value.method.toLowerCase()}`}>{call.value.method}</span>;
  return <span className={`sys-method m-${call.value.kind}`}>{call.value.kind}</span>;
}

/** A view's summary line under the tabs. The tab already names the view, so only what the kicker adds
 *  after its " · " (an API's style, where a trace starts, an environment's provider) is shown. */
function Head({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  const detail = kicker.split(" · ").slice(1).join(" · ");
  return (
    <header className="sys-head">
      <div className="sys-head-title">
        <h2>{title}</h2>
        {detail && <span className="sys-head-detail">{detail}</span>}
      </div>
      <div className="sys-head-actions">{children}</div>
    </header>
  );
}

function Tabs<T extends string>({ items, value, onChange }: { items: { id: T; label: ReactNode }[]; value: T | undefined; onChange: (id: T) => void }) {
  return (
    <div className="sys-tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={it.id === value} className={it.id === value ? "on" : ""} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------------------------------
// Map

type PartData = { part: Part; meta: string; on: boolean };
type PartNode = FlowNode<PartData, "part">;

function partMeta(doc: Doc, part: Part): string {
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  switch (part.kind) {
    case "service": {
      const style = part.api ?? "rest";
      if (style === "none") return "worker";
      return style === "graphql" ? n(Object.values(doc.operations).filter((o) => o.service === part.id).length, "operation") : n(Object.values(doc.endpoints).filter((e) => e.service === part.id).length, "endpoint");
    }
    case "store": return n(Object.values(doc.tables).filter((t) => t.store === part.id).length, "table");
    case "queue": return n(Object.values(doc.events).filter((e) => e.queue === part.id).length, "event");
    case "client": return n(Object.values(doc.pages).filter((p) => p.client === part.id).length, "page");
    case "cache": return n(allCalls(doc).filter((c) => c.value.cache?.part === part.id).length, "rule");
    case "external": return "";
  }
}

function PartCard({ data }: NodeProps<PartNode>) {
  const { part, meta, on } = data;
  const Icon = KIND_ICON[part.kind];
  const starts = part.kind !== "store" && part.kind !== "cache" && part.kind !== "queue";
  return (
    <div className={`sys-card kind-${part.kind}${on ? " on" : ""}`} style={{ width: CARD_W, height: CARD_H }}>
      <Handle type="target" position={Position.Left} className="sys-handle" />
      <span className="sys-card-top"><Icon size={13} /> <span className="sys-kind">{KIND_LABEL[part.kind]}</span><ApiBadge part={part} />{part.tech && !apiStyle(part) && <span className="sys-tech">{part.tech}</span>}</span>
      <span className="sys-card-name">{part.name} <FromBadge id={part.id} /></span>
      {meta && <span className="sys-card-meta">{meta}{apiStyle(part) && part.tech ? ` · ${part.tech}` : ""}</span>}
      {starts && <Handle type="source" position={Position.Right} className="sys-handle" />}
    </div>
  );
}

const NODE_TYPES = { part: PartCard };
const ADDABLE: PartKind[] = ["client", "service", "store", "cache", "queue", "external"];

function MapView({ doc, selection, onSelect, onToast }: ViewProps) {
  const focus = selection?.kind === "part" ? selection.id : selection?.kind === "link" ? doc.links[selection.id]?.from : undefined;
  const hotLink = selection?.kind === "link" ? selection.id : undefined;
  const derived = useMemo((): PartNode[] => {
    const { cards } = systemLayout(doc);
    return Object.values(doc.parts).map((part) => ({
      id: part.id, type: "part", position: positionOf(part, cards),
      data: { part, meta: partMeta(doc, part), on: part.id === focus && !hotLink },
    }));
  }, [doc, focus, hotLink]);
  const [nodes, setNodes, onNodesChange] = useNodesState<PartNode>(derived);
  useEffect(() => setNodes(derived), [derived, setNodes]);
  const edges = useMemo((): Edge[] => Object.values(doc.links).map((l) => {
    const carries = (l.carries ?? []).map((id) => doc.shapes[id]?.name ?? id);
    const async = l.kind === "publishes" || l.kind === "subscribes";
    const hot = hotLink ? l.id === hotLink : l.from === focus || l.to === focus;
    return {
      id: l.id, source: l.from, target: l.to,
      label: carries.length ? `${l.kind} · ${carries.join(", ")}` : l.kind,
      className: `sys-edge${hot ? " hot" : ""}${hotLink && !hot ? " dim" : ""}`,
      style: async ? { strokeDasharray: "5 4" } : {},
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      labelBgPadding: [6, 3], labelBgBorderRadius: 3, zIndex: hot ? 1 : 0,
    };
  }), [doc, focus, hotLink]);
  const edit = async (tool: EditTool, args: Record<string, unknown>) => {
    const r = await window.buni.edit(tool, args);
    if (!r.ok) onToast(r.reply);
    return r;
  };
  const connect = (c: Connection) => {
    const from = doc.parts[c.source];
    const to = doc.parts[c.target];
    const kind = from && to ? linkKindFor(from, to) : undefined;
    if (!kind) return onToast(`${from?.name ?? "That part"} can't start a link to ${to?.name ?? "that"}; stores, caches and queues only receive them.`);
    void edit("link_parts", { from: c.source, to: c.target, kind }).then((r) => {
      const id = Object.values(doc.links).find((l) => l.from === c.source && l.to === c.target && l.kind === kind)?.id ?? r.reply.match(/^Link (\S+) saved/)?.[1];
      if (r.ok && id) onSelect({ kind: "link", id });
    });
  };
  const add = async (kind: PartKind) => {
    const r = await edit("set_part", { kind, name: `New ${kind}`, purpose: "What is it for?" });
    const id = r.reply.match(/^Part (\S+) saved/)?.[1];
    if (id) onSelect({ kind: "part", id });
  };
  const parts = Object.keys(doc.parts).length;
  return (
    <div className="sys-view sys-map-view">
      <Head kicker="System map" title={parts ? `${parts} part${parts === 1 ? "" : "s"} · ${allCalls(doc).length} operations · ${Object.keys(doc.tables).length} tables · ${Object.keys(doc.shapes).length} shapes` : "No system yet"} />
      <div className="sys-flow">
        {parts === 0 && (
          // An empty map says where to start instead of showing a bare grid.
          <div className="sys-empty">
            <b>The system behind these pages</b>
            <p>Start with the client the pages live in, then the services it calls and where their data sits. Drag from a card’s right edge to link two parts, or ask your agent to design it.</p>
            <div className="sys-empty-actions">
              <button type="button" className="btn primary" onClick={() => void add("client")}>Add the client</button>
              <button type="button" className="btn" onClick={() => void add("service")}>Add a service</button>
            </div>
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onSelect({ kind: "part", id: n.id })}
          onEdgeClick={(_, e) => onSelect({ kind: "link", id: e.id })}
          onPaneClick={() => onSelect(undefined)}
          onNodeDragStop={(_, n) => void edit("move_part", { part: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })}
          onConnect={connect}
          onNodesDelete={(ns) => ns.forEach((n) => void edit("delete_system", { what: "part", id: n.id }))}
          onEdgesDelete={(es) => es.forEach((e) => void edit("delete_system", { what: "link", id: e.id }))}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="sys-add">
            {ADDABLE.map((k) => {
              const Icon = KIND_ICON[k];
              return <button key={k} type="button" title={`Add a ${k}`} onClick={() => void add(k)}><Icon size={13} /> {KIND_LABEL[k]}</button>;
            })}
            <button type="button" disabled={parts < 2} onClick={() => onSelect({ kind: "new", what: "link", ...(focus ? { parent: focus } : {}) })}>Connect parts</button>
          </Panel>
          <Panel position="bottom-right" className="sys-hint-panel">Drag from a card’s edge to link · ⌫ removes</Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// API


/** Cached calls some write can make stale without saying so. */
function staleRisks(doc: Doc): { read: Call; writes: Call[] }[] {
  const g = stalenessGrid(doc);
  return g.reads.flatMap((read) => {
    const writes = g.writes.filter((w) => g.cell(w, read) === "missing");
    return writes.length ? [{ read, writes }] : [];
  });
}

function ApiView({ doc, selection, onSelect, onToast }: ViewProps) {
  const services = Object.values(doc.parts).filter((p) => p.kind === "service").sort((a, b) => (a.index < b.index ? -1 : 1));
  const selectedService = selection?.kind === "endpoint" ? doc.endpoints[selection.id]?.service : selection?.kind === "operation" ? doc.operations[selection.id]?.service : selection?.kind === "new" && (selection.what === "endpoint" || selection.what === "operation") ? selection.parent : undefined;
  const [picked, setPicked] = useState<Id>();
  const service = (selectedService ? doc.parts[selectedService] : undefined) ?? (picked ? doc.parts[picked] : undefined) ?? services.find((s) => s.api !== "none") ?? services[0];
  if (!service) return <div className="sys-view"><Head kicker="API" title="No services yet" /><p className="hint">Add a service on the map; set its API style to REST or GraphQL.</p></div>;
  const style = service.api ?? "rest";
  const count = allCalls(doc).filter((c) => c.value.service === service.id).length;
  const risks = staleRisks(doc).filter((r) => r.read.value.service === service.id);
  return (
    <div className="sys-view sys-map-view">
      <Head kicker={style === "graphql" ? "API · GraphQL" : style === "none" ? "API · worker" : "API · REST"} title={`${service.name} · ${count} ${style === "graphql" ? "operation" : "endpoint"}${count === 1 ? "" : "s"}`}>
        {risks.length > 0 && <span className="sys-state warn"><AlertTriangle size={12} /> {risks.length} stale risk{risks.length === 1 ? "" : "s"}</span>}
      </Head>
      <Tabs items={services.map((s) => ({ id: s.id, label: <><Server size={13} /> {s.name} <ApiBadge part={s} /></> }))} value={service.id} onChange={(id) => { setPicked(id); onSelect(undefined); }} />
      {style === "none"
        ? <p className="hint sys-pad">A worker has no API. What it does shows on the map: the queues it subscribes to and the parts it calls.</p>
        : <ApiCanvas key={service.id} doc={doc} service={service} selection={selection} onSelect={onSelect} onToast={onToast} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Data

type TableData = { table: Table; on: boolean; linked: Set<string> };
type TableNode = FlowNode<TableData, "table">;

/** A table card: a handle on both sides of every column, so foreign keys wire column to column and new ones can be dragged. */
function TableCard({ data }: NodeProps<TableNode>) {
  const { table, on, linked } = data;
  return (
    <div className={`sys-er-table${on ? " on" : ""}`} style={{ width: TABLE_W }}>
      <span className="sys-er-name" style={{ height: TABLE_HEAD }}><Table2 size={12} /> {table.name}<FromBadge id={table.id} /><span className="dim">{table.columns.length} cols</span></span>
      {table.columns.map((c) => (
        <span key={c.name} className="sys-er-col" style={{ height: TABLE_ROW }}>
          {(["l", "r"] as const).map((side) => (
            <Fragment key={side}>
              <Handle id={`${c.name}:${side}s`} type="source" position={side === "l" ? Position.Left : Position.Right} className={`sys-col-handle${linked.has(c.name) ? " linked" : ""}`} />
              <Handle id={`${c.name}:${side}t`} type="target" position={side === "l" ? Position.Left : Position.Right} className="sys-col-handle target" />
            </Fragment>
          ))}
          <span className="sys-er-key">{c.primary ? <KeyRound size={11} className="pk" /> : c.ref ? <Link2 size={11} className="fk" /> : null}</span>
          <code className="sys-er-colname">{c.name}</code>
          {c.unique && <span className="sys-badge">unique</span>}
          {c.nullable && <span className="dim">null</span>}
          <code className="sys-er-type">{c.type}</code>
        </span>
      ))}
    </div>
  );
}

const TABLE_TYPES = { table: TableCard };

function DataView({ doc, selection, onSelect, onToast }: ViewProps) {
  const stores = Object.values(doc.parts).filter((p) => p.kind === "store").sort((a, b) => (a.index < b.index ? -1 : 1));
  const selectedStore = selection?.kind === "table" ? doc.tables[selection.id]?.store : selection?.kind === "new" && selection.what === "table" ? selection.parent : undefined;
  const [picked, setPicked] = useState<Id>();
  const store = (selectedStore ? doc.parts[selectedStore] : undefined) ?? (picked ? doc.parts[picked] : undefined) ?? stores[0];
  const storeId = store?.id ?? "";
  const selectedId = selection?.kind === "table" ? selection.id : undefined;
  const derived = useMemo((): TableNode[] => {
    const auto = erLayout(doc, storeId);
    return Object.values(doc.tables).filter((t) => t.store === storeId).map((t) => {
      const linked = new Set<string>(t.columns.filter((c) => c.ref).map((c) => c.name));
      for (const o of Object.values(doc.tables)) for (const c of o.columns) if (c.ref?.table === t.id) linked.add(c.ref.column);
      return { id: t.id, type: "table", position: t.x !== undefined && t.y !== undefined ? { x: t.x, y: t.y } : auto.get(t.id) ?? { x: 0, y: 0 }, data: { table: t, on: t.id === selectedId, linked } };
    });
  }, [doc, storeId, selectedId]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>(derived);
  useEffect(() => setNodes(derived), [derived, setNodes]);
  // Edges follow the nodes as they are dragged: each leaves and enters on the sides facing each other.
  const edges = useMemo((): Edge[] => {
    const at = new Map(nodes.map((n) => [n.id, n.position.x]));
    return nodes.flatMap((n) => n.data.table.columns.flatMap((c): Edge[] => {
      if (!c.ref || !at.has(c.ref.table)) return [];
      const x1 = at.get(n.id) ?? 0;
      const x2 = at.get(c.ref.table) ?? 0;
      const self = n.id === c.ref.table;
      const rightward = x2 >= x1 + TABLE_W / 2;
      const leftward = x2 + TABLE_W / 2 <= x1;
      const [out, into] = self ? ["r", "r"] : rightward ? ["r", "l"] : leftward ? ["l", "r"] : ["r", "r"];
      const hot = selectedId !== undefined && (n.id === selectedId || c.ref.table === selectedId);
      return [{
        id: `${n.id}.${c.name}`, source: n.id, target: c.ref.table,
        sourceHandle: `${c.name}:${out}s`, targetHandle: `${c.ref.column}:${into}t`,
        type: "smoothstep", className: `sys-fk${hot ? " hot" : ""}${selectedId && !hot ? " dim" : ""}`,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, zIndex: hot ? 1 : 0,
      }];
    }));
  }, [nodes, selectedId]);
  if (!store) return <div className="sys-view"><Head kicker="Data" title="No stores yet" /><p className="hint">Add a store on the map (Postgres, S3…), then its tables here.</p></div>;
  const tables = Object.values(doc.tables).filter((t) => t.store === store.id);
  const edit = async (tool: EditTool, args: Record<string, unknown>) => {
    const r = await window.buni.edit(tool, args);
    if (!r.ok) onToast(r.reply);
    return r;
  };
  // Dragging from one column to another makes the first a foreign key to the second.
  const connect = (c: Connection) => {
    const from = doc.tables[c.source];
    const col = c.sourceHandle?.split(":")[0];
    const target = c.targetHandle?.split(":")[0];
    if (!from || !col || !target) return;
    const columns = from.columns.map((x) => (x.name === col ? { ...x, ref: { table: c.target, column: target } } : x));
    void edit("set_table", { table: from.id, store: from.store, name: from.name, columns }).then((r) => r.ok && onToast(`${from.name}.${col} now points at ${doc.tables[c.target]?.name}.${target}.`));
  };
  const writers = [...new Set(Object.values(doc.links).filter((l) => l.to === store.id && l.kind === "writes").map((l) => doc.parts[l.from]?.name ?? l.from))];
  const readers = [...new Set(Object.values(doc.links).filter((l) => l.to === store.id && l.kind === "reads").map((l) => doc.parts[l.from]?.name ?? l.from))];
  return (
    <div className="sys-view sys-map-view">
      <Head kicker="Data" title={`${store.name} · ${tables.length} table${tables.length === 1 ? "" : "s"}`}>
        <button type="button" className="bar-btn" title="Forget dragged positions and lay the tables out again" onClick={() => void edit("arrange_tables", { store: store.id })}>Arrange</button>
        <button type="button" className="bar-btn dark" onClick={() => onSelect({ kind: "new", what: "table", parent: store.id })}><Plus size={13} /> Table</button>
      </Head>
      {stores.length > 1 && <Tabs items={stores.map((s) => ({ id: s.id, label: <><Database size={13} /> {s.name} {s.tech && <span className="dim">{s.tech}</span>}</> }))} value={store.id} onChange={(id) => { setPicked(id); onSelect(undefined); }} />}
      <div className="sys-flow sys-er-flow">
        <ReactFlow
          key={store.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={TABLE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onSelect({ kind: "table", id: n.id })}
          onPaneClick={() => onSelect(undefined)}
          onNodeDragStop={(_, n, dragged) => { for (const d of dragged.length ? dragged : [n]) void edit("move_table", { table: d.id, x: Math.round(d.position.x), y: Math.round(d.position.y) }); }}
          onConnect={connect}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          {nodes.length > 12 && <MiniMap pannable zoomable className="sys-minimap" nodeColor="var(--line)" maskColor="rgb(var(--ink-rgb) / 0.06)" />}
          <Panel position="bottom-left" className="sys-hint-panel sys-er-legend">
            <KeyRound size={11} className="pk" /> key <Link2 size={11} className="fk" /> foreign key · drag tables to arrange, drag column to column to link
            {writers.length > 0 && <> · written by {writers.join(", ")}</>}{readers.length > 0 && <> · read by {readers.join(", ")}</>}
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Shapes


function ShapesView({ doc, selection, onSelect, onToast }: ViewProps) {
  const n = Object.keys(doc.shapes).length;
  return (
    <div className="sys-view sys-map-view">
      <Head kicker="Shapes" title={`${n} data structure${n === 1 ? "" : "s"}`} />
      <ShapesCanvas doc={doc} selection={selection} onSelect={onSelect} onToast={onToast} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cache

function CacheView({ doc, selection, onSelect, onToast }: ViewProps) {
  const { reads } = stalenessGrid(doc);
  return (
    <div className="sys-view sys-map-view">
      <Head kicker="Cache" title={`${reads.length} cached read${reads.length === 1 ? "" : "s"}`}><StaleNote doc={doc} /></Head>
      {reads.length === 0
        ? <p className="hint sys-pad">Nothing is cached. Cache a GET endpoint or a query from its editor in API; it shows up here with what makes it stale.</p>
        : <CacheCanvas doc={doc} selection={selection} onSelect={onSelect} onToast={onToast} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Traces

function TracesView({ doc, selection, onSelect, onToast }: ViewProps) {
  const traces = Object.values(doc.traces).sort((a, b) => (a.index < b.index ? -1 : 1));
  const [picked, setPicked] = useState<Id>();
  const selectedTrace = selection?.kind === "trace" ? selection.id : undefined;
  const trace = (selectedTrace ? doc.traces[selectedTrace] : undefined) ?? (picked ? doc.traces[picked] : undefined) ?? traces[0];
  return (
    <div className="sys-view sys-map-view">
      <Head kicker={trace?.page ? `Trace · from ${doc.pages[trace.page]?.name ?? trace.page}` : "Traces"} title={trace ? `${trace.name} · ${trace.steps.length} hops` : "No traces yet"}>
        <button type="button" className="bar-btn dark" onClick={() => onSelect({ kind: "new", what: "trace" })}><Plus size={13} /> Trace</button>
      </Head>
      {traces.length > 1 && <Tabs items={traces.map((t) => ({ id: t.id, label: <><Route size={13} /> {t.name}</> }))} value={trace?.id} onChange={(id) => { setPicked(id); onSelect({ kind: "trace", id }); }} />}
      {trace
        ? <TraceCanvas key={trace.id} doc={doc} trace={trace.id} selection={selection} onSelect={onSelect} onToast={onToast} />
        : <p className="hint sys-pad">A trace follows one thing a person does, like “Submit a quote”, through every part it touches, in order.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Topology

function TopologyView({ doc, selection, onSelect, onToast }: ViewProps) {
  const envs = Object.values(doc.environments).sort((a, b) => (a.index < b.index ? -1 : 1));
  const selectedEnv =
    selection?.kind === "environment" ? selection.id
    : selection?.kind === "cluster" ? doc.clusters[selection.id]?.environment
    : selection?.kind === "placement" ? doc.placements[selection.id]?.environment
    : selection?.kind === "new" && (selection.what === "cluster" || selection.what === "placement") ? selection.environment
    : undefined;
  const [picked, setPicked] = useState<Id>();
  const env = (selectedEnv ? doc.environments[selectedEnv] : undefined) ?? (picked ? doc.environments[picked] : undefined) ?? envs[0];
  return (
    <div className="sys-view sys-map-view">
      <Head kicker={env ? `Topology · ${env.provider}` : "Topology"} title={env ? `${env.name} · ${env.regions.join(", ")}` : "Where it all runs"}>
        <button type="button" className="bar-btn dark" onClick={() => onSelect({ kind: "new", what: "environment" })}><Plus size={13} /> Environment</button>
      </Head>
      {envs.length > 0 && <Tabs items={envs.map((e) => ({ id: e.id, label: <><Cloud size={13} /> {e.name}</> }))} value={env?.id} onChange={(id) => { setPicked(id); onSelect({ kind: "environment", id }); }} />}
      {env
        ? <TopologyCanvas key={env.id} doc={doc} environment={env.id} selection={selection} onSelect={onSelect} onToast={onToast} />
        : <p className="hint sys-pad">An environment is a copy of the system people rely on, like prod or staging. Add one, then drag parts into its regions and clusters.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Brief & export

type Slice = { id: string; label: string; icon: LucideIcon; group: string; focus?: Focus };

function BriefView({ doc, onToast, fileName }: ViewProps) {
  const slices: Slice[] = [
    { id: "whole", label: "Whole system", icon: Network, group: "System" },
    ...Object.values(doc.parts).sort((a, b) => (a.index < b.index ? -1 : 1)).map((p): Slice => ({ id: `part:${p.id}`, label: p.name, icon: KIND_ICON[p.kind], group: "Parts", focus: { part: p.id } })),
    ...Object.values(doc.traces).sort((a, b) => (a.index < b.index ? -1 : 1)).map((t): Slice => ({ id: `trace:${t.id}`, label: t.name, icon: Route, group: "Traces", focus: { trace: t.id } })),
    ...Object.values(doc.pages).filter((p) => p.route !== undefined).sort((a, b) => (a.index < b.index ? -1 : 1)).map((p): Slice => ({ id: `page:${p.id}`, label: p.name, icon: FileText, group: "Pages", focus: { page: p.id } })),
  ];
  const [picked, setPicked] = useState("whole");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = filter.trim().toLowerCase();
  const groups = ["System", "Parts", "Traces", "Pages"].map((g) => ({ g, items: slices.filter((s) => s.group === g && (!q || s.label.toLowerCase().includes(q))) })).filter((x) => x.items.length);
  const slice = slices.find((s) => s.id === picked) ?? slices[0];
  const brief = contextText(doc, slice?.focus);
  const text = brief.ok ? brief.text : brief.error;
  const whole = contextText(doc);
  const tokens = Math.round(text.length / 4);
  const share = whole.ok ? Math.round((text.length / whole.text.length) * 100) : 100;
  const copy = (t: string, what: string) => { void navigator.clipboard.writeText(t).then(() => onToast(`Copied ${what}.`)); };
  return (
    <div className="sys-view">
      <Head kicker="Brief" title="What an agent gets">
        <span className="dim">{tokens.toLocaleString()} tokens{slice?.focus ? ` · ${share}% of the whole system` : ""}</span>
        <button type="button" className="bar-btn" onClick={() => copy(text, "the brief")}><Copy size={13} /> Copy brief</button>
        <button type="button" className="bar-btn dark" onClick={() => void window.buni.exportSystem().then((r) => r && onToast(`Saved ${r.path}`))}><FileText size={13} /> Share as PDF</button>
      </Head>
      <div className="sys-brief">
        <div className="sys-slices">
          <input className="field sys-slice-filter" placeholder="Filter slices" aria-label="Filter slices" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {groups.map(({ g, items }) => {
            // Long groups start folded unless filtering; the picked slice's group stays open.
            const folded = !q && items.length > 12 && !(open[g] ?? items.some((s) => s.id === picked));
            return (
              <div key={g} className="sys-slice-group">
                <button type="button" className="sys-slice-head" onClick={() => setOpen({ ...open, [g]: folded })} aria-expanded={!folded}>
                  {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />} {g} <span className="dim">{items.length}</span>
                </button>
                {!folded && items.map((s) => {
                  const Icon = s.icon;
                  return <button key={s.id} type="button" title={s.label} className={`sys-slice${s.id === picked ? " on" : ""}`} onClick={() => setPicked(s.id)}><Icon size={14} /> <span>{s.label}</span></button>;
                })}
              </div>
            );
          })}
        </div>
        <div className="sys-brief-preview">
          {text.split("\n").map((line, i) => {
            if (line.startsWith("# ")) return <h3 key={i}>{line.slice(2)}</h3>;
            if (line.startsWith("## ")) return <h4 key={i}>{line.slice(3)}</h4>;
            if (line.startsWith("### ")) return <h5 key={i}>{line.slice(4)}</h5>;
            if (!line.trim()) return <div key={i} className="gap" />;
            const indent = line.match(/^ */)?.[0].length ?? 0;
            return <p key={i} style={{ paddingLeft: indent * 6 }} className={indent ? "mono" : ""}>{line.trim().replace(/\*\*/g, "")}</p>;
          })}
        </div>
        <div className="sys-files">
          <div className="sys-cli">
            <div className="sub-label">Hand to any agent</div>
            <code>buni context {fileName} {slice?.focus ? Object.entries(slice.focus).map(([k, v]) => `${k}:${v}`)[0] : ""}</code>
            <p className="hint">Or over MCP: read_context. Claude Code, Codex and pi all read it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

interface ViewProps {
  doc: Doc;
  /** The .buni file's name, for commands to copy. */
  fileName?: string;
  selection: SystemSelection | undefined;
  onSelect: (s: SystemSelection | undefined) => void;
  onOpenPage: (id: Id) => void;
  onToast: (m: string) => void;
}

function ProcessView({ kicker, title, children }: ViewProps & { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="sys-view sys-map-view">
      <Head kicker={kicker} title={title} />
      {children}
    </div>
  );
}

function AccessView({ doc, selection, onSelect, onToast }: ViewProps) {
  const services = Object.values(doc.parts).filter((p) => allCalls(doc).some((c) => c.value.service === p.id)).sort((a, b) => (a.index < b.index ? -1 : 1));
  const [service, setService] = useState<Id | "all">("all");
  return (
    <div className="sys-view sys-map-view">
      <Head kicker="Who may do what" title="Access" />
      {services.length > 1 && <Tabs items={[{ id: "all", label: "All services" }, ...services.map((p) => ({ id: p.id, label: p.name }))]} value={service} onChange={setService} />}
      <AccessCanvas key={service} doc={doc} {...(service === "all" ? {} : { service })} selection={selection} onSelect={onSelect} onToast={onToast} />
    </div>
  );
}

const REVIEW_TABS: [ReviewKind | "since", string][] = [["since", "Since last commit"], ["screens", "Screens"], ["parts", "Parts"], ["calls", "API"], ["tables", "Data"], ["traces", "Traces"], ["requirements", "Requirements"]];

function ReviewView({ doc, selection, onSelect, onToast }: ViewProps) {
  const [kind, setKind] = useState<ReviewKind | "since">("since");
  // Without a committed version there is nothing to compare, so open on the parts instead.
  useEffect(() => {
    let live = true;
    void window.buni.systemChanges().then((r) => { if (live && "error" in r) setKind((k) => (k === "since" ? "parts" : k)); }, () => undefined);
    return () => { live = false; };
  }, []);
  const waiting = Object.keys(doc.reviews).filter((id) => waitingOn(doc, id)).length;
  // A piece picked from elsewhere (next waiting, a note) brings its board with it.
  const picked = selection && "id" in selection ? selection.id : undefined;
  useEffect(() => {
    if (!picked || (kind !== "since" && reviewItems(doc, kind).some(([id]) => id === picked))) return;
    const home = REVIEW_KINDS.find((k) => reviewItems(doc, k).some(([id]) => id === picked));
    if (home) setKind(home);
  }, [picked]); // only on a new pick, so changing boards by hand still sticks
  // Each board says how many of its pieces wait, so a reviewer goes straight to them.
  const label = (id: ReviewKind | "since", text: string) => {
    if (id === "since") return window.buni.saveVersion ? "Since saved version" : text;
    const n = reviewItems(doc, id).filter(([p]) => waitingOn(doc, p)).length;
    return n ? <>{text} <span className="sys-tab-count">{n}</span></> : text;
  };
  return (
    <div className="sys-view sys-map-view">
      <Head kicker="Review" title={waiting ? `${waiting} waiting on a reviewer or an edit` : "Where each piece stands"} />
      <Tabs items={REVIEW_TABS.map(([id, text]) => ({ id, label: label(id, text) }))} value={kind} onChange={setKind} />
      {kind === "since"
        ? <ChangesCanvas doc={doc} selection={selection} onSelect={onSelect} onToast={onToast} />
        : <ReviewCanvas key={kind} doc={doc} kind={kind} selection={selection} onSelect={onSelect} onToast={onToast} />}
    </div>
  );
}

const SYSTEM_LENSES: readonly SystemView[] = ["map", "api", "data", "shapes", "cache", "traces", "topology", "brief"];
const PLAN_LENSES: readonly SystemView[] = ["requirements", "questions", "access", "review"];

/** Ways to look at the same things: tabs over the view, not rows in the rail. */
function Lenses({ doc, view, onView }: { doc: Doc; view: SystemView; onView: (v: SystemView) => void }) {
  const lenses = PLAN_LENSES.includes(view) ? PLAN_LENSES : SYSTEM_LENSES;
  return (
    <div className="sys-lenses" role="tablist">
      {lenses.map((v) => {
        const Icon = VIEW_META[v].icon;
        const n = viewCount(doc, v);
        return (
          <button type="button" key={v} role="tab" aria-selected={v === view} className={v === view ? "on" : ""} onClick={() => onView(v)}>
            {/* A count only where there's something to count: a row of zeros says nothing. */}
            <Icon size={14} strokeWidth={1.75} /> {VIEW_META[v].label}{n && v !== "map" && Number.parseInt(n, 10) > 0 ? <span className="n">{n.replace(/ .*/, "")}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The System area: the lenses, then one view full size. */
export function SystemScreen(props: ViewProps & { view: SystemView; onView: (v: SystemView) => void }) {
  return (
    <div className="sys-screen">
      <Lenses doc={props.doc} view={props.view} onView={props.onView} />
      <SystemBody {...props} />
    </div>
  );
}

function SystemBody(props: ViewProps & { view: SystemView }) {
  switch (props.view) {
    case "map": return <MapView {...props} />;
    case "api": return <ApiView {...props} />;
    case "data": return <DataView {...props} />;
    case "shapes": return <ShapesView {...props} />;
    case "cache": return <CacheView {...props} />;
    case "traces": return <TracesView {...props} />;
    case "topology": return <TopologyView {...props} />;
    case "requirements": return <ProcessView {...props} kicker="Why" title="Requirements by phase"><RequirementsCanvas doc={props.doc} selection={props.selection} onSelect={props.onSelect} onToast={props.onToast} /></ProcessView>;
    case "questions": return <ProcessView {...props} kicker="What isn't settled" title="Questions and assumptions"><QuestionsCanvas doc={props.doc} selection={props.selection} onSelect={props.onSelect} onToast={props.onToast} /></ProcessView>;
    case "access": return <AccessView {...props} />;
    case "review": return <ReviewView {...props} />;
    case "brief": return <BriefView {...props} />;
  }
}

const HINTS: Record<SystemView, string> = {
  map: "Click a part or a link to edit it. Drag from a card’s right edge to another card to link them.",
  api: "Pick an endpoint or operation to edit it, or add one. A service’s API style (REST, GraphQL, worker) is on the part.",
  data: "Pick a table to edit its columns and keys.",
  shapes: "Pick a shape to edit it. A shape’s name is a type every field can use.",
  cache: "Pick a cached read to change its lifetime and key; tick cells to say what makes it stale.",
  traces: "Pick a trace to edit its steps.",
  topology: "Pick a placement, cluster or environment to edit it; click a part that isn't placed to decide how it runs.",
  requirements: "Pick a requirement to say what serves it. Drag it between phases.",
  questions: "Pick a question to weigh its options and decide it. Agents ask about open ones rather than guess.",
  access: "Pick a call or a role. Drag calls between lanes to say who may call them.",
  review: "Pick a piece to discuss it. Drag it to where it stands.",
  brief: "Pick a slice to see exactly what an agent gets, then copy it or hand it over with buni context.",
};

/** The right panel in the System area: the form for whatever is selected. */
export function SystemInspector({ doc, view, selection, onSelect, onOpenPage, onToast, dir: dirOf = "" }: ViewProps & { view: SystemView; dir?: string }) {
  const key = JSON.stringify(selection ?? null);
  const reselect = (kind: "link" | "endpoint" | "operation" | "table" | "event" | "shape" | "trace") => (reply: string) => {
    const id = reply.match(/^\w+ (\S+) saved/)?.[1];
    onSelect(id ? { kind, id } : undefined);
  };
  const keep = () => {};
  const owners = useContext(OwnersContext);
  const from = selection && "id" in selection ? owners[selection.id] : undefined;
  if (from) {
    return (
      <div className="inspector editing sys-inspector">
        <div className="sys-handoff">
          <b>Lives in {from}</b>
          <p>This file imports it, so it can be linked, called and used as a type here. Change it in its own file.</p>
          <button type="button" className="btn" onClick={() => void window.buni.open(`${dirOf}/${from}`).catch((e: unknown) => onToast(e instanceof Error ? e.message : String(e)))}>Open {from}</button>
        </div>
      </div>
    );
  }
  if (!selection) {
    return (
      <div className="inspector editing sys-inspector">
        <p className="hint">{HINTS[view]}</p>
        <SystemChecks doc={doc} plan={PLAN_VIEWS.includes(view)} />
      </div>
    );
  }
  let body: ReactNode = null;
  switch (selection.kind) {
    case "part": {
      const p = doc.parts[selection.id];
      if (p) body = <><PartForm key={key} part={p} onDone={keep} /><PartContracts doc={doc} part={p} onSelect={onSelect} onToast={onToast} /></>;
      break;
    }
    case "link": {
      const l = doc.links[selection.id];
      if (l) body = <LinkForm key={key} doc={doc} link={l} onDone={keep} />;
      break;
    }
    case "endpoint": {
      const e = doc.endpoints[selection.id];
      if (e) body = <><EndpointForm key={key} doc={doc} service={e.service} endpoint={e} onDone={keep} /><TryIt doc={doc} endpoint={e} onToast={onToast} /></>;
      break;
    }
    case "operation": {
      const o = doc.operations[selection.id];
      if (o) body = <OperationForm key={key} doc={doc} service={o.service} operation={o} onDone={keep} />;
      break;
    }
    case "table": {
      const t = doc.tables[selection.id];
      if (t) body = <TableForm key={key} doc={doc} store={t.store} table={t} onDone={keep} />;
      break;
    }
    case "event": {
      const ev = doc.events[selection.id];
      if (ev) body = <EventForm key={key} doc={doc} queue={ev.queue} event={ev} onDone={keep} />;
      break;
    }
    case "shape": {
      const s = doc.shapes[selection.id];
      if (s) body = <ShapeForm key={key} doc={doc} shape={s} onDone={keep} />;
      break;
    }
    case "page": {
      // Screens are edited on the canvas; here they are only reviewed.
      const p = doc.pages[selection.id];
      if (p) body = (
        <div className="sys-form">
          <div className="sys-form-head">
            <span className="sys-kicker">Screen</span>
            <div className="sys-form-title">{p.name} <span className="sys-row-hint">{pageLabel(doc, p)}</span></div>
          </div>
          {!p.terminal && <Thumb doc={doc} dir={dirOf} page={p.id} />}
          <div className="sys-form-actions"><button type="button" className="btn" onClick={() => onOpenPage(p.id)}>Open on canvas</button></div>
          {/* Approving a screen approves its states too, so they are all here to look at. */}
          {statesOf(doc, p).map((st) => (
            <button key={st.id} type="button" className="sys-state" onClick={() => onOpenPage(st.id)} title="Open on canvas">
              <span className="sys-row-label">State · {st.state}</span>
              <Thumb doc={doc} dir={dirOf} page={st.id} />
            </button>
          ))}
        </div>
      );
      break;
    }
    case "trace": {
      const t = doc.traces[selection.id];
      if (t) body = <TraceForm key={key} doc={doc} trace={t} onDone={keep} />;
      break;
    }
    case "environment": {
      const e = doc.environments[selection.id];
      if (e) body = <EnvironmentForm key={key} environment={e} onDone={keep} />;
      break;
    }
    case "cluster": {
      const c = doc.clusters[selection.id];
      if (c) body = <ClusterForm key={key} doc={doc} environment={c.environment} cluster={c} onDone={keep} />;
      break;
    }
    case "placement": {
      const pl = doc.placements[selection.id];
      if (pl) body = <PlacementForm key={key} doc={doc} part={pl.part} environment={pl.environment} placement={pl} onDone={keep} />;
      break;
    }
    case "phase": {
      const p = doc.phases[selection.id];
      if (p) body = <PhaseForm key={key} phase={p} onDone={keep} />;
      break;
    }
    case "requirement": {
      const q = doc.requirements[selection.id];
      if (q) body = <RequirementForm key={key} doc={doc} requirement={q} onDone={keep} />;
      break;
    }
    case "question": {
      const q = doc.questions[selection.id];
      if (q) body = <QuestionForm key={key} doc={doc} question={q} onDone={keep} />;
      break;
    }
    case "role": {
      const r = doc.roles[selection.id];
      if (r) body = <RoleForm key={key} doc={doc} role={r} onDone={keep} />;
      break;
    }
    case "new": {
      const saved = (kind: "phase" | "requirement" | "question" | "role") => (reply: string) => { const id = reply.match(/^\w+ (\S+) (saved|started)/)?.[1]; onSelect(id ? { kind, id } : undefined); };
      if (selection.what === "phase") { body = <PhaseForm key={key} phase={undefined} onDone={saved("phase")} />; break; }
      if (selection.what === "requirement") { body = <RequirementForm key={key} doc={doc} requirement={undefined} {...(selection.parent ? { phase: selection.parent } : {})} onDone={saved("requirement")} />; break; }
      if (selection.what === "question") { body = <QuestionForm key={key} doc={doc} question={undefined} kind={selection.parent === "assumption" ? "assumption" : "question"} onDone={saved("question")} />; break; }
      if (selection.what === "role") { body = <RoleForm key={key} doc={doc} role={undefined} onDone={saved("role")} />; break; }
      if (selection.what === "cluster") {
        body = <ClusterForm key={key} doc={doc} environment={selection.environment} cluster={undefined} onDone={(reply) => { const id = reply.match(/^Cluster (\S+) saved/)?.[1]; onSelect(id ? { kind: "cluster", id } : undefined); }} />;
        break;
      }
      if (selection.what === "placement") {
        body = <PlacementForm key={key} doc={doc} part={selection.part} environment={selection.environment} placement={placementOf(doc, selection.part, selection.environment)} onDone={(reply) => { const id = reply.match(/^Placement (\S+) saved/)?.[1]; onSelect(id ? { kind: "placement", id } : undefined); }} />;
        break;
      }
      if (selection.what === "environment") {
        body = <EnvironmentForm key={key} environment={undefined} onDone={(reply) => { const id = reply.match(/^Environment (\S+) saved/)?.[1]; onSelect(id ? { kind: "environment", id } : undefined); }} />;
        break;
      }
      const parent = selection.parent ?? "";
      if (selection.what === "link") { body = <LinkForm key={key} doc={doc} link={undefined} from={parent || undefined} onDone={reselect("link")} />; break; }
      body =
        selection.what === "endpoint" ? <EndpointForm key={key} doc={doc} service={parent} endpoint={undefined} onDone={reselect("endpoint")} />
        : selection.what === "operation" ? <OperationForm key={key} doc={doc} service={parent} operation={undefined} onDone={reselect("operation")} />
        : selection.what === "table" ? <TableForm key={key} doc={doc} store={parent} table={undefined} onDone={reselect("table")} />
        : selection.what === "event" ? <EventForm key={key} doc={doc} queue={parent} event={undefined} onDone={reselect("event")} />
        : selection.what === "shape" ? <ShapeForm key={key} doc={doc} shape={undefined} onDone={reselect("shape")} />
        : <TraceForm key={key} doc={doc} trace={undefined} onDone={reselect("trace")} />;
    }
  }
  const discussable = selection.kind !== "new" && !["environment", "cluster", "placement", "phase", "role"].includes(selection.kind) ? selection.id : undefined;
  return (
    <div className="inspector editing sys-inspector">
      {/* Reviewing, the review state and the discussion are the job: they come before the form. */}
      {body && discussable && view === "review" && <ProcessPanel key={discussable} doc={doc} id={discussable} onSelect={onSelect} onToast={onToast} reviewing />}
      {body ?? <p className="hint">That was removed.</p>}
      {body && selection.kind !== "new" && <Sources key={`sources:${selection.id}`} doc={doc} id={selection.id} />}
      {body && discussable && view !== "review" && <ProcessPanel key={discussable} doc={doc} id={discussable} onSelect={onSelect} onToast={onToast} />}
    </div>
  );
}

/** Under a part's form: what it exposes, one click from editing, and its brief. */
function PartContracts({ doc, part, onSelect, onToast }: { doc: Doc; part: Part; onSelect: (s: SystemSelection) => void; onToast: (m: string) => void }) {
  const calls = allCalls(doc).filter((c) => c.value.service === part.id);
  const tables = Object.values(doc.tables).filter((t) => t.store === part.id);
  const events = Object.values(doc.events).filter((e) => e.queue === part.id);
  const links = Object.values(doc.links).filter((l) => l.from === part.id || l.to === part.id);
  const style = part.api ?? "rest";
  const copy = () => {
    const r = contextText(doc, { part: part.id });
    if (r.ok) { void navigator.clipboard.writeText(r.text).then(() => onToast(`Copied the brief for ${part.name}; paste it to any agent.`)); }
  };
  return (
    <div className="sys-contracts">
      <div className="sys-group">
          <div className="sys-row-label sys-row-head">Connections{!["store", "cache", "queue"].includes(part.kind) && <button type="button" className="link-btn" onClick={() => onSelect({ kind: "new", what: "link", parent: part.id })}>Connect to…</button>}</div>
          {links.map((l) => (
            <button key={l.id} type="button" className="sys-mini" onClick={() => onSelect({ kind: "link", id: l.id })}>
              <span>{l.from === part.id ? <><b>{l.kind}</b> {doc.parts[l.to]?.name}</> : <>{doc.parts[l.from]?.name} <b>{l.kind}</b></>}</span>
              <code className="dim">{(l.carries ?? []).map((id) => doc.shapes[id]?.name).join(", ")}</code>
            </button>
          ))}
          {!links.length && <p className="hint">No connections yet.</p>}
        </div>
      {part.kind === "service" && style !== "none" && (
        <div className="sys-group">
          <div className="sys-row-label sys-row-head">{style === "graphql" ? "Operations" : "Endpoints"} · {calls.length}<button type="button" className="link-btn" onClick={() => onSelect({ kind: "new", what: style === "graphql" ? "operation" : "endpoint", parent: part.id })}><Plus size={12} /> Add</button></div>
          {calls.map((c) => (
            <button key={c.value.id} type="button" className="sys-mini" onClick={() => onSelect({ kind: c.rest ? "endpoint" : "operation", id: c.value.id })}>
              <span className="sys-mini-call"><MethodBadge call={c} /><code>{c.rest ? c.value.path : c.value.name}</code></span>
              {c.value.cache && <Zap size={12} className="amber" />}
            </button>
          ))}
        </div>
      )}
      {part.kind === "store" && (
        <div className="sys-group">
          <div className="sys-row-label sys-row-head">Tables · {tables.length}<button type="button" className="link-btn" onClick={() => onSelect({ kind: "new", what: "table", parent: part.id })}><Plus size={12} /> Add</button></div>
          {tables.map((t) => <button key={t.id} type="button" className="sys-mini" onClick={() => onSelect({ kind: "table", id: t.id })}><code>{t.name}</code><span className="dim">{t.columns.length} cols</span></button>)}
        </div>
      )}
      {part.kind === "queue" && (
        <div className="sys-group">
          <div className="sys-row-label sys-row-head">Events · {events.length}<button type="button" className="link-btn" onClick={() => onSelect({ kind: "new", what: "event", parent: part.id })}><Plus size={12} /> Add</button></div>
          {events.map((e) => <button key={e.id} type="button" className="sys-mini" onClick={() => onSelect({ kind: "event", id: e.id })}><code>{e.name}</code></button>)}
        </div>
      )}
      <div className="sys-handoff">
        <b>Hand it off</b>
        <p>The brief has its links, contracts, shapes, the pages that use it and the traces through it.</p>
        <button type="button" className="btn" onClick={copy}><Copy size={13} /> Copy brief</button>
      </div>
    </div>
  );
}

/** Warnings worth acting on, with nothing selected. */
/** What to look at on this screen: the system's gaps in System, the plan's in Plan; the rail counts the same list. */
function SystemChecks({ doc, plan }: { doc: Doc; plan: boolean }) {
  const [all, setAll] = useState(false);
  const found = plan ? planNotes(doc) : systemNotes(doc);
  const items = all ? found : found.slice(0, 6);
  // Nothing to check on an empty screen: no "all clear" for a system or a plan that isn't there yet.
  const empty = plan ? Object.keys(doc.requirements).length + Object.keys(doc.questions).length === 0 : Object.keys(doc.parts).length === 0;
  if (!found.length && empty) return null;
  return (
    <div className="sys-checks-list">
      <div className="sys-row-label">{found.length ? `${found.length} thing${found.length === 1 ? "" : "s"} to look at` : "Nothing to fix"}</div>
      {items.length === 0 && <p className="hint"><CircleCheck size={13} className="green" /> {plan ? "Everything due now has something that serves it, every must has a phase, and no question is left open." : "Every link says what it carries and every cached read goes stale when it should."}</p>}
      {items.map((t, i) => <p key={i} className="sys-check"><AlertTriangle size={13} /> {t}</p>)}
      {found.length > items.length && <button type="button" className="link-btn sys-checks-more" onClick={() => setAll(true)}>Show all {found.length}</button>}
    </div>
  );
}
