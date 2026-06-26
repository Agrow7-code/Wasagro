/**
 * Exported gate helper for the ALERT_DELIVERY_ENABLED env flag.
 *
 * Live delivery is gated OFF by default until PR#3 wires entregarAlertaPlaga at the
 * confirmation point in EventHandler (where eventos_campo is inserted and event_id
 * is available for idempotency keying + decision_alerta tracking).
 *
 * Isolated from pgBoss.ts so it can be unit-tested without importing Supabase/PgBoss
 * singletons. Do not add dependencies to this file.
 */

/**
 * Returns true when live pest-alert delivery is explicitly enabled.
 * Default (unset / any value other than 'true') = delivery is inert in prod.
 *
 * Do not set ALERT_DELIVERY_ENABLED=true in prod until PR#3 completes:
 *   - wires entregarAlertaPlaga at the EventHandler confirmation point
 *   - passes eventId + markAlertaEntregada for the idempotency guard
 *   - implements M12 is_first_alert via decision_alerta.ask_count
 */
export function isAlertDeliveryEnabled(): boolean {
  return process.env['ALERT_DELIVERY_ENABLED'] === 'true'
}
