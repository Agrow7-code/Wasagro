import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Context } from 'hono'
import type { IWhatsAppAdapter } from './IWhatsAppAdapter.js'
import type { NormalizedMessage } from './NormalizedMessage.js'

const EvolutionPayloadSchema = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    message: z.object({
      conversation: z.string().optional(),
      audioMessage: z.object({
        url: z.string(),
        mimetype: z.string(),
        seconds: z.number().optional(),
      }).optional(),
      imageMessage: z.object({
        url: z.string(),
        mimetype: z.string(),
        caption: z.string().optional(),
      }).optional(),
      locationMessage: z.object({
        degreesLatitude: z.number(),
        degreesLongitude: z.number(),
        name: z.string().optional(),
      }).optional(),
      documentMessage: z.object({
        url: z.string(),
        mimetype: z.string().optional(),
        fileName: z.string().optional(),
      }).optional(),
    }),
    messageTimestamp: z.number(),
    pushName: z.string().optional(),
  }),
})

interface EvolutionAdapterConfig {
  secret: string
}

export class EvolutionAdapter implements IWhatsAppAdapter {
  readonly #secret: string

  constructor(config: EvolutionAdapterConfig) {
    this.#secret = config.secret
  }

  async verificarWebhook(c: Context): Promise<boolean> {
    // No secret configured — accept all (self-hosted Evolution API, H0)
    if (!this.#secret) return true
    try {
      const body = await c.req.raw.clone().text()
      const signature = c.req.header('x-evolution-signature') ?? ''
      const expected = createHmac('sha256', this.#secret).update(body).digest('hex')
      const sigBuffer = Buffer.from(signature)
      const expBuffer = Buffer.from(expected)
      if (sigBuffer.length !== expBuffer.length) return false
      return timingSafeEqual(sigBuffer, expBuffer)
    } catch (err) {
      console.error('[EvolutionAdapter] Error en verificarWebhook:', err)
      return false
    }
  }

  parsearMensaje(payload: unknown): NormalizedMessage | null {
    const parsed = EvolutionPayloadSchema.safeParse(payload)
    if (!parsed.success) return null

    const { data } = parsed.data
    const from = data.key.remoteJid.replace(/@.*$/, '')
    const base = {
      wamid: data.key.id,
      from,
      timestamp: new Date(data.messageTimestamp * 1000),
      rawPayload: payload,
    }

    if (data.message.conversation) {
      return { ...base, tipo: 'texto', texto: data.message.conversation } as NormalizedMessage
    }
    if (data.message.audioMessage) {
      return { ...base, tipo: 'audio', audioUrl: data.message.audioMessage.url } as NormalizedMessage
    }
    if (data.message.imageMessage) {
      return { ...base, tipo: 'imagen', imagenUrl: data.message.imageMessage.url } as NormalizedMessage
    }
    if (data.message.locationMessage) {
      return {
        ...base,
        tipo: 'ubicacion',
        latitud: data.message.locationMessage.degreesLatitude,
        longitud: data.message.locationMessage.degreesLongitude,
      } as NormalizedMessage
    }
    if (data.message.documentMessage) {
      const mime = data.message.documentMessage.mimetype ?? ''
      const nombre = data.message.documentMessage.fileName ?? ''
      const esExcel = mime.includes('spreadsheet') || mime.includes('excel') || nombre.endsWith('.xlsx') || nombre.endsWith('.xls') || nombre.endsWith('.csv')
      if (!esExcel) return { ...base, tipo: 'otro' } as NormalizedMessage
      return {
        ...base,
        tipo: 'documento',
        documentoUrl: data.message.documentMessage.url,
        documentoNombre: nombre,
        documentoMimetype: mime,
      } as NormalizedMessage
    }
    return { ...base, tipo: 'otro' } as NormalizedMessage
  }
}
