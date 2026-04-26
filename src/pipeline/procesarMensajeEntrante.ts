import { langfuse } from '../integrations/langfuse.js'
import type { NormalizedMessage } from '../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import type { ILLMAdapter } from '../integrations/llm/ILLMAdapter.js'
import type { IEmbeddingService } from '../integrations/llm/EmbeddingService.js'
import { IntentDetector } from '../agents/orchestrator/IntentDetector.js'
import { RAGRetriever } from '../agents/rag/RAGRetriever.js'
import {
  getMensajeByWamid,
  registrarMensaje,
  actualizarMensaje,
  getUserByPhone
} from './supabaseQueries.js'
import { handleSDRSession, handleFounderApproval, handleMeetingConfirmation } from '../agents/sdrAgent.js'
import { handleOnboardingAdmin, handleOnboardingAgricultor } from './handlers/OnboardingHandler.js'
import { handleEvento } from './handlers/EventHandler.js'

export const ROLES_ADMIN = new Set(['propietario', 'jefe_finca', 'admin_org', 'director'])

export let _sender: IWhatsAppSender | null = null
export let _llm: IWasagroLLM | null = null
export let _intentDetector: IntentDetector | null = null
export let _ragRetriever: RAGRetriever | null = null
export let _embeddingService: IEmbeddingService | null = null

export interface PipelineOptions {
  adapter?: ILLMAdapter
  embeddingService?: IEmbeddingService
  ragRetriever?: RAGRetriever
}

export function inicializarPipeline(sender: IWhatsAppSender, llm: IWasagroLLM, options: PipelineOptions = {}): void {
  _sender = sender
  _llm = llm
  _intentDetector = options.adapter ? new IntentDetector(options.adapter) : null
  _embeddingService = options.embeddingService ?? null
  _ragRetriever = options.ragRetriever ?? null
}

export async function procesarMensajeEntrante(msg: NormalizedMessage, traceId: string): Promise<void> {
  if (!_sender || !_llm) throw new Error('Pipeline no inicializado — llamar inicializarPipeline primero')

  const trace = langfuse.trace({ id: traceId })

  const existing = await getMensajeByWamid(msg.wamid)
  if (existing) {
    trace.event({ name: 'mensaje_duplicado', level: 'WARNING', input: { wamid: msg.wamid } })
    return
  }

  const tipoMensaje = msg.tipo === 'texto' ? 'text' : msg.tipo === 'audio' ? 'audio' : 'image'
  const mensajeId = await registrarMensaje({
    wa_message_id: msg.wamid,
    phone: msg.from,
    tipo_mensaje: tipoMensaje,
    contenido_raw: msg.texto ?? null,
    media_ref: msg.mediaId ?? msg.audioUrl ?? null,
    langfuse_trace_id: traceId,
    status: 'processing',
  })

  try {
    const founderPhone = process.env['FOUNDER_PHONE']
    if (founderPhone && msg.from === founderPhone) {
      const handled = await handleFounderApproval(msg, mensajeId, traceId, _sender!)
      if (handled) return
    }

    const usuario = await getUserByPhone(msg.from)

    if (!usuario) {
      const meetingHandled = await handleMeetingConfirmation(msg, mensajeId, traceId, _sender!)
      if (meetingHandled) return
      await handleSDRSession(msg, mensajeId, traceId, _sender!, _llm!)
      return
    }

    if (!usuario.onboarding_completo) {
      if (ROLES_ADMIN.has(usuario.rol)) {
        await handleOnboardingAdmin(msg, usuario, mensajeId, traceId)
      } else {
        await handleOnboardingAgricultor(msg, usuario, mensajeId, traceId)
      }
      return
    }

    await handleEvento(msg, usuario, mensajeId, traceId)
  } catch (err) {
    console.error('[pipeline] Error procesando mensaje:', err)
    trace.event({ name: 'pipeline_error', level: 'ERROR', input: { error: String(err) } })
    await actualizarMensaje(mensajeId, { status: 'error', error_detail: String(err) }).catch(() => {})
    await _sender.enviarTexto(msg.from, 'Tuve un problema con tu mensaje. Intenta de nuevo en un momento. ⚠️').catch(() => {})
  }
}
