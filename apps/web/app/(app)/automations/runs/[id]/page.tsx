import Link from "next/link";
import { notFound } from "next/navigation";
import type { RunState } from "@dtn/core/workflows/engine";
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
      <Flash ok={sp.ok === "cancelled" ? "Ejecución cancelada." : undefined} error={sp.error} />
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
            ? Object.entries(state.nodes).map(([nodeId, n]) => (
                <Card key={nodeId}>
                  <CardHeader className="flex-row items-center justify-between py-3">
                    <CardTitle className="font-mono text-xs">{nodeId}</CardTitle>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {n.attempts > 1 ? <span>{n.attempts} intentos</span> : null}
                      {n.finishedAt ? <span>{formatDate(n.finishedAt)}</span> : null}
                      <Badge variant={NODE_VARIANT[n.status] ?? "secondary"}>{n.status}</Badge>
                    </div>
                  </CardHeader>
                  {n.logs.length || n.output !== undefined || n.error ? (
                    <CardContent className="space-y-2 pb-3">
                      {n.error ? <p className="text-xs text-danger">{n.error}</p> : null}
                      {n.logs.length ? (
                        <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                          {n.logs.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      ) : null}
                      {n.output !== undefined && n.output !== null ? (
                        <details>
                          <summary className="cursor-pointer text-xs">Salida</summary>
                          <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(n.output, null, 2)}</pre>
                        </details>
                      ) : null}
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
