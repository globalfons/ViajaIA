import { LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { switchOrganization } from "@/lib/actions/org";
import type { OrgSummary } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrgSelect } from "./org-select";

export function Topbar({
  org,
  organizations,
  email,
  isPlatformAdmin,
}: {
  org: OrgSummary | null;
  organizations: OrgSummary[];
  email: string | null;
  isPlatformAdmin: boolean;
}) {
  const options = [...organizations];
  if (org && !options.some((o) => o.id === org.id)) options.unshift(org);
  return (
    <header className="flex h-14 items-center justify-between gap-2 px-2 sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {options.length > 0 ? (
          <form action={switchOrganization}>
            <OrgSelect current={org?.id ?? ""} options={options.map((o) => ({ id: o.id, name: o.name }))} />
          </form>
        ) : null}
        {org?.status === "suspended" ? <Badge variant="danger">Suspendida</Badge> : null}
        {org && !org.role && isPlatformAdmin ? <Badge variant="warning" className="hidden sm:inline-flex">Vista de administrador</Badge> : null}
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {isPlatformAdmin ? <Badge className="hidden md:inline-flex">Platform admin</Badge> : null}
        <span className="hidden sm:inline">{email}</span>
        <form action={signOut}>
          <Button variant="ghost" size="icon" aria-label="Cerrar sesión" type="submit">
            <LogOut className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
