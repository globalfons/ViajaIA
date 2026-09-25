"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Error boundary for dashboard pages: never shows stack traces to users. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">No se ha podido cargar esta página</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ha ocurrido un error inesperado. Vuelve a intentarlo; si persiste, comparte este código con soporte:{" "}
        <code className="rounded bg-muted px-1">{error.digest ?? "—"}</code>
      </p>
      <Button className="mt-6" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
