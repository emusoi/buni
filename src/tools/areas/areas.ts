// Areas of buni's design tools, and which area each tool is in: plain data, so the format, the tools and an editor
// can all use it without the engine's file and network code.
import type { ToolName } from "../tools.ts";

/** Areas of buni's design tools. "read" is always sent; the rest are sent when listed in alwaysLoaded or loaded. */
export const AREAS = {
  read: { name: "Read the design", about: "Look at pages, layers, the doc and flows." },
  pages: { name: "Pages and layers", about: "Build and change pages: HTML, styles, text, layers, tokens, icons." },
  components: { name: "Components", about: "Make, place, override, merge and tidy reusable components and variants." },
  doc: { name: "Design doc", about: "Write and remove its sections." },
  flows: { name: "Flows", about: "Link screens, name flows and write journeys." },
  architecture: { name: "Architecture", about: "How the app is built and shipped: parts, builds, Kubernetes, releases, plans and plays." },
} as const;
export type Area = keyof typeof AREAS;
export const AREA_IDS = ["read", "pages", "components", "doc", "flows", "architecture"] as const satisfies readonly Area[];

const IN: Record<Exclude<Area, "pages">, readonly ToolName[]> = {
  read: ["read_tree", "get_node", "read_doc", "read_flows", "read_context", "read_attachment"],
  components: ["set_variant", "add_variant", "swap_component", "detach_instance", "make_component", "find_repeats", "componentize", "create_component", "place_component", "override", "library_report", "merge_components", "rename_component", "delete_component", "move_component", "import_file"],
  doc: ["set_sources", "write_section", "delete_section"],
  flows: ["connect", "disconnect", "set_flow", "set_journey"],
  architecture: [
    "set_part", "set_build", "link_parts", "unlink", "set_group", "set_environment", "set_cluster", "set_namespace", "set_workload", "set_release",
    "set_migration", "set_plan", "set_stage", "set_play", "delete_architecture", "merge_plan", "read_architecture",
    "read_architecture_text", "write_architecture_text",
    "check_architecture", "export_architecture",
  ],
};

/** The area a design tool belongs to; anything not listed is about pages, the work most requests do. */
const LISTED: readonly Exclude<Area, "pages">[] = ["read", "components", "doc", "flows", "architecture"];
export function areaOf(name: string): Area {
  return LISTED.find((area) => IN[area].some((n) => n === name)) ?? "pages";
}

