import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, UserRound } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { conversationStatusAction, replyAction, triageAction } from "@/lib/actions/conversations";
import { CONV_STATUS, PRIORITY } from "@/lib/conversation-ui";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatNumber, formatUsd } from "@/lib/utils";

const OK: Record<string, string> = { sent: "Respuesta enviada.", saved: "Guardado.", open: "Devuelta a la IA.", escalated: "Escalada.", human: "Asumida por el equipo.", closed: "Conversación cerrada." };

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp, s, supabase] = await Promise.all([params, searchParams, requireOrg("conversations.read"), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: c } = await supabase
    .from("conversations")
    .select("id, status, priority, channel_type, visitor_id, escalation_reason, assigned_to, message_count, total_tokens, total_cost_usd, created_at, agent_id, agents(name), contacts(name, email, phone)")
    .eq("id", id)
    .eq("organization_id", s.org.id)
    .maybeSingle();
  if (!c) notFound();
  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content, model, input_tokens, output_tokens, cost_usd, sources, tool_calls, status, error, agent_run_id, created_at, author_id")
    .eq("conversation_id", id)
    .eq("organization_id", s.org.id)
    .order("id");
  const agent = (Array.isArray(c.agents) ? c.agents[0] : c.agents) as { name: string } | null;
  const contact = (Array.isArray(c.contacts) ? c.contacts[0] : c.contacts) as { name: string | null; email: string | null; phone: string | null } | null;
  const st = CONV_STATUS[c.status] ?? CONV_STATUS.open!;
  const canReply = s.can("conversations.reply") && c.status !== "closed";

  return (
    <>
      <AutoRefresh active={c.status !== "closed"} intervalMs={8000} />
      <PageHeader
        title={contact?.name ?? contact?.email ?? `Visitante ${c.visitor_id?.slice(0, 6) ?? ""}`}
        description={`${agent?.name ?? "Sin agente"} · ${c.channel_type} · iniciada ${formatDate(c.created_at)}`}
        actions={<Badge variant={st.variant}>{st.label}</Badge>}
      />
      <Flash message={sp.ok ? OK[sp.ok] : undefined} error={sp.error} />
      {c.escalation_reason && c.status === "escalated" ? (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">Escalada: {c.escalation_reason}</p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 pt-5">
              {(messages ?? []).map((m) => {
                const isCustomer = m.role === "user";
                const sources = (m.sources as { title: string }[] | null) ?? [];
                const tools = (m.tool_calls as { name: string; status: string }[] | null) ?? [];
                return (
                  <div key={m.id} className={`flex gap-2 ${isCustomer ? "" : "flex-row-reverse"}`}>
                    {isCustomer ? <UserRound className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : m.role === "human_agent" ? <UserRound className="mt-1 h-4 w-4 shrink-0 text-primary" /> : <Bot className="mt-1 h-4 w-4 shrink-0 text-primary" />}
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${isCustomer ? "bg-muted" : m.role === "human_agent" ? "border border-primary/30 bg-primary/5" : "bg-primary/10"}`}>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        <span>{formatDate(m.created_at)}</span>
                        {m.role === "human_agent" ? <span>· equipo</span> : null}
                        {m.model ? <span className="font-mono">· {m.model}</span> : null}
                        {m.role === "assistant" ? <span>· {formatNumber(m.input_tokens + m.output_tokens)} tokens · {formatUsd(Number(m.cost_usd))}</span> : null}
                        {m.status === "failed" ? <span className="text-danger">· fallo IA: {m.error}</span> : null}
                      </div>
                      {sources.length ? <p className="mt-1 text-[11px] text-muted-foreground">Fuentes: {sources.map((x, i) => `[${i + 1}] ${x.title}`).join(" · ")}</p> : null}
                      {tools.length ? <p className="mt-0.5 text-[11px] text-muted-foreground">Tools: {tools.map((t) => `${t.name} (${t.status})`).join(", ")}</p> : null}
                    </div>
                  </div>
                );
              })}
              {messages?.length ? null : <p className="text-sm text-muted-foreground">Sin mensajes.</p>}
            </CardContent>
          </Card>
          {canReply ? (
            <form action={replyAction} className="space-y-2">
              <input type="hidden" name="conversationId" value={c.id} />
              <Textarea name="text" rows={3} required maxLength={8000} placeholder="Responder como equipo (la IA dejará de responder en esta conversación)…" aria-label="Respuesta" />
              <Button type="submit">Enviar respuesta</Button>
            </form>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Detalles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {contact?.email ? <p>Email: {contact.email}</p> : null}
              {contact?.phone ? <p>Teléfono: {contact.phone}</p> : null}
              <p>Mensajes: {c.message_count}</p>
              <p>Tokens: {formatNumber(c.total_tokens)}</p>
              <p>Coste IA: {formatUsd(Number(c.total_cost_usd))}</p>
              <p>Prioridad: {PRIORITY[c.priority]?.label}</p>
              {c.agent_id ? (
                <p>
                  Agente: <Link href={`/agents/${c.agent_id}`} className="underline">{agent?.name}</Link>
                </p>
              ) : null}
            </CardContent>
          </Card>
          {s.can("conversations.reply") ? (
            <Card>
              <CardHeader>
                <CardTitle>Gestión</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form action={triageAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="conversationId" value={c.id} />
                  <Select name="priority" defaultValue={c.priority} className="w-32" aria-label="Prioridad">
                    {Object.entries(PRIORITY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="assign" value="me" defaultChecked={c.assigned_to === s.userId} /> Asignármela
                  </label>
                  <Button type="submit" size="sm" variant="outline">
                    Guardar
                  </Button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {(c.status === "open" ? ["escalated", "closed"] : c.status === "closed" ? ["open"] : ["open", "closed"]).map((st2) => (
                    <form key={st2} action={conversationStatusAction}>
                      <input type="hidden" name="conversationId" value={c.id} />
                      <input type="hidden" name="status" value={st2} />
                      <Button type="submit" size="sm" variant={st2 === "closed" ? "outline" : "secondary"}>
                        {st2 === "open" ? "Devolver a la IA" : st2 === "escalated" ? "Escalar a humano" : st2 === "closed" ? "Cerrar" : st2}
                      </Button>
                    </form>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
