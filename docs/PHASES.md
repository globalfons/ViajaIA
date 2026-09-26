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

## Fase 5: Workflow Builder ✅
**Implementado**
- **Motor** (`core/workflows`): DAG con START, AGENT, TOOL, CONDITION, PARALLEL, HUMAN APPROVAL, DELAY, WEBHOOK y END.
  Paralelismo real por oleadas, ramas con propagación de `skipped` (uniones correctas), reintentos con *backoff*
  exponencial, *timeouts*, `continueOnError`, aprobaciones y delays largos como estados de espera, agentes que esperan su
  propia aprobación, y estado 100 % JSON.
- **Validación estructural**: un START, al menos un END, sin ciclos, sin nodos sueltos, handles de rama correctos y datos
  de cada nodo validados con zod. **Plantillas `{{…}}`** sin `eval` ni acceso a prototipos; secretos `{{secret:X}}`
  resueltos solo en el servidor y nunca persistidos.
- Migración `0004`: `workflows`, `workflow_versions` (inmutables), `workflow_runs` (con `state_version` para CAS),
  `workflow_step_runs` (logs por nodo), `approvals` y la cola `jobs` (con *dedupe*).
- **Worker real**: bucle de jobs, reintentos con *backoff*, recuperación de jobs huérfanos, scheduler de runs en espera y
  caducidad de aprobaciones, y apagado ordenado.
- **UI**: editor visual con React Flow (paleta, panel por tipo de nodo, validación en vivo, guardar versión, publicar,
  probar borrador o ejecutar la versión publicada, guardar como plantilla), **Automations** (bandeja única de
  aprobaciones de workflows y de acciones de agentes, más ejecuciones) y detalle de ejecución con estado, intentos, logs y
  salida por nodo, y cancelación.
- **API v1**: `GET /workflows`, `GET /workflows/{id}`, `POST /workflows/{id}/runs` (202 asíncrono) y
  `GET /workflow-runs/{id}`, con OpenAPI actualizado.
- Workflows como plantillas (sin referencias a agentes del cliente) y "crear desde plantilla".

**Tests:** 235 en verde. Core: 155 (21 del motor: ramas, uniones, paralelismo medido, reintentos, *timeouts*,
aprobaciones, delays, webhooks con secretos y SSRF, *round-trip* JSON, operadores). Worker: 6 **E2E contra Postgres**
(lead caliente: agente → condición → aprobación → tool; lead frío con espera de un día y scheduler; fallo explícito;
*dedupe*; organización suspendida; publicación con agente de otro tenant rechazada). Web: 36 (incluye la API de workflows).
BD: 38.
**Verificación visual:** el editor se renderizó en Chromium (Playwright) con un grafo real, se probaron la selección, la
paleta y la validación en vivo, sin errores en consola. Se corrigió la duplicación de etiquetas en las ramas.
**Bugs encontrados y corregidos gracias a los tests:**
1. El motor redactaba PII en las salidas de las tools y rompía el paso de datos entre nodos. Ahora el estado solo redacta
   secretos (`redactSecretsDeep`); la PII sigue protegida por la RLS.
2. Tras un fallo, los nodos posteriores quedaban `pending` en lugar de `skipped`.
**Tests fallidos:** ninguno.
**Riesgos pendientes:**
- Disparadores automáticos (cron, webhook entrante, eventos de conversación): llegan con canales e integraciones (fases 7-9).
- La tool list de los nodos TOOL crece con las integraciones (CRM, calendario, email).
**Siguiente:** Fase 6, RAG / Knowledge Base.

## Auditoría v2 ✅
Ver [AUDIT_V2.md](AUDIT_V2.md). Stack E2E Supabase-compatible y recorrido en navegador (`pnpm e2e`). 4 defectos reales
corregidos (email borrado tras un login fallido, `pattern` del slug inválido, carrera de Storage en la migración y, en la
fase 6, casillas desmarcadas tras guardar el agente).

## Fase 6: RAG / Knowledge ✅
**Implementado**
- Parsers PDF/DOCX/CSV/HTML/MD/TXT con verificación por *magic number*; chunking recursivo con solape y secciones Markdown.
- Migración `0005`: `knowledge_bases`, `documents`, `document_chunks` (pgvector 1536 + HNSW, tsvector + GIN),
  `app.search_chunks` (**híbrida con RRF**, filtro de organización dentro de la función) y bucket de Storage.
- `BlobStore` (API REST de Supabase Storage sin SDK; versión en memoria para tests); ingesta idempotente en el worker;
  límites `max_documents` y `max_storage_mb`; deduplicación SHA-256; borrado y reindexado.
- **RAG conectado al runtime por defecto**: cualquier agente con knowledge bases recupera contexto de su organización.
- UI: listado de KBs con métricas, detalle con subida múltiple, URL, tabla (estado/tamaño/fragmentos/fecha/errores) con
  auto-refresco, reindexar/eliminar y **probador de búsqueda**; selección de KB en el Agent Builder.
- API v1: `GET /knowledge-bases`, `GET|POST /knowledge-bases/{id}/documents` (multipart o URL, 202) y `POST …/search`.

**Tests:** core 166 · BD 46 (8 de RAG: PDF real + MD + URL, ranking, agente con fuentes, aislamiento, duplicados,
tipos, límites, fallo de parseo, borrado y uso de embeddings) · worker 6 · web 37 (aislamiento de la API de Knowledge) ·
**E2E 23/23** (subida de un PDF desde la UI → el worker lo indexa → búsqueda → el agente responde con la fuente,
salida estructurada `completed`).
**Doble de pruebas E2E:** `e2e/fake-openai.mjs` imita el formato HTTP de OpenAI (embeddings deterministas; el chat repite el
primer fragmento recibido). Está marcado como TEST DOUBLE y solo se usa en E2E.
**Bugs encontrados y corregidos:** separador `-- 1 of 1 --` del parser de PDF en el texto indexado; casillas del editor
desmarcadas tras guardar (reseteo de formularios de React 19); el proxy de Next truncaría en silencio subidas de más de 10 MB.
**Riesgos pendientes:** sin OCR para PDFs escaneados (el documento queda `failed` con «No text could be extracted»); la
dimensión 1536 está fijada por migración.
**Siguiente:** responsive del dashboard → Conversaciones + AI Customer Support web.

## Responsive + estados ✅
Drawer de navegación en móvil/tablet, módulos no construidos ocultos a clientes, `loading.tsx` en páginas hoja (las
páginas de detalle devuelven un **404 real**) y `error.tsx` sin trazas. `e2e/responsive.mjs` (iPhone + iPad).

## Fase 7: Conversaciones + AI Customer Support (web) ✅
**Implementado**
- Migración `0006`: `channels` (clave pública del chat web, orígenes permitidos), `contacts`, `conversations` (estado
  IA/escalada/humano/cerrada, prioridad, asignación, métricas) y `messages` (modelo, tokens, coste, fuentes, tools,
  estado). Mensajes y métricas **solo los escribe el servidor**; los miembros solo pueden hacer *triage* (privilegios
  por columna).
- Servicio: mensaje → agente (RAG) → respuesta con métricas → **escalado** por baja confianza, `needs_human`, aprobación
  pendiente, bloqueo por inyección o fallo del LLM (respuesta de *fallback*). Mientras lo lleva una persona, la IA no
  responde. Respuesta humana, historial como memoria y conversación restringida al visitante y canal.
- **Chat web público**: `/chat/{clave}` (aviso de IA, indicador de atención humana y *polling* de respuestas humanas),
  `widget.js` para incrustar con una línea, endpoints públicos con rate limit por visitante, IP y canal, y allowlist de
  orígenes. Solo `/chat/*` se puede incrustar en un iframe; el resto mantiene `frame-ancestors 'none'`.
- **Inbox**: filtros (estado, agente, canal, prioridad, fecha), paginación, detalle con modelo, tokens, coste, fuentes y
  tools por mensaje, respuesta del equipo, escalar, devolver a la IA, cerrar, prioridad y asignación.
- **Integrations** modular: el chat web y los proveedores LLM funcionan (según `.env`); WhatsApp, Email, Telegram, Slack,
  Calendarios, HubSpot y MCP aparecen como «Próximamente», sin botones falsos.
- Platform Admin: **crear usuario** (contraseña temporal) en la ficha del cliente; cambio de contraseña en Settings.

**Tests:** core 166 · BD 54 (8 de conversaciones) · worker 6 · web 41 · E2E: recorrido 23/23 · responsive 12/12 ·
**MVP 19/19** (`pnpm e2e:mvp`: los 17 pasos de la definición de MVP más escalado y respuesta humana).
**Bugs encontrados y corregidos:** los mensajes de éxito personalizados se mostraban como «Hecho.» (ahora las claves de la
URL van en una allowlist, sin texto arbitrario); las páginas de detalle de otra organización respondían HTTP 200 con la
vista 404, sin fuga de datos (el *streaming* de `loading.tsx` fijaba el estado).
**Riesgos pendientes:** el texto `?error=` de las Server Actions se muestra en la página (escapado y limitado): riesgo
bajo de suplantación de contenido; pasará a *flash* por cookie. La respuesta a visitantes web se entrega por *polling*
(5 s), sin *realtime*.
**Siguiente:** web pública + demo honesta → catálogo de soluciones y «Activar solución» → Leads/CRM → WhatsApp →
límites con aprobación → Stripe.

## Credenciales cifradas ✅
Migración `0007`: tabla `secrets` por organización con AES-256-GCM (`SECRETS_ENCRYPTION_KEYS`, rotación con varias
versiones de clave; AAD = `orgId/nombre`, así que un cifrado no se puede mover a otra organización). Owners y admins ven solo
los metadatos (nombre y últimos 4 caracteres). Las tools obtienen los valores en el servidor (`getSecret`) y el modelo
nunca los ve.

## Catálogo de soluciones + «Activar solución» ✅
10 soluciones versionadas (`SOL-…-v1`) en `packages/core/src/solutions/catalog.ts`, con requisitos, integraciones
necesarias y campos de configuración. La activación es **transaccional**: crea agentes activos, la knowledge base,
el workflow publicado y el canal web, y registra la instancia en `solution_instances` (migración `0008`). Si falta un
requisito (modelo de chat o de embeddings), no se crea nada. E2E `e2e/solutions.mjs` 6/6.

## Leads / CRM + política de límites ✅
**Implementado**
- Migración `0009`: `companies`, `leads` (etapas NEW→WON/LOST, puntuación, valor, **base legal RGPD obligatoria**,
  consentimiento de marketing con fecha), `opportunities`, `activities` y `tasks`, con RLS por organización.
- Tools del agente `crm_capture_lead`, `crm_add_note` y `crm_create_task` (con allowlist por agente, incluidas en las
  plantillas de ventas, cualificación y recepción). Las conversaciones con salida estructurada que incluye `score`
  registran o actualizan **un único lead por conversación**, con base legal «solicitud del propio interesado».
- UI `/leads`: tablero por etapas con totales, mover etapa, alta manual con base legal y ficha con actividad, notas,
  tareas, oportunidad (ganada o perdida sincronizada con la etapa), cualificación BANT y enlace a la conversación.
  La plataforma **no envía comunicaciones**; el CRM solo registra contactos entrantes o consentidos.
- Adaptador `HubSpotSync` (API v3 de contactos) listo para usar con un token guardado en credenciales; no se activa solo.
- Migración `0010`: política por cliente `limit_policy` = `block` | `require_approval`. Con «pedir aprobación», al
  alcanzar un límite (coste LLM mensual, tokens o ejecuciones de workflow) se crea **una** solicitud pendiente por
  límite y mes; el servicio queda en pausa (banner en `/usage`, código API `limit_approval_required`) hasta que el
  Platform Admin concede margen extra o rechaza en `/admin`.

**Tests:** core 185 · BD 75 (CRM 11 y límites 5, incluido el aislamiento entre organizaciones) · worker 6 · web 41 ·
E2E `e2e/crm.mjs` 7/7 (chat → lead cualificado con puntuación 80 → ficha → tablero → lead manual → límite con
aprobación → aprobación del admin).
**Bugs corregidos:** en el alta automática, la actividad decía «Lead creado» en lugar de indicar su origen; el campo de
tarea quedaba aplastado en pantallas estrechas; el estado de la oportunidad se mostraba en inglés.
