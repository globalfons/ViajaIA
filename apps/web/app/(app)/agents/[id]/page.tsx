import { notFound } from "next/navigation";
import { agentConfigSchema } from "@dtn/core/agents/config";
import { BUILTIN_TOOLS } from "@dtn/core/tools/builtin";
import { createCrmTools } from "@dtn/core/crm/tools";
import { AgentEditor } from "@/components/agents/agent-editor";
import { Playground } from "@/components/agents/playground";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TR } from "@/components/ui/table";
import { archiveAgentAction, restoreAgentVersionAction, saveAgentAsTemplateAction } from "@/lib/actions/agents";
import { requireOrg } from "@/lib/session";
import { AGENT_STATUS_VARIANT, RUN_STATUS_VARIANT } from "@/lib/status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatUsd } from "@/lib/utils";

const OK_MESSAGES: Record<string, string> = { restored: "Versión restaurada.", template: "Plantilla guardada." };

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp, s, supabase] = await Promise.all([params, searchParams, requireOrg("agents.read"), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, status, config, version, template_key")
    .eq("id", id)
    .eq("organization_id", s.org.id)
    .maybeSingle();
  if (!agent || agent.status === "archived") notFound();

  const [{ data: models }, { data: versions }, { data: runs }, { data: kbs }] = await Promise.all([
    supabase.from("llm_models").select("provider, model").eq("kind", "chat").eq("enabled", true),
    supabase.from("agent_versions").select("version, created_at").eq("agent_id", id).eq("organization_id", s.org.id).order("version", { ascending: false }).limit(10),
    supabase
      .from("agent_runs")
      .select("id, source, status, input, usage, created_at")
      .eq("agent_id", id)
      .eq("organization_id", s.org.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("knowledge_bases").select("id, name").eq("organization_id", s.org.id).order("name"),
  ]);
  const knowledgeBases = kbs ?? [];
  const config = agentConfigSchema.parse({ ...(agent.config as object), name: agent.name });
  // CRM tools are listed for metadata only (the store is bound server-side at run time).
  const tools = [...BUILTIN_TOOLS, ...createCrmTools({} as never)].map((t) => ({ name: t.name, description: t.description, risk: t.risk, alwaysRequireApproval: Boolean(t.alwaysRequireApproval) }));
  const canEdit = s.can("agents.write");

  return (
    <>
      <PageHeader
        title={agent.name}
        description={`v${agent.version}${agent.template_key && !agent.template_key.startsWith("custom:") ? ` · plantilla ${agent.template_key}` : ""}`}
        actions={<Badge variant={AGENT_STATUS_VARIANT[agent.status as keyof typeof AGENT_STATUS_VARIANT]}>{agent.status}</Badge>}
      />
      <Flash message={sp.ok ? OK_MESSAGES[sp.ok] : undefined} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <AgentEditor
            agentId={agent.id}
            initial={config}
            status={agent.status as "draft" | "active" | "paused"}
            models={(models ?? []).map((m) => `${m.provider}:${m.model}`)}
            tools={tools}
            knowledgeBases={knowledgeBases}
            canEdit={canEdit}
          />

          <Card>
            <CardHeader>
              <CardTitle>Ejecuciones recientes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TBody>
                  {(runs ?? []).map((r) => {
                    const usage = r.usage as { costUsd?: number } | null;
                    return (
                      <TR key={r.id}>
                        <TD>
                          <Badge variant={RUN_STATUS_VARIANT[r.status as keyof typeof RUN_STATUS_VARIANT] ?? "secondary"}>{r.status}</Badge>
                        </TD>
                        <TD className="text-xs text-muted-foreground">{r.source}</TD>
                        <TD className="max-w-xs truncate text-xs">{r.input}</TD>
                        <TD className="text-xs">{formatUsd(usage?.costUsd ?? 0)}</TD>
                        <TD className="text-xs text-muted-foreground">{formatDate(r.created_at)}</TD>
                      </TR>
                    );
                  })}
                  {runs?.length ? null : (
                    <TR>
                      <TD className="py-6 text-center text-muted-foreground">Sin ejecuciones todavía.</TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Versiones</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TBody>
                    {(versions ?? []).map((v) => (
                      <TR key={v.version}>
                        <TD>v{v.version}</TD>
                        <TD className="text-xs text-muted-foreground">{formatDate(v.created_at)}</TD>
                        <TD className="text-right">
                          {canEdit && v.version !== agent.version ? (
                            <form action={restoreAgentVersionAction}>
                              <input type="hidden" name="agentId" value={agent.id} />
                              <input type="hidden" name="version" value={v.version} />
                              <Button type="submit" size="sm" variant="ghost">
                                Restaurar
                              </Button>
                            </form>
                          ) : v.version === agent.version ? (
                            <Badge variant="secondary">actual</Badge>
                          ) : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            {canEdit ? (
              <Card>
                <CardHeader>
                  <CardTitle>Plantilla y ciclo de vida</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form action={saveAgentAsTemplateAction} className="space-y-2">
                    <input type="hidden" name="agentId" value={agent.id} />
                    <Input name="name" required maxLength={120} placeholder="Nombre de la plantilla" defaultValue={agent.name} />
                    <div className="flex gap-2">
                      <Select name="scope" defaultValue="org" aria-label="Visibilidad">
                        <option value="org">Solo esta organización</option>
                        {s.isPlatformAdmin ? <option value="platform">Toda la plataforma (agencia)</option> : null}
                      </Select>
                      <Button type="submit" variant="outline">
                        Guardar como plantilla
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">La plantilla no incluye el modelo ni las knowledge bases del cliente.</p>
                  </form>
                  <form action={archiveAgentAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Archivar agente
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
        <div className="xl:col-span-2">
          <div className="xl:sticky xl:top-0">
            <Playground agentId={agent.id} canRun={s.can("agents.run")} canApprove={s.can("approvals.decide")} />
          </div>
        </div>
      </div>
    </>
  );
}
