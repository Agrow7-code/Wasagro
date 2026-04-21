import { langfuse } from '../integrations/langfuse.js'
import type { NormalizedMessage } from '../integrations/whatsapp/NormalizedMessage.js'

export async function procesarMensajeEntrante(msg: NormalizedMessage, traceId: string): Promise<void> {
  const trace = langfuse.trace({ id: traceId })
  trace.event({
    name: 'mensaje_recibido',
    level: 'DEFAULT',
    input: {
      wamid: msg.wamid,
      from: msg.from,
      tipo: msg.tipo,
      timestamp: msg.timestamp,
    },
  })
  // TODO: implementar pipeline completo (STT → extracción → Supabase)
}
