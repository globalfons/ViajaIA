import { headers } from "next/headers";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { channelStatusAction, createWebChannelAction } from "@/lib/actions/conversations";
import { createWhatsAppChannelAction, emailAutoSendAction } from "@/lib/actions/channels";
import { EmailChannelForm } from "@/components/integrations/email-channel-form";
import { calendarSettingsAction, disconnectCalendarAction } from "@/lib/actions/calendar";
import { normalizeCalendarSettings } from "@dtn/core/calendar/slots";
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
  const [{ data: channels }, { data: agents }, { data: secrets }, { data: calendarRows }] = await Promise.all([
    supabase.from("channels").select("id, name, type, status, public_key, allowed_origins, agent_id, config, agents(name)").eq("organization_id", s.org.id).order("created_at"),
    supabase.from("agents").select("id, name, status").eq("organization_id", s.org.id).neq("status", "archived").order("name"),
    s.can("secrets.manage")
      ? supabase.from("secrets").select("name, hint, updated_at").eq("organization_id", s.org.id).order("name")
      : Promise.resolve({ data: [] as { name: string; hint: string | null; updated_at: string }[] }),
    supabase.from("integration_connections").select("status, account, settings, last_error, created_at").eq("organization_id", s.org.id).eq("provider", "google_calendar").limit(1),
  ]);
  const calendar = calendarRows?.[0] ?? null;
  const calSettings = normalizeCalendarSettings(calendar?.settings);
  const googleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const appUrl = process.env.APP_URL ?? `https://${h.get("host")}`;
  const catalog = integrationCatalog();
  const manage = s.can("integrations.manage");
  const waReady = Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
  const secretNames = (secrets ?? []).map((x) => x.name);
  const channelList = (type: string) => (channels ?? []).filter((c) => c.type === type);
  const agentName = (c: { agents: unknown }) => ((Array.isArray(c.agents) ? c.agents[0] : c.agents) as { name: string } | null)?.name ?? "—";
  const statusToggle = (c: { id: string; status: string }) =>
    manage ? (
      <form action={channelStatusAction}>
        <input type="hidden" name="channelId" value={c.id} />
        <input type="hidden" name="status" value={c.status === "active" ? "paused" : "active"} />
        <Button type="submit" size="sm" variant="outline">
          {c.status === "active" ? "Pausar" : "Activar"}
        </Button>
      </form>
    ) : null;

  return (
    <>
      <PageHeader title="Integrations" description="Canales y servicios conectados a tus agentes." />
      <Flash
        message={{ channel: "Canal creado.", secret: "Credencial guardada (cifrada).", secret_deleted: "Credencial eliminada.", calendar: "Google Calendar conectado.", calendar_disconnected: "Google Calendar desconectado y acceso revocado." }[sp.ok ?? ""]}
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

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>WhatsApp Business</CardTitle>
            <Badge variant={waReady ? "success" : "warning"}>{waReady ? "Disponible" : "Pendiente de la agencia"}</Badge>
          </div>
          <CardDescription>
            Cloud API de Meta. Los mensajes entrantes llegan firmados al webhook de la plataforma, se asignan a este cliente por su número y responde el
            agente (o tu equipo desde Conversations). Solo se contesta dentro de la ventana de 24 h que abre el cliente: no hay envíos masivos ni mensajes no
            solicitados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!waReady ? (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              La agencia debe configurar su app de Meta en el servidor (<code>WHATSAPP_APP_SECRET</code> y <code>WHATSAPP_VERIFY_TOKEN</code>) y registrar el
              webhook <code className="break-all">{appUrl}/api/webhooks/whatsapp</code>.
            </p>
          ) : null}
          {channelList("whatsapp").map((c) => {
            const cfg = (c.config ?? {}) as Record<string, string | null>;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-4">
                <div>
                  <p className="font-medium">
                    {c.name} · {cfg.display_phone_number ?? cfg.phone_number_id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Agente: {agentName(c)} · phone_number_id {cfg.phone_number_id} · token en <code>{cfg.token_secret}</code>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === "active" ? "success" : "secondary"}>{c.status === "active" ? "activo" : "pausado"}</Badge>
                  {statusToggle(c)}
                </div>
              </div>
            );
          })}
          {manage && waReady ? (
            (agents ?? []).length ? (
              <form action={createWhatsAppChannelAction} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wa-name">Nombre</Label>
                  <Input id="wa-name" name="name" required maxLength={120} placeholder="WhatsApp recepción" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-agent">Agente</Label>
                  <Select id="wa-agent" name="agentId" required>
                    {(agents ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} {a.status !== "active" ? "(no activo)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-number">Phone number ID (Meta)</Label>
                  <Input id="wa-number" name="phoneNumberId" required inputMode="numeric" pattern="[0-9]{5,30}" placeholder="109876543210987" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-token">Credencial con el token de acceso</Label>
                  <Select id="wa-token" name="tokenSecret" required defaultValue={secretNames.includes("WHATSAPP_ACCESS_TOKEN") ? "WHATSAPP_ACCESS_TOKEN" : undefined}>
                    {secretNames.length ? null : <option value="WHATSAPP_ACCESS_TOKEN">WHATSAPP_ACCESS_TOKEN (guárdalo en Credenciales)</option>}
                    {secretNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit">Conectar número</Button>
                  <p className="mt-1 text-xs text-muted-foreground">Comprobamos con Meta que el token puede operar ese número antes de conectarlo.</p>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Crea primero un agente para conectarlo a un canal.</p>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Email</CardTitle>
            <Badge variant="success">Disponible</Badge>
          </div>
          <CardDescription>
            Recibe los correos del cliente en un webhook con token propio; el agente prepara la respuesta. Por defecto las respuestas son borradores que
            revisa una persona. El envío usa Resend con la API key del cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {channelList("email").map((c) => {
            const cfg = (c.config ?? {}) as Record<string, unknown>;
            return (
              <div key={c.id} className="space-y-2 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {c.name} · {String(cfg.from_address ?? "")}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      Agente: {agentName(c)} · Webhook: <code>{`${appUrl}/api/webhooks/email/${c.public_key}`}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={cfg.auto_send ? "warning" : "secondary"}>{cfg.auto_send ? "envío automático" : "borradores"}</Badge>
                    <Badge variant={c.status === "active" ? "success" : "secondary"}>{c.status === "active" ? "activo" : "pausado"}</Badge>
                    {manage ? (
                      <form action={emailAutoSendAction}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="autoSend" value={cfg.auto_send ? "false" : "true"} />
                        <Button type="submit" size="sm" variant="outline">
                          {cfg.auto_send ? "Pasar a borradores" : "Activar envío automático"}
                        </Button>
                      </form>
                    ) : null}
                    {statusToggle(c)}
                  </div>
                </div>
              </div>
            );
          })}
          {manage ? (
            (agents ?? []).length ? (
              <EmailChannelForm agents={agents ?? []} secrets={secretNames} appUrl={appUrl} />
            ) : (
              <p className="text-sm text-muted-foreground">Crea primero un agente para conectarlo a un canal.</p>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Google Calendar</CardTitle>
            <Badge variant={calendar?.status === "connected" ? "success" : calendar ? "danger" : googleReady ? "secondary" : "warning"}>
              {calendar?.status === "connected" ? "Conectado" : calendar ? "Requiere reconexión" : googleReady ? "Sin conectar" : "Pendiente de la agencia"}
            </Badge>
          </div>
          <CardDescription>
            Los agentes de citas consultan huecos libres (tools <code>calendar_find_slots</code> y <code>calendar_create_appointment</code>) y reservan
            dentro de tu horario. Permisos mínimos (eventos y disponibilidad); Google no envía invitaciones en tu nombre.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!googleReady ? (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              La agencia debe configurar su cliente OAuth de Google (<code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>) con la URL de retorno{" "}
              <code className="break-all">{appUrl}/api/integrations/google/callback</code>.
            </p>
          ) : null}
          {calendar ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p>
                  Cuenta: <strong>{calendar.account ?? "—"}</strong> · conectado {formatDate(calendar.created_at)}
                  {calendar.last_error ? <span className="block text-danger">{calendar.last_error}</span> : null}
                </p>
                {manage ? (
                  <div className="flex gap-2">
                    {calendar.status !== "connected" && googleReady ? (
                      <a href="/api/integrations/google/start" className="rounded-md border px-3 py-1.5 text-sm">
                        Reconectar
                      </a>
                    ) : null}
                    <form action={disconnectCalendarAction}>
                      <Button type="submit" size="sm" variant="outline">
                        Desconectar
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>
              {manage ? (
                <form action={calendarSettingsAction} className="grid gap-3 sm:grid-cols-3" aria-label="Horario de citas">
                  <div className="space-y-1.5">
                    <Label htmlFor="cal-tz">Zona horaria</Label>
                    <Input id="cal-tz" name="timeZone" required defaultValue={calSettings.timeZone} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cal-start">Desde</Label>
                    <Input id="cal-start" name="start" type="time" required defaultValue={calSettings.start} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cal-end">Hasta</Label>
                    <Input id="cal-end" name="end" type="time" required defaultValue={calSettings.end} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cal-slot">Duración de la cita (min)</Label>
                    <Input id="cal-slot" name="slotMinutes" type="number" min={10} max={240} required defaultValue={calSettings.slotMinutes} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cal-notice">Antelación mínima (min)</Label>
                    <Input id="cal-notice" name="minNoticeMinutes" type="number" min={0} max={10080} required defaultValue={calSettings.minNoticeMinutes} />
                  </div>
                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium">Días</legend>
                    <div className="flex flex-wrap gap-2 text-sm">
                      {["D", "L", "M", "X", "J", "V", "S"].map((d, i) => (
                        <label key={d} className="flex items-center gap-1">
                          <input type="checkbox" name="days" value={i} defaultChecked={calSettings.days.includes(i)} aria-label={`Día ${d}`} /> {d}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="sm:col-span-3">
                    <Button type="submit">Guardar horario</Button>
                  </div>
                </form>
              ) : null}
            </>
          ) : manage && googleReady ? (
            <a href="/api/integrations/google/start" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Conectar con Google
            </a>
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
          .filter((i) => !["web", "whatsapp", "email", "gcal"].includes(i.key))
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
