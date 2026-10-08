// The system behind the screens: parts and links, endpoints, operations, tables, shapes, events, traces, where it runs,
// and exports. One area of buni's design tools (agent/areas.ts); tools.ts gathers them.
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import type { Endpoint, Field, Id, Link, Node, Part, Access, Cluster, Environment, Operation, Placement, QueueEvent, Shape, Trace, Table } from "../../format/doc.ts";
import type { Op } from "../../oplog/oplog.ts";
import { openApi, sqlSchema } from "../backend.ts";
import { placementOf } from "../topology.ts";
import { ACCESS, BODY, CACHE, ERRORS, FIELD, Ids, type Tool, ToolError, body, deleted, forget, node, page, tool } from "../kit.ts";

export const systemTools = {
  set_part: tool({
    description:
      "Add a part of the system, or change one (pass part). Kinds: client (a web or mobile app the pages live in), service (an API or worker), " +
      "store (a database), cache (Redis, a CDN), queue (a message bus), external (Stripe, an email provider). Read buni skills system-design first.",
    input: {
      part: z.string().optional().describe("Part id to change; omit to add one"),
      kind: z.enum(["client", "service", "store", "cache", "queue", "external"]),
      name: z.string().min(1),
      purpose: z.string().min(1).describe("What it is for, in a sentence"),
      tech: z.string().optional().describe('What it is built on, e.g. "Postgres 16"'),
      ifDown: z.string().optional().describe("What the rest of the system does while this part is down; kept when omitted"),
      api: z.enum(["rest", "graphql", "none"]).optional().describe("Services: REST endpoints, GraphQL operations, or none (a worker); kept when omitted"),
      terminal: z
        .union([
          z.object({
            targets: z
              .array(z.object({ language: z.enum(["go", "rust", "python", "typescript"]), framework: z.enum(["bubbletea", "ratatui", "textual", "ink", "opentui", "pi-tui"]).optional() }))
              .min(1),
          }),
          z.literal(false),
        ])
        .optional()
        .describe(
          "Clients that run in a terminal: how it is built, the main way first. Each target is a language and, if it draws full screens, a framework " +
            "(bubbletea=go, ratatui=rust, textual=python, ink, opentui and pi-tui=typescript). Several targets build the same screens to compare. " +
            "false makes it not a terminal client; kept when omitted",
        ),
    },
    run: async (doc, a, ctx) => {
      const old = a.part === undefined ? undefined : doc.parts[a.part];
      if (a.part !== undefined && !old) throw new ToolError(`part "${a.part}" does not exist`);
      const last = Object.values(doc.parts).map((p) => p.index).sort().at(-1) ?? null;
      const value: Part = {
        ...(old ?? { id: new Ids(doc, ctx).slug(a.name), index: generateKeyBetween(last, null) }),
        kind: a.kind, name: a.name, purpose: a.purpose,
      };
      if (a.tech !== undefined) value.tech = a.tech;
      if (a.api !== undefined) value.api = a.api;
      if (a.ifDown !== undefined) { if (a.ifDown) value.ifDown = a.ifDown; else delete value.ifDown; }
      if (a.terminal !== undefined) { if (a.terminal) value.terminal = a.terminal; else delete value.terminal; }
      if (a.kind !== "service" || value.api === "rest") delete value.api;
      return { label: `${old ? "Change" : "Add"} ${a.kind} ${a.name}`, ops: [{ kind: "put", collection: "parts", value }], reply: `Part ${value.id} saved.` };
    },
  }),

  link_parts: tool({
    description:
      "Say how two parts talk: calls (to a service or external), reads or writes (to a store or cache), publishes or subscribes (to a queue), " +
      "and which shapes pass along the link. Endpoints may only touch stores, caches and queues their service links to. Relinking keeps what you leave out.",
    input: {
      from: z.string(),
      to: z.string(),
      kind: z.enum(["calls", "reads", "writes", "publishes", "subscribes"]),
      note: z.string().optional(),
      carries: z.array(z.string()).optional().describe('Shapes on this link, by name ("RefundJob") or id'),
      failure: z.object({
        timeoutMs: z.number().int().positive().optional(), retries: z.number().int().min(0).max(20).optional(),
        idempotencyKey: z.string().optional(), fallback: z.string().optional(),
      }).optional().describe("How the caller copes when this hop is slow or fails; kept when omitted"),
      link: z.string().optional().describe("Link id to change, e.g. to give it another kind; omit to add or match by from, to and kind"),
    },
    run: async (doc, a, ctx) => {
      if (a.link !== undefined && !doc.links[a.link]) throw new ToolError(`link "${a.link}" does not exist`);
      const existing = a.link !== undefined ? doc.links[a.link] : Object.values(doc.links).find((l) => l.from === a.from && l.to === a.to && l.kind === a.kind);
      const value: Link = { ...existing, id: existing?.id ?? new Ids(doc, ctx).slug(`${a.from}-${a.kind}-${a.to}`), from: a.from, to: a.to, kind: a.kind };
      if (a.note) value.note = a.note;
      else if (a.note === "") delete value.note;
      // A shape by the name every other tool uses, or by its id.
      if (a.carries !== undefined) value.carries = a.carries.map((c) => (doc.shapes[c] ? c : Object.values(doc.shapes).find((x) => x.name === c)?.id ?? c));
      if (a.failure !== undefined) { if (Object.keys(a.failure).length) value.failure = a.failure; else delete value.failure; }
      if (value.carries?.length === 0) delete value.carries;
      return { label: `${a.from} ${a.kind} ${a.to}`, ops: [{ kind: "put", collection: "links", value }], reply: `Link ${value.id} saved.` };
    },
  }),

  set_table: tool({
    description:
      "Add a table to a store part, or replace one (pass table). Give every column; ref makes a foreign key to another table's column. " +
      "Read buni skills database-design first.",
    input: {
      table: z.string().optional().describe("Table id to replace; omit to add one"),
      store: z.string(),
      name: z.string().min(1),
      columns: z.array(z.object({
        name: z.string().min(1),
        type: z.string().min(1).describe('SQL type, e.g. "uuid", "text", "numeric(10,2)"'),
        primary: z.boolean().optional(),
        nullable: z.boolean().optional(),
        unique: z.boolean().optional(),
        ref: z.object({ table: z.string(), column: z.string() }).optional().describe("Foreign key"),
        classification: z.enum(["personal", "secret"]).optional().describe("personal: about a person; secret: never shown or logged"),
      })).min(1),
    },
    run: async (doc, a, ctx) => {
      const old = a.table === undefined ? undefined : doc.tables[a.table];
      if (a.table !== undefined && !old) throw new ToolError(`table "${a.table}" does not exist`);
      const last = Object.values(doc.tables).map((t) => t.index).sort().at(-1) ?? null;
      const value: Table = {
        id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null),
        store: a.store, name: a.name, columns: a.columns,
        ...(old?.x !== undefined && old.y !== undefined && old.store === a.store ? { x: old.x, y: old.y } : {}),
      };
      return { label: `${old ? "Change" : "Add"} table ${a.name}`, ops: [{ kind: "put", collection: "tables", value }], reply: `Table ${value.id} saved.` };
    },
  }),

  set_endpoint: tool({
    description:
      "Add an endpoint to a service part, or change one (pass endpoint): method, path, what it takes and returns, the tables it reads and writes " +
      "and the events it emits. Changing one, what you leave out keeps its value; [] empties a list and cache: null removes caching. Read buni skills api-design first.",
    input: {
      endpoint: z.string().optional().describe("Endpoint id to replace; omit to add one"),
      service: z.string(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().describe('Starts with "/"; parameters in braces, e.g. "/quotes/{id}"'),
      summary: z.string().min(1),
      request: BODY.describe('The body it takes: its fields, or a shape whole ("ReturnRequest")'),
      response: BODY.describe('What it returns: its fields, or a shape whole ("Return")'),
      reads: z.array(z.string()).optional().describe("Table ids"),
      writes: z.array(z.string()).optional().describe("Table ids"),
      emits: z.array(z.string()).optional().describe("Event ids"),
      cache: CACHE.nullable().optional().describe("GET only: keep responses in a cache part; null stops caching"),
      invalidates: z.array(z.string()).optional().describe("Cached endpoints or operations whose entries this one makes stale"),
      errors: ERRORS,
      access: ACCESS,
      id: z.string().optional().describe('Id for a new endpoint, e.g. "create-quote"; defaults to one from the summary'),
    },
    run: async (doc, a, ctx) => {
      const old = a.endpoint === undefined ? undefined : doc.endpoints[a.endpoint];
      if (a.endpoint !== undefined && !old) throw new ToolError(`endpoint "${a.endpoint}" does not exist`);
      if (!old && a.id !== undefined && doc.endpoints[a.id]) throw new ToolError(`endpoint "${a.id}" already exists`);
      const last = Object.values(doc.endpoints).map((e) => e.index).sort().at(-1) ?? null;
      // Changing an endpoint, what isn't given stays: an agent fixing the summary must not wipe its tables and errors.
      const req = a.request === undefined ? { fields: old?.request ?? [], shape: old?.requestShape } : body(doc, "request", a.request);
      const res = a.response === undefined ? { fields: old?.response ?? [], shape: old?.responseShape } : body(doc, "response", a.response);
      const cache = a.cache === null ? undefined : a.cache ?? old?.cache;
      const invalidates = a.invalidates ?? old?.invalidates;
      const errors = a.errors ?? old?.errors;
      const value: Endpoint = {
        id: old?.id ?? new Ids(doc, ctx).slug(a.id ?? `${a.method} ${a.path}`), index: old?.index ?? generateKeyBetween(last, null),
        service: a.service, method: a.method, path: a.path, summary: a.summary,
        request: req.fields, response: res.fields, ...(req.shape ? { requestShape: req.shape } : {}), ...(res.shape ? { responseShape: res.shape } : {}),
        reads: a.reads ?? old?.reads ?? [], writes: a.writes ?? old?.writes ?? [], emits: a.emits ?? old?.emits ?? [],
        ...(cache ? { cache } : {}),
        ...(invalidates?.length ? { invalidates } : {}),
        ...(errors?.length ? { errors } : {}),
        ...(a.access ? { access: a.access } : old?.access ? { access: old.access } : {}),
      };
      return { label: `${old ? "Change" : "Add"} ${a.method} ${a.path}`, ops: [{ kind: "put", collection: "endpoints", value }], reply: `Endpoint ${value.id} saved.` };
    },
  }),

  set_operation: tool({
    description:
      "Add a GraphQL operation to a GraphQL service part, or change one (pass operation; what you leave out keeps its value): query, mutation or subscription, its arguments, " +
      "what it returns, the tables it reads and writes, events it emits, caching (queries only) and what it makes stale. Read buni skills api-design first.",
    input: {
      operation: z.string().optional().describe("Operation id to replace; omit to add one"),
      service: z.string().describe("A service part whose API style is graphql"),
      kind: z.enum(["query", "mutation", "subscription"]),
      name: z.string().min(1).describe('camelCase: "plans", "updatePlan"'),
      summary: z.string().min(1),
      args: z.array(FIELD).optional(),
      returns: z.string().min(1).describe('A primitive or shape, [] for a list: "Plan[]"'),
      nullable: z.boolean().optional().describe("The result may be null"),
      reads: z.array(z.string()).optional().describe("Table ids"),
      writes: z.array(z.string()).optional().describe("Table ids"),
      emits: z.array(z.string()).optional().describe("Event ids"),
      cache: CACHE.nullable().optional().describe("Queries only: keep results in a cache part; null stops caching"),
      invalidates: z.array(z.string()).optional().describe("Cached endpoints or operations this one makes stale"),
      errors: ERRORS,
      access: ACCESS,
    },
    run: async (doc, a, ctx) => {
      const old = a.operation === undefined ? undefined : doc.operations[a.operation];
      if (a.operation !== undefined && !old) throw new ToolError(`operation "${a.operation}" does not exist`);
      const last = Object.values(doc.operations).map((o) => o.index).sort().at(-1) ?? null;
      const cache = a.cache === null ? undefined : a.cache ?? old?.cache;
      const invalidates = a.invalidates ?? old?.invalidates;
      const errors = a.errors ?? old?.errors;
      const value: Operation = {
        id: old?.id ?? new Ids(doc, ctx).slug(`${a.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2")}-${a.kind}`), index: old?.index ?? generateKeyBetween(last, null),
        service: a.service, kind: a.kind, name: a.name, summary: a.summary, args: a.args ?? old?.args ?? [], returns: a.returns,
        // Changing an operation, what isn't given stays, as with endpoints.
        reads: a.reads ?? old?.reads ?? [], writes: a.writes ?? old?.writes ?? [], emits: a.emits ?? old?.emits ?? [],
        ...((a.nullable ?? old?.nullable) ? { nullable: true } : {}),
        ...(cache ? { cache } : {}),
        ...(invalidates?.length ? { invalidates } : {}),
        ...(errors?.length ? { errors } : {}),
        ...(a.access ? { access: a.access } : old?.access ? { access: old.access } : {}),
      };
      return { label: `${old ? "Change" : "Add"} ${a.kind} ${a.name}`, ops: [{ kind: "put", collection: "operations", value }], reply: `Operation ${value.id} saved.` };
    },
  }),

  set_trace: tool({
    description:
      "Add or replace (pass trace) a trace: one user action followed through the parts, in order. Each step goes between two linked parts " +
      "and may name the endpoint, operation or event it uses, the shape it carries, whether it is async (after the response) and a time budget in ms.",
    input: {
      trace: z.string().optional().describe("Trace id to replace; omit to add one"),
      name: z.string().min(1).describe('The action: "Submit a quote"'),
      page: z.string().optional().describe("The page it starts on"),
      steps: z.array(z.object({
        from: z.string(), to: z.string(),
        action: z.string().min(1).describe('"insert quotes", "POST /quotes"'),
        via: z.string().optional().describe("Endpoint, operation or event id"),
        carries: z.string().optional().describe("Shape id"),
        async: z.boolean().optional(),
        ms: z.number().nonnegative().optional(),
        ifFails: z.string().optional().describe("What the person sees if this hop fails"),
      })).min(1),
    },
    run: async (doc, a, ctx) => {
      const old = a.trace === undefined ? undefined : doc.traces[a.trace];
      if (a.trace !== undefined && !old) throw new ToolError(`trace "${a.trace}" does not exist`);
      const last = Object.values(doc.traces).map((t) => t.index).sort().at(-1) ?? null;
      const value: Trace = {
        id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null),
        name: a.name, ...(a.page ? { page: a.page } : {}),
        steps: a.steps.map((st) => ({
          from: st.from, to: st.to, action: st.action,
          ...(st.via ? { via: st.via } : {}), ...(st.carries ? { carries: st.carries } : {}),
          ...(st.async ? { async: true } : {}), ...(st.ms !== undefined ? { ms: st.ms } : {}), ...(st.ifFails ? { ifFails: st.ifFails } : {}),
        })),
      };
      return { label: `${old ? "Change" : "Add"} trace ${a.name}`, ops: [{ kind: "put", collection: "traces", value }], reply: `Trace ${value.id} saved.` };
    },
  }),

  set_environment: tool({
    description: 'Add or change (pass environment) an environment: a copy of the system such as "prod" or "staging", its provider and the regions it runs in. Read buni skills deployment first.',
    input: {
      environment: z.string().optional().describe("Environment id to change; omit to add one"),
      name: z.string().min(1).describe('"prod", "staging", "preview"'),
      provider: z.string().min(1).describe('"aws", "gcp", "azure", "fly", "vercel", "cloudflare"…'),
      regions: z.array(z.string().min(1)).min(1).describe('As the provider names them: "us-east-1"'),
    },
    run: async (doc, a, ctx) => {
      const old = a.environment === undefined ? undefined : doc.environments[a.environment];
      if (a.environment !== undefined && !old) throw new ToolError(`environment "${a.environment}" does not exist`);
      const last = Object.values(doc.environments).map((e) => e.index).sort().at(-1) ?? null;
      const value: Environment = { id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null), name: a.name, provider: a.provider, regions: a.regions };
      return { label: `${old ? "Change" : "Add"} environment ${a.name}`, ops: [{ kind: "put", collection: "environments", value }], reply: `Environment ${value.id} saved.` };
    },
  }),

  set_cluster: tool({
    description: "Add or change (pass cluster) a cluster in an environment: where workloads are scheduled. Kinds: kubernetes, ecs, nomad, vms. One region each.",
    input: {
      cluster: z.string().optional().describe("Cluster id to change; omit to add one"),
      environment: z.string(),
      name: z.string().min(1).describe('Lowercase with dashes: "prod-use1"'),
      kind: z.enum(["kubernetes", "ecs", "nomad", "vms"]),
      region: z.string().min(1),
      version: z.string().optional().describe('"EKS 1.30", "GKE 1.29"'),
    },
    run: async (doc, a, ctx) => {
      const old = a.cluster === undefined ? undefined : doc.clusters[a.cluster];
      if (a.cluster !== undefined && !old) throw new ToolError(`cluster "${a.cluster}" does not exist`);
      const value: Cluster = { id: old?.id ?? new Ids(doc, ctx).slug(a.name), environment: a.environment, name: a.name, kind: a.kind, region: a.region, ...(a.version ? { version: a.version } : {}) };
      return { label: `${old ? "Change" : "Add"} cluster ${a.name}`, ops: [{ kind: "put", collection: "clusters", value }], reply: `Cluster ${value.id} saved.` };
    },
  }),

  place: tool({
    description:
      "Say how a part runs in an environment, replacing what was there: its runtime (Kubernetes deployment, statefulset, daemonset, cronjob or job; " +
      "function; static; managed; vm), regions, and for Kubernetes the cluster, namespace, scale and resources; an ingress host and path " +
      "for outside traffic; a cron schedule; the managed service's name; and the names of the config and secrets it reads (never values).",
    input: {
      part: z.string(),
      environment: z.string(),
      runtime: z.enum(["deployment", "statefulset", "daemonset", "cronjob", "job", "container", "function", "static", "managed", "vm"]).describe("Kubernetes kinds need a cluster; container is a managed container platform (ECS Fargate, Cloud Run) named in service"),
      regions: z.array(z.string().min(1)).min(1),
      cluster: z.string().optional(),
      namespace: z.string().optional(),
      scale: z.object({ min: z.number().int(), max: z.number().int(), cpuTarget: z.number().optional() }).optional(),
      resources: z.object({ cpu: z.string().optional(), memory: z.string().optional() }).optional().describe('"250m", "256Mi"'),
      ingress: z.object({ host: z.string(), path: z.string().default("/") }).optional(),
      schedule: z.string().optional().describe('Cronjobs: "0 3 * * *"'),
      service: z.string().optional().describe('Managed or static: "RDS Postgres 16", "CloudFront + S3"'),
      config: z.array(z.string()).optional().describe("Environment variable names it reads"),
      secrets: z.array(z.string()).optional().describe("Secret names it reads; never values"),
      replicas: z.number().int().optional().describe("Standby copies, for stores and caches"),
      note: z.string().optional(),
    },
    run: async (doc, a, ctx) => {
      const old = placementOf(doc, a.part, a.environment);
      const { part, environment, runtime, regions, ...rest } = a;
      const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== ""));
      const value: Placement = { id: old?.id ?? new Ids(doc, ctx).slug(`${part}-${doc.environments[environment]?.name ?? environment}`), part, environment, runtime, regions, ...extra };
      return { label: `Place ${doc.parts[part]?.name ?? part} in ${doc.environments[environment]?.name ?? environment}`, ops: [{ kind: "put", collection: "placements", value }], reply: `Placement ${value.id} saved.` };
    },
  }),

  set_event: tool({
    description: 'Add an event to a queue part, or replace one (pass event). Name it dotted and past tense, e.g. "quote.created".',
    input: {
      event: z.string().optional().describe("Event id to replace; omit to add one"),
      queue: z.string(),
      name: z.string().min(1),
      payload: z.array(FIELD).default([]),
    },
    run: async (doc, a, ctx) => {
      const old = a.event === undefined ? undefined : doc.events[a.event];
      if (a.event !== undefined && !old) throw new ToolError(`event "${a.event}" does not exist`);
      const last = Object.values(doc.events).map((e) => e.index).sort().at(-1) ?? null;
      const value: QueueEvent = {
        id: old?.id ?? new Ids(doc, ctx).slug(a.name), index: old?.index ?? generateKeyBetween(last, null),
        queue: a.queue, name: a.name, payload: a.payload,
      };
      return { label: `${old ? "Change" : "Add"} event ${a.name}`, ops: [{ kind: "put", collection: "events", value }], reply: `Event ${value.id} saved.` };
    },
  }),

  set_shape: tool({
    description:
      "Add a data structure, or replace one (pass shape): a named set of fields that requests, responses, events, links and other shapes use " +
      'by name, e.g. Quote or Money; or an enum, with values instead of fields (QuoteStatus: draft, sent). PascalCase names. Read buni skills api-design first.',
    input: {
      shape: z.string().optional().describe("Shape id to replace; omit to add one"),
      name: z.string().min(1),
      fields: z.array(FIELD).default([]),
      values: z.array(z.string().min(1)).optional().describe("An enum's allowed values; give these instead of fields"),
      note: z.string().optional().describe("What it is, when the name doesn't say"),
    },
    run: async (doc, a, ctx) => {
      const old = a.shape === undefined ? undefined : doc.shapes[a.shape];
      if (a.shape !== undefined && !old) throw new ToolError(`shape "${a.shape}" does not exist`);
      const last = Object.values(doc.shapes).map((s) => s.index).sort().at(-1) ?? null;
      const value: Shape = {
        id: old?.id ?? new Ids(doc, ctx).slug(a.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2")), index: old?.index ?? generateKeyBetween(last, null),
        name: a.name, fields: a.fields, ...(a.values?.length ? { values: a.values } : {}), ...(a.note ? { note: a.note } : {}),
      };
      const ops: Op[] = [{ kind: "put", collection: "shapes", value }];
      // A rename carries through to every field typed with the old name.
      if (old && old.name !== a.name) {
        const rename = (fs: Field[]) => fs.map((f) => (f.type === old.name || f.type === `${old.name}[]` ? { ...f, type: f.type.replace(old.name, a.name) } : f));
        for (const s of Object.values(doc.shapes)) if (s.id !== old.id) ops.push({ kind: "put", collection: "shapes", value: { ...s, fields: rename(s.fields) } });
        for (const e of Object.values(doc.endpoints)) ops.push({ kind: "put", collection: "endpoints", value: { ...e, request: rename(e.request), response: rename(e.response) } });
        for (const e of Object.values(doc.events)) ops.push({ kind: "put", collection: "events", value: { ...e, payload: rename(e.payload) } });
        const retype = (t: string) => (t === old.name ? a.name : t === `${old.name}[]` ? `${a.name}[]` : t);
        for (const o of Object.values(doc.operations)) ops.push({ kind: "put", collection: "operations", value: { ...o, args: rename(o.args), returns: retype(o.returns) } });
        value.fields = rename(value.fields);
      }
      return { label: `${old ? "Change" : "Add"} shape ${a.name}`, ops, reply: `Shape ${value.id} saved.` };
    },
  }),

  import_file: tool({
    description: "Build on another .buni file's system: its parts, shapes, tables and calls become usable here (they stay edited in their own file). Pass a path relative to this file.",
    input: { path: z.string().min(1).describe('"catalog.buni"'), remove: z.boolean().optional().describe("Stop importing it") },
    run: async (doc, a) => {
      const now = doc.imports ?? [];
      if (!a.remove && now.includes(a.path)) return { label: "Import", ops: [], reply: `Already imports ${a.path}.` };
      if (a.remove && !now.includes(a.path)) throw new ToolError(`this file doesn't import ${a.path}`);
      const imports = a.remove ? now.filter((p) => p !== a.path) : [...now, a.path];
      return { label: `${a.remove ? "Stop importing" : "Import"} ${a.path}`, ops: [{ kind: "imports", value: imports }], reply: `${a.remove ? "No longer imports" : "Imports"} ${a.path}.` };
    },
  }),

  move_on_canvas: tool({
    description: "Remember where things were dragged on a System canvas (api, shapes, cache, traces). Layout only; it changes no design.",
    input: {
      view: z.enum(["api", "shapes", "cache", "traces"]),
      items: z.array(z.object({ id: z.string(), x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) })).min(1),
    },
    run: async (_doc, a) => ({
      label: `Move ${a.items.length === 1 ? "one thing" : `${a.items.length} things`} on ${a.view}`,
      ops: a.items.map((it): Op => ({ kind: "put", collection: "positions", value: { id: `${a.view}:${it.id}`, x: it.x, y: it.y } })),
      reply: "Moved.",
    }),
  }),

  arrange_canvas: tool({
    description: "Forget where things were dragged on a System canvas, so it lays itself out again.",
    input: { view: z.enum(["api", "shapes", "cache", "traces"]) },
    run: async (doc, a) => {
      const ops: Op[] = Object.keys(doc.positions).filter((k) => k.startsWith(`${a.view}:`)).map((id) => ({ kind: "delete", collection: "positions", id }));
      return { label: `Arrange ${a.view}`, ops, reply: ops.length ? "Arranged." : "Already arranged." };
    },
  }),

  move_table: tool({
    description: "Place a table on the Data canvas at x, y.",
    input: { table: z.string(), x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) },
    run: async (doc, a) => {
      const t = doc.tables[a.table];
      if (!t) throw new ToolError(`table "${a.table}" does not exist`);
      return { label: `Move ${t.name}`, ops: [{ kind: "put", collection: "tables", value: { ...t, x: a.x, y: a.y } }], reply: `Moved ${t.name}.` };
    },
  }),

  arrange_tables: tool({
    description: "Forget where a store's tables were dragged, so the Data canvas lays them out again: each table right of the tables its foreign keys point at.",
    input: { store: z.string() },
    run: async (doc, a) => {
      const ops: Op[] = Object.values(doc.tables).filter((t) => t.store === a.store && t.x !== undefined).map((t) => {
        const { x: _, y: __, ...rest } = t;
        return { kind: "put", collection: "tables", value: rest };
      });
      return { label: `Arrange ${doc.parts[a.store]?.name ?? a.store} tables`, ops, reply: ops.length ? `Arranged ${ops.length} tables.` : "Already arranged." };
    },
  }),

  move_part: tool({
    description: "Place a part on the system canvas at x, y.",
    input: { part: z.string(), x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) },
    run: async (doc, a) => {
      const p = doc.parts[a.part];
      if (!p) throw new ToolError(`part "${a.part}" does not exist`);
      return { label: `Move ${p.name}`, ops: [{ kind: "put", collection: "parts", value: { ...p, x: a.x, y: a.y } }], reply: `Moved ${p.name}.` };
    },
  }),

  delete_system: tool({
    description:
      "Remove a part (with its links), link, table, endpoint, operation, event, shape or trace. Anything still pointing at it (an endpoint writing a table, " +
      "a page bound to an endpoint, a field typed with a shape, a trace step over a link) makes the call fail with what to change first.",
    input: { what: z.enum(["part", "link", "table", "endpoint", "operation", "event", "shape", "trace", "environment", "cluster", "placement", "phase", "requirement", "question", "role", "thread", "agent", "eval"]), id: z.string() },
    run: async (doc, a) => {
      const collection = ({ part: "parts", link: "links", table: "tables", endpoint: "endpoints", operation: "operations", event: "events", shape: "shapes", trace: "traces", environment: "environments", cluster: "clusters", placement: "placements", phase: "phases", requirement: "requirements", question: "questions", role: "roles", thread: "threads", agent: "agents", eval: "evals" } as const)[a.what];
      if (!doc[collection][a.id]) throw new ToolError(`${a.what} "${a.id}" does not exist`);
      const ops: Op[] = [{ kind: "delete", collection, id: a.id }];
      if (a.what === "part") {
        for (const l of Object.values(doc.links)) if (l.from === a.id || l.to === a.id) ops.push({ kind: "delete", collection: "links", id: l.id });
        for (const p of Object.values(doc.placements)) if (p.part === a.id) ops.push({ kind: "delete", collection: "placements", id: p.id });
      }
      if (a.what === "phase") {
        for (const q of Object.values(doc.requirements)) if (q.phase === a.id) { const { phase: _, ...rest } = q; ops.push({ kind: "put", collection: "requirements", value: rest }); }
      }
      if (a.what === "role") {
        // A call left with no roles falls back to signed-in, never to public.
        const strip = (acc: Access | undefined): Access | undefined => {
          if (!acc?.roles?.includes(a.id)) return undefined;
          const roles = acc.roles.filter((r) => r !== a.id);
          return roles.length ? { ...acc, roles } : { who: "signed-in", ...(acc.rule ? { rule: acc.rule } : {}) };
        };
        for (const e of Object.values(doc.endpoints)) { const nx = strip(e.access); if (nx) ops.push({ kind: "put", collection: "endpoints", value: { ...e, access: nx } }); }
        for (const o of Object.values(doc.operations)) { const nx = strip(o.access); if (nx) ops.push({ kind: "put", collection: "operations", value: { ...o, access: nx } }); }
      }
      if (a.what === "environment") {
        for (const p of Object.values(doc.placements)) if (p.environment === a.id) ops.push({ kind: "delete", collection: "placements", id: p.id });
        for (const c of Object.values(doc.clusters)) if (c.environment === a.id) ops.push({ kind: "delete", collection: "clusters", id: c.id });
      }
      ops.push(...forget(doc, ops));
      return { label: `Remove ${a.what} ${a.id}`, ops, reply: "Removed." };
    },
  }),

  bind: tool({
    description: "Make a node show live data: a field of an endpoint's response or of a GraphQL operation's returned shape, e.g. a total or a name. Omit endpoint to unbind.",
    input: { node: z.string(), endpoint: z.string().optional(), field: z.string().optional() },
    run: async (doc, a) => {
      const { bind: _, ...n } = node(doc, a.node);
      if (a.endpoint === undefined) return { label: `Unbind ${n.name}`, ops: [{ kind: "put", collection: "nodes", value: n }], reply: "Unbound." };
      if (a.field === undefined) throw new ToolError("give the response field to show");
      const value: Node = { ...n, bind: { endpoint: a.endpoint, field: a.field } };
      return { label: `Bind ${n.name} to ${a.endpoint}.${a.field}`, ops: [{ kind: "put", collection: "nodes", value }], reply: "Bound." };
    },
  }),

  export_openapi: tool({
    description: "The REST endpoints as an OpenAPI 3.1 document (JSON), for one service or all: shapes as components, errors as responses, example bodies.",
    input: { service: z.string().optional().describe("Service part id; omit for every endpoint") },
    run: async (doc, a) => {
      if (a.service !== undefined && doc.parts[a.service]?.kind !== "service") throw new ToolError(`"${a.service}" is not a service part`);
      return { label: "Export OpenAPI", ops: [], reply: JSON.stringify(openApi(doc, a.service), null, 2) };
    },
  }),

  export_sql: tool({
    description: "The tables as Postgres DDL (CREATE TABLE, keys, foreign keys, comments on personal and secret columns), for one store or all.",
    input: { store: z.string().optional().describe("Store part id; omit for every table") },
    run: async (doc, a) => {
      if (a.store !== undefined && doc.parts[a.store]?.kind !== "store") throw new ToolError(`"${a.store}" is not a store part`);
      return { label: "Export SQL", ops: [], reply: sqlSchema(doc, a.store) };
    },
  }),
} satisfies Record<string, Tool>;
