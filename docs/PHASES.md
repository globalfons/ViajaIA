# Estado por fases

## Fase 0: Auditoría y arquitectura ✅
Ver [AUDIT.md](AUDIT.md).

## Fase 1: Core SaaS ✅
**Implementado**
- Monorepo pnpm (`apps/web`, `apps/worker`, `packages/core`, `packages/db`) con TypeScript estricto.
- Next.js 16 + Tailwind 4 + componentes shadcn/ui; layout con sidebar y tokens de marca listos para white-label.
- Dashboard con el estado real de la configuración del sistema (solo booleanos, nunca valores).
- Cabeceras de seguridad HTTP (HSTS, nosniff, frame DENY, Referrer-Policy, Permissions-Policy).
- `config/env`: validación de entorno por `APP_ENV`, que en staging/producción no arranca si falta algo crítico.
- `observability/logger`: logs JSON con IDs de correlación, redacción de secretos y *hooks* para Sentry/OTel.
- `packages/db`: pool de Postgres y *runner* de migraciones.
- Dockerfiles (web *standalone* y worker, usuario no-root) y `docker-compose.yml` (sin Redis: la cola va en Postgres).
- `.env.example` sin valores; README, CONTRIBUTING y THIRD_PARTY_NOTICES.

**Tests:** 9 en verde (core: 6, web: 3). Typecheck en verde en los 4 paquetes. `next build` en verde. `pnpm audit`: 0 vulnerabilidades.
**Tests fallidos:** ninguno.
**Riesgos pendientes:** las imágenes Docker no se han construido todavía en CI (se hará en la fase 13).
**Siguiente:** Fase 2, Auth + multi-tenancy + RLS.

## Fase 2: Auth + multi-tenancy + RLS ✅
**Implementado**
- Migración `0001_tenancy.sql`: `plans` (sin precios), `platform_settings`, `organizations` (estado, plan, límites,
  branding, white-label), `profiles`, `memberships` (owner/admin/member/viewer), `invitations`, `projects` y `audit_logs`.
- Kit de RLS reutilizable (`app.apply_tenant_policies`): select para miembros, escritura por roles,
  `organization_id` inmutable, `updated_at` y audit automáticos.
- RPCs: `create_organization` (solo Platform Admin salvo auto-registro activado) y `accept_pending_invitations`.
- Web: login (contraseña y *magic link*), callback, proxy con refresco de sesión e IDs de petición, selector de
  organización, *onboarding*.
- **Clients**: listado y alta (Platform Admin) con invitación al responsable. Ficha con bloqueo/reactivación,
  plan, límites (JSON validado), activación del white-label, usuarios y audit log.
- **Settings**: nombre, branding white-label (validado), usuarios, roles, invitaciones y revocación.
- **Platform Admin**: KPIs de clientes, gestión de planes (código, nombre, `price_…` de Stripe, límites), auto-registro.
- Core: RBAC (`security/rbac`) y límites (`billing/limits`). Branding con protección contra inyección CSS.
- CI de GitHub Actions con Postgres + pgvector para ejecutar los tests de RLS.

**Tests:** 57 en verde. Core: 17 (env, logger, rbac, limits). Web: 18 (auth gate del proxy, branding, *open redirect*,
estado del sistema). BD: 22 (18 de RLS/tenancy + 4 de invariantes de migraciones: RLS en todas las tablas, políticas y
sin privilegios para `anon`). `next build` en verde.
**Tests fallidos:** ninguno.
**Riesgos pendientes:**
- No hay E2E contra Supabase Auth real (GoTrue): llegará en la fase 12 con `supabase start` en CI.
- Rate limiting del login: por ahora depende del límite de Supabase Auth; el propio llega en la fase 11.
**Siguiente:** Fase 3, Agent runtime.
