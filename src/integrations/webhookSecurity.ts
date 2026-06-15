import { createHmac, timingSafeEqual } from 'node:crypto'

// ── Verificación de webhooks de proveedores que no traen firma nativa estándar ─
// Patrón doble, ambos timing-safe y fail-closed:
//   1) HMAC-SHA256 sobre el body raw, firma en un header (estilo Cal.com/Meta).
//   2) Token compartido en query/header (cuando NOSOTROS controlamos la URL de
//      notificación, como en dLocal Go, donde fijamos `notification_url`).
// Se acepta el webhook si CUALQUIERA de los dos verifica. Si no hay secreto
// configurado, el caller debe rechazar (nunca procesar un pago sin verificar).

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/** Verifica HMAC-SHA256(body, secret) contra una firma hex (con o sin prefijo `sha256=`). */
export function verifyHmacSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const clean = signature.startsWith('sha256=') ? signature.slice(7) : signature
  return safeEqual(clean, expected)
}

/** Verifica un token compartido (query param o header) contra el secreto esperado. */
export function verifySharedToken(
  provided: string | undefined | null,
  secret: string,
): boolean {
  if (!provided || !secret) return false
  return safeEqual(provided, secret)
}
