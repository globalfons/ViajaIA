# API v1

- Especificación OpenAPI 3: `GET /api/openapi.json`. Se genera a partir de los mismos schemas zod que validan las
  peticiones, así que la documentación no puede desincronizarse del código.
- Autenticación: `Authorization: Bearer dtn_…`. Las claves se crean en **Settings → API keys** (owner/admin),
  están ligadas a una organización, tienen *scopes* y caducidad opcional, y se guardan solo como hash SHA-256.
- Rate limit por clave: `requests_per_minute` del plan u override del cliente (120 por defecto). Si se supera, `429`.
- Todas las respuestas incluyen `x-request-id`.

| Método | Ruta | Scope |
|---|---|---|
| GET | `/api/v1/agents` | `agents:read` |
| POST | `/api/v1/agents` | `agents:write` |
| GET/PATCH/DELETE | `/api/v1/agents/{id}` | `agents:read` / `agents:write` |
| POST | `/api/v1/agents/{id}/runs` | `agents:run` |
| POST | `/api/v1/runs/{id}/decision` | `agents:run` |
| GET | `/api/v1/usage?from=&to=` | `usage:read` |

Errores: `{ "error": { "code", "message", "details?" } }`. Códigos: `400` validación, `401` clave, `402` límite
del plan o presupuesto, `403` scope u organización suspendida, `404`, `413`, `415`, `429` y `500`.

Los endpoints de workflows, conversaciones, knowledge, leads, tasks, integraciones y webhooks se añaden en sus fases.

## Ejemplo
```bash
curl -X POST "$APP_URL/api/v1/agents/$AGENT_ID/runs" \
  -H "Authorization: Bearer $DTN_API_KEY" -H "Content-Type: application/json" \
  -d '{"message":"¿Qué horario tenéis?"}'
```
