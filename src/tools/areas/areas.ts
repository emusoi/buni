// Areas of buni's design tools, and which area each tool is in: plain data, so the format, the tools and an editor
// can all use it without the engine's file and network code.
import type { ToolName } from "../tools.ts";

/** Areas of buni's design tools. "read" is always sent; the rest are sent when listed in alwaysLoaded or loaded. */
export const AREAS = {
  read: { name: "Read the design", about: "Look at pages, layers, the doc, flows and the system." },
  pages: { name: "Pages and layers", about: "Build and change pages: HTML, styles, text, layers, tokens, icons." },
  components: { name: "Components", about: "Make, place, override, merge and tidy reusable components and variants." },
  system: { name: "System", about: "Parts, links, endpoints, operations, tables, shapes, events, traces, where it runs." },
  plan: { name: "Plan", about: "Requirements, phases, open questions, roles and access, review." },
  doc: { name: "Design doc", about: "Write sections and record or drop decisions." },
  flows: { name: "Flows", about: "Link screens, name flows and write journeys." },
  endpoints: { name: "API", about: "Call this design's REST endpoints and GraphQL queries and mutations: the mock API, or a live URL you set for a service." },
} as const;
export type Area = keyof typeof AREAS;
export const AREA_IDS = ["read", "pages", "components", "system", "plan", "doc", "flows", "endpoints"] as const satisfies readonly Area[];

const IN: Record<Exclude<Area, "pages">, readonly ToolName[]> = {
  read: ["read_tree", "get_node", "read_doc", "read_flows", "read_context", "read_attachment"],
  components: ["set_variant", "add_variant", "swap_component", "detach_instance", "make_component", "find_repeats", "componentize", "create_component", "place_component", "override", "library_report", "merge_components", "rename_component", "delete_component", "move_component"],
  system: ["set_part", "link_parts", "set_table", "set_endpoint", "set_operation", "set_trace", "set_environment", "set_cluster", "place", "set_event", "set_shape", "import_file", "move_on_canvas", "arrange_canvas", "move_table", "arrange_tables", "move_part", "delete_system", "bind", "export_openapi", "export_sql"],
  plan: ["set_phase", "set_requirement", "serve", "set_question", "decide_question", "set_role", "set_access", "review", "discuss", "set_agent", "set_eval"],
  doc: ["set_sources", "write_section", "delete_section", "decide", "drop_decision"],
  flows: ["connect", "disconnect", "set_flow", "set_journey"],
  // Made from the design's endpoints at each request (endpoints.ts), not buni's own tools.
  endpoints: [],
};

/** The area a design tool belongs to; anything not listed is about pages, the work most requests do. Endpoint tools are "endpoints". */
const LISTED: readonly Exclude<Area, "pages">[] = ["read", "components", "system", "plan", "doc", "flows"];
export function areaOf(name: string): Area {
  return LISTED.find((area) => IN[area].some((n) => n === name)) ?? "pages";
}

