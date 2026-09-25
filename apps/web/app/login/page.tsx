import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata = { title: "Acceso" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isSupabaseConfigured()) redirect("/dashboard");
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">DigitalizaTusNegocios AI OS</CardTitle>
          <CardDescription>Accede a tu panel.</CardDescription>
        </CardHeader>
        <CardContent>
          {sp.error === "link" ? <p className="mb-3 text-sm text-danger">El enlace no es válido o ha caducado.</p> : null}
          <LoginForm next={safeNextPath(sp.next)} />
        </CardContent>
      </Card>
    </div>
  );
}
