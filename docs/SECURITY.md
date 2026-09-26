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

## Canales externos, credenciales y límites

- **Webhooks de WhatsApp**: firma `X-Hub-Signature-256` obligatoria (comparación en tiempo constante). El cliente se
  identifica por `phone_number_id`, nunca por el contenido, y un número solo puede pertenecer a una organización.
  Además, se comprueba en Meta que el token del cliente puede operar ese número antes de enlazarlo.
- **Webhook de email**: un token por canal (solo se guarda su SHA-256, se compara en tiempo constante), límite de
  tamaño y rate limit por remitente.
- **Procesado idempotente**: `messages(organization_id, external_id)` es único y los trabajos del worker cargan el canal
  filtrando por la organización del trabajo.
- **Sin contacto no solicitado**: solo se responde a conversaciones iniciadas por el cliente (ventana de 24 h en
  WhatsApp). Los emails se quedan en borrador salvo que el cliente active el envío automático; nunca se responde a
  correos automáticos, y hay un límite horario contra bucles.
- **Credenciales**: AES-256-GCM con AAD `orgId/nombre` y rotación de claves. Owners y admins solo ven los metadatos.
- **CRM**: la base legal RGPD es obligatoria en cada lead y el consentimiento de marketing se registra con su fecha.
  La plataforma no envía comunicaciones comerciales.
- **Límites**: el cliente no puede cambiar su plan, sus límites ni su política (privilegios por columna). Las
  aprobaciones de límite las escribe solo el servidor tras `requirePlatformAdmin()`.
