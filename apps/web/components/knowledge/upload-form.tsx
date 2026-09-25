"use client";

import { useActionState, useRef } from "react";
import { Upload } from "lucide-react";
import { uploadDocumentsAction, type UploadResult } from "@/lib/actions/knowledge";
import { Button } from "@/components/ui/button";

export function UploadForm({ kbId }: { kbId: string }) {
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(uploadDocumentsAction, null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kbId" value={kbId} />
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground hover:bg-muted/40">
        <Upload className="h-5 w-5" />
        <span>PDF, DOCX, TXT, Markdown, CSV o HTML · máx. 20 MB por fichero · hasta 20 a la vez</span>
        <input ref={input} type="file" name="files" multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.html,.htm" className="text-xs" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Subiendo…" : "Subir e indexar"}
      </Button>
      {state?.uploaded.length ? <p className="text-sm text-success">En cola para indexar: {state.uploaded.join(", ")}</p> : null}
      {state?.errors.map((e) => (
        <p key={e.file} className="text-sm text-danger">
          {e.file}: {e.error}
        </p>
      ))}
    </form>
  );
}
