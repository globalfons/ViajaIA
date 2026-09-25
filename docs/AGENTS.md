# Agentes

## Crear un agente (UI)
1. Entra en la organización del cliente (selector superior, o *Clients → Abrir panel del cliente*).
2. **Agents → Nuevo agente**: elige una plantilla (Customer Support, Receptionist, Sales, Lead Qualification,
   Document Assistant, Internal Knowledge, Appointment, Marketing, WhatsApp, Voice), una plantilla propia o «En blanco».
3. Pon un nombre y elige el modelo. El listado de modelos lo gestiona el Platform Admin en **Platform Admin → Modelos**.
4. El agente se crea como **borrador**. Ajusta el prompt, las tools, los guardrails y los límites, y pruébalo en el **Playground**.
5. Cambia el estado a **Activo**: solo los agentes activos responden por API y por canales.

Cada guardado crea una **versión** nueva (se puede restaurar). **Guardar como plantilla** permite reutilizar el agente
en otros clientes («Create from Template»); la plantilla no incluye el modelo ni las knowledge bases del cliente.

## Configuración

| Campo | Qué hace |
|---|---|
| System prompt / Instrucciones | Admiten variables: `{{company_name}}` y las de `organizations.settings.variables` |
| Modelo / fallbacks | `proveedor:modelo`. Si el principal falla, se prueban los fallbacks en orden |
| Tools | **Allowlist**: el modelo solo ve y solo puede ejecutar las tools marcadas |
| Aprobación humana | Por tool, o para todas las de escritura o externas. La ejecución se pausa hasta que alguien decide |
| Escalado por confianza | Con un schema de salida que incluya `confidence`, por debajo del umbral el resultado queda `escalated` |
| Guardrails | *Prompt injection* (marcar/bloquear), temas bloqueados, longitud máxima y aviso de IA |
| Límites | Pasos por ejecución, coste por ejecución, presupuesto mensual del agente y *timeout* |
| Memoria | Número de mensajes previos que se envían al modelo |
| Structured output | JSON Schema; la respuesta se devuelve como objeto validable |

## Estados de una ejecución

| Estado | Significado |
|---|---|
| `completed` | Respuesta final |
| `needs_approval` | Pausada: una tool requiere aprobación (`pending_approval`) |
| `escalated` | Respondida, pero debe revisarla una persona (confianza baja o `needs_human`) |
| `blocked` | Rechazada por un guardrail (tema bloqueado, inyección, longitud) |
| `failed` | Error (LLM, límite de pasos, coste o presupuesto) |

## Añadir una tool nueva (desarrolladores)
1. Define un `ToolDefinition` en `packages/core/src/tools/` con `parameters` (zod), `risk` y `execute`.
2. Los secretos se obtienen con `ctx.getSecret(name)` dentro de `execute`: **nunca** en argumentos ni en resultados.
3. Si la tool tiene efectos irreversibles (enviar, pagar o borrar), pon `alwaysRequireApproval: true`.
4. Regístrala en `BUILTIN_TOOLS` o pásala como `extraTools` a `createAgentRuntime`.
5. Añade tests con `FakeProvider` (`@dtn/core/testing/fake-llm`).

## Añadir una plantilla (producto)
Añade una entrada a `packages/core/src/templates/agent-templates.ts`. El test `templates.test.ts` garantiza que
genera una configuración válida y que solo usa tools existentes.
