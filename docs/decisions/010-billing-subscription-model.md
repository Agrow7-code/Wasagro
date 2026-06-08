# 010 — Billing: Suscripción mensual fija con trial 30 días + dLocal Go / DeUna

**Fecha:** 2026-06-06 (pasarela actualizada Stripe → dLocal Go el 2026-06-08)
**Estado:** Aceptada
**Decisiones relacionadas:** D26 (CLAUDE.md), D27 (costos), D28 (back-office)

## Contexto

Wasagro no tiene forma de cobrar. `organizaciones.plan` es TEXT libre sin CHECK constraint — cualquier string es aceptado, no hay trial, no hay vencimiento, no hay pasarela de pago. Los clientes usan Wasagro gratis indefinidamente. Sin billing, no hay negocio.

El modelo de cobro inicial es suscripción mensual fija. El éxito será monitorear constantemente para encontrar el modelo óptimo (flat, híbrido, pay-per-use) basado en data real de costos (D27) vs. revenue.

## Decisión

### Planes

| Plan | Trial | Post-trial si no paga | Features |
|---|---|---|---|
| `trial` | 30 días gratis, todo habilitado | Se bloquea | Full access por 30 días |
| `free` | — | Solo lectura de eventos existentes | Sin crear nuevos, sin métricas, sin alertas, sin resumen |
| `starter` | — | Suscripción mensual fija | Crear eventos + métricas + alertas + resumen semanal |
| `enterprise` | — | Suscripción mensual fija superior | Starter + multi-finca + API + soporte prioritario |

### Flujo de vida de una org

```
signup → trial (30 días) → [paga] → starter/enterprise (activo)
                         → [no paga] → bloqueado (bloquea acceso, data se preserva)
                         → [cancela después de pagar] → free (solo lectura)
```

### Trial → bloqueo (no degradación)

Después de 30 días sin pago, se bloquea el acceso:
- WhatsApp: responde con aviso de upgrade
- Dashboard: redirige a pantalla de payment
- Data se preserva intacta — no se borra nada

### Métodos de pago

1. **dLocal Go Transparent Checkout / SmartFields** (internacional). dLocal Go ≠ dLocal clásico:
   - Auth: `Bearer <API_KEY>:<SECRET_KEY>` (sin HMAC, sin X-Login/X-Trans-Key).
   - URLs: `https://api-sbx.dlocalgo.com` (sandbox), `https://api.dlocalgo.com` (live).
   - Flow 2 pasos: (1) backend `POST /v1/payments` con `allow_transparent:true, allow_recurring:true` → `merchant_checkout_token`; (2) frontend tokeniza la tarjeta con SmartFields; (3) backend `POST /v1/payments/confirm/{checkoutToken}` con el card token. Si `confirm` devuelve `redirect_url` (3DS), el frontend redirige.
   - Recurring: `POST /v1/payments/recurring/{merchant_checkout_token}` — el checkout token ES el recurring token.
   - Webhooks: dLocal Go POSTea el payment object a la `notification_url` definida al crear el payment (`PAID`/`COMPLETED`/`REJECTED`/`DECLINED`/`CANCELLED`/`PENDING`).
2. **DeUna** (Ecuador): link de pago generado vía API, enviado por WhatsApp. Webhook confirma pago.
3. **Transferencia bancaria** (Ecuador): cliente envía comprobante por WhatsApp → AI detecta intent `pago_subscription` → marca `requiere_validacion` → founder aprueba manualmente (Rule 3).

### Cancelación

- Cliente cancela desde dashboard o WhatsApp (intent `cancelar_subscription`).
- Efecto al fin del período pagado (no prorrateo). Se setea `subscription_status='canceled'` y se limpia `dlocalgo_checkout_token`.
- Org pasa a `free` al expirar — data se preserva, solo lectura.

### Schema cambios

Campos en `organizaciones` (estado final tras migraciones 53 + 54):
- `plan plan_org NOT NULL DEFAULT 'trial'` (enum reemplaza TEXT)
- `trial_inicio TIMESTAMPTZ`
- `trial_fin TIMESTAMPTZ` (generated: trial_inicio + 30 días)
- `dlocalgo_payment_id TEXT`
- `dlocalgo_checkout_token TEXT`
- `subscription_status TEXT` (`active`, `past_due`, `canceled`, `none`)
- `plan_activo_desde TIMESTAMPTZ`
- `plan_cancelado_en TIMESTAMPTZ`
- `metodo_pago TEXT` CHECK IN (`dlocalgo`, `deuna`, `transferencia`)

### Implementación

`src/integrations/dlocal/dlocalClient.ts` (Bearer auth, createPayment, confirmPayment, chargeRecurring, getSmartFieldsApiKey), `dlocalWebhookHandler.ts`, `src/integrations/deuna/deunaClient.ts`, `src/pipeline/handlers/BillingIntentHandler.ts`, `src/auth/planGuard.ts`, `landing/src/dashboard/views/BillingView.tsx`. Env: `DLOCALGO_API_KEY`, `DLOCALGO_API_SECRET`, `DLOCALGO_SMARTFIELDS_API_KEY`, `DLOCALGO_API_URL`. Migraciones: `20260101000053_replace-stripe-with-dlocal.sql`, `20260101000054_dlocalgo-correct-columns.sql`.

## Consecuencias

**Gana:**
- Primera fuente de revenue.
- Data para calcular margen real por cliente (con D27).
- Flujo automatizado de trial → paid → cancel.
- Cobertura: dLocal Go (internacional + LATAM) + DeUna/transferencia (Ecuador).

**Pierde/Riesgos:**
- Comprobantes por WhatsApp requieren validación manual (Rule 3) → fricción, pero seguro.
- Trial de 30 días puede ser generoso si el costo de servir es alto → D27 permite ajustar.
- DeUna es relativamente nuevo → riesgo de API inestable.
- SmartFields exige cargar el SDK JS de dLocal Go en el frontend (dependencia de su CDN).

### Historial — por qué se descartó Stripe

La pasarela internacional original de esta decisión fue **Stripe** (Checkout Session + Subscription + webhooks). Se descartó porque **Stripe requiere crear una LLC en EE.UU.**, fuera del alcance del equipo en H0-R. Se ripearon `checkoutService.ts` y `stripeWebhookHandler.ts`, y las columnas `stripe_customer_id`/`stripe_subscription_id` se reemplazaron por `dlocalgo_*` (migraciones 53 → 54). El modelo de planes, trial, bloqueo y cancelación **no cambió** — solo la pasarela.
