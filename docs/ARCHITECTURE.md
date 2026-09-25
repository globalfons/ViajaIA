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
| `llm/*` | LLM Router: proveedores, *fallbacks*, reintentos, *timeouts*, costes y uso | 3 |

## Entornos

| APP_ENV | Uso | Reglas |
|---|---|---|
| development | Local con `supabase start` | Se permite `ALLOW_INSECURE_OUTBOUND=true` |
| test | Vitest y BD de tests (`docker compose --profile test`) | Sin APIs reales; *fakes* |
| staging | Réplica de producción con datos de prueba | Exige Supabase, `DATABASE_URL` y claves de cifrado |
| production | Clientes reales | Igual que staging + HSTS; *outbound* inseguro prohibido |
