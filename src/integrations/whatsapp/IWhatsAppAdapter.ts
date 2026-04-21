import type { Context } from 'hono'
import type { NormalizedMessage } from './NormalizedMessage.js'

export interface IWhatsAppAdapter {
  verificarWebhook(c: Context): boolean
  parsearMensaje(payload: unknown): NormalizedMessage | null
}
