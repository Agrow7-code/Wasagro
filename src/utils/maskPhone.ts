/**
 * Masks a phone number to its last 4 digits for log/response safety (P5/D31).
 *
 * Extracted from the 4-way duplicate in pgBoss.ts, alertaEntrega.ts,
 * provisionarCliente.ts, and EventHandler.ts (T-S2.1, founder-backoffice
 * change). Existing call sites are NOT migrated in this PR — that is a
 * follow-up refactor outside this change's behavioral scope.
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****'
  return `****${phone.slice(-4)}`
}
