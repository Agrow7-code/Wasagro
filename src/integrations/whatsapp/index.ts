import type { IWhatsAppAdapter } from './IWhatsAppAdapter.js'
import { MetaAdapter } from './MetaAdapter.js'
import { EvolutionAdapter } from './EvolutionAdapter.js'

export type WhatsAppProvider = 'meta' | 'evolution'

export function crearAdapterWhatsApp(): IWhatsAppAdapter {
  const provider = process.env['WHATSAPP_PROVIDER'] as WhatsAppProvider | undefined

  if (provider === 'meta') {
    const appSecret = process.env['WHATSAPP_APP_SECRET']
    const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN']
    if (!appSecret || !verifyToken) {
      throw new Error('WHATSAPP_PROVIDER=meta requiere WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN')
    }
    return new MetaAdapter({ appSecret, verifyToken })
  }

  if (provider === 'evolution') {
    const secret = process.env['EVOLUTION_WEBHOOK_SECRET'] ?? ''
    return new EvolutionAdapter({ secret })
  }

  throw new Error(
    `WHATSAPP_PROVIDER="${provider ?? ''}" no es válido. Valores aceptados: meta | evolution`
  )
}

export { MetaAdapter, EvolutionAdapter }
export type { IWhatsAppAdapter }
export type { NormalizedMessage } from './NormalizedMessage.js'
