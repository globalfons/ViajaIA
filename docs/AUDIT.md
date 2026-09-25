# FASE 0: Auditoría y arquitectura

Fecha: 2026-09-25 · Estado: **completada**

## 1. Estado inicial del proyecto

| Elemento | Hallazgo |
|---|---|
| Repositorio | `globalfons/ViajaIA`, rama `claude/digitalizatusnegocios-saas-platform-tzu4ep` |
| Contenido | Solo `README.md` (2 líneas, de un proyecto anterior: "AI travel concierge") |
| Código existente | Ninguno. No hay nada que migrar ni que respete compatibilidad |
| Herramientas del entorno | Node 22, pnpm 10, Python 3.11, Docker 29 |

**Conclusión:** construimos desde cero. El README antiguo se sustituye.

## 2. Repositorios open-source evaluados

Datos obtenidos de GitHub el 2026-09-25: estrellas, *issues* abiertos, fecha del último *push* y el fichero `LICENSE` leído directamente del repositorio oficial.
Criterio: **MIT / Apache-2.0 / BSD → aceptable**. Licencias mixtas (carpetas `ee/`) → solo la parte MIT/Apache y sin tocar `ee/`. AGPL, *Sustainable Use*, FSL o licencias "Apache modificada" → **no se incorpora código**.

| Repositorio | URL | Licencia (verificada) | Función | Calidad (★ · issues · último push) | Qué reutilizamos | Riesgos |
|---|---|---|---|---|---|---|
| shadcn/ui | github.com/shadcn-ui/ui | MIT | Componentes UI (Radix + Tailwind) | 124k · 1.8k · 2026-09-24 | Patrón y código de componentes copiados al proyecto (es su modelo de distribución) | Ninguno relevante. Mantener atribución MIT |
| xyflow (React Flow) | github.com/xyflow/xyflow | MIT | Editor visual de grafos | 38k · 139 · 2026-09-24 | `@xyflow/react` como dependencia para el Workflow Builder | Ninguno. Las funciones "Pro" son de pago y no las usamos |
| Supabase | github.com/supabase/supabase | Apache-2.0 | Postgres gestionado, Auth, Storage, RLS | 110k · 1k · 2026-09-25 | Plataforma (servicio) + `@supabase/supabase-js`/`@supabase/ssr` (MIT) | Dependencia de proveedor → mitigado: es Postgres estándar y se puede autoalojar |
| pgvector | github.com/pgvector/pgvector | PostgreSQL License (tipo BSD) | Búsqueda vectorial en Postgres | 23k · 17 · 2026-09-22 | Extensión `vector` para RAG | Ninguno |
| MCP TypeScript SDK | github.com/modelcontextprotocol/typescript-sdk | MIT → Apache-2.0 (en transición; ambas permisivas) | Cliente/servidor de Model Context Protocol | 13k · 648 · 2026-09-25 | Cliente MCP (transporte HTTP) | La API evoluciona rápido → la aislamos tras nuestra interfaz `McpClient` |
| stripe-node | github.com/stripe/stripe-node | MIT | SDK de Stripe | 4.5k · 52 · 2026-09-25 | Checkout, webhooks, portal de cliente | Ninguno |
| supabase-js | github.com/supabase/supabase-js | MIT | Cliente de Supabase | 4.5k · 94 · 2026-09-25 | Autenticación y consultas con RLS desde Next.js | Ninguno |
| pdf.js / pdf-parse | github.com/mozilla/pdf.js | Apache-2.0 | Extraer texto de PDFs | 54k · 427 · 2026-09-25 | Parsing de PDF en el pipeline RAG | Los PDFs maliciosos se procesan en el *worker* con límites de tamaño y tiempo |
| mammoth.js | github.com/mwilliamson/mammoth.js | BSD-2-Clause | DOCX → texto | 6.3k · 61 · 2026-09-19 | Parsing de DOCX | Ninguno |
| PapaParse | github.com/mholt/PapaParse | MIT | Parsing de CSV | 13.5k · 224 · 2026-09-15 | Parsing de CSV | Ninguno |
| undici | github.com/nodejs/undici | MIT | Cliente HTTP de Node | 7.7k · 347 · 2026-09-25 | *Dispatcher* con `lookup` propio para la protección SSRF (anti DNS-rebinding) | Ninguno |
| pino | github.com/pinojs/pino | MIT | Logs JSON estructurados | 18k · 166 · 2026-09-25 | Logger con redacción de secretos | Ninguno |
| Recharts | github.com/recharts/recharts | MIT | Gráficos React | 27k · 445 · 2026-09-25 | Gráficos de costes y uso | Ninguno |
| Vercel AI SDK | github.com/vercel/ai | Apache-2.0 | Abstracción multi-LLM | 27k · 1.4k · 2026-09-25 | **No en el MVP.** Router propio más fino (ver §4). Plan B si crece el número de proveedores | Muchas dependencias y API muy cambiante |
| LiteLLM | github.com/BerriAI/litellm | MIT (excepto `enterprise/`) | Proxy LLM multi-proveedor (Python) | 60k · 5.3k · 2026-09-25 | **Opcional**: desplegable como proxy externo detrás de `openai-compatible` sin tocar código | Servicio Python adicional. `enterprise/` es propietario |
| Langfuse | github.com/langfuse/langfuse | MIT (excepto `ee/`) | Observabilidad LLM | 35k · 946 · 2026-09-25 | **Opcional** (fase 13): exportar trazas vía el hook `onUsage`/OTel | Servicio adicional (ClickHouse). `ee/` es propietario |
| Chatwoot | github.com/chatwoot/chatwoot | MIT (excepto `enterprise/`) | Inbox omnicanal humano | 37k · 1.5k · 2026-09-25 | **Opcional**: canal de escalado a humanos vía API | Rails + Redis: demasiado pesado para el MVP |
| Activepieces | github.com/activepieces/activepieces | MIT (excepto `ee/`) | Automatizaciones tipo Zapier | 25k · 591 · 2026-09-25 | **No** en el MVP. Integrable después como destino de webhooks | Arquitectura pesada. Duplicaría nuestro motor |
| LangGraph.js | github.com/langchain-ai/langgraphjs | MIT | Orquestación de agentes en grafo | 3.3k · 164 · 2026-09-25 | **No.** Inspiración conceptual (estado serializable y *checkpoints*) | Acoplamiento a LangChain, más superficie de dependencias |
| LangChain.js | github.com/langchain-ai/langchainjs | MIT | Toolkit LLM | 18k · 586 · 2026-09-25 | **No.** Solo usaríamos *splitters*, y los implementamos en unas 80 líneas | Enorme árbol de dependencias |
| OpenAI Agents JS | github.com/openai/openai-agents-js | MIT | Runtime de agentes | 3.9k · 11 · 2026-09-25 | **No.** Sesgado a un proveedor | Rompe la neutralidad del router |
| Mastra | github.com/mastra-ai/mastra | Apache-2.0 (excepto `ee/`) | Framework de agentes TS | 28k · 466 · 2026-09-25 | **No.** Solapa con nuestro núcleo | `ee/` propietario, framework opinado |
| Unstructured | github.com/Unstructured-IO/unstructured | Apache-2.0 | Parsing avanzado de documentos (Python) | 15k · 314 · 2026-09-25 | **Futuro**: microservicio FastAPI para OCR y tablas si los clientes lo necesitan | Dependencias pesadas (OCR) |
| Botpress | github.com/botpress/botpress | MIT | Plataforma de chatbots | 15k · 55 · 2026-09-23 | **No.** El repositorio público es sobre todo SDK/integraciones de su *cloud* | Dependencia de su nube |
| Cal.com | github.com/calcom/cal.com | MIT | Agenda/reservas | — · — · 2026-09-25 | **No.** Adaptadores directos a Google/Microsoft Calendar (más simple) | Monolito enorme |
| **Dify** | github.com/langgenius/dify | **Apache-2.0 modificada** | Plataforma LLM | 157k · 1.1k · 2026-09-25 | **EXCLUIDO** | Su licencia **prohíbe operar un entorno multi-tenant** sin autorización escrita: incompatible con nuestro modelo de negocio |
| **n8n** | github.com/n8n-io/n8n | **Sustainable Use License** | Automatizaciones | 206k · 1.2k · 2026-09-25 | **EXCLUIDO** (no es OSI) | Prohíbe ofrecerlo como servicio a terceros |
| **Twenty** | github.com/twentyhq/twenty | **AGPL-3.0** (+ ficheros comerciales) | CRM | 57k · 133 · 2026-09-25 | **EXCLUIDO** como código. Integrable en el futuro solo vía API como CRM externo | AGPL obliga a publicar el código del SaaS |
| **Typebot** | github.com/baptisteArno/typebot.io | **FSL-1.1** | Constructor de chatbots | 10k · 26 · 2026-09-24 | **EXCLUIDO** | FSL prohíbe el uso competidor |
| **Flowise** | github.com/FlowiseAI/Flowise | Apache-2.0 (+ `enterprise/`) | Constructor visual LLM | 55k · 1k | **EXCLUIDO** | **Repositorio archivado** (sin mantenimiento) |

> Vulnerabilidades: tras instalar las dependencias se ejecuta `pnpm audit` en cada fase (ver `docs/PHASES.md`).
> Atribuciones: `THIRD_PARTY_NOTICES.md`.

## 3. Arquitectura final propuesta (MVP primero)

```
                ┌─────────────────────────── Vercel / contenedor ───────────────────────────┐
 Navegador ───► │ apps/web  (Next.js 16 · React 19 · Tailwind 4 · shadcn/ui · React Flow)   │
 WhatsApp  ───► │   • UI: dashboard, admin, builders, inbox                                 │
 Stripe    ───► │   • API REST /api/v1/* (OpenAPI)  • Webhooks  • OAuth callbacks           │
 Email     ───► │   • Auth: Supabase Auth (cookies, @supabase/ssr)                          │
                └───────────────┬──────────────────────────────────────┬────────────────────┘
                                │ JWT del usuario → RLS               │ encola jobs
                                ▼                                      ▼
                ┌───────────────────────────── Supabase ─────────────────────────────────────┐
                │ Postgres 15+ · pgvector · RLS por organización · Storage (documentos)      │
                │ Tabla `jobs` (cola con SKIP LOCKED) · `usage_events` · `audit_logs`        │
                └───────────────▲────────────────────────────────────────────────────────────┘
                                │ service role (filtra SIEMPRE por organization_id)
                ┌───────────────┴───────── VPS / contenedor ──────────────────┐
                │ apps/worker (Node 22)                                       │
                │  ingesta RAG · ejecución de workflows · mensajes entrantes │
                │  (WhatsApp/email) · delays/reintentos · follow-ups          │
                └───────────────┬─────────────────────────────────────────────┘
                                ▼
         packages/core (TS puro, sin E/S de BD): LLM Router · Agent Runtime · Workflow Engine
         RAG (chunking/retrieval) · Tools/MCP · Canales · CRM · Calendar · Seguridad · Billing
                                ▼
         OpenAI · Anthropic · Gemini · xAI · DeepSeek · OpenRouter  (fetch directo, sin SDKs)
```

### Decisiones de simplificación (principio "lo más sencillo que funcione")

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| **Un solo lenguaje (TypeScript)** | FastAPI + Node | Menos despliegues, tipos compartidos UI↔API↔worker. FastAPI solo si más adelante necesitamos Unstructured/OCR |
| **Cola de trabajos en Postgres** (`FOR UPDATE SKIP LOCKED`) | Redis + BullMQ | Un servicio menos. Aguanta miles de jobs/min, suficiente para el MVP. Redis queda documentado como escalado futuro |
| **Rate limiting en Postgres** (ventana fija) | Redis | Mismo motivo |
| **Router LLM propio** (unas 600 líneas, fetch) | Vercel AI SDK / LiteLLM | Control total de coste por tenant, cadenas de *fallback*, presupuesto previo a cada llamada y cero dependencias de proveedores |
| **Motor de workflows propio** (DAG serializable) | n8n (licencia), Temporal (infraestructura) | Estado JSON persistido en `workflow_runs`: pausa/reanudación para aprobación humana y *delays* largos sin infraestructura extra |
| **Next.js hace UI + API** | Backend separado | Un despliegue. El trabajo pesado va al worker |
| **Supabase Storage** para ficheros | S3 | Ya incluido y con políticas por organización |

## 4. Qué construimos y qué reutilizamos

**Construimos (núcleo diferencial, propiedad nuestra):** modelo multi-tenant y RLS, LLM Router con costes, Agent Runtime (tools con allowlist, guardrails, aprobación humana), motor de workflows, pipeline RAG, capa de canales (WhatsApp/email), capa CRM abstracta con adaptadores, adaptadores de calendario, registro MCP seguro, control de costes/límites, sistema de plantillas, white-label, admin de plataforma y API v1 con OpenAPI.

**Reutilizamos como dependencias:** Next.js, React, Tailwind, shadcn/ui, React Flow, Supabase (Auth/DB/Storage), pgvector, MCP SDK, Stripe SDK, pdf-parse (pdf.js), mammoth, PapaParse, undici, pino, zod, Recharts, lucide-react.

**Integrables más adelante sin cambiar el núcleo:** LiteLLM (proxy), Langfuse u OpenTelemetry (trazas), Chatwoot (inbox humano), Sentry (errores), Unstructured (parsing avanzado).

## 5. Dependencias externas (requieren credenciales reales)

| Servicio | Variables | Necesario para |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | Todo (en local: `supabase start`) |
| Proveedores LLM | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` | Al menos uno para chat. Embeddings: OpenAI o Gemini |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Cobro |
| WhatsApp Cloud API (Meta) | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (+ token de acceso por cliente, cifrado en BD) | Canal WhatsApp |
| Email (Resend / Postmark inbound) | Por cliente, cifrado en BD | Canal email |
| Google / Microsoft OAuth | `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` | Calendario |
| HubSpot | Token por cliente, cifrado | CRM externo |

## 6. Riesgos

### Seguridad
| Riesgo | Mitigación |
|---|---|
| Fuga de datos entre tenants | RLS en **todas** las tablas con `organization_id`; el worker filtra explícitamente; tests de RLS |
| Prompt injection (documentos RAG, emails, webhooks) | Contenido no confiable delimitado y marcado; detector heurístico; las tools de riesgo exigen aprobación humana; allowlist de tools por agente |
| Exfiltración de secretos por el modelo | Los secretos nunca entran en el prompt; se inyectan en el servidor al ejecutar la tool; redacción en logs y salidas |
| SSRF (URLs RAG, webhooks, MCP) | Solo HTTPS, bloqueo de rangos privados/metadata, validación de la IP resuelta en el momento de conectar (anti DNS-rebinding) y re-validación en cada redirección |
| Coste descontrolado | Presupuesto mensual por organización y agente, comprobado antes de cada llamada; límite de pasos por ejecución |
| Webhooks falsificados | Firma HMAC de Meta (`X-Hub-Signature-256`), firma de Stripe, token por canal para email |
| Robo de credenciales de integraciones | AES-256-GCM con clave de entorno y versionado para rotación; tabla sin acceso para usuarios (solo *service role*) |

### Licencias
- **Dify** (prohíbe el multi-tenant), **n8n**, **Twenty (AGPL)** y **Typebot (FSL)**: no se copia ni una línea.
- Proyectos con `ee/` o `enterprise/`: nunca se importa código de esas carpetas.
- MCP SDK en transición MIT→Apache-2.0: ambas son compatibles; se revisa en cada *upgrade*.

### Legal / cumplimiento (España/UE)
- **RGPD/LOPDGDD**: somos encargados del tratamiento de nuestros clientes → DPA con cada cliente y con los proveedores LLM; recomendamos región UE en Supabase. Exportación y borrado por organización (fase 11).
- **LSSI + RGPD en el Sales Agent**: sin envíos comerciales no solicitados. El agente solo responde a leads *inbound* o a contactos con base legal registrada (`consent_status`), y cada envío saliente pasa por aprobación humana salvo configuración explícita.
- **WhatsApp Business Policy**: *opt-in* obligatorio; fuera de la ventana de 24 h solo se pueden enviar plantillas aprobadas.
- **Reglamento de IA de la UE (art. 50, transparencia)**: los agentes se identifican como IA. Hay un aviso configurable por agente, activado por defecto.

## 7. Plan de implementación por fases

La **definición de MVP** (lo mínimo para vender): crear cliente → crear agente desde plantilla → subir documentos → probar en el playground → conectar WhatsApp o widget web → ver conversaciones, leads y coste → cobrar con Stripe.

| Fase | Contenido | Entregable verificable |
|---|---|---|
| 0 | Auditoría y arquitectura | Este documento |
| 1 | Core SaaS: monorepo, Next.js con layout y navegación, esquema base, Docker, `.env.example`, docs base | `pnpm build` y `pnpm test` en verde |
| 2 | Auth + multi-tenancy + RLS: Supabase Auth, organizaciones, membresías, RBAC, políticas, admin de plataforma | Tests de RLS contra Postgres real |
| 3 | Agent runtime: LLM Router, tools, guardrails, presupuesto, registro de uso | Tests con proveedores simulados |
| 4 | Agent Builder: UI y API, playground, plantillas | CRUD + chat de prueba |
| 5 | Workflow Builder: React Flow, motor, versiones, aprobaciones | Tests del motor + editor funcional |
| 6 | RAG: subida, parsing, chunking, embeddings, búsqueda híbrida | Tests de pipeline con embeddings falsos |
| 7 | Customer Support: plantilla, inbox, escalado | Flujo completo con LLM simulado |
| 8 | Sales + Leads: CRM interno, scoring, consentimiento | Tests de cualificación y consentimiento |
| 9 | Integraciones: WhatsApp, email, calendario, HubSpot, MCP | Tests de firma y parsing de webhooks |
| 10 | Billing: Stripe, planes configurables, límites | Tests de webhooks de Stripe |
| 11 | Hardening de seguridad | Tests de seguridad (SSRF, inyección, XSS, CSRF) |
| 12 | Testing: E2E y cobertura | CI en verde |
| 13 | Despliegue en producción | `DEPLOYMENT.md` + Dockerfiles + CI |

En cada fase: tests → correcciones → revisión de seguridad → documentación → commit → informe (`docs/PHASES.md`).
