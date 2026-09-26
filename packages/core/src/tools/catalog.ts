import { createCalendarTools } from "../calendar/tools";
import { createCrmTools } from "../crm/tools";
import { BUILTIN_TOOLS } from "./builtin";
import type { ToolDefinition } from "./registry";

/** Every platform tool, for listings in the builder UIs (definitions only; never executed from here). */
export function platformToolCatalog(): ToolDefinition[] {
  return [...BUILTIN_TOOLS, ...createCrmTools({} as never), ...createCalendarTools(async () => null)];
}
