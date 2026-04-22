import type { Context } from 'hono'
import type { NormalizedMessage } from './NormalizedMessage.js'

export interface IWhatsAppAdapter {
  verificarWebhook(c: Context): Promise<boolean>
  parsearMensaje(payload: unknown): NormalizedMessage | null
}
