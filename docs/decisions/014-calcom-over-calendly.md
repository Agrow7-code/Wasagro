# 014 — Booking de demos: Cal.com (SaaS) sobre Calendly

**Fecha:** 2026-06-07
**Estado:** Aceptada
**Decisiones relacionadas:** D23, D24, D25 (CLAUDE.md), D13 (pipeline SDR)

## Contexto

El pipeline SDR (D13) cerraba demos enviando `DEMO_BOOKING_URL`, un link estático de Calendly. Calendly no daba feedback al sistema: cuando un prospecto agendaba, Wasagro no se enteraba. El `sdrChaserWorker` seguía mandando reenganche a prospectos que ya habían agendado, y los founders no recibían aviso de una demo nueva. Sin webhook entrante, el estado de `sdr_prospectos` quedaba desincronizado de la realidad.

## Decisión

Reemplazar Calendly por **Cal.com en modo SaaS** (cal.com hosted, no self-hosted — el self-hosted queda previsto para H1). El booking sigue siendo un URL que se envía al prospecto, pero ahora hay webhook bidireccional.

### Configuración (producción, verificada en smoke 2026-06-07)

- **Cal.com user:** `wasagro` — booking link `https://cal.com/wasagro/30min`.
- **Event Type ID:** `5923788` (slug `30min`).
- **API base:** `https://api.cal.com/v2` (`cal-api-version: 2024-08-13` para bookings, `2024-06-14` para webhooks).
- **Webhook subscriber:** `https://wasagro-production.up.railway.app/webhook/calcom`, triggers `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_REQUESTED`.
- **Env:** `CALCOM_API_KEY` (`cal_live_...`), `CALCOM_WEBHOOK_SECRET`, `CALCOM_BOOKING_URL`, `FOUNDER_PHONE`, `FOUNDER_EMAIL`, `RESEND_API_KEY` (opcional).

### Webhook entrante

`POST /webhook/calcom` → `handleCalcomWebhook`. Verifica firma con HMAC-SHA256 sobre el body raw; header `x-cal-signature-256` (lowercase, hex puro sin prefijo `sha256=`), en `verifyCalcomSignature`.

- **`BOOKING_CREATED`:** busca el prospecto por email/teléfono del attendee (o `metadata.prospecto_id`), actualiza `sdr_prospectos.status → reunion_agendada` + `reunion_agendada_at` + `calcom_booking_id`. Notifica al founder por WhatsApp (`FOUNDER_PHONE`); si `RESEND_API_KEY` está configurada, además manda email custom — si no, Cal.com manda su email automático al organizer.
- **`BOOKING_CANCELLED`:** NO revierte el status automáticamente (Rule 3 — ninguna acción irreversible sin aprobación humana). Registra `booking_cancelled_at` y notifica al founder para que decida.

### Chaser

`sdrChaserWorker` verifica `calcom_booking_id IS NOT NULL` antes de reenganchar — si ya agendó, no molesta (ver D24 para los dos modos de chaser).

### Sin SDK

Cal.com no tiene SDK JS — integración exclusiva vía webhook (inbound) + REST API v2 (outbound, para crear bookings de smoke con `metadata.prospecto_id`). No se agrega dependencia npm.

## Consecuencias

**Gana:**
- Estado de `sdr_prospectos` sincronizado con la realidad del calendario.
- Founders avisados al instante de cada demo agendada.
- Chaser deja de molestar a quien ya agendó.

**Pierde/Riesgos:**
- Dependencia de la disponibilidad del SaaS de cal.com.
- La firma del webhook debe verificarse sobre el body **raw** — re-serializar el JSON rompe la verificación.

**Gotchas resueltos en el smoke (2026-06-07):**
1. `AttendeeSchema` rechazaba `phoneNumber: null` (default de Cal.com) → ahora nullable.
2. `saveSDRInteraccion` con `action_taken='booking_confirmed_webhook'` violaba el CHECK de `sdr_interacciones` → usar `'meeting_confirmed'` (confirmación) y `'graceful_exit'` (cancelación).
3. El init de Stripe en `checkoutService.ts` crasheaba al startup sin `STRIPE_SECRET_KEY` → era lazy-init via Proxy (Stripe ya fue removido por completo, ver ADR 010).

**Nota de numeración:** D23 referenciaba `009-calcom-over-calendly.md`, pero el `009` ya estaba ocupado por `llm-decision-audit.md`. Este ADR usa el siguiente número libre (014).
