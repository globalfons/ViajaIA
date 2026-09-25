"use client";

import { useState, useTransition } from "react";
import type { RetrievedChunk } from "@dtn/core/agents/runtime";
import { searchKnowledgeAction } from "@/lib/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Lets users check what the agent will retrieve for a question. */
export function SearchTester({ kbId }: { kbId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RetrievedChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await searchKnowledgeAction(kbId, q);
            setError(r.error ?? null);
            setHits(r.hits ?? null);
          });
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe una pregunta de un cliente…" maxLength={1000} aria-label="Consulta" />
        <Button type="submit" disabled={pending || !q.trim()}>
          {pending ? "Buscando…" : "Buscar"}
        </Button>
      </form>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {hits && hits.length === 0 ? <p className="text-sm text-muted-foreground">Sin resultados. ¿Están los documentos indexados?</p> : null}
      {hits?.map((h, i) => (
        <div key={h.id} className="rounded-md border p-3 text-sm">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>
              [{i + 1}] {h.title}
            </span>
            <span>score {h.score.toFixed(4)}</span>
          </div>
          <p className="line-clamp-4 whitespace-pre-wrap">{h.content}</p>
        </div>
      ))}
    </div>
  );
}
