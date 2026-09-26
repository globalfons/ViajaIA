# Integraciones y canales

Estado real de cada integración. «Disponible» significa implementada y probada. «Próximamente» se muestra así en la UI,
sin botones que simulen una conexión.

| Integración | Estado | Dónde se configura |
|---|---|---|
| Chat web (widget) | Disponible | Integrations → Chat web |
| WhatsApp Business (Cloud API de Meta) | Disponible (si la agencia configura su app de Meta) | Integrations → WhatsApp Business |
| Email (entrada por webhook, salida con Resend) | Disponible | Integrations → Email |
| Google Calendar (OAuth) | Disponible (si la agencia configura su cliente OAuth) | Integrations → Google Calendar |
| Proveedores LLM | Disponibles según las variables de entorno | `.env` del servidor |
| API REST v1 | Disponible | Settings → API keys |
| Telegram, Slack, Microsoft Calendar, HubSpot (UI), MCP | Próximamente | — |

## Credenciales

Los tokens de cada cliente (p. ej. `WHATSAPP_ACCESS_TOKEN`, `RESEND_API_KEY`) se guardan en **Integrations →
Credenciales**, cifrados con AES-256-GCM (`SECRETS_ENCRYPTION_KEYS`). Solo el servidor y el worker los descifran al usar
la integración. Nunca se devuelven al navegador ni llegan al modelo; en la UI solo se ven el nombre y los últimos 4
caracteres.

## WhatsApp Business (Cloud API)

**Una vez por agencia**
1. Crea una app de Meta (tipo *Business*) con el producto WhatsApp.
2. En el servidor, define `WHATSAPP_APP_SECRET` (App Secret de la app) y `WHATSAPP_VERIFY_TOKEN` (un valor aleatorio
   que eliges tú).
3. En Meta → WhatsApp → Configuración, registra el webhook `{APP_URL}/api/webhooks/whatsapp` con ese verify token y
   suscríbete al campo `messages`.

**Por cliente**
1. Guarda el token de acceso del número (idealmente de un *system user*) como credencial `WHATSAPP_ACCESS_TOKEN`.
2. En Integrations → WhatsApp Business, indica el **phone number ID** y el agente. Antes de conectar, la plataforma
   pregunta a Meta si ese token puede operar ese número; si no, rechaza la conexión. Un número solo puede estar conectado
   a un cliente en toda la plataforma.

**Cómo funciona**
- `POST /api/webhooks/whatsapp` verifica `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo con el App Secret, en tiempo
  constante). Sin firma válida devuelve 401. Identifica al cliente por `metadata.phone_number_id`, aplica un rate limit
  por remitente y encola el mensaje. El worker lo procesa **una sola vez** (`messages.external_id` es único), aunque
  Meta reintente.
- El agente responde con su configuración (RAG, tools, guardrails, escalado). Los mensajes que no son texto (imagen,
  audio…) pasan directamente a una persona. Las respuestas del equipo desde Conversations también salen por WhatsApp.
- Solo se responde dentro de la **ventana de 24 h** abierta por el cliente. La plataforma no envía plantillas, difusiones
  ni mensajes no solicitados.
- Si el envío falla, los errores transitorios (red, 429, 5xx) se reintentan con *backoff* y los definitivos se muestran
  en el mensaje («no entregado» y un botón para reintentar).

## Email

**Por cliente**
1. Verifica el dominio del remitente en Resend y guarda la API key como credencial `RESEND_API_KEY`.
2. En Integrations → Email, crea el canal (remitente, agente y credencial). La plataforma muestra **una sola vez** la URL
   del webhook y el token `Authorization: Bearer eit_…`; solo guarda su hash.
3. Configura tu proveedor de correo entrante (Postmark inbound o un reenvío propio) para que haga POST a esa URL con esa
   cabecera.

**Formato de entrada.** Se acepta el webhook de Postmark tal cual o este JSON genérico:

```json
{
  "from": "Ana Pérez <ana@example.com>",
  "subject": "Horario",
  "text": "¿Abrís el sábado?",
  "html": "<p>opcional si no hay text</p>",
  "message_id": "<id@example.com>",
  "headers": { "Auto-Submitted": "no" }
}
```

**Garantías**
- **Borradores por defecto.** La respuesta de la IA queda como borrador en Conversations; una persona la revisa, la edita
  y la envía. El envío automático solo se activa si el cliente lo marca expresamente en el canal (queda en el audit log).
- Nunca se responde automáticamente a correos generados por máquinas: `Auto-Submitted`, `Precedence: bulk/list`,
  `List-Id`, remitentes `no-reply` o `mailer-daemon`, ni a la propia dirección del canal.
- Con envío automático activado, hay un máximo de 5 respuestas automáticas por conversación y hora. A partir de ahí, las
  respuestas vuelven a ser borradores (protección contra bucles).
- Las respuestas mantienen el hilo (`Re:` e `In-Reply-To`/`References`) y se elimina el texto citado del correo
  anterior antes de pasárselo al agente.

## Google Calendar

**Una vez por agencia.** En Google Cloud crea un cliente OAuth (tipo *Aplicación web*), añade la URI de retorno
`{APP_URL}/api/integrations/google/callback` y define `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en el servidor. Para
producción, Google exige verificar la app porque usa permisos de Calendar.

**Por cliente.** Integrations → Google Calendar → «Conectar con Google». Se piden solo los permisos
`calendar.events` y `calendar.freebusy` (más `openid email` para mostrar la cuenta). El *refresh token* se guarda cifrado
(`GOOGLE_CALENDAR_REFRESH_TOKEN`) y en la tabla `integration_connections` solo quedan la cuenta, el estado y el horario.

**Seguridad del flujo.** El `state` es un valor aleatorio que se guarda en una cookie `httpOnly` limitada a la ruta del
callback. En el callback se comprueba que coincide con esa cookie y que la organización activa es la misma que inició la
conexión (protección contra CSRF y confusión de cuentas). Al desconectar, el token se revoca en Google y se borra.

**Tools para agentes**
- `calendar_find_slots` (lectura): huecos libres en el horario configurado (zona horaria, días, franja, duración y
  antelación mínima), cruzados con la disponibilidad real (`freeBusy`).
- `calendar_create_appointment` (escritura): justo antes de escribir, vuelve a comprobar el horario y la disponibilidad.
  Crea el evento sin invitados y con `sendUpdates=none`, así que Google no envía correos. Si el cliente lo configura en
  el agente, puede requerir aprobación humana.
- Si no hay calendario conectado, las tools lo dicen y el agente ofrece tomar los datos. Nunca inventa huecos.
- Si Google revoca el acceso, la conexión pasa a «Requiere reconexión» en Integrations.

Microsoft Calendar todavía no está implementado y aparece como «Próximamente».

## Pruebas

`e2e/fake-providers.mjs` es un **doble de pruebas** que habla los formatos HTTP de OpenAI, Meta Graph, Resend y Google
(OAuth y Calendar), y no
contacta con ningún servicio real. `e2e/channels.mjs` firma los webhooks igual que Meta y comprueba el recorrido completo:
conexión del número, handshake, firma falsificada, respuesta basada en la documentación, idempotencia ante reintentos,
respuesta humana, borrador de email editado y enviado en el mismo hilo, y token incorrecto.
`e2e/calendar.mjs` conecta Google por OAuth, rechaza un callback con `state` falsificado, guarda el horario, y el agente
consulta huecos y reserva la cita desde el chat. Después comprueba la trazabilidad de las tools y la revocación al
desconectar.
