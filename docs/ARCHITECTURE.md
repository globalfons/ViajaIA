# Arquitectura

La justificación de cada decisión y las alternativas evaluadas están en [AUDIT.md](AUDIT.md).
Este documento describe cómo está construido el sistema y se actualiza en cada fase.

## Vista general

```
apps/web  ──(JWT usuario, RLS)──►  Supabase Postgres  ◄──(service role, filtro org)──  apps/worker
   │                                    ▲                                                  │
   └──────────── packages/core (dominio puro, sin E/S de BD) ◄─────────────────────────────┘
                 packages/db   (repositorios Postgres para código de confianza)
```

- **apps/web**: Next.js (App Router). Server Components leen con el cliente Supabase del usuario, así la RLS
  decide qué ve cada uno. Las rutas `/api/v1/*` exponen la API pública y las rutas `/api/webhooks/*` reciben
  WhatsApp, Stripe y email.
- **apps/worker**: consume la tabla `jobs` (`FOR UPDATE SKIP LOCKED`). Ejecuta la ingesta RAG, los workflows,
  los mensajes entrantes y los *delays*.
- **packages/core**: lógica de dominio testeable sin red ni BD. Todo lo externo se inyecta (proveedores LLM,
  `fetch`, repositorios).
- **packages/db**: pool `pg` con *service role* y el *runner* de migraciones para Postgres plano (CI).

## Módulos de `packages/core`

| Módulo | Responsabilidad | Fase |
|---|---|---|
| `config/env` | Validación de variables de entorno por entorno (development/test/staging/production) | 1 |
| `observability/logger` | Logs JSON (pino) con IDs de correlación, redacción de secretos y *hooks* de errores/spans (Sentry/OTel) | 1 |
| `security/rbac` | Matriz de permisos por rol (UI/API); la RLS es la fuente de verdad | 2 |
| `billing/limits` | Claves de límites, límites efectivos (plan + override) y comprobación | 2 |
| `llm/*` | LLM Router: proveedores, *fallbacks*, reintentos, *timeouts*, costes y uso | 3 |
| `agents/*` | Config validada del agente y runtime (tools, límites, aprobación humana, RAG, *structured output*) | 3 |
| `tools/*` | Registro de tools, allowlist, ejecución con *timeout*; built-ins | 3 |
| `security/guardrails`, `security/ssrf` | Inyección, redacción, delimitación de contenido no confiable; *outbound* seguro | 3 |
| `testing/*` | *Fakes* deterministas (LLM, `fetch`) para tests | 3 |
| `templates/*` | Plantillas de agente (productos) | 4 |
| `workflows/*` | Schema y validación del grafo, plantillas `{{…}}` y motor de ejecución | 5 |

## Entornos

| APP_ENV | Uso | Reglas |
|---|---|---|
| development | Local con `supabase start` | Se permite `ALLOW_INSECURE_OUTBOUND=true` |
| test | Vitest y BD de tests (`docker compose --profile test`) | Sin APIs reales; *fakes* |
| staging | Réplica de producción con datos de prueba | Exige Supabase, `DATABASE_URL` y claves de cifrado |
| production | Clientes reales | Igual que staging + HSTS; *outbound* inseguro prohibido |

## Multi-tenancy

```
Platform Admin (profiles.is_platform_admin)
  └─ Organization (cliente) ── plan, límites, estado, branding
       ├─ Memberships (owner | admin | member | viewer) ── Users (profiles ↔ auth.users)
       ├─ Invitations
       └─ Projects ── (agents, workflows, knowledge bases… en fases siguientes)
```

- La organización activa se guarda en la cookie `dtn_org`, validada contra las membresías en cada petición.
- Los Server Components usan el cliente Supabase del usuario, así que la RLS aplica siempre.
- El *service role* solo se usa en acciones de Platform Admin (tras `requirePlatformAdmin`), en webhooks
  verificados y en el worker.

## Flujo de una ejecución de agente

```
mensaje → sanitizar/limitar → temas bloqueados → detección de inyección → RAG (untrusted, citado)
       → system prompt (instrucciones + política de seguridad + aviso IA)
       → [BudgetGuard] → LLM Router (retry/fallback/timeout) → usage_events
       → ¿tool calls? → allowlist → ¿requiere aprobación? → pausa (estado JSON) / ejecución con timeout
                     → resultado redactado + <untrusted> → tool_invocations → siguiente paso
       → respuesta final → redacción de secretos → structured output → ¿confianza baja? → escalado
```

## Tiempo real

Las conversaciones se actualizan en vivo sin infraestructura adicional:
1. Los triggers de `messages` y `conversations` (migración `0016`) emiten `pg_notify('conversation_events', {o, c})`.
   Solo viajan identificadores, nunca contenido.
2. Cada proceso web mantiene **una** conexión `LISTEN` (`ConversationEventHub`) y reparte los avisos a sus suscriptores.
3. Server-Sent Events: `/api/public/chat/{key}/conversations/{id}/events` para el visitante (con las mismas comprobaciones
   que leer su hilo) y `/api/conversations/{id}/events` para el equipo (sesión y RLS).
4. El cliente recibe `update` y vuelve a leer por el endpoint normal autorizado. Al (re)conectar hace una lectura para no
   perder eventos. Si la conexión cae, pasa a *polling* (5 s en el chat y 10 s en la bandeja) hasta que se recupera.
