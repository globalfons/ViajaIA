import Link from "next/link";
import { notFound } from "next/navigation";
import type { RunState } from "@dtn/core/workflows/engine";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelRunAction } from "@/lib/actions/workflows";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** "1,2 s" / "350 ms" / "3 min 5 s". */
function duration(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Execution order: started nodes by start time, then the rest in graph order. */
function orderNodes(state: RunState, graphOrder: string[]) {
  const pos = (id: string) => (graphOrder.indexOf(id) + 1 || 1e6);
  return Object.entries(state.nodes).sort(([a, x], [b, y]) => {
    if (x.startedAt && y.startedAt) return x.startedAt.localeCompare(y.startedAt) || pos(a) - pos(b);
    if (x.startedAt) return -1;
    if (y.startedAt) return 1;
    return pos(a) - pos(b);
  });
}

function Json({ label, value, open = false }: { label: string; value: unknown; open?: boolean }) {
  return (
    <details open={open}>
      <summary className="cursor-pointer text-xs font-medium">{label}</summary>
      <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

const NODE_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary" | "default"> = {
  succeeded: "success",
  waiting: "warning",
  running: "default",
  pending: "secondary",
  skipped: "secondary",
  failed: "danger",
};

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp, s, supabase] = await Promise.all([params, searchParams, requireOrg("workflows.read"), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id, workflow_id, version, status, trigger, input, output, state, error, created_at, started_at, finished_at, next_wake_at, workflows(name)")
    .eq("id", id)
    .eq("organization_id", s.org.id)
    .maybeSingle();
  if (!run) notFound();
  const { data: version } = await supabase.from("workflow_versions").select("graph").eq("workflow_id", run.workflow_id).eq("version", run.version).eq("organization_id", s.org.id).maybeSingle();
  const graphNodes = new Map(((version?.graph as { nodes?: { id: string; type: string; data?: { label?: string } }[] } | null)?.nodes ?? []).map((n) => [n.id, n]));
  const state = run.state as RunState | null;
  const wf = (Array.isArray(run.workflows) ? run.workflows[0] : run.workflows) as { name: string } | null;
  const active = ["queued", "running", "waiting"].includes(run.status);

  return (
    <>
      <PageHeader
        title={`${wf?.name ?? "Workflow"} · ejecución`}
        description={`v${run.version} · ${run.trigger} · ${formatDate(run.created_at)}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={NODE_VARIANT[run.status] ?? (run.status === "completed" ? "success" : "secondary")}>{run.status}</Badge>
            <Link href={`/workflows/${run.workflow_id}`}>
              <Button variant="outline" size="sm">
                Abrir workflow
              </Button>
            </Link>
            {active && s.can("workflows.run") ? (
              <form action={cancelRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <Button type="submit" size="sm" variant="destructive">
                  Cancelar
                </Button>
              </form>
            ) : null}
          </div>
        }
      />
      <AutoRefresh active={active} intervalMs={3000} />
      <Flash message={sp.ok === "cancelled" ? "Ejecución cancelada." : undefined} error={sp.error} />
      <dl className="mb-6 grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">ID de ejecución</dt>
          <dd className="break-all font-mono text-xs">{run.id}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Inicio</dt>
          <dd>{run.started_at ? formatDate(run.started_at) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Duración total</dt>
          <dd>{duration(run.started_at, run.finished_at) ?? (active ? "en curso" : "—")}</dd>
        </div>
      </dl>
      {run.status === "queued" ? (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          En cola. Si no avanza, comprueba que el worker está en marcha (<code>pnpm dev:worker</code>).
        </p>
      ) : null}
      {run.next_wake_at && run.status === "waiting" ? <p className="mb-4 text-sm text-muted-foreground">Se reanudará el {formatDate(run.next_wake_at)}.</p> : null}
      {run.error ? <p className="mb-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{run.error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {state
            ? orderNodes(state, [...graphNodes.keys()]).map(([nodeId, n]) => (
                <Card key={nodeId} data-node={nodeId}>
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 py-3">
                    <CardTitle className="text-sm">
                      {graphNodes.get(nodeId)?.data?.label ?? nodeId}
                      <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                        {nodeId} · {graphNodes.get(nodeId)?.type ?? "?"}
                      </span>
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {n.attempts > 1 ? <span>{n.attempts} intentos</span> : null}
                      {n.startedAt ? <span>inicio {formatDate(n.startedAt)}</span> : null}
                      {duration(n.startedAt, n.finishedAt) ? <span>· {duration(n.startedAt, n.finishedAt)}</span> : null}
                      <Badge variant={NODE_VARIANT[n.status] ?? "secondary"}>{n.status}</Badge>
                    </div>
                  </CardHeader>
                  {n.logs.length || n.output !== undefined || n.error || n.input !== undefined ? (
                    <CardContent className="space-y-2 pb-3">
                      {n.error ? <p className="text-xs text-danger">{n.error}</p> : null}
                      {n.logs.length ? (
                        <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                          {n.logs.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      ) : null}
                      {n.input !== undefined && n.input !== null ? <Json label="Entrada" value={n.input} /> : null}
                      {n.output !== undefined && n.output !== null ? <Json label="Salida" value={n.output} open={n.status === "failed"} /> : null}
                    </CardContent>
                  ) : null}
                </Card>
              ))
            : null}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Entrada</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.input, null, 2)}</pre>
            </CardContent>
          </Card>
          {run.output ? (
            <Card>
              <CardHeader>
                <CardTitle>Salida</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.output, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
