import { headers } from "next/headers";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { channelStatusAction, createWebChannelAction } from "@/lib/actions/conversations";
import { integrationCatalog } from "@/lib/integrations";
import { deleteSecretAction, setSecretAction } from "@/lib/actions/secrets";
import { formatDate } from "@/lib/utils";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Integrations" };

const STATE = {
  available: { label: "Disponible", variant: "success" },
  configured: { label: "Conectado", variant: "success" },
  not_configured: { label: "Sin configurar", variant: "warning" },
  coming_soon: { label: "Próximamente", variant: "secondary" },
} as const;

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase, h] = await Promise.all([requireOrg("integrations.read"), searchParams, createSupabaseServerClient(), headers()]);
  const [{ data: channels }, { data: agents }, { data: secrets }] = await Promise.all([
    supabase.from("channels").select("id, name, type, status, public_key, allowed_origins, agent_id, agents(name)").eq("organization_id", s.org.id).order("created_at"),
    supabase.from("agents").select("id, name, status").eq("organization_id", s.org.id).neq("status", "archived").order("name"),
    s.can("secrets.manage")
      ? supabase.from("secrets").select("name, hint, updated_at").eq("organization_id", s.org.id).order("name")
      : Promise.resolve({ data: [] as { name: string; hint: string | null; updated_at: string }[] }),
  ]);
  const appUrl = process.env.APP_URL ?? `https://${h.get("host")}`;
  const catalog = integrationCatalog();
  const manage = s.can("integrations.manage");

  return (
    <>
      <PageHeader title="Integrations" description="Canales y servicios conectados a tus agentes." />
      <Flash
        message={{ channel: "Canal creado.", secret: "Credencial guardada (cifrada).", secret_deleted: "Credencial eliminada." }[sp.ok ?? ""]}
        ok={sp.ok === "saved" ? "saved" : undefined}
        error={sp.error}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Chat web</CardTitle>
          <CardDescription>Añade el asistente a la web del cliente con una línea de código. Responde el agente elegido (debe estar activo) y escala a tu equipo en Conversations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {(channels ?? [])
            .filter((c) => c.type === "web")
            .map((c) => {
              const agent = (Array.isArray(c.agents) ? c.agents[0] : c.agents) as { name: string } | null;
              const snippet = `<script src="${appUrl}/widget.js" data-key="${c.public_key}" async></script>`;
              return (
                <div key={c.id} className="space-y-2 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Agente: {agent?.name ?? "—"} · Orígenes: {c.allowed_origins.length ? c.allowed_origins.join(", ") : "cualquiera"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={c.status === "active" ? "success" : "secondary"}>{c.status === "active" ? "activo" : "pausado"}</Badge>
                      <a href={`/chat/${c.public_key}`} target="_blank" rel="noreferrer" className="text-sm underline">
                        Probar chat
                      </a>
                      {manage ? (
                        <form action={channelStatusAction}>
                          <input type="hidden" name="channelId" value={c.id} />
                          <input type="hidden" name="status" value={c.status === "active" ? "paused" : "active"} />
                          <Button type="submit" size="sm" variant="outline">
                            {c.status === "active" ? "Pausar" : "Activar"}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  <Textarea readOnly rows={2} className="font-mono text-xs" value={snippet} aria-label="Código para incrustar" />
                </div>
              );
            })}
          {manage ? (
            (agents ?? []).length ? (
              <form action={createWebChannelAction} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ch-name">Nombre</Label>
                  <Input id="ch-name" name="name" required maxLength={120} placeholder="Web principal" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-agent">Agente</Label>
                  <Select id="ch-agent" name="agentId" required>
                    {(agents ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} {a.status !== "active" ? "(no activo)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-origins">Webs permitidas (opcional)</Label>
                  <Input id="ch-origins" name="origins" placeholder="https://clinicadental.es" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-welcome">Mensaje de bienvenida (opcional)</Label>
                  <Input id="ch-welcome" name="welcome" maxLength={500} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit">Crear chat web</Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Crea primero un agente para conectarlo a un canal.</p>
            )
          ) : null}
        </CardContent>
      </Card>

      {s.can("secrets.manage") ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Credenciales</CardTitle>
            <CardDescription>
              Tokens y claves de las integraciones de esta organización. Se cifran (AES-256-GCM) y solo el servidor las usa al ejecutar una integración;
              nunca se muestran ni llegan al modelo. Úsalas en workflows con <code>{"{{secret:NOMBRE}}"}</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(secrets ?? []).length ? (
              <ul className="divide-y text-sm">
                {(secrets ?? []).map((sec) => (
                  <li key={sec.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-mono">{sec.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {sec.hint} · actualizada {formatDate(sec.updated_at)}
                    </span>
                    <form action={deleteSecretAction}>
                      <input type="hidden" name="name" value={sec.name} />
                      <Button type="submit" size="sm" variant="ghost" className="text-danger">
                        Eliminar
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aún no hay credenciales guardadas.</p>
            )}
            <form action={setSecretAction} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <Input name="name" required pattern="[A-Za-z][A-Za-z0-9_]{1,63}" placeholder="WHATSAPP_ACCESS_TOKEN" aria-label="Nombre" className="font-mono" />
              <Input name="value" type="password" required autoComplete="off" placeholder="Valor (no se volverá a mostrar)" aria-label="Valor" />
              <Button type="submit">Guardar</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {catalog
          .filter((i) => i.key !== "web")
          .map((i) => (
            <Card key={i.key} className={i.state === "coming_soon" ? "opacity-75" : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{i.name}</CardTitle>
                  <Badge variant={STATE[i.state].variant}>{STATE[i.state].label}</Badge>
                </div>
                <CardDescription>{i.description}</CardDescription>
                {i.note ? <p className="pt-1 text-xs text-muted-foreground">{i.note}</p> : null}
                <p className="pt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{i.category}</p>
              </CardHeader>
            </Card>
          ))}
      </div>
    </>
  );
}
