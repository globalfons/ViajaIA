# Workflows

## Crear un workflow
1. **Workflows → Nuevo workflow** (en blanco o desde una plantilla de la agencia o de la organización).
2. En el editor, añade nodos desde la paleta y conéctalos arrastrando de la salida (derecha) a la entrada (izquierda).
3. Configura cada nodo en el panel derecho. La validación en vivo marca en rojo los nodos con problemas.
4. **Guardar versión** crea una versión inmutable (se admiten borradores incompletos). **Publicar** valida y fija la
   versión que usarán la API y los disparadores.
5. **Probar borrador** ejecuta la última versión guardada; **Ejecutar publicada**, la publicada. El worker procesa la
   ejecución y el detalle se ve en **Automations**.

## Nodos

| Nodo | Qué hace | Salidas |
|---|---|---|
| START | Recibe la entrada (`{{input.*}}`) | 1 |
| AGENT | Ejecuta un agente de la organización con un mensaje (plantilla) | 1. Salida: `status`, `text`, `structured` y `agentRunId` |
| TOOL | Ejecuta una tool registrada con argumentos (plantillas) | 1 |
| CONDITION | Reglas `eq, neq, gt, gte, lt, lte, contains, not_contains, exists, not_exists, in` combinadas con AND/OR | `true` / `false` |
| PARALLEL | Abre ramas que se ejecutan a la vez | N |
| HUMAN APPROVAL | Crea una aprobación en Automations y espera (puede caducar) | `approved` / `rejected` |
| DELAY | Espera N segundos (≤5 s en línea; más, el run queda en espera y el scheduler lo despierta) | 1 |
| WEBHOOK | Petición HTTP(S) protegida contra SSRF. Cabeceras con `{{secret:NOMBRE}}` resueltas en el servidor | 1 |
| END | Construye la salida del run | — |

Cada nodo AGENT, TOOL o WEBHOOK admite **reintentos** (hasta 5, con *backoff* exponencial), **timeout** y
**continuar aunque falle**.

**Datos entre nodos:** `{{input.campo}}`, `{{nodes.<id>.output.campo}}` y `{{run.id}}`. Si un valor es exactamente una
plantilla, conserva su tipo (número, objeto…).

**Ramas y uniones:** una rama no elegida se marca como `skipped`, y un nodo con varias entradas espera a que todas
se resuelvan. Así, dos ramas de una condición pueden volver a unirse.

**Rechazo:** si una aprobación se rechaza y el nodo no tiene salida `rejected`, el run falla.

## Ejecución (arquitectura)
- El estado completo del run es JSON (`workflow_runs.state`), así que un run puede esperar días y sobrevive a reinicios.
- La web encola `workflow.advance`; el **worker** reclama jobs con `FOR UPDATE SKIP LOCKED`. La `dedupe_key`
  garantiza un único avance activo por run.
- Las decisiones humanas y el worker escriben el estado con **compare-and-set** (`state_version`), sin pérdidas de
  actualización. En caso de conflicto se reintenta sobre el estado fresco.
- Scheduler (cada 15 s): despierta los runs con `next_wake_at` vencido, caduca aprobaciones y recupera jobs huérfanos.
- Una organización suspendida detiene sus runs.

> **El worker es obligatorio** para ejecutar workflows: `pnpm dev:worker` en local, o el contenedor `worker` en producción.

## Depuración de ejecuciones

La página de cada ejecución (`/automations/runs/{id}`) muestra:
- El ID de ejecución, el inicio y la duración total.
- Por nodo, en orden de ejecución: etiqueta, id, tipo, estado, intentos, inicio y duración.
- La **entrada resuelta** de cada nodo, con las plantillas aplicadas y los secretos redactados. En los webhooks nunca se
  guardan las cabeceras, porque pueden contener `{{secret:…}}`.
- La salida, el error y los logs de cada nodo.
- Se actualiza sola mientras la ejecución está activa.
