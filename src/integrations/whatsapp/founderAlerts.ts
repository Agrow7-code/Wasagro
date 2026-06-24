import type { IWhatsAppSender } from './IWhatsAppSender.js'

/**
 * Reasons a founder gets alerted about a troubled onboarding (change:
 * onboarding-hardening). Kept as a string union so callers are explicit and
 * the message copy can branch per reason.
 */
export type FounderAlertReason =
  | 'onboarding_requiere_revision'
  | 'consentimiento_rechazado'
  | 'aprobacion_escalada'

export interface FounderAlertPayload {
  phone?: string
  nombre?: string | null
  finca?: string | null
  org?: string | null
  detalle?: string
}

export interface FounderAlertDeps {
  sender?: IWhatsAppSender
  /** Defaults to process.env.FOUNDER_PHONE. Pass explicitly in tests. */
  founderPhone?: string | undefined
}

const TITULOS: Record<FounderAlertReason, string> = {
  onboarding_requiere_revision: '⚠️ Onboarding trabado — requiere revisión',
  consentimiento_rechazado:     '⚠️ Un contacto rechazó el consentimiento',
  aprobacion_escalada:          '⚠️ Aprobación de agricultor sin resolver',
}

export function construirMensajeFounder(reason: FounderAlertReason, p: FounderAlertPayload): string {
  const quien = [p.nombre, p.phone].filter(Boolean).join(' · ') || 'usuario desconocido'
  const donde = [p.finca, p.org].filter(Boolean).join(' / ')
  const lineas = [TITULOS[reason], quien]
  if (donde) lineas.push(donde)
  if (p.detalle) lineas.push(p.detalle)
  return lineas.join('\n')
}

/**
 * Sends a best-effort WhatsApp alert to the founder. NEVER throws and NEVER
 * blocks the calling flow (P4): if FOUNDER_PHONE is unset or the send fails,
 * it returns { sent: false }. Idempotency is the caller's responsibility —
 * alert only on a real state transition (setOnboardingEstado returns it).
 */
export async function alertarFounder(
  reason: FounderAlertReason,
  payload: FounderAlertPayload,
  deps: FounderAlertDeps = {},
): Promise<{ sent: boolean }> {
  const founderPhone = deps.founderPhone ?? process.env['FOUNDER_PHONE']
  if (!founderPhone) {
    console.warn('[founder-alert] FOUNDER_PHONE no configurado — alerta omitida', { reason })
    return { sent: false }
  }

  // Lazy import: only build the default sender (which pulls in the supabase
  // client) when no sender was injected — keeps this helper importable in
  // isolation (tests, lightweight callers).
  const sender = deps.sender ?? (await import('./index.js')).crearSenderWhatsApp()
  try {
    await sender.enviarTexto(founderPhone, construirMensajeFounder(reason, payload))
    return { sent: true }
  } catch (err) {
    console.error('[founder-alert] fallo enviando alerta al founder (no-bloqueante):', err)
    return { sent: false }
  }
}
