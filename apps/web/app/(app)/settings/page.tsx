import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
  updateBranding,
  updateOrganizationProfile,
} from "@/lib/actions/settings";
import { parseBranding } from "@/lib/branding";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("org.read"), searchParams, createSupabaseServerClient()]);
  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, profiles(email, full_name)").eq("organization_id", s.org.id),
    s.can("members.invite")
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at")
          .eq("organization_id", s.org.id)
          .is("accepted_at", null)
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
  ]);
  const branding = parseBranding(s.org.branding);
  const canEdit = s.can("org.update");

  return (
    <>
      <PageHeader title="Settings" description={`Configuración de ${s.org.name}`} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Empresa</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateOrganizationProfile} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="orgname">Nombre</Label>
                <Input id="orgname" name="name" defaultValue={s.org.name} disabled={!canEdit} maxLength={200} />
              </div>
              {canEdit ? <Button type="submit">Guardar</Button> : null}
            </form>
            <p className="mt-3 text-xs text-muted-foreground">
              Plan: <strong>{s.org.plan_code}</strong> · Tu rol: <strong>{s.role ?? "platform admin"}</strong>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marca (white-label)</CardTitle>
            <CardDescription>
              {s.org.white_label_enabled
                ? "Activado: tus usuarios ven esta marca."
                : "Se guarda, pero solo se muestra cuando el administrador de la plataforma active el white-label."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateBranding} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="b-name">Nombre visible</Label>
                <Input id="b-name" name="name" defaultValue={branding.name} maxLength={80} disabled={!s.can("org.branding")} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="b-logo">URL del logo (https)</Label>
                <Input id="b-logo" name="logo_url" type="url" defaultValue={branding.logo_url} disabled={!s.can("org.branding")} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="b-fav">URL del favicon (https)</Label>
                <Input id="b-fav" name="favicon_url" type="url" defaultValue={branding.favicon_url} disabled={!s.can("org.branding")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-primary">Color principal</Label>
                <Input id="b-primary" name="primary" type="color" defaultValue={branding.colors?.primary ?? "#2563eb"} disabled={!s.can("org.branding")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-accent">Color de acento</Label>
                <Input id="b-accent" name="accent" type="color" defaultValue={branding.colors?.accent ?? "#7c3aed"} disabled={!s.can("org.branding")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-from">Remitente (nombre)</Label>
                <Input id="b-from" name="email_from_name" defaultValue={branding.email_from_name} disabled={!s.can("org.branding")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-fromaddr">Remitente (email)</Label>
                <Input id="b-fromaddr" name="email_from_address" type="email" defaultValue={branding.email_from_address} disabled={!s.can("org.branding")} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="b-support">Email de soporte</Label>
                <Input id="b-support" name="support_email" type="email" defaultValue={branding.support_email} disabled={!s.can("org.branding")} />
              </div>
              {s.can("org.branding") ? (
                <div className="col-span-2">
                  <Button type="submit">Guardar marca</Button>
                </div>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Usuarios</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Table>
              <THead>
                <TR>
                  <TH>Usuario</TH>
                  <TH>Rol</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {(members ?? []).map((m) => {
                  const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { email: string | null; full_name: string | null } | null;
                  const isMe = m.user_id === s.userId;
                  return (
                    <TR key={m.user_id}>
                      <TD>
                        {p?.full_name ?? p?.email}
                        {p?.full_name ? <div className="text-xs text-muted-foreground">{p.email}</div> : null}
                      </TD>
                      <TD>
                        {s.can("members.invite") ? (
                          <form action={changeMemberRole} className="flex gap-2">
                            <input type="hidden" name="userId" value={m.user_id} />
                            <Select name="role" defaultValue={m.role} className="w-32">
                              {s.role === "owner" || s.isPlatformAdmin ? <option value="owner">owner</option> : null}
                              <option value="admin">admin</option>
                              <option value="member">member</option>
                              <option value="viewer">viewer</option>
                            </Select>
                            <Button type="submit" size="sm" variant="outline">
                              Cambiar
                            </Button>
                          </form>
                        ) : (
                          <Badge variant="secondary">{m.role}</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        {isMe || s.can("members.remove") ? (
                          <form action={removeMember}>
                            <input type="hidden" name="userId" value={m.user_id} />
                            <Button type="submit" size="sm" variant="ghost">
                              {isMe ? "Salir" : "Quitar"}
                            </Button>
                          </form>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>

            {s.can("members.invite") ? (
              <>
                <form action={inviteMember} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-64 flex-1 space-y-1.5">
                    <Label htmlFor="inv-email">Invitar por email</Label>
                    <Input id="inv-email" name="email" type="email" required />
                  </div>
                  <Select name="role" defaultValue="member" className="w-32" aria-label="Rol">
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </Select>
                  <Button type="submit">Invitar</Button>
                </form>
                {invitations?.length ? (
                  <Table>
                    <TBody>
                      {invitations.map((i) => (
                        <TR key={i.id}>
                          <TD>{i.email}</TD>
                          <TD>
                            <Badge variant="warning">pendiente · {i.role}</Badge>
                          </TD>
                          <TD className="text-xs text-muted-foreground">caduca {formatDate(i.expires_at)}</TD>
                          <TD className="text-right">
                            <form action={revokeInvitation}>
                              <input type="hidden" name="id" value={i.id} />
                              <Button type="submit" size="sm" variant="ghost">
                                Revocar
                              </Button>
                            </form>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
