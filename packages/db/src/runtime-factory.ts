import {
  AgentRuntime,
  BUILTIN_TOOLS,
  LLMRouter,
  providersFromEnv,
  ToolRegistry,
  type LLMProvider,
  type ProviderId,
  type RetrievedChunk,
  type ToolDefinition,
  type UsageContext,
} from "@dtn/core";
import type { Queryable } from "./pool";
import { BudgetGuard, loadPricing, pgUsageSink, recordToolInvocation } from "./usage";
import { searchKnowledge } from "./knowledge";
import { secretResolver } from "./secrets";

export interface RuntimeFactoryOptions {
  db: Queryable;
  env?: Record<string, string | undefined>;
  /** Override providers (tests). */
  providers?: Partial<Record<ProviderId, LLMProvider>>;
  extraTools?: ToolDefinition[];
  retrieve?: (query: string, kbIds: string[], ctx: UsageContext) => Promise<RetrievedChunk[]>;
  getSecret?: (organizationId: string, name: string) => Promise<string | null>;
  requestId?: string;
}

/** Wires the pure core runtime to Postgres: pricing, usage, budgets and tool logs. */
export async function createAgentRuntime(opts: RuntimeFactoryOptions) {
  const pricing = await loadPricing(opts.db);
  const guard = new BudgetGuard(opts.db);
  const router = new LLMRouter({
    providers: opts.providers ?? providersFromEnv(opts.env ?? process.env),
    pricing,
    onUsage: pgUsageSink(opts.db, opts.requestId),
    beforeCall: guard.check,
  });
  const tools = new ToolRegistry();
  for (const t of [...BUILTIN_TOOLS, ...(opts.extraTools ?? [])]) tools.register(t);
  const runtime = new AgentRuntime({
    router,
    tools,
    // Default RAG: hybrid search over the agent's knowledge bases, scoped to its org.
    retrieve: opts.retrieve ?? ((query, kbIds, ctx) => searchKnowledge(opts.db, router, ctx.organizationId, kbIds, query, { ctx })),
    // Credentials are decrypted server-side only when a tool needs them.
    getSecret: opts.getSecret ?? secretResolver(opts.db),
    onToolInvocation: (rec, input) =>
      recordToolInvocation(
        opts.db,
        { organizationId: input.organizationId, agentId: input.agentId, conversationId: input.conversationId, workflowRunId: input.workflowRunId },
        rec,
      ),
  });
  return { runtime, router, tools, guard, pricing };
}
