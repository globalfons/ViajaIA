import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { requireSession } from "@/lib/session";

export default async function OnboardingPage() {
  const s = await requireSession();
  if (s.org) redirect("/dashboard");
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Aún no perteneces a ninguna organización</CardTitle>
        <CardDescription>
          {s.isPlatformAdmin
            ? "Como administrador de la plataforma puedes crear el primer cliente."
            : "Pide al administrador de tu empresa que te invite con este email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {s.isPlatformAdmin ? (
          <Link href="/admin" className={buttonVariants()}>
            Crear cliente
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{s.email}</p>
        )}
      </CardContent>
    </Card>
  );
}
