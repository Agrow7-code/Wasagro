import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import { downloadEvolutionMedia } from '../../integrations/whatsapp/EvolutionMediaClient.js'
import { subirMediaSDR } from '../../integrations/supabaseStorage.js'
import { actualizarMensaje } from '../supabaseQueries.js'

/**
 * Best-effort media ingest for SDR prospect audio/image inbound messages
 * (feat/sdr-inbox-media). Downloads the media from Evolution (D8 pattern,
 * same as EventHandler.ts) and persists it into the shared eventos-media
 * bucket under an sdr/ prefix (D29 bucket reuse — no new bucket), then
 * stamps media_path on the mensajes_entrada row so the founder-crm inbox
 * thread (getConversacionThread) can render the original media instead of
 * the '[audio o imagen]' text placeholder.
 *
 * NEVER throws — a media failure must not break the SDR reply or the pipeline
 * (P3/P4). Intended to be called WITHOUT awaiting from the caller so it never
 * adds latency to the prospect's reply; any failure only shows up as a
 * WARNING trace event.
 */
export async function ingerirMediaSDR(msg: NormalizedMessage, mensajeId: string, traceId: string): Promise<void> {
  if (msg.tipo !== 'audio' && msg.tipo !== 'imagen') return

  try {
    let base64: string
    let mimeType: string

    if (msg.mediaBase64) {
      base64 = msg.mediaBase64
      mimeType = msg.mediaMimetype ?? 'application/octet-stream'
    } else {
      const apiUrl = process.env['EVOLUTION_API_URL']
      const apiKey = process.env['EVOLUTION_API_KEY']
      const instance = process.env['EVOLUTION_INSTANCE']
      if (!apiUrl || !apiKey || !instance) {
        langfuse.trace({ id: traceId }).event({
          name: 'sdr_media_ingest_skipped',
          level: 'WARNING',
          input: { reason: 'env_vars_missing', mensajeId },
        })
        return
      }
      const media = await downloadEvolutionMedia(msg.rawPayload, apiUrl, apiKey, instance)
      base64 = media.base64
      mimeType = media.mimeType
    }

    const path = await subirMediaSDR(base64, mimeType, msg.from)
    if (!path) return

    await actualizarMensaje(mensajeId, { media_path: path })
  } catch (err) {
    langfuse.trace({ id: traceId }).event({
      name: 'sdr_media_ingest_failed',
      level: 'WARNING',
      input: { error: String(err), mensajeId },
    })
  }
}
