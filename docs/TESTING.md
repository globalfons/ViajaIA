# Testing

| Nivel | Comando | Qué cubre | Requiere |
|---|---|---|---|
| Unit | `pnpm test` | core (router, runtime, guardrails, SSRF, motor de workflows, RAG, plantillas), web (proxy, branding, OpenAPI…) | Nada |
| Integración / RLS | `TEST_DATABASE_URL=… pnpm test` | RLS y aislamiento entre tenants, servicios, API v1 con rutas reales, worker E2E | `docker compose --profile test up -d testdb` (Postgres + pgvector) |
| E2E (navegador) | `pnpm e2e` | Recorrido real: login, clientes, modelos, agentes, workflows ejecutados por el worker, API keys | Stack Supabase local + web + worker (abajo) |

Ningún test llama a APIs externas: los proveedores LLM se simulan con `FakeProvider`/`mockFetch`, o con un servidor HTTP
local con formato OpenAI (`OPENAI_BASE_URL`).

## Stack E2E (Supabase-compatible, imágenes oficiales)
```bash
pnpm e2e:stack                 # docker/e2e/up.sh: Postgres de Supabase + GoTrue + PostgREST + Storage + gateway; aplica migraciones
# genera docker/e2e/.env.e2e con claves LOCALES (no versionadas, no válidas fuera de este stack)
# .env para la web/worker: NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321, las claves de .env.e2e,
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
pnpm --filter @dtn/web build && node apps/web/.next/standalone/apps/web/server.js   # (copiar .next/static al standalone)
pnpm dev:worker
pnpm e2e                       # seed (admin + organización) + recorrido en Chromium
```
Las capturas y los fallos se guardan en `e2e/.artifacts/`.
