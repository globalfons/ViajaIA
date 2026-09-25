"use client";

import { useRef, useState, useTransition } from "react";
import { Bot, Send, ShieldAlert, User } from "lucide-react";
import { decideRunAction, playgroundSendAction, type PlaygroundReply } from "@/lib/actions/agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { RUN_STATUS_VARIANT } from "@/lib/status";

type Result = NonNullable<PlaygroundReply["result"]>;
interface Turn {
  role: "user" | "assistant";
  content: string;
  runId?: string;
  result?: Result;
}

const usd = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 5 }).format(v);

/** Renders the assistant text: structured answers show their `answer`/`reply` field. */
function displayText(r: Result): string {
  const s = r.structured as Record<string, unknown> | null | undefined;
  if (s && typeof s.answer === "string") return s.answer;
  if (s && typeof s.reply === "string") return s.reply;
  return r.output || r.error || "";
}

export function Playground({ agentId, canRun, canApprove }: { agentId: string; canRun: boolean; canApprove: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);

  const apply = (reply: PlaygroundReply, replaceRunId?: string) => {
    if (reply.error || !reply.result) {
      setError(reply.error ?? "Error");
      return;
    }
    const r = reply.result;
    setTurns((prev) => {
      const next = replaceRunId ? prev.filter((t) => t.runId !== replaceRunId) : prev;
      return [...next, { role: "assistant", content: displayText(r), runId: reply.runId, result: r }];
    });
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth" }));
  };

  const send = () => {
    const message = input.trim();
    if (!message || pending) return;
    setError(null);
    setInput("");
    const history = turns
      .filter((t) => t.content && t.result?.status !== "needs_approval")
      .map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    start(async () => apply(await playgroundSendAction(agentId, message, history)));
  };

  const decide = (runId: string, approved: boolean) => {
    setError(null);
    start(async () => {
      apply(await decideRunAction(runId, approved, note || undefined), runId);
      setNote("");
    });
  };

  return (
    <Card className="flex h-[calc(100vh-10rem)] flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Playground</CardTitle>
        {turns.length ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setTurns([])}>
            Reiniciar
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {turns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Prueba el agente con la configuración guardada. Las ejecuciones cuentan en el consumo.
            </p>
          ) : null}
          {turns.map((t, i) => (
            <div key={i} className={`flex gap-2 ${t.role === "user" ? "justify-end" : ""}`}>
              {t.role === "assistant" ? <Bot className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : null}
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${t.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {/* Plain text rendering: model output is never injected as HTML. */}
                {t.content ? <p className="whitespace-pre-wrap">{t.content}</p> : null}
                {t.result ? <RunDetails result={t.result} /> : null}
                {t.result?.status === "needs_approval" && t.result.pendingApproval && t.runId ? (
                  <div className="mt-2 space-y-2 rounded-md border border-warning/40 bg-background p-2">
                    <p className="flex items-center gap-1 text-xs font-medium text-warning">
                      <ShieldAlert className="h-3.5 w-3.5" /> El agente quiere ejecutar <code>{t.result.pendingApproval.toolName}</code>
                    </p>
                    <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(t.result.pendingApproval.args, null, 2)}</pre>
                    {canApprove ? (
                      <>
                        <Input placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                        <div className="flex gap-2">
                          <Button type="button" size="sm" disabled={pending} onClick={() => decide(t.runId!, true)}>
                            Aprobar
                          </Button>
                          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(t.runId!, false)}>
                            Rechazar
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tienes permiso para aprobar acciones.</p>
                    )}
                  </div>
                ) : null}
              </div>
              {t.role === "user" ? <User className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : null}
            </div>
          ))}
          {pending ? <p className="text-xs text-muted-foreground">Pensando…</p> : null}
          <div ref={bottom} />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            rows={2}
            value={input}
            disabled={!canRun}
            placeholder={canRun ? "Escribe un mensaje…" : "No tienes permiso para ejecutar agentes"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" size="icon" disabled={!canRun || pending || !input.trim()} aria-label="Enviar">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RunDetails({ result }: { result: Result }) {
  return (
    <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={RUN_STATUS_VARIANT[result.status] ?? "secondary"}>{result.status}</Badge>
        {result.model ? <span className="font-mono">{result.model}</span> : null}
        <span>
          · {result.usage.inputTokens + result.usage.outputTokens} tokens · {usd(result.usage.costUsd)} · {result.steps} pasos
        </span>
      </div>
      {result.flags.injection.length ? <p className="text-warning">Posible prompt injection detectado ({result.flags.injection.map((f) => f.pattern).join(", ")})</p> : null}
      {result.toolInvocations.length ? (
        <p>
          Tools:{" "}
          {result.toolInvocations.map((t) => (
            <span key={t.toolCallId} className="mr-1 font-mono">
              {t.name}({t.status})
            </span>
          ))}
        </p>
      ) : null}
      {result.sources.length ? <p>Fuentes: {result.sources.map((s, i) => `[${i + 1}] ${s.title}`).join(" · ")}</p> : null}
      {result.structured ? (
        <details>
          <summary className="cursor-pointer">Salida estructurada</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2">{JSON.stringify(result.structured, null, 2)}</pre>
        </details>
      ) : null}
      {result.error ? <p className="text-danger">{result.error}</p> : null}
    </div>
  );
}
