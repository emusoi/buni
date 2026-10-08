// buni's design tools: every edit a person or agent can make to a design, one file per area (areas/), on the
// helpers in kit.ts. Each tool checks its arguments, then returns the changes it makes or a ToolError saying why not.
import type { Tool } from "./kit.ts";
import { readTools } from "./areas/read.ts";
import { pagesTools } from "./areas/pages.ts";
import { componentsTools } from "./areas/components.ts";
import { systemTools } from "./areas/system.ts";
import { planTools } from "./areas/plan.ts";
import { docTools } from "./areas/doc.ts";
import { flowsTools } from "./areas/flows.ts";

export { ToolError, type Tool, type ToolContext, type ToolOutput } from "./kit.ts";

/** Every design tool, by name, area by area. */
export const tools = { ...readTools, ...pagesTools, ...componentsTools, ...systemTools, ...planTools, ...docTools, ...flowsTools } satisfies Record<string, Tool>;

export type ToolName = keyof typeof tools;
export const toolNames = Object.keys(tools).filter((k): k is ToolName => k in tools);
