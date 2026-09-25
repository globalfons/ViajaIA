"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Bot, CheckCircle2, Clock, Flag, GitBranch, Play, Split, UserCheck, Webhook, Wrench, type LucideIcon } from "lucide-react";
import { validateWorkflowGraph, type GraphIssue, type NodeType } from "@dtn/core/workflows/schema";
import { publishWorkflowAction, runWorkflowAction, saveWorkflowAction, saveWorkflowAsTemplateAction } from "@/lib/actions/workflows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type NodeDataRecord = Record<string, unknown>;
type WfNode = Node<NodeDataRecord, NodeType>;

const META: Record<NodeType, { label: string; icon: LucideIcon; color: string; outputs?: { id: string; label: string }[] }> = {
  start: { label: "Inicio", icon: Play, color: "border-l-emerald-500" },
  agent: { label: "Agente", icon: Bot, color: "border-l-blue-500" },
  tool: { label: "Tool", icon: Wrench, color: "border-l-slate-500" },
  condition: { label: "Condición", icon: GitBranch, color: "border-l-amber-500", outputs: [{ id: "true", label: "sí" }, { id: "false", label: "no" }] },
  parallel: { label: "Paralelo", icon: Split, color: "border-l-violet-500" },
  approval: { label: "Aprobación humana", icon: UserCheck, color: "border-l-orange-500", outputs: [{ id: "approved", label: "aprobado" }, { id: "rejected", label: "rechazado" }] },
  delay: { label: "Espera", icon: Clock, color: "border-l-cyan-500" },
  webhook: { label: "Webhook", icon: Webhook, color: "border-l-pink-500" },
  end: { label: "Fin", icon: Flag, color: "border-l-emerald-700" },
};

const DEFAULT_DATA: Record<NodeType, NodeDataRecord> = {
  start: {},
  agent: { agentId: "", message: "{{input.message}}", retry: { maxAttempts: 1, backoffMs: 1000 }, timeoutMs: 60000 },
  tool: { tool: "current_datetime", args: {}, retry: { maxAttempts: 1, backoffMs: 1000 }, timeoutMs: 30000 },
  condition: { combinator: "and", rules: [{ left: "{{input.value}}", op: "exists" }] },
  parallel: {},
  approval: { title: "Revisar", instructions: "", payload: "" },
  delay: { seconds: 3600 },
  webhook: { url: "https://", method: "POST", headers: {}, body: "", retry: { maxAttempts: 3, backoffMs: 2000 }, timeoutMs: 15000 },
  end: { output: {} },
};

function FlowNode({ type, data, selected }: NodeProps<WfNode>) {
  const meta = META[type as NodeType];
  const Icon = meta.icon;
  const issue = data.__issue as string | undefined;
  return (
    <div
      className={cn(
        "min-w-44 rounded-md border border-l-4 bg-card px-3 py-2 text-xs shadow-sm",
        meta.color,
        selected && "ring-2 ring-primary",
        issue && "border-danger",
      )}
      title={issue}
    >
      {type !== "start" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="flex items-center gap-1.5 font-medium">
        <Icon className="h-3.5 w-3.5" />
        {(data.label as string) || meta.label}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{String((data.__id as string) ?? "")}</div>
      {meta.outputs ? (
        meta.outputs.map((o, i) => (
          <Handle key={o.id} id={o.id} type="source" position={Position.Right} style={{ top: `${35 + i * 35}%` }}>
            <span className="pointer-events-none absolute left-3 -translate-y-1/2 text-[9px] text-muted-foreground">{o.label}</span>
          </Handle>
        ))
      ) : type !== "end" ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

const nodeTypes = Object.fromEntries(Object.keys(META).map((k) => [k, FlowNode]));

export interface BuilderProps {
  workflowId: string;
  name: string;
  version: number;
  publishedVersion: number | null;
  initialGraph: { nodes: { id: string; type: string; position?: { x: number; y: number }; data?: NodeDataRecord }[]; edges: { id: string; source: string; target: string; sourceHandle?: string | null }[] };
  agents: { id: string; name: string }[];
  tools: { name: string; description: string }[];
  canEdit: boolean;
  canRun: boolean;
  isPlatformAdmin: boolean;
}

export function WorkflowBuilder(props: BuilderProps) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<WfNode>(
    props.initialGraph.nodes.map((n) => ({ id: n.id, type: n.type as NodeType, position: n.position ?? { x: 0, y: 0 }, data: { ...(n.data ?? {}), __id: n.id } })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    props.initialGraph.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? null })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(props.name);
  const [version, setVersion] = useState(props.version);
  const [published, setPublished] = useState(props.publishedVersion);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [runInput, setRunInput] = useState('{\n  "message": "Hola"\n}');
  const [pending, start] = useTransition();

  const graph = useMemo(
    () => ({
      nodes: nodes.map((n) => {
        const { __id: _id, __issue: _issue, ...data } = n.data;
        return { id: n.id, type: n.type!, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data };
      }),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
    }),
    [nodes, edges],
  );
  const issues: GraphIssue[] = useMemo(() => validateWorkflowGraph(structuredClone(graph)).issues, [graph]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: `e_${c.source}_${c.sourceHandle ?? "out"}_${c.target}` }, eds)),
    [setEdges],
  );

  const addNode = (type: NodeType) => {
    const base = type.replace(/[^a-z]/g, "");
    let i = 1;
    while (nodes.some((n) => n.id === `${base}_${i}`)) i++;
    const id = `${base}_${i}`;
    setNodes((ns) => [...ns, { id, type, position: { x: 200 + ns.length * 30, y: 80 + ns.length * 30 }, data: { ...structuredClone(DEFAULT_DATA[type]), __id: id } }]);
    setSelectedId(id);
  };

  const updateSelected = (patch: NodeDataRecord) => {
    if (!selected) return;
    setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const save = () =>
    start(async () => {
      const res = await saveWorkflowAction(props.workflowId, graph, { name });
      if (res.error) setStatus({ error: res.error });
      else {
        setVersion(res.version!);
        setStatus({ ok: `Guardada la versión ${res.version}${res.issues?.length ? " (borrador con avisos)" : ""}.` });
      }
    });

  const publish = () =>
    start(async () => {
      const saved = await saveWorkflowAction(props.workflowId, graph, { name });
      if (saved.error) return setStatus({ error: saved.error });
      setVersion(saved.version!);
      const res = await publishWorkflowAction(props.workflowId);
      if (res.error) setStatus({ error: res.error });
      else {
        setPublished(res.version ?? null);
        setStatus({ ok: `Publicada la versión ${res.version}. Los disparadores usarán esta versión.` });
      }
    });

  const run = (useDraft: boolean) =>
    start(async () => {
      let input: unknown;
      try {
        input = JSON.parse(runInput || "{}");
      } catch {
        return setStatus({ error: "La entrada no es JSON válido." });
      }
      if (useDraft) {
        const saved = await saveWorkflowAction(props.workflowId, graph, { name });
        if (saved.error) return setStatus({ error: saved.error });
      }
      const res = await runWorkflowAction(props.workflowId, input, useDraft);
      if (res.error) setStatus({ error: res.error });
      else router.push(`/automations/runs/${res.runId}`);
    });

  return (
    <div className="grid h-[calc(100vh-9rem)] grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b bg-card p-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56" aria-label="Nombre" disabled={!props.canEdit} />
          <Badge variant="secondary">v{version}</Badge>
          {published ? <Badge variant="success">publicada v{published}</Badge> : <Badge variant="warning">sin publicar</Badge>}
          <div className="ml-auto flex gap-2">
            {props.canEdit ? (
              <>
                <Button size="sm" variant="outline" onClick={save} disabled={pending}>
                  Guardar versión
                </Button>
                <Button size="sm" onClick={publish} disabled={pending || issues.length > 0} title={issues.length ? "Corrige los avisos para publicar" : undefined}>
                  Publicar
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {props.canEdit ? (
          <div className="flex flex-wrap gap-1 border-b bg-muted/40 p-2">
            {(Object.keys(META) as NodeType[])
              .filter((t) => t !== "start")
              .map((t) => {
                const Icon = META[t].icon;
                return (
                  <Button key={t} size="sm" variant="ghost" onClick={() => addNode(t)}>
                    <Icon className="h-3.5 w-3.5" /> {META[t].label}
                  </Button>
                );
              })}
          </div>
        ) : null}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes.map((n) => ({ ...n, data: { ...n.data, __issue: issues.find((i) => i.nodeId === n.id)?.message } }))}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={props.canEdit ? onNodesChange : undefined}
            onEdgesChange={props.canEdit ? onEdgesChange : undefined}
            onConnect={props.canEdit ? onConnect : undefined}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={props.canEdit ? ["Backspace", "Delete"] : null}
            fitView
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>

      <aside className="space-y-4 overflow-y-auto">
        {status.ok ? <p className="rounded-md border border-success/30 bg-success/5 p-2 text-sm text-success">{status.ok}</p> : null}
        {status.error ? <p className="rounded-md border border-danger/30 bg-danger/5 p-2 text-sm text-danger">{status.error}</p> : null}

        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            {issues.length ? <Badge variant="warning">{issues.length} avisos</Badge> : <CheckCircle2 className="h-4 w-4 text-success" />}
            Validación
          </h3>
          {issues.length ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {issues.map((i, idx) => (
                <li key={idx}>
                  <button type="button" className="text-left hover:underline" onClick={() => i.nodeId && setSelectedId(i.nodeId)}>
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">El workflow es válido.</p>
          )}
        </div>

        {selected ? (
          <NodePanel key={selected.id} node={selected} agents={props.agents} tools={props.tools} onChange={updateSelected} disabled={!props.canEdit} />
        ) : (
          <p className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
            Selecciona un nodo para editarlo. Conecta nodos arrastrando desde la salida (derecha) hasta la entrada (izquierda). Usa{" "}
            <code>{"{{input.campo}}"}</code> y <code>{"{{nodes.id.output.campo}}"}</code> para pasar datos. Supr borra lo seleccionado.
          </p>
        )}

        {props.canEdit ? (
          <form
            className="space-y-2 rounded-lg border bg-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const res = await saveWorkflowAsTemplateAction(props.workflowId, String(f.get("tname")), f.get("tscope") === "platform" ? "platform" : "org");
                setStatus(res.error ? { error: res.error } : { ok: "Plantilla guardada (sin referencias a agentes del cliente)." });
              });
            }}
          >
            <h3 className="text-sm font-semibold">Guardar como plantilla</h3>
            <Input name="tname" required maxLength={120} defaultValue={name} aria-label="Nombre de la plantilla" />
            <div className="flex gap-2">
              <Select name="tscope" defaultValue="org" aria-label="Visibilidad">
                <option value="org">Esta organización</option>
                {props.isPlatformAdmin ? <option value="platform">Toda la agencia</option> : null}
              </Select>
              <Button size="sm" variant="outline" type="submit" disabled={pending}>
                Guardar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Guarda la última versión guardada.</p>
          </form>
        ) : null}

        {props.canRun ? (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <h3 className="text-sm font-semibold">Ejecutar</h3>
            <Textarea rows={4} className="font-mono text-xs" value={runInput} onChange={(e) => setRunInput(e.target.value)} aria-label="Entrada JSON" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => run(true)} disabled={pending || issues.length > 0}>
                Probar borrador
              </Button>
              <Button size="sm" onClick={() => run(false)} disabled={pending || !published}>
                Ejecutar publicada
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">La ejecución la procesa el worker en segundo plano.</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function NodePanel({
  node,
  agents,
  tools,
  onChange,
  disabled,
}: {
  node: WfNode;
  agents: { id: string; name: string }[];
  tools: { name: string; description: string }[];
  onChange: (patch: NodeDataRecord) => void;
  disabled: boolean;
}) {
  const d = node.data;
  const type = node.type as NodeType;
  const retry = (d.retry as { maxAttempts: number; backoffMs: number } | undefined) ?? { maxAttempts: 1, backoffMs: 1000 };
  const [jsonDraft, setJsonDraft] = useState(() =>
    JSON.stringify(type === "tool" ? (d.args ?? {}) : type === "webhook" ? (d.headers ?? {}) : type === "end" ? (d.output ?? {}) : type === "condition" ? (d.rules ?? []) : {}, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const jsonField = (key: string) => (v: string) => {
    setJsonDraft(v);
    try {
      onChange({ [key]: JSON.parse(v) });
      setJsonError(null);
    } catch {
      setJsonError("JSON no válido");
    }
  };

  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border bg-card p-3">
      <h3 className="text-sm font-semibold">
        {META[type].label} <span className="font-mono text-xs text-muted-foreground">{node.id}</span>
      </h3>
      <div className="space-y-1">
        <Label htmlFor="n-label">Etiqueta</Label>
        <Input id="n-label" value={(d.label as string) ?? ""} maxLength={80} onChange={(e) => onChange({ label: e.target.value })} />
      </div>

      {type === "agent" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="n-agent">Agente</Label>
            <Select id="n-agent" value={(d.agentId as string) ?? ""} onChange={(e) => onChange({ agentId: e.target.value })}>
              <option value="">Selecciona…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-msg">Mensaje</Label>
            <Textarea id="n-msg" rows={4} value={(d.message as string) ?? ""} onChange={(e) => onChange({ message: e.target.value })} />
          </div>
        </>
      ) : null}

      {type === "tool" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="n-tool">Tool</Label>
            <Select id="n-tool" value={(d.tool as string) ?? ""} onChange={(e) => onChange({ tool: e.target.value })}>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-args">Argumentos (JSON, admite plantillas)</Label>
            <Textarea id="n-args" rows={4} className="font-mono text-xs" value={jsonDraft} onChange={(e) => jsonField("args")(e.target.value)} />
          </div>
        </>
      ) : null}

      {type === "condition" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="n-comb">Combinar reglas</Label>
            <Select id="n-comb" value={(d.combinator as string) ?? "and"} onChange={(e) => onChange({ combinator: e.target.value })}>
              <option value="and">Todas (AND)</option>
              <option value="or">Alguna (OR)</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-rules">Reglas (JSON)</Label>
            <Textarea id="n-rules" rows={6} className="font-mono text-xs" value={jsonDraft} onChange={(e) => jsonField("rules")(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              {'[{"left": "{{nodes.x.output.score}}", "op": "gte", "right": 70}]'} · ops: eq, neq, gt, gte, lt, lte, contains, not_contains, exists, not_exists, in
            </p>
          </div>
        </>
      ) : null}

      {type === "approval" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="n-title">Título para el revisor</Label>
            <Input id="n-title" value={(d.title as string) ?? ""} onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-ins">Instrucciones</Label>
            <Textarea id="n-ins" rows={3} value={(d.instructions as string) ?? ""} onChange={(e) => onChange({ instructions: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-payload">Datos a revisar (plantilla)</Label>
            <Input id="n-payload" value={(d.payload as string) ?? ""} onChange={(e) => onChange({ payload: e.target.value })} placeholder="{{nodes.agent_1.output.text}}" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-exp">Caduca en (horas, vacío = nunca)</Label>
            <Input id="n-exp" type="number" min={1} value={(d.timeoutHours as number | null) ?? ""} onChange={(e) => onChange({ timeoutHours: e.target.value ? Number(e.target.value) : null })} />
          </div>
        </>
      ) : null}

      {type === "delay" ? (
        <div className="space-y-1">
          <Label htmlFor="n-sec">Segundos</Label>
          <Input id="n-sec" type="number" min={1} value={(d.seconds as number) ?? 60} onChange={(e) => onChange({ seconds: Number(e.target.value) })} />
        </div>
      ) : null}

      {type === "webhook" ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Select value={(d.method as string) ?? "POST"} onChange={(e) => onChange({ method: e.target.value })} aria-label="Método">
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Input className="col-span-2" value={(d.url as string) ?? ""} onChange={(e) => onChange({ url: e.target.value })} aria-label="URL" placeholder="https://" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-headers">Cabeceras (JSON). Secretos: {"{{secret:NOMBRE}}"}</Label>
            <Textarea id="n-headers" rows={3} className="font-mono text-xs" value={jsonDraft} onChange={(e) => jsonField("headers")(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-body">Cuerpo</Label>
            <Textarea id="n-body" rows={4} className="font-mono text-xs" value={(d.body as string) ?? ""} onChange={(e) => onChange({ body: e.target.value })} />
          </div>
        </>
      ) : null}

      {type === "end" ? (
        <div className="space-y-1">
          <Label htmlFor="n-out">Salida (JSON; valores con plantillas)</Label>
          <Textarea id="n-out" rows={4} className="font-mono text-xs" value={jsonDraft} onChange={(e) => jsonField("output")(e.target.value)} />
        </div>
      ) : null}

      {type === "agent" || type === "tool" || type === "webhook" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="n-att">Intentos</Label>
            <Input id="n-att" type="number" min={1} max={5} value={retry.maxAttempts} onChange={(e) => onChange({ retry: { ...retry, maxAttempts: Number(e.target.value) } })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-back">Backoff ms</Label>
            <Input id="n-back" type="number" min={0} max={60000} value={retry.backoffMs} onChange={(e) => onChange({ retry: { ...retry, backoffMs: Number(e.target.value) } })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-to">Timeout ms</Label>
            <Input id="n-to" type="number" min={1000} max={300000} value={(d.timeoutMs as number) ?? 60000} onChange={(e) => onChange({ timeoutMs: Number(e.target.value) })} />
          </div>
          <label className="col-span-3 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={Boolean(d.continueOnError)} onChange={(e) => onChange({ continueOnError: e.target.checked })} />
            Continuar aunque falle
          </label>
        </div>
      ) : null}
      {jsonError ? <p className="text-xs text-danger">{jsonError}</p> : null}
    </fieldset>
  );
}
