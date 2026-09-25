import { z } from "zod";
import { TOOL_NAME_RE } from "../tools/registry";

/**
 * Workflow graph definition (what the visual builder saves). Nodes carry
 * React Flow positions so the canvas round-trips, but the engine only uses
 * `id`, `type` and `data`.
 */

export const NODE_TYPES = ["start", "agent", "tool", "condition", "parallel", "approval", "delay", "webhook", "end"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

const retrySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(5).default(1),
    backoffMs: z.number().int().min(0).max(60_000).default(1000),
  })
  .default({ maxAttempts: 1, backoffMs: 1000 });

const execOptions = {
  retry: retrySchema,
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
  continueOnError: z.boolean().default(false),
};

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "exists", "not_exists", "in"] as const;

export const conditionRuleSchema = z.object({
  left: z.string().max(500).describe("Template, e.g. {{nodes.classify.output.category}}"),
  op: z.enum(CONDITION_OPS),
  right: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
});

export const nodeDataSchemas = {
  start: z.object({ label: z.string().max(80).optional(), inputSchema: z.record(z.string(), z.unknown()).nullable().default(null) }),
  agent: z.object({
    label: z.string().max(80).optional(),
    agentId: z.string().uuid(),
    message: z.string().min(1).max(20_000),
    ...execOptions,
  }),
  tool: z.object({
    label: z.string().max(80).optional(),
    tool: z.string().regex(TOOL_NAME_RE),
    args: z.record(z.string(), z.unknown()).default({}),
    ...execOptions,
  }),
  condition: z.object({
    label: z.string().max(80).optional(),
    combinator: z.enum(["and", "or"]).default("and"),
    rules: z.array(conditionRuleSchema).min(1).max(20),
  }),
  parallel: z.object({ label: z.string().max(80).optional() }),
  approval: z.object({
    label: z.string().max(80).optional(),
    title: z.string().min(1).max(200),
    instructions: z.string().max(5000).default(""),
    /** Data shown to the reviewer (templated). */
    payload: z.string().max(10_000).default(""),
    timeoutHours: z.number().min(1).max(24 * 30).nullable().default(null),
  }),
  delay: z.object({ label: z.string().max(80).optional(), seconds: z.number().int().min(1).max(60 * 60 * 24 * 30) }),
  webhook: z.object({
    label: z.string().max(80).optional(),
    url: z.string().url().max(2048),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    /** Header values may reference organization secrets as {{secret:NAME}}; resolved server-side only. */
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), z.string().max(2000)).default({}),
    body: z.string().max(50_000).default(""),
    ...execOptions,
  }),
  end: z.object({
    label: z.string().max(80).optional(),
    output: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])).default({}),
  }),
} satisfies Record<NodeType, z.ZodType>;

export type NodeData<T extends NodeType> = z.infer<(typeof nodeDataSchemas)[T]>;

export const workflowNodeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const workflowEdgeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  source: z.string(),
  target: z.string(),
  /** Branch handle: "true"/"false" for conditions, "approved"/"rejected" for approvals. */
  sourceHandle: z.string().max(32).nullable().optional(),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema).min(2).max(200),
  edges: z.array(workflowEdgeSchema).max(500),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export interface GraphIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
}

const BRANCH_HANDLES: Partial<Record<NodeType, string[]>> = {
  condition: ["true", "false"],
  approval: ["approved", "rejected"],
};

/** Structural validation: returns human-readable issues (empty = valid). */
export function validateWorkflowGraph(input: unknown): { graph: WorkflowGraph | null; issues: GraphIssue[] } {
  const parsed = workflowGraphSchema.safeParse(input);
  if (!parsed.success) return { graph: null, issues: parsed.error.issues.map((i) => ({ message: `${i.path.join(".")}: ${i.message}` })) };
  const graph = parsed.data;
  const issues: GraphIssue[] = [];
  const byId = new Map<string, WorkflowNode>();

  for (const n of graph.nodes) {
    if (byId.has(n.id)) issues.push({ nodeId: n.id, message: `Duplicate node id "${n.id}"` });
    byId.set(n.id, n);
    const data = nodeDataSchemas[n.type].safeParse(n.data);
    if (!data.success) {
      for (const i of data.error.issues) issues.push({ nodeId: n.id, message: `${n.type} "${n.id}": ${i.path.join(".") || "data"} ${i.message}` });
    } else {
      n.data = data.data as Record<string, unknown>;
    }
  }

  const starts = graph.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) issues.push({ message: "A workflow needs exactly one START node" });
  if (!graph.nodes.some((n) => n.type === "end")) issues.push({ message: "A workflow needs at least one END node" });

  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) issues.push({ edgeId: e.id, message: `Duplicate edge id "${e.id}"` });
    edgeIds.add(e.id);
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) {
      issues.push({ edgeId: e.id, message: `Edge "${e.id}" references a missing node` });
      continue;
    }
    if (e.source === e.target) issues.push({ edgeId: e.id, message: "A node cannot connect to itself" });
    if (tgt.type === "start") issues.push({ edgeId: e.id, message: "START cannot have incoming connections" });
    if (src.type === "end") issues.push({ edgeId: e.id, message: "END cannot have outgoing connections" });
    const handles = BRANCH_HANDLES[src.type];
    if (handles && !handles.includes(e.sourceHandle ?? "")) {
      issues.push({ edgeId: e.id, message: `Connections from ${src.type} "${src.id}" must use the ${handles.join("/")} outputs` });
    }
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  for (const n of graph.nodes) {
    if (n.type !== "start" && !(incoming.get(n.id)?.length)) issues.push({ nodeId: n.id, message: `Node "${n.id}" is not connected to any input` });
    if (n.type !== "end" && !(outgoing.get(n.id)?.length)) issues.push({ nodeId: n.id, message: `Node "${n.id}" has no outgoing connection` });
    if (n.type === "condition") {
      const hs = new Set((outgoing.get(n.id) ?? []).map((e) => e.sourceHandle));
      if (!hs.has("true") || !hs.has("false")) issues.push({ nodeId: n.id, message: `Condition "${n.id}" needs both true and false branches` });
    }
  }

  // Cycle detection (Kahn). Loops are expressed with retries, not back-edges.
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (byId.has(e.target) && byId.has(e.source)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const e of outgoing.get(id) ?? []) {
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (visited !== graph.nodes.length) issues.push({ message: "The workflow contains a cycle" });

  return { graph: issues.length ? null : graph, issues };
}
