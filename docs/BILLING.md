# Planes, límites y facturación

## Planes y límites

Los planes (`STARTER`, `PRO`, `BUSINESS`, `ENTERPRISE` y los que crees) se gestionan en **Platform Admin → Configuración**.
Cada plan define sus **límites** en JSON. Un límite ausente o `null` significa «sin límite». La agencia puede ajustar los
límites de un cliente concreto en su ficha: esos valores sustituyen a los del plan.

| Clave | Qué limita |
|---|---|
| `monthly_llm_cost_usd` | Coste LLM del mes (USD, calculado con los precios de la tabla de modelos) |
| `monthly_tokens` | Tokens del mes |
| `max_agents`, `max_workflows`, `max_knowledge_bases`, `max_documents` | Recursos |
| `max_workflow_runs_per_month`, `max_monthly_conversations` | Uso mensual |
| `max_storage_mb`, `max_members`, `max_integrations` | Capacidad |
| `requests_per_minute` | API pública |

**Política al alcanzar un límite** (por cliente): `block` corta el servicio. `require_approval` crea **una** solicitud
por límite y mes, pausa el servicio y muestra un aviso en Usage. El Platform Admin concede margen extra o la rechaza en
Platform Admin → Resumen.

## Precios

La plataforma **no contiene precios**. Se crean en Stripe (producto y precio recurrente) y en Platform Admin →
Configuración se vincula cada plan con su `price_…`. Al vincularlo, se consulta Stripe y se guardan su importe, moneda y
periodicidad. Solo se muestran y se pueden contratar los planes con un precio activo vinculado.

## Stripe

Variables: `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`. Sin ellas, la facturación online está desactivada y la
agencia asigna los planes a mano.

Webhook: `{APP_URL}/api/webhooks/stripe` con los eventos `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.created`, `invoice.finalized`,
`invoice.paid`, `invoice.payment_failed`, `invoice.voided` e `invoice.marked_uncollectible`.

**Flujo**
1. El propietario de la organización pulsa «Contratar» en `/billing`. Se crea (una sola vez, con clave de idempotencia)
   el *customer* de Stripe asociado a la organización y se abre Stripe Checkout.
2. Stripe envía los webhooks. Se verifica la firma (HMAC-SHA256, tolerancia de 5 minutos) y cada evento se aplica una
   sola vez (`stripe_events`). La organización se identifica por su `stripe_customer_id`; los eventos de *customers*
   desconocidos se ignoran.
3. Con la suscripción `active` o `trialing`, la organización pasa al plan del precio contratado. Si se cancela y no queda
   ninguna activa, vuelve al plan por defecto de la plataforma.
4. Las facturas se replican en `invoices`. Los **ingresos del mes** del Platform Admin son la suma de las facturas
   pagadas ese mes. Si no hay datos de Stripe, se muestra «Sin datos», nunca una estimación.
5. «Gestionar suscripción y pago» abre el Billing Portal de Stripe (cambio de plan, método de pago, cancelación y
   facturas).

**Permisos**
- Ven la facturación los owners y admins (`billing.read`); solo los owners pueden contratar o cambiar de plan
  (`billing.manage`).
- Suscripciones y facturas tienen RLS por organización y solo las escribe el servidor.
- `plan_prices` la pueden leer todos los usuarios con sesión y solo la escribe el servidor tras `requirePlatformAdmin()`.
