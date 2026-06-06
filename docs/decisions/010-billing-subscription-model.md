# 010 — Billing: Suscripción mensual fija con trial 30 días + Stripe / DeUna

**Fecha:** 2026-06-06
**Estado:** Aceptada
**Decisiones relacionadas:** D26 (CLAUDE.md), D27 (costos), D28 (back-office)

## Contexto

Wasagro no tiene forma de cobrar. `organizaciones.plan` es TEXT libre sin CHECK constraint — cualquier string es aceptado, no hay trial, no hay vencimiento, no hay pasarela de pago. Los clientes usan Wasagro gratis indefinidamente. Sin billing, no hay negocio.

El modelo de cobro inicial es suscripción mensual fija. El éxito del analyst será monitorear constantemente para encontrar el modelo óptimo (flat, híbrido, pay-per-use) basado en data real de costos (D27) vs. revenue.

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

1. **Stripe** (internacional): Checkout Session → Subscription → Webhooks sincronizan estado. Stripe maneja retry, dunning, facturación.
2. **DeUna** (Ecuador): Link de pago generado via API, enviado por WhatsApp. Webhook confirma pago.
3. **Transferencia bancaria** (Ecuador): Cliente envía comprobante por WhatsApp → AI detecta intent `pago_subscription` → marca `requiere_validacion` → founder aprueba manualmente.

### Cancelación

- Cliente cancela desde dashboard o WhatsApp (intent `cancelar_subscription`)
- Efecto al fin del período pagado (`cancel_at_period_end`)
- No prorrateo
- Org pasa a `free` — data se preserva, solo lectura

### Schema cambios

Campos nuevos en `organizaciones`:
- `plan plan_org NOT NULL DEFAULT 'trial'` (enum reemplaza TEXT)
- `trial_inicio TIMESTAMPTZ`
- `trial_fin TIMESTAMPTZ` (generated: trial_inicio + 30 días)
- `stripe_customer_id TEXT`
- `stripe_subscription_id TEXT`
- `subscription_status TEXT` (`active`, `past_due`, `canceled`, `none`)
- `plan_activo_desde TIMESTAMPTZ`
- `plan_cancelado_en TIMESTAMPTZ`
- `metodo_pago TEXT` (`stripe`, `deuna`, `transferencia`)

## Consecuencias

**Gana:**
- Primera fuente de revenue
- Data para calcular margen real por cliente (con D27)
- Flujo automatizado de trial → paid → cancel
- Dos vías de pago para Ecuador (DeUna + transferencia) e internacional (Stripe)

**Pierde/Riesgos:**
- Stripe no soporta todos los bancos ecuatorianos directamente → DeUna y transferencia cubren ese gap
- Comprobantes por WhatsApp requieren validación manual (Rule 3) → agrega fricción pero es seguro
- Trial de 30 días puede ser generoso si el costo de servir es alto → D27 permite ajustar
- DeUna es relativamente nuevo → riesgo de API inestable

**Próximos pasos:**
- Implementar enum + migration
- Integrar Stripe Checkout + webhooks
- Integrar DeUna API
- Implementar intent de pago por WhatsApp
- Implementar planGuard middleware
