import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { decideApprovalAction } from "@/lib/actions/workflows";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Automations" };

const RUN_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary" | "default"> = {
  completed: "success",
  waiting: "warning",
  running: "default",
  queued: "secondary",
  failed: "danger",
  cancelled: "secondary",
};

function DecisionForm({ id, kind }: { id: string; kind: "workflow" | "agent_run" }) {
  return (
    <form action={decideApprovalAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <Input name="note" placeholder="Nota (opcional)" maxLength={500} className="h-8 w-48" aria-label="Nota" />
      <Button type="submit" name="decision" value="approve" size="sm">
        Aprobar
      </Button>
      <Button type="submit" name="decision" value="reject" size="sm" variant="outline">
        Rechazar
      </Button>
    </form>
  );
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("workflows.read"), searchParams, createSupabaseServerClient()]);
  const [{ data: approvals }, { data: agentApprovals }, { data: runs }] = await Promise.all([
    supabase
      .from("approvals")
      .select("id, title, instructions, payload, created_at, expires_at, workflow_run_id")
      .eq("organization_id", s.org.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_runs")
      .select("id, input, pending_approval, created_at, agents(name)")
      .eq("organization_id", s.org.id)
      .eq("status", "needs_approval")
      .order("created_at", { ascending: false }),
    supabase
      .from("workflow_runs")
      .select("id, status, trigger, version, error, created_at, finished_at, workflows(name)")
      .eq("organization_id", s.org.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const canDecide = s.can("approvals.decide");
  const pendingCount = (approvals?.length ?? 0) + (agentApprovals?.length ?? 0);

  return (
    <>
      <PageHeader title="Automations" description="Aprobaciones pendientes y ejecuciones de workflows." />
      <Flash ok={sp.ok === "approved" ? "Aprobado." : sp.ok === "rejected" ? "Rechazado." : sp.ok} error={sp.error} />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Aprobaciones pendientes {pendingCount ? <Badge variant="warning">{pendingCount}</Badge> : null}</CardTitle>
          <CardDescription>Acciones que un agente o un workflow no ejecutará sin tu decisión.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(approvals ?? []).map((a) => (
            <div key={a.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Workflow · <Link href={`/automations/runs/${a.workflow_run_id}`} className="underline">ver ejecución</Link> · {formatDate(a.created_at)}
                    {a.expires_at ? ` · caduca ${formatDate(a.expires_at)}` : ""}
                  </p>
                </div>
                {canDecide ? <DecisionForm id={a.id} kind="workflow" /> : null}
              </div>
              {a.instructions ? <p className="mt-2 whitespace-pre-wrap text-sm">{a.instructions}</p> : null}
              {a.payload ? <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{typeof a.payload === "string" ? a.payload : JSON.stringify(a.payload, null, 2)}</pre> : null}
            </div>
          ))}
          {(agentApprovals ?? []).map((r) => {
            const p = r.pending_approval as { toolName: string; args: unknown } | null;
            const agent = (Array.isArray(r.agents) ? r.agents[0] : r.agents) as { name: string } | null;
            return (
              <div key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {agent?.name ?? "Agente"} quiere ejecutar <code>{p?.toolName}</code>
                    </p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      «{r.input}» · {formatDate(r.created_at)}
                    </p>
                  </div>
                  {canDecide ? <DecisionForm id={r.id} kind="agent_run" /> : null}
                </div>
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(p?.args ?? {}, null, 2)}</pre>
              </div>
            );
          })}
          {pendingCount === 0 ? <p className="text-sm text-muted-foreground">No hay nada pendiente.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ejecuciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Workflow</TH>
                <TH>Estado</TH>
                <TH>Origen</TH>
                <TH>Inicio</TH>
                <TH>Error</TH>
              </TR>
            </THead>
            <TBody>
              {(runs ?? []).map((r) => {
                const wf = (Array.isArray(r.workflows) ? r.workflows[0] : r.workflows) as { name: string } | null;
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/automations/runs/${r.id}`} className="font-medium hover:underline">
                        {wf?.name ?? "—"}
                      </Link>
                      <span className="ml-1 text-xs text-muted-foreground">v{r.version}</span>
                    </TD>
                    <TD>
                      <Badge variant={RUN_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">{r.trigger}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(r.created_at)}</TD>
                    <TD className="max-w-xs truncate text-xs text-danger">{r.error}</TD>
                  </TR>
                );
              })}
              {runs?.length ? null : (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-muted-foreground">
                    Sin ejecuciones.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
