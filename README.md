# DigitalizaTusNegocios AI OS

Plataforma SaaS multi-tenant con la que una agencia crea, configura, despliega y opera soluciones
de IA (agentes, workflows, RAG y canales como WhatsApp o email) para muchas empresas cliente desde
un único sistema.

| Documento | Contenido |
|---|---|
| [docs/AUDIT.md](docs/AUDIT.md) | Fase 0: auditoría OSS, licencias, riesgos y plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura y módulos |
| [docs/PHASES.md](docs/PHASES.md) | Estado de cada fase (tests, riesgos, siguiente paso) |
| [docs/AGENTS.md](docs/AGENTS.md) | Crear y configurar agentes, tools y plantillas |
| [docs/API.md](docs/API.md) | API v1 (OpenAPI en `/api/openapi.json`) |
| [docs/SECURITY.md](docs/SECURITY.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Seguridad y despliegue |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Convenciones de desarrollo |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Componentes de terceros y licencias |

## Estructura

```
apps/web       Next.js 16: UI, API REST, webhooks
apps/worker    Procesos en segundo plano (cola de jobs en Postgres)
packages/core  Dominio puro: LLM Router, agentes, workflows, RAG, seguridad
packages/db    Acceso a Postgres (service role) y migraciones
supabase/      Migraciones SQL (esquema, RLS, pgvector)
docker/        Dockerfiles
docs/          Documentación
```

## Requisitos

- Node 22+ y pnpm 10 (`corepack enable`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) para desarrollo local
- Docker (opcional: contenedores y tests de integración de BD)

## Instalación y ejecución

```bash
pnpm install
cp .env.example .env        # rellenar valores (nunca commitear .env)
supabase start              # Postgres + Auth + Storage locales; copia las claves a .env
pnpm dev                    # http://localhost:3000
pnpm dev:worker             # en otra terminal
```

Comprobaciones:

```bash
pnpm typecheck
pnpm test
pnpm --filter @dtn/web build
```

Con Docker (sobre `supabase start`):

```bash
docker compose up --build
```
