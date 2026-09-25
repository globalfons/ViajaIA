import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSystemStatus } from "@/lib/system-status";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const status = getSystemStatus();
  const missingRequired = status.filter((s) => s.required && !s.configured);

  return (
    <>
      <PageHeader title="Dashboard" description="Estado de la plataforma y actividad de tus clientes." />
      <Card>
        <CardHeader>
          <CardTitle>Configuración del sistema</CardTitle>
          <CardDescription>
            {missingRequired.length === 0
              ? "Todos los servicios obligatorios están configurados."
              : `Faltan ${missingRequired.length} servicios obligatorios. Consulta .env.example y docs/DEPLOYMENT.md.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {status.map((s) => (
              <li key={s.key} className="flex items-center gap-3 py-2 text-sm">
                {s.configured ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : s.required ? (
                  <CircleAlert className="h-4 w-4 text-danger" />
                ) : (
                  <CircleDashed className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1">{s.label}</span>
                <code className="hidden text-xs text-muted-foreground md:block">{s.hint}</code>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
