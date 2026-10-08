import { expect, test } from "bun:test";
import { areaOf } from "./areas.ts";
import { componentsTools } from "./components.ts";
import { docTools } from "./doc.ts";
import { flowsTools } from "./flows.ts";
import { pagesTools } from "./pages.ts";
import { planTools } from "./plan.ts";
import { readTools } from "./read.ts";
import { systemTools } from "./system.ts";

test("each tool lives in the file of the area agents load it with", () => {
  const files = { read: readTools, pages: pagesTools, components: componentsTools, system: systemTools, plan: planTools, doc: docTools, flows: flowsTools };
  for (const [area, tools] of Object.entries(files)) for (const name of Object.keys(tools)) expect(`${name} in ${areaOf(name)}`).toBe(`${name} in ${area}`);
});
