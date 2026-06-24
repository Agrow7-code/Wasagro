import { describe, expect, it, vi } from 'vitest'

import { alertarFounder } from '../../../src/integrations/whatsapp/founderAlerts.js'
import type { IWhatsAppSender } from '../../../src/integrations/whatsapp/IWhatsAppSender.js'

function crearSenderMock(): IWhatsAppSender & { enviarTexto: ReturnType<typeof vi.fn> } {
  return {
    enviarTexto: vi.fn().mockResolvedValue(undefined),
    enviarTemplate: vi.fn().mockResolvedValue(undefined),
  } as any
}

describe('alertarFounder', () => {
  it('envía al FOUNDER_PHONE inyectado e incluye motivo + datos del usuario', async () => {
    const sender = crearSenderMock()

    const res = await alertarFounder(
      'onboarding_requiere_revision',
      { phone: '593987000111', nombre: 'Don Pepe', finca: 'F010', detalle: 'techo de pasos' },
      { sender, founderPhone: '593900000000' },
    )

    expect(res.sent).toBe(true)
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
    const [to, body] = sender.enviarTexto.mock.calls[0]!
    expect(to).toBe('593900000000')
    expect(body).toContain('Don Pepe')
    expect(body).toContain('F010')
  })

  it('es no-op seguro cuando FOUNDER_PHONE no está configurado', async () => {
    const sender = crearSenderMock()

    const res = await alertarFounder(
      'consentimiento_rechazado',
      { phone: '593987000111' },
      { sender, founderPhone: undefined },
    )

    expect(res.sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('nunca tira si el envío falla (best-effort, no bloquea el flujo)', async () => {
    const sender = crearSenderMock()
    sender.enviarTexto.mockRejectedValueOnce(new Error('WA down'))

    const res = await alertarFounder(
      'aprobacion_escalada',
      { phone: '593987000111' },
      { sender, founderPhone: '593900000000' },
    )

    expect(res.sent).toBe(false)
  })
})
