import Link from "next/link";
import { AGENT_TEMPLATES } from "@dtn/core/templates/agent-templates";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { createAgentAction } from "@/lib/actions/agents";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Nuevo agente" };

export default async function NewAgentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("agents.write"), searchParams, createSupabaseServerClient()]);
  const [{ data: models }, { data: custom }] = await Promise.all([
    supabase.from("llm_models").select("provider, model, display_name").eq("kind", "chat").eq("enabled", true).order("provider"),
    supabase.from("templates").select("id, name, description, organization_id").eq("kind", "agent").order("name"),
  ]);
  const defaultModel = process.env.DEFAULT_CHAT_MODEL;
  const selected = sp.template ?? "builtin:customer_support";
  const options = [
    ...AGENT_TEMPLATES.map((t) => ({ value: `builtin:${t.key}`, name: t.name, description: t.description, badge: t.category, requirements: t.requirements ?? [] })),
    ...(custom ?? []).map((t) => ({
      value: `custom:${t.id}`,
      name: t.name,
      description: t.description,
      badge: t.organization_id ? "de la organización" : "de la agencia",
      requirements: [] as string[],
    })),
    { value: "blank", name: "En blanco", description: "Empieza desde cero.", badge: "custom", requirements: [] as string[] },
  ];

  return (
    <>
      <PageHeader title="Nuevo agente" description={`Crear desde plantilla para ${s.org.name}`} />
      <Flash error={sp.error} />
      {!models?.length ? (
        <Card className="mb-6 border-warning/40">
          <CardHeader>
            <CardTitle>No hay modelos activos</CardTitle>
            <CardDescription>
              {s.isPlatformAdmin ? (
                <>
                  Añade un modelo de chat en <Link href="/admin" className="underline">Platform Admin → Modelos</Link>.
                </>
              ) : (
                "Pide al administrador de la plataforma que active un modelo."
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      <form action={createAgentAction} className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          {options.map((o) => (
            <label key={o.value} className="cursor-pointer">
              <input type="radio" name="template" value={o.value} defaultChecked={o.value === selected} className="peer sr-only" />
              <Card className="h-full transition-colors peer-checked:border-primary peer-checked:ring-2 peer-checked:ring-primary/30 hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{o.name}</CardTitle>
                    <Badge variant="secondary">{o.badge}</Badge>
                  </div>
                  <CardDescription>{o.description}</CardDescription>
                  {o.requirements.map((r) => (
                    <p key={r} className="text-xs text-warning">
                      {r}
                    </p>
                  ))}
                </CardHeader>
              </Card>
            </label>
          ))}
        </div>
        <Card className="h-fit lg:sticky lg:top-6">
          <CardContent className="space-y-3 pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre del agente</Label>
              <Input id="name" name="name" required maxLength={120} placeholder="Asistente de Clínica Sol" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Modelo</Label>
              <Select id="model" name="model" required defaultValue={defaultModel}>
                {(models ?? []).map((m) => (
                  <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                    {m.display_name ?? `${m.provider}:${m.model}`}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={!models?.length}>
              Crear agente
            </Button>
            <p className="text-xs text-muted-foreground">Se crea como borrador. Pruébalo en el playground antes de activarlo.</p>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
