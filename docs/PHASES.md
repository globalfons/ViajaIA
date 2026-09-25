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

## Fase 3: Agent runtime ✅
**Implementado**
- **LLM Router** (`core/llm`): OpenAI, xAI, DeepSeek y OpenRouter (formato Chat Completions), Anthropic Messages y
  Gemini, con `fetch` directo. Referencias `proveedor:modelo`, reintentos con *backoff* solo en errores reintentables,
  cadena de *fallback*, *timeout*, *structured output* (JSON Schema; en Anthropic mediante una tool forzada) y embeddings por lotes.
- **Costes**: los precios salen de `llm_models` (gestionados por el Platform Admin; no se inventan). Los modelos sin
  precio se marcan como «sin precio».
- **Uso**: una fila en `usage_events` por llamada (también las fallidas), con organización, agente, workflow, conversación,
  tokens, coste, latencia y `request_id`.
- **Presupuesto** (`BudgetGuard`): antes de cada llamada comprueba que la organización esté activa, el coste y los tokens
  mensuales (plan + override) y el presupuesto mensual del agente.
- **Agent runtime**: bucle con tools, `maxSteps`, coste máximo por ejecución, *timeout*, memoria (últimos N mensajes),
  plantillas `{{variable}}`, RAG inyectado como contenido no confiable y citable, y *structured output* con escalado por
  confianza.
- **Aprobación humana**: pausa con estado serializable y reanudación (aprobar o rechazar). Si la decisión no corresponde
  a la tool pendiente, se rechaza.
- **Tools**: registro con allowlist por agente (lo no permitido es invisible para el modelo y se rechaza si lo llama),
  validación zod, *timeout*, nivel de riesgo y resultados truncados y redactados. Built-ins: `current_datetime` y `http_get`
  (este último exige allowlist de hosts por agente).
- **Guardrails**: detección heurística de *prompt injection* (ES/EN) con modo flag o block, delimitación `<untrusted>`
  a prueba de cierre prematuro, temas bloqueados, aviso de IA (art. 50 del Reglamento de IA de la UE) y redacción de
  secretos y PII (DNI/NIE/IBAN/teléfono/email) en logs.
- **SSRF**: solo HTTPS, bloqueo de IPs privadas/metadata/IPv6 mapeadas/hosts numéricos, validación en el momento de
  conectar (anti DNS-rebinding con `lookup` propio en undici), redirecciones re-validadas y límite de tamaño y tiempo.
- Migración `0002_agents_usage.sql`: `llm_models`, `agents` (versionado automático en `agent_versions`), `usage_events`,
  `tool_invocations`, vista `usage_daily` (`security_invoker`) y `app.month_usage`.
- **UI**: Usage (coste y tokens frente a límites, por modelo y por agente, últimos errores, aviso de modelos sin precio),
  Analytics (coste y tokens diarios, 30 días, con tabla accesible), catálogo de Modelos en Platform Admin y KPIs de IA en el Dashboard.

**Tests:** 190 en verde. Core: 119 (proveedores a nivel de *wire format*, router, runtime, guardrails, SSRF, tools, config).
Web: 20. BD: 30 (añadidos: versionado de agentes, uso atribuido al tenant, usage no falsificable, presupuestos
mensuales de organización y agente, organización suspendida, todas las vistas con `security_invoker`).
Ningún test llama a APIs reales (proveedores simulados con `FakeProvider` y `mockFetch`).
**Tests fallidos:** ninguno.
**Riesgos pendientes:**
- La detección de *prompt injection* es heurística: la defensa real es la allowlist + la aprobación humana + no tener
  secretos en el prompt.
- Sin *streaming* de respuestas todavía (el playground de la fase 4 usará respuesta completa).
- La caché de `BudgetGuard` (15 s) permite un pequeño sobreconsumo en ráfagas concurrentes.
**Siguiente:** Fase 4, Agent Builder (UI + API + playground + plantillas).

## Fase 4: Agent Builder ✅
**Implementado**
- **Plantillas integradas** (`core/templates`): Customer Support, Receptionist, Sales Agent, Lead Qualification
  (BANT + puntuación), Document/RAG Assistant, Internal Knowledge, Appointment, Marketing, WhatsApp y Voice, con
  requisitos pendientes indicados. El Sales Agent prohíbe expresamente iniciar contactos no solicitados.
- **Create from Template**: galería con plantillas integradas, de la agencia (globales) y del cliente, más «en blanco».
- **Editor de agentes**: prompt, modelo y fallbacks, temperatura, allowlist de tools con aprobación por tool, hosts para
  `http_get`, memoria, guardrails, aprobación y escalado, límites y structured output (JSON Schema validado).
- **Playground**: chat con estado, modelo, tokens, coste, pasos, tools, fuentes, salida estructurada, aviso de inyección
  y **aprobación o rechazo de acciones**. El estado pausado vive en el servidor (`agent_runs.state`, sin permiso de lectura
  para los usuarios) y se reanuda de forma atómica (sin doble ejecución).
- Versionado con restauración, archivado y **Guardar como plantilla** (de la organización o global de la agencia).
- Migración `0003`: `templates` (RLS: globales solo para el Platform Admin), `agent_runs`, `api_keys` (hash, scopes,
  caducidad, solo se puede revocar) y `rate_limits` + `app.rate_limit_hit`.
- **API v1** con OpenAPI 3 generado desde zod: agentes (CRUD), ejecuciones, decisiones de aprobación y uso.
  Autenticación por API key, scopes, rate limit por plan, errores tipados y `x-request-id`.
- Gestión de API keys en Settings (se muestra una sola vez; revocación).

**Tests:** 264 en verde. Core: 131. Web: 35, incluidos **11 tests de API** con rutas reales, Postgres real y un servidor
local con formato OpenAI (401/403/402/404/415/429, aislamiento entre tenants, versión y archivado, uso registrado).
BD: 38 (servicio de agentes, **aprobación concurrente ejecutada una sola vez**, API keys, rate limit, RLS de plantillas
y del estado de ejecución).
**Bug encontrado y corregido gracias a los tests:** las respuestas `Response` de los handlers se serializaban como
JSON (201 → 200).
**Tests fallidos:** ninguno.
**Riesgos pendientes:** el playground no hace *streaming*; la API aún no expone workflows, knowledge, leads… (fases siguientes).
**Siguiente:** Fase 5, Workflow Builder.
