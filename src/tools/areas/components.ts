// Components: making and placing them, variants, overrides, and keeping the library tidy. One area of buni's design
// tools (agent/areas.ts); tools.ts gathers them.
import { z } from "zod";
import { setOf, variantProperties, type Connection, type Id, type InstanceNode, type SharedSection, type Style } from "../../format/doc.ts";
import type { Op } from "../../oplog/oplog.ts";
import { parseHtml } from "../html.ts";
import { layersOf, libraryReport, shapeOf, usesOf } from "../library.ts";
import { Ids, type Tool, ToolError, draftOps, forget, indexAt, node, page, pageOf, rootOf, styleValues, subtree, tool } from "../kit.ts";

export const componentsTools = {
  set_variant: tool({
    description:
      "Say which variant of its set a component is, as properties: { \"Tone\": \"Primary\" }, { \"Size\": \"Small\" }. A use then picks a value for " +
      "each and shows the variant that has them. \"\" removes a property. Two variants of a set can't have the same properties.",
    input: { component: z.string(), props: z.record(z.string().min(1), z.string()) },
    run: async (doc, a) => {
      const c = doc.shared[a.component];
      if (!c) throw new ToolError(`component "${a.component}" does not exist`);
      if (c.name.lastIndexOf("/") <= 0) throw new ToolError(`${c.name} isn't in a set yet; name it "Group / ${c.name}" first (rename_component)`);
      const variant = { ...c.variant };
      for (const [k, v] of Object.entries(a.props)) { if (v.trim()) variant[k.trim()] = v.trim(); else delete variant[k.trim()]; }
      const same = setOf(doc, c.id).find((x) => x.id !== c.id && Object.keys(variant).length > 0 && JSON.stringify(Object.entries(x.variant ?? {}).sort()) === JSON.stringify(Object.entries(variant).sort()));
      if (same) throw new ToolError(`${same.name} already has those properties; give this one a different value`);
      const { variant: _v, ...rest } = c;
      const value = Object.keys(variant).length ? { ...rest, variant } : rest;
      return { label: `Variant ${c.name}`, ops: [{ kind: "put", collection: "shared", value }], reply: `${c.name} is ${Object.entries(variant).map(([k, v]) => `${k}: ${v}`).join(", ") || "no variant"}.` };
    },
  }),

  add_variant: tool({
    description:
      "A new variant of a component: a copy of its layers as another component in the same group (\"Buttons / Primary\" gives " +
      "\"Buttons / Secondary\"), placed beside it, to change from there. Replies with the new component's id.",
    input: {
      component: z.string(),
      name: z.string().min(1).describe('The variant\'s own name, e.g. "Secondary"; the group is kept'),
      props: z.record(z.string().min(1), z.string().min(1)).optional().describe('Its properties, e.g. { "Tone": "Secondary" }; others are copied from the original'),
    },
    run: async (doc, a, ctx) => {
      const from = doc.shared[a.component];
      if (!from) throw new ToolError(`component "${a.component}" does not exist`);
      const cut = from.name.lastIndexOf("/");
      const group = cut > 0 ? from.name.slice(0, cut).trim() : from.name;
      const name = `${group} / ${a.name.trim()}`;
      if (Object.values(doc.shared).some((x) => x.name === name)) throw new ToolError(`there is already a ${name}`);
      const ids = new Ids(doc, ctx);
      const tree = subtree(doc, from.root);
      const fresh = new Map(tree.map((n) => [n.id, ids.next()]));
      const ops: Op[] = tree.map((n) => {
        const { twin: _t, ...copy } = structuredClone(n);
        return { kind: "put", collection: "nodes", value: { ...copy, id: fresh.get(n.id) ?? n.id, ...(n.parent !== undefined ? { parent: fresh.get(n.parent) ?? n.parent } : {}) } };
      });
      const id = ids.next();
      const width = Number.parseInt(doc.nodes[from.root]?.style.width ?? "", 10) || 1200;
      // Beside its sibling when that has a place; otherwise in the components row, which keeps a group together.
      const place = from.x !== undefined && from.y !== undefined ? { x: from.x + width + 120, y: from.y } : {};
      const variant = { ...from.variant, ...a.props };
      if (a.props && setOf(doc, from.id).some((x) => JSON.stringify(Object.entries(x.variant ?? {}).sort()) === JSON.stringify(Object.entries(variant).sort()))) throw new ToolError("another variant of this set already has those properties");
      ops.push({ kind: "put", collection: "shared", value: { id, name, root: fresh.get(from.root) ?? from.root, ...place, ...(a.props && Object.keys(variant).length ? { variant } : {}) } });
      return { label: `Add variant ${name}`, ops, reply: `Component ${id} "${name}" is a copy of ${from.name}.` };
    },
  }),

  swap_component: tool({
    description:
      "Make a component use show another component instead, in the same place: a variant from the same group (\"Buttons / Primary\" to \"Buttons / Secondary\"). " +
      "Overrides carry over to layers of the same name; the rest are dropped.",
    input: { instance: z.string(), component: z.string() },
    run: async (doc, a, ctx) => {
      const inst = node(doc, a.instance);
      if (inst.kind !== "instance") throw new ToolError(`"${inst.name}" is not a component use`);
      const to = doc.shared[a.component];
      if (!to) throw new ToolError(`component "${a.component}" does not exist`);
      const from = doc.shared[inst.shared];
      const unique = (root: Id) => {
        const byName = new Map<string, Id | null>();
        for (const n of subtree(doc, root)) byName.set(n.name, byName.has(n.name) ? null : n.id);
        return byName;
      };
      const target = unique(to.root);
      const overrides: InstanceNode["overrides"] = {};
      let dropped = 0;
      for (const [id, ov] of Object.entries(inst.overrides)) {
        const name = doc.nodes[id]?.name;
        const hit = name === undefined ? undefined : target.get(name);
        if (hit) overrides[hit] = ov; else dropped++;
      }
      const value: InstanceNode = { ...inst, shared: to.id, overrides, name: inst.name === from?.name ? to.name : inst.name };
      const ops: Op[] = [{ kind: "put", collection: "nodes", value }];
      // Links this page set on the old component's layers follow to the same-named layers of the new one; the
      // originals stay while another use of the old component on the page still needs them.
      const page = Object.values(doc.pages).find((p) => p.frame === rootOf(doc, inst.id));
      const oldTree = from ? new Set(subtree(doc, from.root).map((n) => n.id)) : new Set<Id>();
      const othersHere = Object.values(doc.nodes).some((n) => n.kind === "instance" && n.id !== inst.id && n.shared === inst.shared && page && rootOf(doc, n.id) === page.frame);
      const ids = new Ids(doc, ctx);
      let lostLinks = 0;
      for (const c of Object.values(doc.connections)) {
        if (!page || c.page !== page.id || !oldTree.has(c.node)) continue;
        const hit = target.get(doc.nodes[c.node]?.name ?? "");
        if (hit) ops.push({ kind: "put", collection: "connections", value: { ...c, id: othersHere ? ids.next() : c.id, node: hit } });
        else if (!othersHere) lostLinks++;
        if (!hit && !othersHere) ops.push({ kind: "delete", collection: "connections", id: c.id });
      }
      const lost = (n: number, what: string) => (n ? `${n} ${what}${n === 1 ? " has" : "s have"} no layer of that name there, so ${n === 1 ? "it was" : "they were"} dropped.` : "");
      const notes = [lost(dropped, "override"), lost(lostLinks, "link")].filter(Boolean).join(" ");
      return { label: `Swap ${inst.name} for ${to.name}`, ops, reply: `The use of ${from?.name ?? inst.name} now shows ${to.name}.${notes ? ` ${notes}` : ""}` };
    },
  }),

  detach_instance: tool({
    description: "Turn a component use into plain layers, a copy of the component with its overrides, in the same place; it no longer follows the component. Replies with the new root's id.",
    input: { instance: z.string() },
    run: async (doc, a, ctx) => {
      const inst = node(doc, a.instance);
      if (inst.kind !== "instance") throw new ToolError(`"${inst.name}" is not a component use`);
      const shared = doc.shared[inst.shared];
      if (!shared) throw new ToolError(`its component "${inst.shared}" does not exist`);
      const ids = new Ids(doc, ctx);
      const tree = subtree(doc, shared.root);
      const fresh = new Map(tree.map((n) => [n.id, ids.next()]));
      const ops: Op[] = [{ kind: "delete", collection: "nodes", id: inst.id }];
      for (const n of tree) {
        const ov = inst.overrides[n.id];
        const id = fresh.get(n.id) ?? n.id;
        const isRoot = n.id === shared.root;
        const style: Style = { ...n.style, ...ov?.style, ...(isRoot ? inst.style : {}) };
        const base = { ...structuredClone(n), id, style, ...(isRoot ? { parent: inst.parent, index: inst.index, name: inst.name } : n.parent !== undefined ? { parent: fresh.get(n.parent) ?? n.parent } : {}) };
        ops.push({ kind: "put", collection: "nodes", value: base.kind === "text" && ov?.text !== undefined ? { ...base, text: ov.text } : base });
      }
      // Comments on the use stay with the plain layers that replace it.
      const newRoot = fresh.get(shared.root) ?? shared.root;
      for (const c of Object.values(doc.comments)) if (c.node === inst.id) ops.push({ kind: "put", collection: "comments", value: { ...c, node: newRoot } });
      // Links the page set on the component's layers are copied to the new layers; the originals stay while another
      // use of the component on the page still needs them.
      const page = Object.values(doc.pages).find((p) => p.frame === rootOf(doc, inst.id));
      const othersHere = Object.values(doc.nodes).some((n) => n.kind === "instance" && n.id !== inst.id && n.shared === inst.shared && page && rootOf(doc, n.id) === page.frame);
      for (const c of Object.values(doc.connections)) {
        if (c.node === inst.id) ops.push({ kind: "delete", collection: "connections", id: c.id });
        const to = fresh.get(c.node);
        if (!to || !page || c.page !== page.id) continue;
        ops.push({ kind: "put", collection: "connections", value: { ...c, id: ids.next(), node: to } });
        if (!othersHere) ops.push({ kind: "delete", collection: "connections", id: c.id });
      }
      ops.push(...forget(doc, ops));
      return { label: `Detach ${inst.name}`, ops, reply: `Detached: ${fresh.get(shared.root)} is a copy of ${shared.name}.` };
    },
  }),

  make_component: tool({
    description:
      "Turn a layer on a page into a reusable component. The layer becomes the component's source and an instance takes its place. " +
      "Links on layers inside it keep working on this page; connect them on other pages that use it.",
    input: { node: z.string(), name: z.string().optional().describe("Defaults to the layer's name") },
    run: async (doc, a, ctx) => {
      const n = node(doc, a.node);
      const p = pageOf(doc, n.id);
      if (n.id === p.frame || n.parent === undefined) throw new ToolError("a page's root frame cannot become a component; pick a layer inside it");
      const tree = subtree(doc, n.id);
      if (tree.some((x) => x.kind === "instance")) throw new ToolError("a component cannot contain other components yet; pick a layer without any");
      const ids = new Ids(doc, ctx);
      const section: SharedSection = { id: ids.next(), name: a.name ?? n.name, root: n.id };
      const { parent: _, ...source } = n;
      const instance: InstanceNode = { id: ids.next(), kind: "instance", parent: n.parent, index: n.index, name: section.name, style: {}, shared: section.id, overrides: {} };
      const ops: Op[] = [
        { kind: "put", collection: "nodes", value: { ...source, index: "a0" } },
        { kind: "put", collection: "shared", value: section },
        { kind: "put", collection: "nodes", value: instance },
      ];
      // The layer's copies in its screen's states become uses too, keeping what they changed as overrides (their
      // words, their styles) and their links, now on the component's layers for that state.
      const copies = Object.values(doc.nodes).filter((x) => x.twin === n.id);
      for (const copy of copies) {
        if (copy.parent === undefined) continue;
        const theirs = subtree(doc, copy.id);
        const overrides: InstanceNode["overrides"] = {};
        for (const t of theirs) {
          const src = t.twin ? doc.nodes[t.twin] : undefined;
          if (!src || !tree.some((x) => x.id === src.id)) continue;
          const text = t.kind === "text" && src.kind === "text" && t.text !== src.text ? { text: t.text } : {};
          const style = JSON.stringify(t.style) !== JSON.stringify(src.style) ? { style: t.style } : {};
          if (Object.keys(text).length || Object.keys(style).length) overrides[src.id] = { ...text, ...style };
        }
        const use: InstanceNode = { id: ids.next(), kind: "instance", parent: copy.parent, index: copy.index, name: section.name, style: {}, shared: section.id, overrides, twin: instance.id };
        ops.push(...theirs.map((t): Op => ({ kind: "delete", collection: "nodes", id: t.id })), { kind: "put", collection: "nodes", value: use });
        const gone = new Set(theirs.map((t) => t.id));
        for (const c of Object.values(doc.connections)) {
          const to = gone.has(c.node) ? doc.nodes[c.node]?.twin : undefined;
          if (to) ops.push({ kind: "put", collection: "connections", value: { ...c, node: to } });
          else if (gone.has(c.node)) ops.push({ kind: "delete", collection: "connections", id: c.id });
        }
        for (const c of Object.values(doc.comments)) if (gone.has(c.node)) ops.push({ kind: "put", collection: "comments", value: { ...c, node: use.id } });
      }
      const also = copies.length ? ` Its ${copies.length} cop${copies.length === 1 ? "y" : "ies"} in the screen's states became uses too.` : "";
      return { label: `Make component ${section.name}`, ops, reply: `Component ${section.id} "${section.name}"; instance ${instance.id} is where the layer was.${also}` };
    },
  }),

  create_component: tool({
    description: "Make a new component from HTML (same rules as write_html). It starts unused; place it with place_component.",
    input: { name: z.string().min(1), html: z.string() },
    run: async (doc, a, ctx) => {
      const { drafts, warnings } = parseHtml(a.html);
      if (drafts.length === 0) throw new ToolError("the HTML produced no nodes");
      if (drafts.some((d) => d.kind === "instance")) throw new ToolError("a component cannot contain other components yet");
      const ids = new Ids(doc, ctx);
      const root = ids.next();
      const section: SharedSection = { id: ids.next(), name: a.name, root };
      const created: Id[] = [];
      const ops: Op[] = [
        { kind: "put", collection: "nodes", value: { id: root, kind: "frame", index: "a0", name: a.name, style: {} } },
        ...draftOps(ids, drafts, root, "a0", created),
        { kind: "put", collection: "shared", value: section },
      ];
      return { label: `Create component ${a.name}`, ops, reply: [`Component ${section.id} "${a.name}" with root ${root}.`, ...warnings.map((w) => `Warning: ${w}`)].join("\n") };
    },
  }),

  place_component: tool({
    description: "Place an instance of a component inside a frame on a page.",
    input: { component: z.string(), parent: z.string().describe("Frame to insert into"), after: z.string().optional().describe('Sibling to insert after; "" puts it first; omit to append') },
    run: async (doc, a, ctx) => {
      const section = doc.shared[a.component];
      if (!section) throw new ToolError(`component "${a.component}" does not exist`);
      if (node(doc, a.parent).kind !== "frame") throw new ToolError(`"${a.parent}" is not a frame`);
      const page = pageOf(doc, a.parent);
      const ids = new Ids(doc, ctx);
      const instance: InstanceNode = {
        id: ids.next(), kind: "instance", parent: a.parent, index: indexAt(doc, a.parent, a.after),
        name: section.name, style: {}, shared: section.id, overrides: {},
      };
      // The component's links (its nav items, its buttons) work on this page too, as they do on the pages it was already on.
      const inside = new Set(subtree(doc, section.root).map((n) => n.id));
      const key = (c: Connection) => `${c.node} ${c.to} ${c.trigger} ${c.condition ?? ""}`;
      const here = new Set(Object.values(doc.connections).filter((c) => c.page === page.id).map(key));
      const links = new Map<string, Connection>();
      for (const c of Object.values(doc.connections)) if (inside.has(c.node) && c.to !== page.id && !here.has(key(c))) links.set(key(c), c);
      const ops: Op[] = [{ kind: "put", collection: "nodes", value: instance }, ...[...links.values()].map((c): Op => ({ kind: "put", collection: "connections", value: { ...c, id: ids.next(), page: page.id } }))];
      return { label: `Place ${section.name}`, ops, reply: `Placed instance ${instance.id} of ${section.name}${links.size ? `, with its ${links.size} link${links.size === 1 ? "" : "s"}` : ""}.` };
    },
  }),

  override: tool({
    description: "Change one instance without changing its component: new text or styles for a layer inside it. reset clears that layer's override.",
    input: {
      instance: z.string(),
      node: z.string().describe("Layer inside the component"),
      text: z.string().optional(),
      style: styleValues.optional(),
      width: z.number().int().optional().describe("With style: only at this one of the page's widths (set_widths)"),
      reset: z.boolean().optional(),
    },
    run: async (doc, a) => {
      const inst = node(doc, a.instance);
      if (inst.kind !== "instance") throw new ToolError(`"${a.instance}" is not a component instance`);
      if (a.width !== undefined) {
        const page = Object.values(doc.pages).find((p) => p.frame === rootOf(doc, inst.id));
        if (!page?.widths?.includes(a.width)) throw new ToolError(`${page?.name ?? "That page"} doesn't have a ${a.width} px width; add it with set_widths`);
      }
      const section = doc.shared[inst.shared];
      const target = node(doc, a.node);
      if (!section || !subtree(doc, section.root).some((x) => x.id === target.id)) throw new ToolError(`"${a.node}" is not inside ${section?.name ?? "that component"}`);
      if (a.text !== undefined && target.kind !== "text") throw new ToolError(`"${target.name}" has no text to override`);
      const overrides = { ...inst.overrides };
      if (a.reset) delete overrides[target.id];
      else {
        const prev = overrides[target.id] ?? {};
        const clean = (s: Style) => { for (const [k, v] of Object.entries(s)) if (v === "") delete s[k]; return s; };
        // With a width, the style goes to that width only; the rest of the override stays as it was.
        const style = a.width === undefined ? clean({ ...prev.style, ...a.style }) : prev.style ?? {};
        const at = { ...prev.at };
        if (a.width !== undefined) {
          const w = clean({ ...at[String(a.width)], ...a.style });
          if (Object.keys(w).length) at[String(a.width)] = w; else delete at[String(a.width)];
        }
        overrides[target.id] = {
          ...(a.text !== undefined ? { text: a.text } : prev.text !== undefined ? { text: prev.text } : {}),
          ...(Object.keys(style).length ? { style } : {}),
          ...(Object.keys(at).length ? { at } : {}),
        };
      }
      return {
        label: `${a.reset ? "Reset" : "Override"} ${target.name} in ${inst.name}`,
        ops: [{ kind: "put", collection: "nodes", value: { ...inst, overrides } }],
        reply: a.reset ? "Override cleared." : "Override set.",
      };
    },
  }),

  library_report: tool({
    description: "Health of the component library: unused components, near-duplicates that could be merged (with what differs), and components without a \"Group / Name\" name.",
    input: {},
    run: async (doc) => {
      const r = libraryReport(doc);
      const name = (id: Id) => `${doc.shared[id]?.name ?? id} (${id}, ${usesOf(doc, id)} use${usesOf(doc, id) === 1 ? "" : "s"})`;
      const lines = [`${Object.keys(doc.shared).length} components.`];
      if (r.duplicates.length) {
        lines.push("Near-duplicates (merge_components into the first):");
        for (const g of r.duplicates) lines.push(`- ${name(g.keep)} <- ${g.others.map((o) => `${name(o.id)}: ${o.differences.join(", ") || "identical"}`).join("; ")}`);
      }
      const sets = new Map<string, Id>();
      for (const s of Object.values(doc.shared)) if (s.variant && s.name.lastIndexOf("/") > 0) sets.set(s.name.slice(0, s.name.lastIndexOf("/")).trim(), s.id);
      for (const [group, id] of sets) lines.push(`Set ${group}: ${variantProperties(setOf(doc, id)).map(([k, vs]) => `${k} (${vs.join(", ")})`).join("; ")}; a use switches with swap_component, or set_variant on a component.`);
      if (r.unused.length) lines.push(`Unused: ${r.unused.map(name).join(", ")}`);
      if (r.ungrouped.length) lines.push(`Without a group (rename to "Group / Name"): ${r.ungrouped.map((id) => doc.shared[id]?.name ?? id).join(", ")}`);
      if (lines.length === 1) lines.push("Nothing to fix.");
      return { label: "Read library report", ops: [], reply: lines.join("\n") };
    },
  }),

  merge_components: tool({
    description:
      "Merge same-shaped components into one: every use of each `from` component moves to `into`, keeping its overrides and links, and the `from` components are removed. " +
      "Use library_report to find candidates.",
    input: { into: z.string(), from: z.array(z.string()).min(1) },
    run: async (doc, a) => {
      const into = doc.shared[a.into];
      if (!into) throw new ToolError(`component "${a.into}" does not exist`);
      const keepLayers = layersOf(doc, into.root);
      const ops: Op[] = [];
      let moved = 0;
      for (const id of a.from) {
        const from = doc.shared[id];
        if (!from) throw new ToolError(`component "${id}" does not exist`);
        if (id === into.id) throw new ToolError("a component cannot merge into itself");
        if (shapeOf(doc, from.root) !== shapeOf(doc, into.root)) throw new ToolError(`"${from.name}" is shaped differently from "${into.name}"; only same-shaped components merge`);
        const pair = new Map(layersOf(doc, from.root).map((n, i) => [n.id, keepLayers[i]?.id ?? ""]));
        for (const n of Object.values(doc.nodes)) {
          if (n.kind !== "instance" || n.shared !== id) continue;
          const overrides = Object.fromEntries(Object.entries(n.overrides).flatMap(([k, v]) => (pair.get(k) ? [[pair.get(k) ?? "", v]] : [])));
          ops.push({ kind: "put", collection: "nodes", value: { ...n, shared: into.id, overrides } });
          moved += 1;
        }
        for (const c of Object.values(doc.connections)) {
          const to = pair.get(c.node);
          if (!to) continue;
          ops.push({ kind: "delete", collection: "connections", id: c.id });
          const clash = Object.values(doc.connections).some((x) => x.node === to && x.page === c.page && x.trigger === c.trigger);
          if (!clash) ops.push({ kind: "put", collection: "connections", value: { ...c, node: to } });
        }
        for (const c of Object.values(doc.comments)) {
          const to = pair.get(c.node);
          if (to) ops.push({ kind: "put", collection: "comments", value: { ...c, node: to } });
        }
        ops.push({ kind: "delete", collection: "shared", id });
        for (const n of layersOf(doc, from.root)) ops.push({ kind: "delete", collection: "nodes", id: n.id });
      }
      return { label: `Merge ${a.from.length} into ${into.name}`, ops, reply: `Merged ${a.from.length} component${a.from.length === 1 ? "" : "s"} into ${into.name}; ${moved} use${moved === 1 ? "" : "s"} moved.` };
    },
  }),

  rename_component: tool({
    description: "Rename a component. Use \"Group / Name\" (e.g. \"Buttons / Primary\") so large libraries stay grouped.",
    input: { component: z.string(), name: z.string().min(1) },
    run: async (doc, a) => {
      const s = doc.shared[a.component];
      if (!s) throw new ToolError(`component "${a.component}" does not exist`);
      return { label: `Rename ${s.name} to ${a.name}`, ops: [{ kind: "put", collection: "shared", value: { ...s, name: a.name } }], reply: `Renamed to ${a.name}.` };
    },
  }),

  delete_component: tool({
    description: "Remove an unused component and its source layers. Refused while anything still uses it.",
    input: { component: z.string() },
    run: async (doc, a) => {
      const s = doc.shared[a.component];
      if (!s) throw new ToolError(`component "${a.component}" does not exist`);
      const n = usesOf(doc, s.id);
      if (n > 0) throw new ToolError(`"${s.name}" is used ${n} time${n === 1 ? "" : "s"}; remove or merge those uses first`);
      const ops: Op[] = [{ kind: "delete", collection: "shared", id: s.id }, ...layersOf(doc, s.root).map((x): Op => ({ kind: "delete", collection: "nodes", id: x.id }))];
      ops.push(...forget(doc, ops));
      return { label: `Delete component ${s.name}`, ops, reply: `Deleted ${s.name}.` };
    },
  }),

  move_component: tool({
    description: "Place a component's board on the canvas at x, y.",
    input: { component: z.string(), x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) },
    run: async (doc, a) => {
      const section = doc.shared[a.component];
      if (!section) throw new ToolError(`component "${a.component}" does not exist`);
      return { label: `Move ${section.name}`, ops: [{ kind: "put", collection: "shared", value: { ...section, x: a.x, y: a.y } }], reply: `Moved ${section.name}.` };
    },
  }),
} satisfies Record<string, Tool>;
