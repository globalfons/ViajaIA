import { z } from "zod";
import type { ToolSpec } from "../llm/types";

/**
 * Tools are the only way an agent can act on the world. Safety properties:
 *  - An agent only sees tools in ITS allowlist (agent.tools) that are also
 *    enabled for the organization; everything else is invisible to the model.
 *  - Arguments are validated with zod before execution.
 *  - Every tool has a risk level; "write"/"external" tools can require human
 *    approval, and some always do.
 *  - Secrets are resolved server-side inside execute(); they never appear in
 *    the tool spec, arguments or results sent to the model.
 *  - Execution is bounded by a timeout and results are size-limited.
 */

export type ToolRisk = "read" | "write" | "external";

export interface ToolContext {
  organizationId: string;
  agentId?: string;
  conversationId?: string;
  workflowRunId?: string;
  userId?: string;
  signal: AbortSignal;
  /** Resolves integration credentials server-side. Never pass results to the model. */
  getSecret?: (name: string) => Promise<string | null>;
  /** Per-agent tool configuration (e.g. allowed HTTP hosts). */
  config?: Record<string, unknown>;
}

export interface ToolDefinition<Args extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Args;
  risk: ToolRisk;
  /** Always require human approval, regardless of agent configuration. */
  alwaysRequireApproval?: boolean;
  timeoutMs?: number;
  execute(args: z.infer<Args>, ctx: ToolContext): Promise<unknown>;
}

export const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: "not_allowed" | "invalid_args" | "timeout" | "failed",
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function toToolSpec(tool: ToolDefinition): ToolSpec {
  const schema = z.toJSONSchema(tool.parameters, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: tool.name, description: tool.description, parameters: schema };
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (!TOOL_NAME_RE.test(tool.name)) throw new Error(`Invalid tool name "${tool.name}"`);
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" already registered`);
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Intersection of the agent allowlist with registered tools. Unknown names are dropped. */
  forAgent(allowlist: string[]): ToolDefinition[] {
    return [...new Set(allowlist)].map((n) => this.tools.get(n)).filter((t): t is ToolDefinition => Boolean(t));
  }
}

const MAX_RESULT_CHARS = 20_000;

export function serializeToolResult(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result ?? null);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…[truncated]` : text;
}

/** Validates args and executes with a timeout. Throws ToolError. */
export async function executeTool(tool: ToolDefinition, rawArgs: unknown, ctx: Omit<ToolContext, "signal">, parentSignal?: AbortSignal) {
  const parsed = tool.parameters.safeParse(rawArgs);
  if (!parsed.success) {
    throw new ToolError(`Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, "invalid_args");
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timeoutMs = tool.timeoutMs ?? 20_000;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      tool.execute(parsed.data, { ...ctx, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ToolError(`Tool ${tool.name} timed out after ${timeoutMs}ms`, "timeout"));
        }, timeoutMs);
      }),
    ]);
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(`Tool ${tool.name} failed: ${(e as Error).message}`, "failed");
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

/** Type-safe helper: infers `execute` argument types from the zod schema. */
export function defineTool<Args extends z.ZodType>(tool: ToolDefinition<Args>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}
