# Seguridad

Documento vivo: cada fase añade sus controles. Para reportar una vulnerabilidad, escribe a la
dirección de seguridad de la agencia (no abras un *issue* público).

## Modelo de amenazas (resumen)

| Actor | Objetivo | Controles |
|---|---|---|
| Usuario de un cliente | Ver o modificar datos de otro cliente | RLS en todas las tablas, `organization_id` inmutable, tests de RLS en CI |
| Usuario con rol bajo | Escalar privilegios | RBAC en la BD (políticas por rol), privilegios por columna, solo los owners conceden `owner`, siempre queda al menos un owner |
| Cliente | Cambiarse de plan, límites o estado sin pagar | Esas columnas no se pueden actualizar con el rol `authenticated`: solo el Platform Admin, vía servidor |
| Anónimo | Leer datos | Sin privilegios para `anon`, verificado por test |
| Atacante externo | *Open redirect* tras el login | `safeNextPath` solo admite rutas relativas |
| Atacante externo | CSRF | Las Server Actions de Next.js validan `Origin`; cookies `SameSite=Lax` |
| Tenant malicioso | Inyección CSS/HTML vía branding | Solo colores `#rrggbb` y URLs `https://`, validados con zod |

## Fase 2: autenticación y aislamiento

- **Autenticación**: Supabase Auth (contraseña o *magic link*). `getUser()` valida el JWT contra Supabase
  en cada petición (el proxy refresca la cookie). Los mensajes de error no revelan si una cuenta existe.
- **Aislamiento**: `app.can_access(org)` y `app.has_role(org, roles)` (SECURITY DEFINER con `search_path` vacío)
  en las políticas de cada tabla, aplicadas con `app.apply_tenant_policies()` para que todas sean iguales.
- **Organizaciones suspendidas**: sus miembros siguen viendo la organización (para mostrar el aviso), pero no
  sus datos. Esto lo aplica la propia RLS.
- **Platform Admin**: `profiles.is_platform_admin`. No se puede autoasignar (privilegio por columna).
  Las acciones de administración usan el *service role* después de `requirePlatformAdmin()` y dejan una
  entrada explícita en el `audit_log` con el actor.
- **Audit log**: triggers en las tablas sensibles (organizations, memberships, invitations, projects…) que
  registran solo identificadores y columnas cambiadas, nunca contenidos. Solo se puede añadir (sin
  UPDATE/DELETE para usuarios) y sobrevive al borrado de la organización.
- **Invitaciones**: se aceptan únicamente para el email verificado del JWT (`accept_pending_invitations`).
- **Cabeceras HTTP**: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
- **IDs de petición**: el proxy asigna o propaga `x-request-id`, que se incluye en los logs y en el audit.
