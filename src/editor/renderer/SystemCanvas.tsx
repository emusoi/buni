// The System views as canvases: everything drags, wires show what connects to what, and dragging
// from one thing to another makes the connection. Every change goes through the same tools as agents.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background, Controls, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type Node as FlowNode, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import { AlertTriangle, Boxes,  Cloud, Globe, Inbox, Plus, Route, Search, Shapes as ShapesIcon, Table2, Zap } from "lucide-react";
import type { Doc, Id, Part, Placement } from "buni/format/doc.ts";
import { runtimesFor } from "buni/format/parse.ts";
import { runtimeLabel } from "buni/tools/topology.ts";
import type { EditTool } from "../api.ts";
import {
  apiGraph, cacheGraph, callArgs, callName, callOf, callWires, positionOf, shapesGraph, stalenessGrid, systemLayout, topologyLayout,
  type Call, type CallWire, type GraphNode, type SystemSelection,
} from "./system.ts";

type Select = (s: SystemSelection | undefined) => void;
type Toast = (m: string) => void;

async function edit(tool: EditTool, args: Record<string, unknown>, onToast: Toast) {
  const r = await window.buni.edit(tool, args);
  if (!r.ok) onToast(r.reply);
  return r;
}

// ---------------------------------------------------------------------------------------------
// The shared canvas

type AnyNode = FlowNode<Record<string, unknown>>;

interface CanvasProps {
  /** Remembers dragged positions under this view; without it, dragging is for dropping only. */
  view?: "api" | "shapes" | "cache" | "traces";
  doc: Doc;
  nodes: AnyNode[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  /** What the search box can find, by node id. */
  search: { id: string; label: string }[];
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  onPaneClick?: () => void;
  onConnect?: (c: Connection) => void;
  onEdgesDelete?: (ids: string[]) => void;
  /** Replaces remembering positions: where a node was dropped, for views where that means something. */
  onDrop?: (node: AnyNode) => void;
  /** Nodes to bring into view when they change: the selection and what it is wired to. */
  focus?: string[];
  onToast: Toast;
  /** Start scrolled to the top of a tall board instead of its middle. */
  alignTop?: boolean;
  children?: ReactNode;
}

function CanvasInner({ view, doc, nodes: derived, edges, nodeTypes, search, onNodeClick, onEdgeClick, onPaneClick, onConnect, onEdgesDelete, onDrop, focus, onToast, alignTop, children }: CanvasProps) {
  const placed = useMemo(() => derived.map((n) => {
    const p = view ? doc.positions[`${view}:${n.id}`] : undefined;
    return p ? { ...n, position: { x: p.x, y: p.y } } : n;
  }), [derived, doc.positions, view]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNode>(placed);
  useEffect(() => setNodes(placed), [placed, setNodes]);
  const rf = useReactFlow();
  const focusKey = (focus ?? []).join(" ");
  useEffect(() => {
    if (!focusKey) return;
    const t = setTimeout(() => void rf.fitView({ nodes: focusKey.split(" ").map((id) => ({ id })), duration: 350, maxZoom: 1, minZoom: 0.35, padding: 0.25 }), 30);
    return () => clearTimeout(t);
  }, [focusKey, rf]);
  // A tall board fits its width and starts at the top, so every lane's heading shows.
  const wrap = useRef<HTMLDivElement>(null);
  const count = derived.length;
  // Once the cards are measured: a timer guessed at that, and when it guessed early the board kept the
  // default view, its lanes under the search box.
  const measured = useNodesInitialized();
  useEffect(() => {
    if (!alignTop || !measured) return;
    const el = wrap.current;
    const b = rf.getNodesBounds(rf.getNodes());
    if (!el || !b.width) return;
    const zoom = Math.min(1, Math.max(0.35, (el.clientWidth - 48) / b.width));
    void rf.setViewport({ x: Math.max(24, (el.clientWidth - b.width * zoom) / 2) - b.x * zoom, y: 72 - b.y * zoom, zoom });
  }, [alignTop, rf, count, measured]);
  const [q, setQ] = useState("");
  const hits = q.trim() ? search.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const go = (id: string) => {
    void rf.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.1, padding: 0.4 });
    onNodeClick?.(id);
    setQ("");
  };
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => onNodeClick?.(n.id)}
      onEdgeClick={(_, e) => onEdgeClick?.(e.id)}
      onPaneClick={() => onPaneClick?.()}
      onConnect={(c) => onConnect?.(c)}
      onEdgesDelete={(es) => onEdgesDelete?.(es.map((e) => e.id))}
      deleteKeyCode={onEdgesDelete ? ["Backspace", "Delete"] : null}
      onNodeDragStop={(_, n, dragged) => {
        if (onDrop) return onDrop(n);
        const items = (dragged.length ? dragged : [n]).filter((d) => !d.id.startsWith("lane:")).map((d) => ({ id: d.id, x: Math.round(d.position.x), y: Math.round(d.position.y) }));
        if (view && items.length) void edit("move_on_canvas", { view, items }, onToast);
      }}
      ref={wrap}
      fitView={!alignTop}
      fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.55 }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
      {/* A map of the map only once there's more than fits a glance. */}
      {nodes.length > 12 && <MiniMap pannable zoomable className="sys-minimap" nodeColor="var(--line)" maskColor="rgb(var(--ink-rgb) / 0.06)" />}
      <Panel position="top-right" className="sys-search">
        <label><Search size={13} /><input placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0].id); if (e.key === "Escape") setQ(""); }} aria-label="Find on canvas" /></label>
        {hits.length > 0 && <div className="sys-search-hits">{hits.map((h) => <button key={h.id} type="button" onClick={() => go(h.id)}>{h.label}</button>)}</div>}
      </Panel>
      {view && <Panel position="bottom-right" className="sys-hint-panel"><button type="button" className="link-btn" onClick={() => void edit("arrange_canvas", { view }, onToast)}>Arrange</button></Panel>}
      {children}
    </ReactFlow>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <div className="sys-flow">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

/** Imported things by id → the file they live in; the System views badge them and keep them read-only. */
export const OwnersContext = createContext<Record<Id, string>>({});

/** "from catalog.buni" on anything that lives in an imported file. */
export function FromBadge({ id }: { id: Id }) {
  const from = useContext(OwnersContext)[id];
  return from ? <span className="sys-from" title={`Lives in ${from}; edit it there`}>{from}</span> : null;
}

function LaneNode({ data }: NodeProps<FlowNode<{ label: string }>>) {
  return <div className="sys-lane-label">{data.label}</div>;
}

const lane = (g: GraphNode): AnyNode => ({ id: g.id, type: "lane", position: { x: g.x, y: g.y }, data: { label: g.label ?? "" }, draggable: false, selectable: false });

// ---------------------------------------------------------------------------------------------
// Call cards, used by API and Cache

type CallData = { call: Call; on: boolean; dim: boolean; detail?: ReactNode };

function CallNode({ data }: NodeProps<FlowNode<CallData>>) {
  const { call, on, dim, detail } = data;
  const kind = call.rest ? call.value.method.toLowerCase() : call.value.kind;
  return (
    <div className={`sys-callnode k-${kind}${on ? " on" : ""}${dim ? " dim" : ""}`}>
      <Handle type="target" position={Position.Left} className="sys-handle small" />
      <div className="sys-callnode-top">
        <span className={`sys-method m-${kind}`}>{call.rest ? call.value.method : call.value.kind}</span>
        <code className="sys-callnode-name">{call.rest ? call.value.path : call.value.name}</code>
        {call.value.cache && <Zap size={12} className="amber" />}
        <FromBadge id={call.value.id} />
        {(call.value.errors?.length ?? 0) > 0 && <span className="sys-errs" title={call.value.errors?.map((e) => `${e.code}: ${e.when}`).join("\n")}>{call.value.errors?.length} err</span>}
      </div>
      {detail ?? <div className="sys-callnode-sub"><span>{call.value.summary}</span>{!call.rest && <code className="shape-type">{call.value.returns}{call.value.nullable ? "" : "!"}</code>}</div>}
      <Handle type="source" position={Position.Right} className="sys-handle small" />
    </div>
  );
}

function MiniNode({ id, data }: NodeProps<FlowNode<{ label: string; sub?: string; icon: "shape" | "table" | "event"; on: boolean; dim: boolean }>>) {
  const Icon = data.icon === "shape" ? ShapesIcon : data.icon === "table" ? Table2 : Inbox;
  return (
    <div className={`sys-mininode i-${data.icon}${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      <Handle type="target" position={Position.Left} className="sys-handle small" />
      <Icon size={12} /><code>{data.label}</code>{data.sub && <span className="dim">{data.sub}</span>}<FromBadge id={id} />
      <Handle type="source" position={Position.Right} className="sys-handle small" />
    </div>
  );
}

const WIRE_STYLE: Record<CallWire["kind"], { cls: string; label: string }> = {
  returns: { cls: "w-returns", label: "returns" }, takes: { cls: "w-takes", label: "takes" }, reads: { cls: "w-reads", label: "reads" },
  writes: { cls: "w-writes", label: "writes" }, emits: { cls: "w-emits", label: "emits" }, invalidates: { cls: "w-stale", label: "makes stale" },
};

// ---------------------------------------------------------------------------------------------
// API

const API_TYPES: NodeTypes = { call: CallNode, mini: MiniNode, lane: LaneNode };

export function ApiCanvas({ doc, service, selection, onSelect, onToast }: { doc: Doc; service: Part; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const [all, setAll] = useState(false);
  const selected = selection && "id" in selection ? selection.id : undefined;
  const graph = useMemo(() => apiGraph(doc, service.id), [doc, service.id]);
  const calls = useMemo(() => graph.flatMap((g) => (g.kind === "call" ? [callOf(doc, g.id)].filter((c): c is Call => !!c) : [])), [graph, doc]);
  // Which wires show: the selected call's, or every call wired to the selected shape, table or event; all of them on request.
  const wires = useMemo(() => calls.flatMap((c) => callWires(doc, c).map((w) => ({ from: c.value.id, ...w }))).filter((w) => graph.some((g) => g.id === w.to)), [calls, doc, graph]);
  const shown = wires.filter((w) => all || w.from === selected || w.to === selected);
  const lit = new Set(shown.flatMap((w) => [w.from, w.to]));
  const focus = selected !== undefined && graph.some((g) => g.id === selected);
  const nodes = useMemo((): AnyNode[] => graph.map((g): AnyNode => {
    if (g.kind === "lane") return lane(g);
    const dim = focus && g.id !== selected && !lit.has(g.id);
    if (g.kind === "call") {
      const call = callOf(doc, g.id);
      return { id: g.id, type: "call", position: { x: g.x, y: g.y }, data: { call, on: g.id === selected, dim } };
    }
    const label = g.kind === "shape" ? doc.shapes[g.id]?.name ?? g.id : g.kind === "table" ? doc.tables[g.id]?.name ?? g.id : doc.events[g.id]?.name ?? g.id;
    const sub = g.kind === "shape" ? (doc.shapes[g.id]?.values ? "enum" : `${doc.shapes[g.id]?.fields.length ?? 0} fields`) : g.kind === "table" ? doc.parts[doc.tables[g.id]?.store ?? ""]?.name : undefined;
    return { id: g.id, type: "mini", position: { x: g.x, y: g.y }, data: { label, sub, icon: g.kind, on: g.id === selected, dim } };
  }), [graph, doc, selected, focus, lit]);
  const edges = useMemo((): Edge[] => shown.map((w) => ({
    id: `${w.from}>${w.kind}>${w.to}`, source: w.from, target: w.to, className: `sys-wire2 ${WIRE_STYLE[w.kind].cls}`,
    label: all ? undefined : WIRE_STYLE[w.kind].label, markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 },
    labelBgPadding: [5, 2], labelBgBorderRadius: 3,
  })), [shown, all]);
  const select = (id: string) => {
    const c = callOf(doc, id);
    if (c) return onSelect({ kind: c.rest ? "endpoint" : "operation", id });
    if (doc.shapes[id]) return onSelect({ kind: "shape", id });
    if (doc.tables[id]) return onSelect({ kind: "table", id });
    if (doc.events[id]) return onSelect({ kind: "event", id });
  };
  // Dragging from a call to a table, shape, event or cached call wires it.
  const connect = (conn: Connection) => {
    const c = callOf(doc, conn.source);
    if (!c) return onToast("Drag from a call to what it uses.");
    const { tool, args } = callArgs(c);
    const reading = c.rest ? c.value.method === "GET" : c.value.kind === "query";
    const target = conn.target;
    const add = (key: "reads" | "writes" | "emits" | "invalidates", note: string) => {
      const list = (args[key] as Id[] | undefined) ?? [];
      if (list.includes(target)) return onToast(`Already ${note}.`);
      void edit(tool, { ...args, [key]: [...list, target] }, onToast).then((r) => r.ok && onToast(`${callName(c)} ${note}.`));
    };
    if (doc.tables[target]) return add(reading ? "reads" : "writes", `${reading ? "reads" : "writes"} ${doc.tables[target]?.name}`);
    if (doc.events[target]) return add("emits", `emits ${doc.events[target]?.name}`);
    const other = callOf(doc, target);
    if (other) return add("invalidates", `makes ${callName(other)} stale`);
    const shape = doc.shapes[target];
    if (shape) {
      if (!c.rest) return void edit(tool, { ...args, returns: `${shape.name}${c.value.returns.endsWith("[]") ? "[]" : ""}` }, onToast).then((r) => r.ok && onToast(`${callName(c)} returns ${shape.name}.`));
      // A body that is a shape whole isn't a list to add to: say so rather than replace it.
      if (c.value.responseShape) return onToast(`${callName(c)} already returns ${doc.shapes[c.value.responseShape]?.name ?? "a shape"} whole; change it in its form.`);
      const name = shape.name.charAt(0).toLowerCase() + shape.name.slice(1);
      return void edit(tool, { ...args, response: [...c.value.response.filter((f) => f.name !== name), { name, type: shape.name }] }, onToast).then((r) => r.ok && onToast(`${callName(c)} returns ${name}: ${shape.name}.`));
    }
  };
  const search = graph.filter((g) => g.kind !== "lane").map((g) => {
    const c = g.kind === "call" ? callOf(doc, g.id) : undefined;
    return { id: g.id, label: c ? callName(c) : doc.shapes[g.id]?.name ?? doc.tables[g.id]?.name ?? doc.events[g.id]?.name ?? g.id };
  });
  return (
    <Canvas view="api" doc={doc} nodes={nodes} edges={edges} nodeTypes={API_TYPES} search={search} focus={focus && !all ? [...lit, selected ?? ""].filter(Boolean) : undefined} onNodeClick={select} onPaneClick={() => onSelect(undefined)} onConnect={connect} onToast={onToast}>
      <Panel position="top-left" className="sys-add">
        <button type="button" onClick={() => onSelect({ kind: "new", what: service.api === "graphql" ? "operation" : "endpoint", parent: service.id })}><Plus size={13} /> {service.api === "graphql" ? "Operation" : "Endpoint"}</button>
        <label className="sys-toggle"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all wires</label>
      </Panel>
      <Panel position="bottom-left" className="sys-hint-panel">Click a call to see what it touches · drag from a call to a table, shape, event or cached call to wire it</Panel>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------------------------
// Shapes

type ShapeData = { id: Id; on: boolean; dim: boolean; doc: Doc };

function ShapeNode({ data }: NodeProps<FlowNode<ShapeData>>) {
  const s = data.doc.shapes[data.id];
  if (!s) return null;
  const names = new Set(Object.values(data.doc.shapes).map((x) => x.name));
  return (
    <div className={`sys-shapenode${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      <Handle type="target" position={Position.Left} className="sys-handle small" style={{ top: 18 }} />
      <div className="sys-shapenode-head"><ShapesIcon size={12} /> <code>{s.name}</code>{s.values && <span className="sys-badge">enum</span>}<FromBadge id={s.id} /></div>
      {s.values
        ? s.values.map((v) => <div key={v} className="sys-shapenode-row"><code className="shape-type">{v}</code></div>)
        : s.fields.map((f) => (
          <div key={f.name} className="sys-shapenode-row">
            <code>{f.name}{f.optional ? "?" : ""}</code>
            <code className={names.has(f.type.replace(/\[\]$/, "")) ? "shape-type" : "dim"}>{f.type}</code>
            <Handle id={f.name} type="source" position={Position.Right} className="sys-handle small field" />
          </div>
        ))}
    </div>
  );
}

const SHAPE_TYPES: NodeTypes = { shape: ShapeNode };

export function ShapesCanvas({ doc, selection, onSelect, onToast }: { doc: Doc; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection?.kind === "shape" ? selection.id : undefined;
  const [all, setAll] = useState(false);
  const graph = useMemo(() => shapesGraph(doc), [doc]);
  const byName = useMemo(() => new Map(Object.values(doc.shapes).map((s) => [s.name, s.id])), [doc]);
  const refs = useMemo(() => Object.values(doc.shapes).flatMap((s) => s.fields.flatMap((f) => {
    const to = byName.get(f.type.replace(/\[\]$/, ""));
    return to && to !== s.id ? [{ from: s.id, field: f.name, to, list: f.type.endsWith("[]") }] : [];
  })), [doc, byName]);
  const lit = new Set(refs.filter((r) => r.from === selected || r.to === selected).flatMap((r) => [r.from, r.to]));
  const nodes = useMemo((): AnyNode[] => graph.map((g) => ({ id: g.id, type: "shape", position: { x: g.x, y: g.y }, data: { id: g.id, doc, on: g.id === selected, dim: !!selected && g.id !== selected && !lit.has(g.id) } })), [graph, doc, selected, lit]);
  // Only the selected shape's references draw, unless asked for all: a big type graph is unreadable as one tangle.
  const edges = useMemo((): Edge[] => refs.filter((r) => all || r.from === selected || r.to === selected).map((r) => {
    const hot = r.from === selected || r.to === selected;
    return { id: `${r.from}.${r.field}`, source: r.from, sourceHandle: r.field, target: r.to, className: `sys-wire2 w-returns${selected && !hot ? " dim" : ""}${hot ? " hot" : ""}`, label: r.list ? "[ ]" : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 } };
  }), [refs, selected, all]);
  // Dragging from a field to a shape types the field with it.
  const connect = (c: Connection) => {
    const s = doc.shapes[c.source];
    const target = doc.shapes[c.target];
    if (!s || !target || !c.sourceHandle) return;
    const fields = s.fields.map((f) => (f.name === c.sourceHandle ? { ...f, type: `${target.name}${f.type.endsWith("[]") ? "[]" : ""}` } : f));
    void edit("set_shape", { shape: s.id, name: s.name, fields, ...(s.note ? { note: s.note } : {}) }, onToast).then((r) => r.ok && onToast(`${s.name}.${c.sourceHandle} is now a ${target.name}.`));
  };
  return (
    <Canvas view="shapes" doc={doc} nodes={nodes} edges={edges} nodeTypes={SHAPE_TYPES} focus={selected ? [selected, ...lit] : undefined} search={Object.values(doc.shapes).map((s) => ({ id: s.id, label: s.name }))} onNodeClick={(id) => onSelect({ kind: "shape", id })} onPaneClick={() => onSelect(undefined)} onConnect={connect} onToast={onToast}>
      <Panel position="top-left" className="sys-add">
        <button type="button" onClick={() => onSelect({ kind: "new", what: "shape" })}><Plus size={13} /> Shape</button>
        <label className="sys-toggle"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all wires</label>
      </Panel>
      <Panel position="bottom-left" className="sys-hint-panel">Drag from a field to a shape to type the field with it</Panel>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------------------------
// Cache

const CACHE_TYPES: NodeTypes = { call: CallNode, lane: LaneNode };

export function CacheCanvas({ doc, selection, onSelect, onToast }: { doc: Doc; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const { reads, writes, cell } = useMemo(() => stalenessGrid(doc), [doc]);
  const graph = useMemo(() => cacheGraph(doc), [doc]);
  const pairs = useMemo(() => writes.flatMap((w) => reads.flatMap((r) => { const s = cell(w, r); return s === "none" ? [] : [{ w, r, s }]; })), [reads, writes, cell]);
  const nodes = useMemo((): AnyNode[] => graph.map((g): AnyNode => {
    if (g.kind === "lane") return lane(g);
    const call = callOf(doc, g.id);
    const detail = call?.value.cache ? (
      <div className="sys-callnode-sub"><span className="sys-ttl"><Zap size={11} /> {call.value.cache.ttlSeconds}s</span><code className="sys-key">{call.value.cache.key || "no key"}</code><span className="dim">{doc.parts[call.value.cache.part]?.name}</span></div>
    ) : undefined;
    return { id: g.id, type: "call", position: { x: g.x, y: g.y }, data: { call, on: g.id === selected, dim: false, detail } };
  }), [graph, doc, selected]);
  const edges = useMemo((): Edge[] => pairs.map(({ w, r, s }) => ({
    id: `${w.value.id}>${r.value.id}`, source: w.value.id, target: r.value.id,
    className: `sys-wire2 ${s === "set" ? "w-stale" : "w-missing"}`, animated: s === "missing",
    label: s === "missing" ? "writes its data · click to add" : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 },
    labelBgPadding: [5, 2], labelBgBorderRadius: 3, deletable: s === "set",
  })), [pairs]);
  const setStale = (writeId: Id, readId: Id, on: boolean) => {
    const w = callOf(doc, writeId);
    if (!w) return;
    const now = w.value.invalidates ?? [];
    const next = on ? [...new Set([...now, readId])] : now.filter((x) => x !== readId);
    const { tool, args } = callArgs(w, { invalidates: next });
    void edit(tool, args, onToast);
  };
  return (
    <Canvas
      view="cache" doc={doc} nodes={nodes} edges={edges} nodeTypes={CACHE_TYPES}
      search={[...reads, ...writes].map((c) => ({ id: c.value.id, label: callName(c) }))}
      onNodeClick={(id) => { const c = callOf(doc, id); if (c) onSelect({ kind: c.rest ? "endpoint" : "operation", id }); }}
      onEdgeClick={(id) => { const [w, r] = id.split(">"); const p = pairs.find((x) => x.w.value.id === w && x.r.value.id === r); if (p?.s === "missing" && w && r) setStale(w, r, true); }}
      onEdgesDelete={(ids) => ids.forEach((id) => { const [w, r] = id.split(">"); if (w && r) setStale(w, r, false); })}
      onPaneClick={() => onSelect(undefined)}
      onConnect={(c) => { if (callOf(doc, c.target)?.value.cache) setStale(c.source, c.target, true); else onToast("Drag from a write to a cached read."); }}
      onToast={onToast}
    >
      <Panel position="bottom-left" className="sys-hint-panel">Solid: makes it stale · moving dashes: writes its data without saying so (click to add) · drag write → cached read to add · select a wire and ⌫ to remove</Panel>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------------------------
// Traces

type PartData = { part: Part; on: boolean };

function TracePartNode({ data }: NodeProps<FlowNode<PartData>>) {
  return (
    <div className={`sys-mininode i-part${data.on ? " on" : ""}`}>
      <Handle type="target" position={Position.Left} className="sys-handle small" />
      <Handle type="target" id="top" position={Position.Top} className="sys-handle small" />
      <b>{data.part.name}</b><span className="dim">{data.part.kind}</span><FromBadge id={data.part.id} />
      <Handle type="source" position={Position.Right} className="sys-handle small" />
      <Handle type="source" id="bottom" position={Position.Bottom} className="sys-handle small" />
    </div>
  );
}

const TRACE_TYPES: NodeTypes = { part: TracePartNode };

export function TraceCanvas({ doc, trace, selection, onSelect, onToast }: { doc: Doc; trace: Id; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const t = doc.traces[trace];
  const partIds = useMemo(() => (t ? [...new Set(t.steps.flatMap((s) => [s.from, s.to]))] : []), [t]);
  const nodes = useMemo((): AnyNode[] => {
    const { cards } = systemLayout(doc);
    return partIds.flatMap((id): AnyNode[] => {
      const part = doc.parts[id];
      if (!part) return [];
      const at = positionOf(part, cards);
      return [{ id, type: "part", position: { x: at.x * 1.1, y: at.y * 1.4 }, data: { part, on: selection?.kind === "trace" } }];
    });
  }, [doc, partIds, selection]);
  const edges = useMemo((): Edge[] => {
    if (!t) return [];
    const seen = new Map<string, number>();
    return t.steps.map((s, i) => {
      const key = [s.from, s.to].sort().join(">");
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const via = s.via ? (callOf(doc, s.via) ? callName(callOf(doc, s.via) as Call) : doc.events[s.via]?.name) : undefined;
      const bits = [via && via !== s.action ? via : undefined, s.carries ? doc.shapes[s.carries]?.name : undefined, s.ms !== undefined ? `${s.ms} ms` : undefined].filter(Boolean);
      return {
        id: `step-${i}`, source: s.from, target: s.to, className: `sys-wire2 ${s.async ? "w-async" : "w-step"}`,
        label: `${i + 1} · ${s.action}${bits.length ? ` · ${bits.join(" · ")}` : ""}`, animated: !!s.async,
        pathOptions: { curvature: 0.25 + n * 0.35 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 }, labelBgPadding: [6, 3], labelBgBorderRadius: 4,
      };
    });
  }, [t, doc]);
  if (!t) return null;
  // Dragging from one part to another adds that hop as the next step.
  const connect = (c: Connection) => {
    const linked = Object.values(doc.links).some((l) => (l.from === c.source && l.to === c.target) || (l.from === c.target && l.to === c.source));
    if (!linked) return onToast(`${doc.parts[c.source]?.name} and ${doc.parts[c.target]?.name} aren't linked; link them on the map first.`);
    void edit("set_trace", { trace: t.id, name: t.name, ...(t.page ? { page: t.page } : {}), steps: [...t.steps, { from: c.source, to: c.target, action: "new step" }] }, onToast).then((r) => {
      if (r.ok) { onSelect({ kind: "trace", id: t.id }); onToast("Added a step; name it in the panel."); }
    });
  };
  const budget = t.steps.filter((s) => !s.async).reduce((sum, s) => sum + (s.ms ?? 0), 0);
  return (
    <Canvas
      view="traces" doc={doc} nodes={nodes} edges={edges} nodeTypes={TRACE_TYPES}
      search={partIds.map((id) => ({ id, label: doc.parts[id]?.name ?? id }))}
      onNodeClick={() => onSelect({ kind: "trace", id: t.id })} onEdgeClick={() => onSelect({ kind: "trace", id: t.id })} onPaneClick={() => onSelect(undefined)}
      onConnect={connect} onToast={onToast}
    >
      <Panel position="bottom-left" className="sys-hint-panel">{budget > 0 ? `~${budget} ms before the person sees a response · ` : ""}numbered hops in order, moving dashes run after the response · drag part → part to add a hop</Panel>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------------------------
// Topology

const REGION_W = 380;
const CARD_H = 74;

function RegionNode({ data }: NodeProps<FlowNode<{ region: string; w: number; h: number }>>) {
  return <div className="sys-region-node" style={{ width: data.w, height: data.h }}><span><Globe size={13} /> {data.region}</span></div>;
}

function ClusterNode({ data }: NodeProps<FlowNode<{ label: string; sub: string; w: number; h: number; on: boolean }>>) {
  return <div className={`sys-cluster-node${data.on ? " on" : ""}`} style={{ width: data.w, height: data.h }}><span><Boxes size={13} /> <b>{data.label}</b> <span className="dim">{data.sub}</span></span></div>;
}

function PlacementNode({ data }: NodeProps<FlowNode<{ pl?: Placement; part: Part; on: boolean; unplaced?: boolean }>>) {
  const { pl, part, on, unplaced } = data;
  const facts = pl ? [
    pl.namespace && `ns ${pl.namespace}`,
    pl.scale && (pl.scale.min === pl.scale.max ? `${pl.scale.min}×` : `${pl.scale.min}–${pl.scale.max}×`),
    pl.resources?.cpu, pl.resources?.memory, pl.service, pl.schedule,
  ].filter(Boolean) : [];
  return (
    <div className={`sys-place${on ? " on" : ""}${unplaced ? " unplaced" : ""}`} style={{ width: REGION_W - 64 }}>
      <span className="sys-place-top"><b>{part.name}</b><FromBadge id={part.id} /><span className={`sys-runtime rt-${pl?.runtime ?? "none"}`}>{pl ? runtimeLabel(pl.runtime) : "not placed"}</span></span>
      {facts.length > 0 && <span className="sys-place-facts">{facts.join(" · ")}</span>}
      {pl?.ingress && <code className="sys-place-ingress">{pl.ingress.host}{pl.ingress.path === "/" ? "" : pl.ingress.path}</code>}
    </div>
  );
}

const TOPO_TYPES: NodeTypes = { region: RegionNode, cluster: ClusterNode, place: PlacementNode };

type Rect = { id: Id; kind: "region" | "cluster"; region: string; x: number; y: number; w: number; h: number };

export function TopologyCanvas({ doc, environment, selection, onSelect, onToast }: { doc: Doc; environment: Id; selection: SystemSelection | undefined; onSelect: Select; onToast: Toast }) {
  const selected = selection && "id" in selection ? selection.id : undefined;
  const { nodes, rects } = useMemo(() => {
    const { regions, unplaced } = topologyLayout(doc, environment);
    const out: AnyNode[] = [];
    const rects: Rect[] = [];
    // Parts not placed yet wait in a column on the left; drag one into a region or cluster.
    unplaced.forEach((part, i) => out.push({ id: `unplaced:${part.id}`, type: "place", position: { x: -REGION_W + 20, y: 40 + i * (CARD_H - 14) }, data: { part, on: false, unplaced: true } }));
    regions.forEach((r, ri) => {
      const x = ri * (REGION_W + 30);
      let y = 44;
      for (const { cluster, namespaces } of r.clusters) {
        const placements = namespaces.flatMap((n) => n.placements);
        const h = 44 + Math.max(1, placements.length) * CARD_H + 8;
        rects.push({ id: cluster.id, kind: "cluster", region: r.region, x: x + 12, y, w: REGION_W - 24, h });
        out.push({ id: `cluster:${cluster.id}`, type: "cluster", position: { x: x + 12, y }, data: { label: cluster.name, sub: `${cluster.kind}${cluster.version ? ` · ${cluster.version}` : ""}`, w: REGION_W - 24, h, on: cluster.id === selected }, draggable: false, zIndex: -1 });
        placements.forEach((pl, i) => { const part = doc.parts[pl.part]; if (part) out.push({ id: pl.id, type: "place", position: { x: x + 32, y: y + 40 + i * CARD_H }, data: { pl, part, on: pl.id === selected } }); });
        y += h + 16;
      }
      r.other.forEach((pl, i) => { const part = doc.parts[pl.part]; if (part) out.push({ id: pl.id, type: "place", position: { x: x + 32, y: y + i * CARD_H }, data: { pl, part, on: pl.id === selected } }); });
      y += r.other.length * CARD_H + 12;
      const h = Math.max(y, 200);
      rects.push({ id: r.region, kind: "region", region: r.region, x, y: 0, w: REGION_W, h });
      out.unshift({ id: `region:${r.region}`, type: "region", position: { x, y: 0 }, data: { region: r.region, w: REGION_W, h }, draggable: false, selectable: false, zIndex: -2 });
    });
    return { nodes: out, rects };
  }, [doc, environment, selected]);
  // Where a card lands decides what changes: into a cluster makes it a Kubernetes workload there; into a region moves it there.
  const drop = (n: AnyNode) => {
    const cx = n.position.x + (REGION_W - 64) / 2;
    const cy = n.position.y + 30;
    const inside = (r: Rect) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    const cluster = rects.find((r) => r.kind === "cluster" && inside(r));
    const region = rects.find((r) => r.kind === "region" && inside(r));
    const partId = n.id.startsWith("unplaced:") ? n.id.slice("unplaced:".length) : doc.placements[n.id]?.part;
    const part = partId ? doc.parts[partId] : undefined;
    if (!part) return;
    const pl = doc.placements[n.id];
    const fits = runtimesFor(part);
    const k8s = fits.filter((r) => ["deployment", "statefulset", "daemonset", "cronjob", "job"].includes(r));
    if (!cluster && !region) return onToast("Drop it into a region or a cluster.");
    if (cluster) {
      if (!k8s.length) return onToast(`A ${part.kind} doesn't run on Kubernetes.`);
      const runtime = pl && k8s.includes(pl.runtime) ? pl.runtime : k8s[0];
      const base = pl ? { ...pl } : {};
      const { id: _i, part: _p, environment: _e, runtime: _r, regions: _g, cluster: _c, ...rest } = base as Placement;
      void edit("place", { ...(pl ? rest : {}), part: part.id, environment, runtime, regions: [cluster.region], cluster: cluster.id, namespace: pl?.namespace ?? part.id.replace(/[^a-z0-9-]/g, "-") }, onToast).then((r) => {
        if (r.ok) { const id = r.reply.match(/^Placement (\S+) saved/)?.[1]; if (id) onSelect({ kind: "placement", id }); }
      });
      return;
    }
    if (region) {
      if (pl && !k8s.includes(pl.runtime)) return void edit("place", { ...pl, regions: [region.region], id: undefined }, onToast);
      if (pl) return onToast("Kubernetes workloads live in a cluster; drop it into one.");
      onSelect({ kind: "new", what: "placement", part: part.id, environment });
    }
  };
  return (
    <Canvas
      doc={doc} nodes={nodes} edges={[]} nodeTypes={TOPO_TYPES}
      search={nodes.filter((n) => n.type === "place").map((n) => ({ id: n.id, label: String((n.data as { part: Part }).part.name) }))}
      onNodeClick={(id) => {
        if (id.startsWith("cluster:")) return onSelect({ kind: "cluster", id: id.slice(8) });
        if (id.startsWith("unplaced:")) return onSelect({ kind: "new", what: "placement", part: id.slice(9), environment });
        if (doc.placements[id]) onSelect({ kind: "placement", id });
      }}
      onPaneClick={() => onSelect(undefined)}
      onDrop={drop}
      onToast={onToast}
    >
      <Panel position="top-left" className="sys-add">
        <button type="button" onClick={() => onSelect({ kind: "new", what: "cluster", environment })}><Boxes size={13} /> Cluster</button>
        <button type="button" onClick={() => onSelect({ kind: "environment", id: environment })}><Cloud size={13} /> {doc.environments[environment]?.name}</button>
      </Panel>
      <Panel position="bottom-left" className="sys-hint-panel">Drag a part into a cluster to run it there on Kubernetes, or into a region · parts on the left aren't placed yet</Panel>
    </Canvas>
  );
}

export function StaleNote({ doc }: { doc: Doc }) {
  const { reads, writes, cell } = stalenessGrid(doc);
  const n = reads.reduce((sum, r) => sum + writes.filter((w) => cell(w, r) === "missing").length, 0);
  if (!n) return null;
  return <span className="sys-state warn"><AlertTriangle size={12} /> {n} stale risk{n === 1 ? "" : "s"}</span>;
}

export { Route };
