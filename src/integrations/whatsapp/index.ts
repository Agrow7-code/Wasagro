import type { IWhatsAppAdapter } from './IWhatsAppAdapter.js'
import type { IWhatsAppSender } from './IWhatsAppSender.js'
import { MetaAdapter } from './MetaAdapter.js'
import { EvolutionAdapter } from './EvolutionAdapter.js'
import { MetaSender } from './MetaSender.js'
import { EvolutionSender } from './EvolutionSender.js'

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

export function crearSenderWhatsApp(): IWhatsAppSender {
  const provider = process.env['WHATSAPP_PROVIDER'] as WhatsAppProvider | undefined

  if (provider === 'meta') {
    const phoneNumberId = process.env['META_PHONE_NUMBER_ID']
    const accessToken = process.env['WHATSAPP_ACCESS_TOKEN']
    if (!phoneNumberId || !accessToken) {
      throw new Error('WHATSAPP_PROVIDER=meta requiere META_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN')
    }
    return new MetaSender({ phoneNumberId, accessToken })
  }

  if (provider === 'evolution') {
    const apiUrl = process.env['EVOLUTION_API_URL']
    const apiKey = process.env['EVOLUTION_API_KEY']
    const instance = process.env['EVOLUTION_INSTANCE']
    if (!apiUrl || !apiKey || !instance) {
      throw new Error('WHATSAPP_PROVIDER=evolution requiere EVOLUTION_API_URL, EVOLUTION_API_KEY y EVOLUTION_INSTANCE')
    }
    return new EvolutionSender({ apiUrl, apiKey, instance })
  }

  throw new Error(
    `WHATSAPP_PROVIDER="${provider ?? ''}" no es válido. Valores aceptados: meta | evolution`
  )
}

export { MetaAdapter, EvolutionAdapter, MetaSender, EvolutionSender }
export type { IWhatsAppAdapter, IWhatsAppSender }
export type { NormalizedMessage } from './NormalizedMessage.js'
