# Auditoría v2: estado real del proyecto (verificado)

Fecha: 2026-09-25. Método: **ejecutar, no suponer**. Todo lo marcado como «funciona» se ha comprobado con al menos uno de:
tests automáticos, Postgres real, un stack Supabase real (Auth + PostgREST + Storage, `docker/e2e/`) o un navegador real
(Chromium con Playwright) contra el build de producción *standalone* y el worker en ejecución.

## 1. CURRENT STATE

| Aspecto | Estado |
|---|---|
| Stack | Monorepo pnpm · Next.js 16 (App Router) · React 19 · Tailwind 4 · componentes shadcn/ui · React Flow · Supabase (Auth + Postgres + pgvector + Storage) · worker Node con cola en Postgres · TypeScript estricto |
| Tamaño | 176 ficheros versionados · ~14.600 líneas TS/TSX/SQL |
| Compilación | `tsc` 0 errores en los 4 paquetes · `next build` OK |
| Tests | **246 en verde** (core 166, BD 38, worker 6, web 36). Sin BD, los tests de integración se **saltan de forma explícita** (no pasan en falso) |
| Dependencias | `pnpm audit`: 0 vulnerabilidades conocidas |
| TODO / mocks en producción | Ninguno (grep). Los *fakes* viven solo en `core/src/testing` y en los tests |

## 2. WHAT EXISTS → WHAT WORKS (verificado)

| Módulo | Existe | Funciona | Cómo se ha verificado |
|---|---|---|---|
| Auth (contraseña, *magic link*, callback, logout) | ✅ | ✅ | E2E en navegador con GoTrue real: redirección de anónimos, error genérico con contraseña incorrecta, login, logout |
| Multi-tenancy + RLS | ✅ | ✅ | 22 tests SQL + **HTTP real vía PostgREST**: B no ve A ni manipulando IDs, no inserta en A, no escala plan, anon denegado, solo el admin crea organizaciones |
| Organizaciones / clientes / Platform Admin | ✅ | ✅ | E2E: crear cliente desde la UI, abrir su panel, planes y límites, catálogo de modelos |
| Roles e invitaciones | ✅ | ✅ (BD) | Tests de RLS. El envío de email depende de SMTP en Supabase |
| LLM Router (6 proveedores) | ✅ | ⚠️ parcial | *Wire format* probado con respuestas simuladas; fallback, reintentos y costes probados. **No probado contra las APIs reales**: no hay API keys en este entorno |
| Agent runtime (tools, allowlist, aprobación, límites, guardrails) | ✅ | ✅ | 26 tests + E2E en BD. Sin keys, el playground falla de forma controlada («provider not configured») |
| Agent Builder + plantillas + versiones | ✅ | ✅ | E2E: crear desde plantilla, guardar (v2) |
| Workflows (motor, editor, worker, aprobaciones) | ✅ | ✅ | E2E: crear → publicar → ejecutar → **el worker lo completa**. 6 E2E del worker contra BD |
| API v1 + OpenAPI + API keys + rate limit | ✅ | ✅ | 12 tests de API + E2E: clave creada en la UI y usada contra `/api/v1/agents` |
| Usage / Analytics / costes | ✅ | ✅ | Tests de BD; páginas renderizadas en E2E |
| RAG: parsers, chunking, migración con búsqueda híbrida | 🟡 en curso | ✅ parsers (PDF/DOCX reales) · migración aplicada en Supabase real | Falta la ingesta (worker), el *retrieval* conectado al runtime y la UI |

## 3. DEFECTOS ENCONTRADOS AL EJECUTAR LA APP (y estado)

| # | Defecto | Gravedad | Estado |
|---|---|---|---|
| 1 | Tras un login fallido, React 19 reseteaba el formulario y **borraba el email** | Media (UX) | ✅ Corregido (campo controlado) y verificado en E2E |
| 2 | El `pattern` del slug no era una regex válida con el flag `v` de los navegadores actuales, así que la validación nativa no funcionaba | Baja | ✅ Corregido y verificado en el navegador |
| 3 | La migración 0005 fallaba si Storage aún no había creado sus tablas (carrera en el arranque) | Media (despliegue) | ✅ Corregido (bucket condicional y asegurado en tiempo de ejecución) |
| 4 | **El dashboard no se puede usar en móvil** (la barra lateral ocupa el 60 %) | Alta | ⏳ Siguiente corrección |
| 5 | `next start` con `output: standalone` muestra un aviso. Producción usa `node server.js` (Dockerfile ya correcto) | Info | Documentado |

## 4. WHAT IS MISSING (según la especificación v2)

- **Web pública comercial** (`/`, `/soluciones/*`, `/sectores`, `/precios`, `/casos-de-uso`, `/demo`, `/contacto`) y demo honesta.
- **Catálogo de soluciones + «Activar solución»** (provisionar agente + workflow + KB + configuración para una organización).
- RAG completo (ingesta, UI, fuentes en las respuestas, KB en el Agent Builder).
- **Conversaciones** (inbox, widget web, escalado humano) → el MVP de AI Customer Support depende de esto.
- Leads / CRM, integraciones (WhatsApp, email, calendario, HubSpot, MCP), almacén de **secretos cifrados** (hoy
  `getSecret` no tiene *backend*: los webhooks con `{{secret:X}}` fallan con un error explícito).
- Stripe (planes con `price_…` configurable ya existen; faltan checkout, webhooks, suscripciones y facturas).
- Política de límites **BLOCK vs REQUIRE_ADMIN_APPROVAL** (hoy siempre BLOCK).
- Platform Admin global (ingresos solo desde Stripe, sin inventarlos; conversaciones; errores; logs).
- Crear usuarios directamente (hoy solo por invitación, que depende del email).
- Agent Builder por pestañas (hoy es un formulario largo por secciones).
- Detalle de ejecución de workflow con **duración, entrada y salida** por nodo (hoy: estado, intentos, logs y salida).
- Estados de carga (`loading.tsx`) y de error (`error.tsx`) por sección.

## 5. WHAT SHOULD BE REUSED (sin tocar su diseño)

`packages/core` completo (router, runtime, guardrails, SSRF, motor de workflows, plantillas, RAG), el esquema de BD y el kit de
RLS, la cola de jobs y el worker, la API v1 con `withApi`, el sistema de sesión y RBAC, y los componentes UI base.

## 6. WHAT SHOULD BE REFACTORED (controlado)

| Qué | Por qué |
|---|---|
| Layout de la app | Responsive (drawer en móvil) y separación de rutas `(marketing)` / `(app)` para la web pública |
| Agent editor | Pestañas en lugar de un formulario continuo |
| Navegación | Añadir «Soluciones» y ocultar los módulos pendientes en lugar de mostrarlos como «F6/F7…» a clientes finales |
| Plantillas | Unificarlas en un **catálogo de soluciones** (agente + workflow + KB + canales) sobre las plantillas de agente existentes |

## 7. WHAT SHOULD NOT BE TOUCHED

Las migraciones 0001–0005 ya aplicadas (solo se añaden migraciones nuevas), el modelo de aislamiento (RLS +
`organization_id` inmutable), el contrato de la API v1, el formato del estado de workflows (hay runs persistidos) y la
elección de stack (funciona y está verificado).

## 8. Revisión de seguridad (estado actual)

| Área | Estado |
|---|---|
| Authentication | ✅ Supabase Auth; `getUser()` en cada petición; errores genéricos |
| Authorization / RBAC | ✅ Matriz de roles + RLS por rol; Platform Admin no autoasignable |
| RLS / tenant isolation | ✅ Verificado por SQL, PostgREST real y API (IDs manipulados → 404) |
| API validation | ✅ zod en todas las entradas; 413/415; UUIDs validados |
| Rate limiting | ✅ API por clave y plan. ⏳ Login: depende del límite de GoTrue |
| Secrets | ✅ Nada en Git; nunca en prompts, logs ni estado. ⏳ Falta el almacén cifrado para integraciones |
| SSRF | ✅ Validación en el momento de conectar, redirecciones re-validadas, tests |
| XSS | ✅ React escapa; sin `dangerouslySetInnerHTML`; branding validado |
| CSRF | ✅ Server Actions con verificación de `Origin`; la API usa Bearer (sin cookies) |
| Prompt injection | ✅ Delimitación, detección, allowlist y aprobación humana |
| Tool permissions | ✅ Allowlist por agente; tools externas con hosts permitidos |
| File uploads | 🟡 Detección de tipo por *magic number* y límite de tamaño hechos; falta el flujo de subida (fase RAG) |
| Webhooks entrantes | ⏳ WhatsApp/Stripe pendientes (se verificará la firma) |
| OAuth / MCP | ⏳ Pendientes |
| Logs | ✅ pino con redacción, IDs de petición y de ejecución |

## 9. Plan (priorización aplicada)

La especificación define el MVP por 17 pasos que deben funcionar realmente. Orden elegido para llegar antes a ellos sin
dejar nada a medias:

1. **Terminar RAG** (estaba a medias; pasos 6, 7 y 12 del MVP).
2. **Responsive** del dashboard (defecto de gravedad alta).
3. **Conversaciones + AI Customer Support por web** (pasos 10–13).
4. **Crear usuarios** desde el Platform Admin (paso 3).
5. **Web pública premium + demo honesta** (P1).
6. **Catálogo de soluciones + Activar solución** (template → instancia).
7. Leads/CRM → integraciones (WhatsApp primero) → límites con aprobación → Stripe → *hardening* → producción.

El paso 17 (aislamiento entre organizaciones) ya está verificado y seguirá cubierto por los tests de cada módulo nuevo.
