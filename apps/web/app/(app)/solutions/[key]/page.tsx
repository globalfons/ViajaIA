import { notFound } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { getSolution } from "@dtn/core/solutions/catalog";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { activateSolutionAction } from "@/lib/actions/solutions";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NEEDS: Record<string, string> = {
  whatsapp: "Integración de WhatsApp Business (Integrations)",
  email: "Integración de email",
  calendar: "Integración de calendario (Google/Microsoft): la reserva automática aún no está disponible; el agente recoge y confirma los datos",
};

export default async function SolutionPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ key }, sp, s, supabase] = await Promise.all([params, searchParams, requireOrg("agents.read"), createSupabaseServerClient()]);
  const sol = getSolution(key);
  if (!sol) notFound();
  const { data: models } = await supabase.from("llm_models").select("provider, model, kind").eq("enabled", true);
  const chat = (models ?? []).filter((m) => m.kind === "chat").map((m) => `${m.provider}:${m.model}`);
  const emb = (models ?? []).filter((m) => m.kind === "embedding").map((m) => `${m.provider}:${m.model}`);
  const { data: waChannel } = await supabase.from("channels").select("id").eq("organization_id", s.org.id).eq("type", "whatsapp").limit(1);
  const checks = [
    { ok: chat.length > 0, label: "Modelo de chat activo en la plataforma" },
    ...(sol.knowledgeBase ? [{ ok: emb.length > 0, label: "Modelo de embeddings activo (1536 dimensiones)" }] : []),
    ...sol.needsIntegrations.map((n) => ({ ok: n === "whatsapp" ? Boolean(waChannel?.length) : false, label: NEEDS[n] ?? n })),
  ];
  const canActivate = s.can("agents.write") && chat.length > 0 && (!sol.knowledgeBase || emb.length > 0);

  return (
    <>
      <PageHeader title={sol.name} description={sol.tagline} actions={<Badge variant="secondary">{sol.templateId}</Badge>} />
      <Flash error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Qué hace</CardTitle>
              <CardDescription>{sol.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <span className="font-medium">Caso de uso: </span>
                {sol.useCase}
              </p>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Agentes</dt>
                  <dd>{sol.agents.map((a) => a.name).join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Workflow</dt>
                  <dd>{sol.workflow ? sol.workflow.name : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Knowledge base</dt>
                  <dd>{sol.knowledgeBase ? "Sí, se crea vacía para subir documentación" : "No"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Herramientas</dt>
                  <dd className="font-mono text-xs">{sol.tools.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Canales</dt>
                  <dd>{sol.channels.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Se crea al activar</dt>
                  <dd>{sol.provisionChannel === "web" ? "Chat web listo para incrustar" : "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Requisitos</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                    {c.label}
                  </li>
                ))}
                {sol.requirements.map((r) => (
                  <li key={r} className="pl-6 text-muted-foreground">
                    {r}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit lg:col-span-2">
          <CardHeader>
            <CardTitle>Activar para {s.org.name}</CardTitle>
            <CardDescription>Crea los recursos en una sola operación. Si algo falla, no se crea nada.</CardDescription>
          </CardHeader>
          <CardContent>
            {canActivate ? (
              <form action={activateSolutionAction} className="space-y-3">
                <input type="hidden" name="solutionKey" value={sol.key} />
                <div className="space-y-1.5">
                  <Label htmlFor="s-name">Nombre de la instancia</Label>
                  <Input id="s-name" name="name" defaultValue={sol.name} maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-model">Modelo de chat</Label>
                  <Select id="s-model" name="model">
                    {chat.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                </div>
                {sol.knowledgeBase ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="s-emb">Modelo de embeddings</Label>
                    <Select id="s-emb" name="embeddingModel">
                      {emb.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                {sol.config.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`cfg-${f.key}`}>
                      {f.label}
                      {f.required ? " *" : ""}
                    </Label>
                    {f.type === "textarea" ? (
                      <Textarea id={`cfg-${f.key}`} name={`cfg_${f.key}`} required={f.required} placeholder={f.placeholder} rows={3} maxLength={2000} />
                    ) : (
                      <Input id={`cfg-${f.key}`} name={`cfg_${f.key}`} required={f.required} placeholder={f.placeholder} maxLength={300} />
                    )}
                  </div>
                ))}
                {sol.provisionChannel === "web" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="s-origins">Webs donde se incrustará el chat (opcional)</Label>
                    <Input id="s-origins" name="origins" placeholder="https://clinicadental.es" />
                  </div>
                ) : null}
                <Button type="submit" className="w-full">
                  Activar solución
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                {s.can("agents.write") ? "Faltan requisitos de la plataforma (modelos activos). El administrador puede añadirlos en Platform Admin → Modelos." : "Tu rol no permite activar soluciones."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
