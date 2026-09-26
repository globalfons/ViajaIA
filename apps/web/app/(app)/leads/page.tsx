import Link from "next/link";
import { LEAD_STAGES } from "@dtn/core/crm/types";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createLeadAction, moveStageAction } from "@/lib/actions/leads";
import { eur, LAWFUL_BASIS_LABEL, SOURCE_LABEL, STAGE_LABEL } from "@/lib/crm-ui";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("crm.read"), searchParams, createSupabaseServerClient()]);
  let q = supabase
    .from("leads")
    .select("id, title, stage, score, value, source, created_at, stage_changed_at, contacts(email, phone)")
    .eq("organization_id", s.org.id)
    .order("stage_changed_at", { ascending: false })
    .limit(500);
  if (sp.source && sp.source in SOURCE_LABEL) q = q.eq("source", sp.source);
  const { data: leads } = await q;
  const byStage = Object.fromEntries(LEAD_STAGES.map((st) => [st, (leads ?? []).filter((l) => l.stage === st)]));
  const total = leads?.length ?? 0;
  const won = byStage.WON!.length;
  const closed = won + byStage.LOST!.length;
  const pipelineValue = (leads ?? []).filter((l) => !["WON", "LOST"].includes(l.stage)).reduce((a, l) => a + Number(l.value ?? 0), 0);
  const canWrite = s.can("crm.write");

  return (
    <>
      <PageHeader title="Leads" description="Pipeline comercial. Solo leads que contactaron o dieron su consentimiento: la plataforma no envía comunicaciones no solicitadas." />
      <Flash error={sp.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Leads", formatNumber(total)],
          ["Valor en pipeline", eur(pipelineValue)],
          ["Ganados", formatNumber(won)],
          ["Tasa de cierre", closed ? `${Math.round((won / closed) * 100)} %` : "—"],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
        {LEAD_STAGES.map((st) => (
          <div key={st} className="w-64 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
              <span>{STAGE_LABEL[st]}</span>
              <Badge variant={st === "WON" ? "success" : st === "LOST" ? "secondary" : "default"}>{byStage[st]!.length}</Badge>
            </div>
            <div className="space-y-2 rounded-lg bg-muted/50 p-2" data-stage={st}>
              {byStage[st]!.map((l) => {
                const contact = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as { email: string | null } | null;
                return (
                  <div key={l.id} className="rounded-md border bg-card p-2.5 text-sm shadow-sm">
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                      {l.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {l.score != null ? <Badge variant={l.score >= 70 ? "success" : l.score >= 40 ? "warning" : "secondary"}>{l.score}</Badge> : null}
                      <span>{SOURCE_LABEL[l.source]}</span>
                      {l.value ? <span>· {eur(Number(l.value))}</span> : null}
                    </div>
                    {contact?.email ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{contact.email}</div> : null}
                    {canWrite ? (
                      <form action={moveStageAction} className="mt-2 flex gap-1">
                        <input type="hidden" name="leadId" value={l.id} />
                        <input type="hidden" name="back" value="board" />
                        <Select name="stage" defaultValue={st} className="h-7 px-2 py-0 text-xs" aria-label="Mover a">
                          {LEAD_STAGES.map((x) => (
                            <option key={x} value={x}>
                              {STAGE_LABEL[x]}
                            </option>
                          ))}
                        </Select>
                        <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
                          Mover
                        </Button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
              {byStage[st]!.length === 0 ? <p className="px-1 py-3 text-center text-xs text-muted-foreground">Vacío</p> : null}
            </div>
          </div>
        ))}
      </div>

      {canWrite ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Nuevo lead</CardTitle>
            <CardDescription>Los agentes registran leads automáticamente desde las conversaciones; aquí puedes añadirlos a mano.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createLeadAction} className="grid gap-3 sm:grid-cols-2">
              <Input name="name" maxLength={200} placeholder="Nombre" aria-label="Nombre" />
              <Input name="company" maxLength={200} placeholder="Empresa" aria-label="Empresa" />
              <Input name="email" type="email" maxLength={320} placeholder="Email" aria-label="Email" />
              <Input name="phone" maxLength={40} placeholder="Teléfono" aria-label="Teléfono" />
              <Input name="value" type="number" min={0} step="1" placeholder="Valor estimado (€)" aria-label="Valor" />
              <div className="space-y-1">
                <Label htmlFor="lb">Base legal (RGPD) *</Label>
                <Select id="lb" name="lawfulBasis" required defaultValue="inbound_request">
                  {Object.entries(LAWFUL_BASIS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="marketingConsent" /> Ha aceptado expresamente recibir comunicaciones comerciales
              </label>
              <Textarea name="note" rows={2} maxLength={2000} placeholder="Nota (opcional)" aria-label="Nota" className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <Button type="submit">Crear lead</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
