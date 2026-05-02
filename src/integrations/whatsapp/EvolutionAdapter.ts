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
      extendedTextMessage: z.object({
        text: z.string(),
      }).optional(),
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
    }).optional(),
    // z.coerce.number() acepta tanto número como string — Evolution API varía entre versiones
    messageTimestamp: z.coerce.number(),
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
    const baseParsed = EvolutionPayloadSchema.safeParse(payload)
    if (!baseParsed.success) {
      return null
    }

    const { event, data } = baseParsed.data

    // Ignorar eventos que no sean de mensajes nuevos
    if (event && event !== 'messages.upsert') {
      return null
    }

    // Evolution API v2 a veces envía data como un array de mensajes
    const rawData = Array.isArray(data) ? data[0] : data

    const parsed = MessageDataSchema.safeParse(rawData)
    if (!parsed.success) {
      console.error('[EvolutionAdapter] Schema parse failed:', JSON.stringify(parsed.error.issues))
      return null
    }

    const msgData = parsed.data

    // Ignorar mensajes enviados por el bot (evita auto-procesamiento en loop)
    if (msgData.key.fromMe) {
      console.log(`[EvolutionAdapter] fromMe ignorado: ${msgData.key.id}`)
      return null
    }

    // Ignorar chats grupales, broadcast y newsletter — solo procesar chats individuales
    const jid = msgData.key.remoteJid
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.includes('newsletter')) {
      console.log(`[EvolutionAdapter] JID no individual ignorado: ${jid}`)
      return null
    }

    const from = jid.replace(/@.*$/, '')
    const base = {
      wamid: msgData.key.id,
      from,
      timestamp: new Date(msgData.messageTimestamp * 1000),
      rawPayload: payload,
    }

    const msg = msgData.message
    if (!msg) return null

    // Texto simple
    if (msg.conversation) {
      return { ...base, tipo: 'texto', texto: msg.conversation } as NormalizedMessage
    }
    // Texto en respuesta/cita (WhatsApp extendedTextMessage)
    if (msg.extendedTextMessage?.text) {
      return { ...base, tipo: 'texto', texto: msg.extendedTextMessage.text } as NormalizedMessage
    }
    if (msg.audioMessage) {
      return { ...base, tipo: 'audio', audioUrl: msg.audioMessage.url } as NormalizedMessage
    }
    if (msg.imageMessage) {
      return {
        ...base,
        tipo: 'imagen',
        imagenUrl: msg.imageMessage.url,
        texto: msg.imageMessage.caption,
      } as NormalizedMessage
    }
    if (msg.locationMessage) {
      return {
        ...base,
        tipo: 'ubicacion',
        latitud: msg.locationMessage.degreesLatitude,
        longitud: msg.locationMessage.degreesLongitude,
      } as NormalizedMessage
    }
    if (msg.documentMessage) {
      const mime = msg.documentMessage.mimetype ?? ''
      const nombre = msg.documentMessage.fileName ?? ''
      const esExcel = mime.includes('spreadsheet') || mime.includes('excel') || nombre.endsWith('.xlsx') || nombre.endsWith('.xls') || nombre.endsWith('.csv')
      if (!esExcel) return { ...base, tipo: 'otro' } as NormalizedMessage
      return {
        ...base,
        tipo: 'documento',
        documentoUrl: msg.documentMessage.url,
        documentoNombre: nombre,
        documentoMimetype: mime,
      } as NormalizedMessage
    }
    return { ...base, tipo: 'otro' } as NormalizedMessage
  }
}
