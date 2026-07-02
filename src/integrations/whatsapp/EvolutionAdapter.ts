import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Context } from 'hono'
import type { IWhatsAppAdapter } from './IWhatsAppAdapter.js'
import type { NormalizedMessage } from './NormalizedMessage.js'

const MessageDataSchema = z.object({
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
})

const EvolutionPayloadSchema = z.object({
  event: z.string().optional(),
  instance: z.string().optional(),
  data: z.any(),
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
    if (!this.#secret) {
      console.error('[EvolutionAdapter] EVOLUTION_WEBHOOK_SECRET no configurado — rechazando webhook por seguridad')
      return false
    }
    // Evolution API v2 does not sign payloads with HMAC. We rely on a shared
    // bearer token sent via WEBHOOK_GLOBAL_HEADERS in the Evolution service:
    //   WEBHOOK_GLOBAL_HEADERS={"X-Webhook-Token":"<EVOLUTION_WEBHOOK_SECRET>"}
    const token = c.req.header('x-webhook-token') ?? ''
    if (!token) return false
    const tokenBuf = Buffer.from(token)
    const secretBuf = Buffer.from(this.#secret)
    if (tokenBuf.length !== secretBuf.length) return false
    return timingSafeEqual(tokenBuf, secretBuf)
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

    // Ignorar chats grupales, broadcast y newsletter — solo procesar chats individuales
    const jid = msgData.key.remoteJid
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.includes('newsletter')) {
      console.log(`[EvolutionAdapter] JID no individual ignorado: ${jid}`)
      return null
    }

    // fromMe: mensajes enviados desde el dispositivo vinculado del founder (o
    // eco de nuestros propios envíos vía Evolution). Ya NO se descartan acá —
    // se etiquetan con esFromMe=true. `key.remoteJid` sigue siendo el
    // DESTINATARIO (el prospecto), nunca el número del founder. El router
    // desvía estos mensajes a handleFounderManualReply; NUNCA deben llegar al
    // pipeline normal (procesarMensajeEntrante/handleEvento). Ver founder-crm PR5.
    const esFromMe = msgData.key.fromMe
    if (esFromMe) {
      console.log(`[EvolutionAdapter] fromMe detectado: ${msgData.key.id}`)
    }

    const from = jid.replace(/@.*$/, '')
    const base = {
      wamid: msgData.key.id,
      from,
      timestamp: new Date(msgData.messageTimestamp * 1000),
      rawPayload: payload,
      esFromMe,
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
