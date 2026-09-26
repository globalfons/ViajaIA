import type { ReactNode } from "react";
import { formatMoney } from "@dtn/core/billing/stripe";
import {
  listContactRequests,
  platformAgents,
  platformAudit,
  platformBilling,
  platformConversations,
  platformErrors,
  platformLeads,
  platformTemplates,
  platformUsers,
  platformWorkflowRuns,
} from "@dtn/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { contactStatusAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { formatDate, formatUsd } from "@/lib/utils";
import { SUB_STATUS } from "@/lib/billing-ui";

function DataCard({ title, description, head, rows, empty, children }: { title: string; description?: string; head: string[]; rows: ReactNode[][]; empty: string; children?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {children}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              {head.map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {r.map((cell, j) => (
                  <TD key={j} className="align-top text-sm">
                    {cell}
                  </TD>
                ))}
              </TR>
            ))}
            {rows.length ? null : (
              <TR>
                <TD colSpan={head.length} className="py-6 text-center text-muted-foreground">
                  {empty}
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const muted = (v: string | null | undefined) => <span className="text-muted-foreground">{v ?? "—"}</span>;
const clip = (v: string | null | undefined, n = 140) => (v ? (v.length > n ? `${v.slice(0, n)}…` : v) : "—");

export async function ListTab({ tab, q }: { tab: string; q?: string }) {
  const d = db();
  switch (tab) {
    case "users": {
      const rows = await platformUsers(d, q);
      return (
        <DataCard
          title="Usuarios"
          head={["Email", "Nombre", "Organizaciones", "Alta"]}
          empty="Sin usuarios"
          rows={rows.map((u) => [
            <span key="e">
              {u.email} {u.is_platform_admin ? <Badge className="ml-1">platform admin</Badge> : null}
            </span>,
            muted(u.full_name),
            (u.orgs ?? []).map((o) => `${o.name} (${o.role})`).join(", ") || "—",
            formatDate(u.created_at),
          ])}
        >
          <form className="flex gap-2 pt-2" action="/admin">
            <input type="hidden" name="tab" value="users" />
            <Input name="q" defaultValue={q} placeholder="Buscar por email o nombre" aria-label="Buscar usuarios" className="max-w-xs" />
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </form>
        </DataCard>
      );
    }
    case "agents": {
      const rows = await platformAgents(d);
      return (
        <DataCard
          title="Agentes"
          description="Todos los agentes no archivados. Consumo del mes en curso."
          head={["Agente", "Cliente", "Estado", "Modelo", "Ejecuciones", "Coste"]}
          empty="Sin agentes"
          rows={rows.map((a) => [a.name, a.organization, <Badge key="s" variant={a.status === "active" ? "success" : "secondary"}>{a.status}</Badge>, <code key="m" className="text-xs">{a.model ?? "—"}</code>, a.runs_month, formatUsd(Number(a.cost_month))])}
        />
      );
    }
    case "workflows": {
      const rows = await platformWorkflowRuns(d);
      return (
        <DataCard
          title="Ejecuciones de workflows"
          head={["Workflow", "Cliente", "Estado", "Inicio", "Fin", "Error"]}
          empty="Sin ejecuciones"
          rows={rows.map((r) => [r.workflow, r.organization, <Badge key="s" variant={r.status === "completed" ? "success" : r.status === "failed" ? "danger" : "secondary"}>{r.status}</Badge>, formatDate(r.created_at), r.finished_at ? formatDate(r.finished_at) : "—", muted(clip(r.error))])}
        />
      );
    }
    case "conversations": {
      const rows = await platformConversations(d);
      return (
        <DataCard
          title="Conversaciones"
          description="Metadatos de todas las conversaciones. El contenido solo se consulta dentro del panel del cliente."
          head={["Cliente", "Canal", "Estado", "Motivo de escalado", "Mensajes", "Coste", "Última actividad"]}
          empty="Sin conversaciones"
          rows={rows.map((c) => [c.organization, c.channel_type, c.status, muted(clip(c.escalation_reason, 80)), c.message_count, formatUsd(Number(c.total_cost_usd)), c.last_message_at ? formatDate(c.last_message_at) : "—"])}
        />
      );
    }
    case "leads": {
      const rows = await platformLeads(d);
      return (
        <DataCard
          title="Leads"
          head={["Lead", "Cliente", "Etapa", "Puntuación", "Origen", "Alta"]}
          empty="Sin leads"
          rows={rows.map((l) => [l.title, l.organization, l.stage, l.score ?? "—", l.source, formatDate(l.created_at)])}
        />
      );
    }
    case "errors": {
      const rows = await platformErrors(d);
      return (
        <DataCard
          title="Errores"
          description="Ejecuciones fallidas de agentes y workflows, trabajos del worker agotados y entregas fallidas por WhatsApp o email."
          head={["Tipo", "Cliente", "Error", "Fecha"]}
          empty="Sin errores registrados"
          rows={rows.map((e) => [<code key="k" className="text-xs">{e.kind}</code>, e.organization ?? "—", muted(clip(e.error, 200)), formatDate(e.created_at)])}
        />
      );
    }
    case "audit": {
      const rows = await platformAudit(d, { action: q });
      return (
        <DataCard
          title="Auditoría"
          head={["Fecha", "Cliente", "Actor", "Acción", "Objeto"]}
          empty="Sin entradas"
          rows={rows.map((a) => [formatDate(a.created_at), a.organization ?? "Plataforma", `${a.actor ?? a.actor_type}`, <code key="a" className="text-xs">{a.action}</code>, muted(a.target_type ? `${a.target_type} ${a.target_id ?? ""}` : null)])}
        >
          <form className="flex gap-2 pt-2" action="/admin">
            <input type="hidden" name="tab" value="audit" />
            <Input name="q" defaultValue={q} placeholder="Filtrar por acción (p. ej. channel.)" aria-label="Filtrar auditoría" className="max-w-xs" />
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
          </form>
        </DataCard>
      );
    }
    case "billing": {
      const b = await platformBilling(d);
      return (
        <div className="space-y-6">
          {!process.env.STRIPE_SECRET_KEY ? <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">Stripe no está configurado (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET).</p> : null}
          <DataCard
            title="Suscripciones"
            head={["Cliente", "Plan", "Estado", "Periodo actual hasta"]}
            empty="Sin suscripciones"
            rows={b.subscriptions.map((x) => [x.organization, x.plan_code ?? "—", `${SUB_STATUS[x.status]?.label ?? x.status}${x.cancel_at_period_end ? " (cancela al final del periodo)" : ""}`, x.current_period_end ? formatDate(x.current_period_end) : "—"])}
          />
          <DataCard
            title="Facturas"
            head={["Cliente", "Número", "Estado", "Importe", "Fecha", ""]}
            empty="Sin facturas"
            rows={b.invoices.map((i) => [
              i.organization,
              i.number ?? "—",
              i.status,
              formatMoney(Number(i.status === "paid" ? i.amount_paid : i.amount_due), i.currency),
              formatDate(i.paid_at ?? i.created_at),
              i.hosted_invoice_url ? (
                <a key="u" href={i.hosted_invoice_url} target="_blank" rel="noreferrer" className="underline">
                  Ver
                </a>
              ) : (
                ""
              ),
            ])}
          />
        </div>
      );
    }
    case "templates": {
      const rows = await platformTemplates(d);
      return (
        <DataCard
          title="Plantillas guardadas"
          description="Plantillas creadas desde los editores de agentes y workflows. El catálogo de soluciones (SOL-…) está en Soluciones."
          head={["Nombre", "Tipo", "Categoría", "Ámbito", "Alta"]}
          empty="Sin plantillas guardadas"
          rows={rows.map((t) => [t.name, t.kind, t.category ?? "—", t.organization ?? "Global (plataforma)", formatDate(t.created_at)])}
        />
      );
    }
    case "contacts": {
      const rows = await listContactRequests(d, q && ["new", "contacted", "closed", "spam"].includes(q) ? q : undefined);
      const STATUS: Record<string, string> = { new: "Nueva", contacted: "Contactada", closed: "Cerrada", spam: "Spam" };
      return (
        <DataCard
          title="Solicitudes de contacto"
          description="Enviadas desde el formulario público. Nadie recibe correos automáticos: respóndelas tú."
          head={["Fecha", "Persona", "Interés", "Mensaje", "Marketing", "Estado"]}
          empty="Sin solicitudes"
          rows={rows.map((r) => [
            formatDate(r.created_at),
            <span key="p">
              <span className="font-medium">{r.name}</span>
              <br />
              <a href={`mailto:${r.email}`} className="underline">
                {r.email}
              </a>
              {r.company ? <span className="block text-muted-foreground">{r.company}</span> : null}
              {r.phone ? <span className="block text-muted-foreground">{r.phone}</span> : null}
            </span>,
            r.interest ?? "—",
            <span key="m" className="block max-w-md whitespace-pre-wrap">
              {clip(r.message, 600)}
            </span>,
            r.marketing_consent ? "Sí" : "No",
            <form key="s" action={contactStatusAction} className="flex items-center gap-1">
              <input type="hidden" name="id" value={r.id} />
              <select name="status" defaultValue={r.status} aria-label="Estado de la solicitud" className="h-8 rounded-md border bg-transparent px-2 text-xs">
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline" className="h-8">
                Guardar
              </Button>
            </form>,
          ])}
        >
          <div className="flex flex-wrap gap-2 pt-2 text-sm">
            {[["", "Todas"], ["new", "Nuevas"], ["contacted", "Contactadas"], ["closed", "Cerradas"], ["spam", "Spam"]].map(([k, v]) => (
              <a key={k} href={k ? `/admin?tab=contacts&q=${k}` : "/admin?tab=contacts"} className={`rounded-full border px-3 py-1 ${(q ?? "") === k ? "bg-foreground text-background" : ""}`}>
                {v}
              </a>
            ))}
          </div>
        </DataCard>
      );
    }
    default:
      return null;
  }
}
