import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import type { IWhatsAppAdapter } from './IWhatsAppAdapter.js'
import type { NormalizedMessage } from './NormalizedMessage.js'
import { WhatsAppMessageSchema } from '../../types/whatsapp.js'

interface MetaAdapterConfig {
  appSecret: string
  verifyToken: string
}

export class MetaAdapter implements IWhatsAppAdapter {
  readonly #appSecret: string
  readonly #verifyToken: string

  constructor(config: MetaAdapterConfig) {
    this.#appSecret = config.appSecret
    this.#verifyToken = config.verifyToken
  }

  async verificarWebhook(c: Context): Promise<boolean> {
    try {
      const body = await c.req.raw.clone().text()
      const signature = c.req.header('x-hub-signature-256') ?? ''
      const expected = 'sha256=' + createHmac('sha256', this.#appSecret).update(body).digest('hex')
      const sigBuffer = Buffer.from(signature)
      const expBuffer = Buffer.from(expected)
      if (sigBuffer.length !== expBuffer.length) return false
      return timingSafeEqual(sigBuffer, expBuffer)
    } catch (err) {
      console.error('[MetaAdapter] Error en verificarWebhook:', err)
      return false
    }
  }

  verificarGetWebhook(c: Context): string | false {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token')
    const challenge = c.req.query('hub.challenge')
    if (mode === 'subscribe' && token === this.#verifyToken) return challenge ?? ''
    return false
  }

  parsearMensaje(payload: unknown): NormalizedMessage | null {
    const parsed = WhatsAppMessageSchema.safeParse(payload)
    if (!parsed.success) return null

    const entry = parsed.data.entry[0]
    if (!entry) return null
    const change = entry.changes[0]
    if (!change) return null
    const message = change.value.messages?.[0]
    if (!message) return null

    const base = {
      wamid: message.id,
      from: message.from.replace(/\D/g, ''),
      timestamp: new Date(Number(message.timestamp) * 1000),
      rawPayload: payload,
      source_context: message.referral ? `headline: ${message.referral.headline || ''} | body: ${message.referral.body || ''} | url: ${message.referral.source_url || ''}` : undefined,
    }

    if (message.type === 'text' && message.text) {
      return { ...base, tipo: 'texto', texto: message.text.body } as NormalizedMessage
    }
    if (message.type === 'audio' && message.audio) {
      return { ...base, tipo: 'audio', mediaId: message.audio.id } as NormalizedMessage
    }
    if (message.type === 'image' && message.image) {
      return { ...base, tipo: 'imagen', mediaId: message.image.id } as NormalizedMessage
    }
    return { ...base, tipo: 'otro' } as NormalizedMessage
  }
}
