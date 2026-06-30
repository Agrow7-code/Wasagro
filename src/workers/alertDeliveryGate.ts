/**
 * Exported gate helper for the ALERT_DELIVERY_ENABLED env flag.
 *
 * PR#3b COMPLETE: entregarAlertaPlaga is now wired at the EventHandler confirmation
 * point (pending_confirmation → saveEvento) with real eventId idempotency and
 * M12 is_first_alert via decision_alerta.ask_count.
 *
 * Setting ALERT_DELIVERY_ENABLED=true in prod will activate the live delivery path.
 * The pgBoss extraction-stage path remains gated OFF permanently (see pgBoss.ts).
 *
 * Isolated from pgBoss.ts so it can be unit-tested without importing Supabase/PgBoss
 * singletons. Do not add dependencies to this file.
 */

/**
 * Returns true when live pest-alert delivery is explicitly enabled.
 * Default (unset / any value other than 'true') = delivery is inert in prod.
 *
 * PR#3b complete — safe to set ALERT_DELIVERY_ENABLED=true in prod after:
 *   1. Verifying this change passes sdd-verify
 *   2. Confirming quarantine copy with the agronómico (D29 flag in alertaEntrega.ts)
 *   3. Flipping the flag in Railway environment variables
 */
export function isAlertDeliveryEnabled(): boolean {
  return process.env['ALERT_DELIVERY_ENABLED'] === 'true'
}
