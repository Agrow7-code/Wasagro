// Redacción de PII para logs. Los teléfonos son datos de la finca/prospecto
// (P5): nunca deben aparecer completos en stdout (Railway/Vercel logs).

/** Devuelve solo los últimos 4 dígitos enmascarados: `***4321`. */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return '***'
  const s = String(phone)
  return `***${s.slice(-4)}`
}
