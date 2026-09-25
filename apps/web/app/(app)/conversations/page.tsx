import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CONV_STATUS, PRIORITY } from "@/lib/conversation-ui";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatUsd } from "@/lib/utils";

export const metadata = { title: "Conversations" };
const PAGE = 50;

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("conversations.read"), searchParams, createSupabaseServerClient()]);
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = supabase
    .from("conversations")
    .select("id, status, priority, channel_type, message_count, total_cost_usd, last_message_at, escalation_reason, visitor_id, agents(name), contacts(name, email)", { count: "exact" })
    .eq("organization_id", s.org.id)
    .order("last_message_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (sp.status && sp.status in CONV_STATUS) q = q.eq("status", sp.status);
  if (sp.priority && sp.priority in PRIORITY) q = q.eq("priority", sp.priority);
  if (sp.channel && /^(web|whatsapp|email|api|playground)$/.test(sp.channel)) q = q.eq("channel_type", sp.channel);
  if (sp.agent && /^[0-9a-f-]{36}$/i.test(sp.agent)) q = q.eq("agent_id", sp.agent);
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q = q.gte("last_message_at", sp.from);
  const [{ data: rows, count }, { data: agents }, { count: waiting }] = await Promise.all([
    q,
    supabase.from("agents").select("id, name").eq("organization_id", s.org.id).neq("status", "archived").order("name"),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", s.org.id).eq("status", "escalated"),
  ]);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/conversations?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Todas las conversaciones de tus agentes con clientes."
        actions={waiting ? <Link href={qs({ status: "escalated", page: undefined })} className={buttonVariants({ variant: "outline" })}>{waiting} esperando a una persona</Link> : null}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/conversations">
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Estado" className="w-40">
          <option value="">Todos los estados</option>
          {Object.entries(CONV_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select name="agent" defaultValue={sp.agent ?? ""} aria-label="Agente" className="w-44">
          <option value="">Todos los agentes</option>
          {(agents ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select name="channel" defaultValue={sp.channel ?? ""} aria-label="Canal" className="w-36">
          <option value="">Todos los canales</option>
          {["web", "whatsapp", "email", "api"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select name="priority" defaultValue={sp.priority ?? ""} aria-label="Prioridad" className="w-36">
          <option value="">Cualquier prioridad</option>
          {Object.entries(PRIORITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} aria-label="Desde" className="w-40" />
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
        {Object.keys(sp).length ? (
          <Link href="/conversations" className={buttonVariants({ variant: "ghost" })}>
            Limpiar
          </Link>
        ) : null}
      </form>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Agente</TH>
                <TH>Estado</TH>
                <TH>Prioridad</TH>
                <TH>Canal</TH>
                <TH className="text-right">Mensajes</TH>
                <TH className="text-right">Coste</TH>
                <TH>Última actividad</TH>
              </TR>
            </THead>
            <TBody>
              {(rows ?? []).map((c) => {
                const agent = (Array.isArray(c.agents) ? c.agents[0] : c.agents) as { name: string } | null;
                const contact = (Array.isArray(c.contacts) ? c.contacts[0] : c.contacts) as { name: string | null; email: string | null } | null;
                const st = CONV_STATUS[c.status] ?? CONV_STATUS.open!;
                const pr = PRIORITY[c.priority] ?? PRIORITY.normal!;
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/conversations/${c.id}`} className="font-medium hover:underline">
                        {contact?.name ?? contact?.email ?? `Visitante ${c.visitor_id?.slice(0, 6) ?? ""}`}
                      </Link>
                      {c.escalation_reason ? <div className="line-clamp-1 max-w-xs text-xs text-warning">{c.escalation_reason}</div> : null}
                    </TD>
                    <TD className="text-xs">{agent?.name ?? "—"}</TD>
                    <TD>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TD>
                    <TD>
                      <Badge variant={pr.variant}>{pr.label}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">{c.channel_type}</TD>
                    <TD className="text-right text-xs">{c.message_count}</TD>
                    <TD className="text-right text-xs">{formatUsd(Number(c.total_cost_usd))}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(c.last_message_at)}</TD>
                  </TR>
                );
              })}
              {rows?.length ? null : (
                <TR>
                  <TD colSpan={8} className="py-12 text-center text-muted-foreground">
                    {Object.keys(sp).length ? "Ninguna conversación coincide con los filtros." : "Aún no hay conversaciones. Activa un canal (Integrations → Chat web) para empezar a recibirlas."}
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {(count ?? 0) > PAGE ? (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, count ?? 0)} de {count}
          </span>
          <div className="flex gap-2">
            {page > 0 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(page - 1) })}>Anterior</Link> : null}
            {(page + 1) * PAGE < (count ?? 0) ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(page + 1) })}>Siguiente</Link> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
