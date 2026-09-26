import Link from "next/link";
import { notFound } from "next/navigation";
import { LEAD_STAGES } from "@dtn/core/crm/types";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { addNoteAction, createTaskAction, moveStageAction, saveOpportunityAction, toggleTaskAction } from "@/lib/actions/leads";
import { eur, LAWFUL_BASIS_LABEL, OPPORTUNITY_STATUS_LABEL, SOURCE_LABEL, STAGE_LABEL } from "@/lib/crm-ui";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp, s, supabase] = await Promise.all([params, searchParams, requireOrg("crm.read"), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, title, stage, score, value, source, qualification, lawful_basis, marketing_consent, consent_at, conversation_id, lost_reason, created_at, contacts(name, email, phone, company)")
    .eq("id", id)
    .eq("organization_id", s.org.id)
    .maybeSingle();
  if (!lead) notFound();
  const [{ data: activities }, { data: tasks }, { data: opp }] = await Promise.all([
    supabase.from("activities").select("id, type, content, created_at").eq("lead_id", id).eq("organization_id", s.org.id).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title, status, due_at, source").eq("lead_id", id).eq("organization_id", s.org.id).order("created_at"),
    supabase.from("opportunities").select("name, amount, status, close_date").eq("lead_id", id).eq("organization_id", s.org.id).maybeSingle(),
  ]);
  const contact = (Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts) as { name: string | null; email: string | null; phone: string | null; company: string | null } | null;
  const q = (lead.qualification ?? {}) as Record<string, string>;
  const canWrite = s.can("crm.write");

  return (
    <>
      <PageHeader
        title={lead.title}
        description={`${SOURCE_LABEL[lead.source]} · creado ${formatDate(lead.created_at)}`}
        actions={
          <div className="flex items-center gap-2">
            {lead.score != null ? <Badge variant={lead.score >= 70 ? "success" : "warning"}>Puntuación {lead.score}</Badge> : null}
            <Badge>{STAGE_LABEL[lead.stage]}</Badge>
          </div>
        }
      />
      <Flash error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canWrite ? (
            <form action={moveStageAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <Select name="stage" defaultValue={lead.stage} className="w-44" aria-label="Etapa">
                {LEAD_STAGES.map((x) => (
                  <option key={x} value={x}>
                    {STAGE_LABEL[x]}
                  </option>
                ))}
              </Select>
              <Input name="lostReason" placeholder="Motivo si se pierde (opcional)" maxLength={300} className="w-64" aria-label="Motivo" />
              <Button type="submit" variant="outline">
                Cambiar etapa
              </Button>
            </form>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Actividad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canWrite ? (
                <form action={addNoteAction} className="space-y-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Textarea name="note" rows={2} maxLength={4000} required placeholder="Añadir nota…" aria-label="Nota" />
                  <Button type="submit" size="sm">
                    Guardar nota
                  </Button>
                </form>
              ) : null}
              <ul className="space-y-2">
                {(activities ?? []).map((a) => (
                  <li key={a.id} className="rounded-md border p-2 text-sm">
                    <div className="mb-0.5 flex justify-between text-xs text-muted-foreground">
                      <span>{a.type === "agent" ? "Agente IA" : a.type === "stage_change" ? "Cambio de etapa" : a.type === "system" ? "Sistema" : "Nota"}</span>
                      <span>{formatDate(a.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{a.content}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{contact?.name ?? "—"}</p>
              {contact?.email ? <p>{contact.email}</p> : null}
              {contact?.phone ? <p>{contact.phone}</p> : null}
              {contact?.company ? <p>{contact.company}</p> : null}
              <p className="pt-2 text-xs text-muted-foreground">
                Base legal: {LAWFUL_BASIS_LABEL[lead.lawful_basis]} · Marketing: {lead.marketing_consent ? `aceptado ${lead.consent_at ? formatDate(lead.consent_at) : ""}` : "no aceptado"}
              </p>
              {lead.conversation_id ? (
                <Link href={`/conversations/${lead.conversation_id}`} className="text-xs underline">
                  Ver conversación de origen
                </Link>
              ) : null}
            </CardContent>
          </Card>
          {Object.keys(q).length ? (
            <Card>
              <CardHeader>
                <CardTitle>Cualificación</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(q).map(([k, v]) => (
                  <p key={k}>
                    <span className="text-muted-foreground">{{ budget: "Presupuesto", authority: "Decisor", need: "Necesidad", timeline: "Plazo" }[k] ?? k}: </span>
                    {String(v)}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Oportunidad</CardTitle>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <form action={saveOpportunityAction} className="space-y-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Input name="name" required maxLength={200} defaultValue={opp?.name ?? lead.title} aria-label="Nombre de la oportunidad" />
                  <Input name="amount" type="number" min={0} required defaultValue={opp?.amount ?? lead.value ?? ""} placeholder="Importe (€)" aria-label="Importe" />
                  <Input name="closeDate" type="date" defaultValue={opp?.close_date ?? ""} aria-label="Cierre previsto" />
                  <Button type="submit" size="sm" variant="outline">
                    Guardar
                  </Button>
                  {opp ? <p className="text-xs text-muted-foreground">{OPPORTUNITY_STATUS_LABEL[opp.status] ?? opp.status} · {eur(Number(opp.amount))}</p> : null}
                </form>
              ) : (
                <p className="text-sm">{opp ? `${opp.name} · ${eur(Number(opp.amount))} · ${OPPORTUNITY_STATUS_LABEL[opp.status] ?? opp.status}` : "—"}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tareas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(tasks ?? []).map((t) => (
                <form key={t.id} action={toggleTaskAction} className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="taskId" value={t.id} />
                  <input type="hidden" name="leadId" value={lead.id} />
                  <input type="hidden" name="status" value={t.status === "done" ? "open" : "done"} />
                  <Button type="submit" size="sm" variant="ghost" className="h-6 px-1" aria-label={t.status === "done" ? "Reabrir" : "Completar"} disabled={!canWrite}>
                    {t.status === "done" ? "☑" : "☐"}
                  </Button>
                  <span className={t.status === "done" ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                  {t.source === "agent" ? <Badge variant="secondary">IA</Badge> : null}
                  {t.due_at ? <span className="text-xs text-muted-foreground">{formatDate(t.due_at)}</span> : null}
                </form>
              ))}
              {canWrite ? (
                <form action={createTaskAction} className="flex flex-wrap gap-2 pt-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Input name="title" required maxLength={300} placeholder="Nueva tarea" aria-label="Nueva tarea" className="w-full" />
                  <Input name="due" type="datetime-local" className="min-w-0 flex-1" aria-label="Vencimiento" />
                  <Button type="submit" size="sm">
                    Añadir
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
