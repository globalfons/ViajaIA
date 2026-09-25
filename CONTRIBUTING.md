# Contribuir

## Flujo
1. Rama por cambio. Commits pequeños y descriptivos.
2. Antes de hacer push: `pnpm typecheck && pnpm test && pnpm --filter @dtn/web build`.
3. Toda migración SQL nueva va en `supabase/migrations/NNNN_nombre.sql`, es idempotente cuando sea posible
   e incluye las políticas RLS de las tablas que crea.

## Reglas
- **Multi-tenant**: toda tabla de negocio tiene `organization_id` y RLS. El código con *service role*
  (worker y webhooks) filtra siempre por `organization_id`.
- **Secretos**: nunca en el repositorio, en los logs ni en los prompts. Credenciales de clientes → `secrets` (cifradas).
- **Tests**: sin llamadas a APIs reales. Usar los *fakes* de `packages/core/test/fixtures`.
- **Dependencias**: solo MIT, Apache-2.0, BSD, ISC o similares. Antes de añadir una, se comprueban la licencia,
  la actividad y el `pnpm audit`, y se registra en `THIRD_PARTY_NOTICES.md`.
- **UI**: nada de botones sin acción. Si algo no está implementado, no se muestra o se muestra deshabilitado
  indicando la fase.
- Código y comentarios en inglés. UI y documentación de usuario en español.
