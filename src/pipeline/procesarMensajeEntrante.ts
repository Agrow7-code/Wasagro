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
import { handleHandoffGate } from './handlers/HandoffGateHandler.js'
import { loadSessionState } from '../agents/sdr/contextStore.js'
import { shouldSuppressOnboardingForActiveSDR } from '../agents/sdr/onboardingGuard.js'
import { recordInboundWaCost } from '../integrations/whatsapp/CostTrackedSender.js'
import { planGuardWhatsApp } from '../auth/planGuard.js'
import { handleBillingIntent } from './handlers/BillingIntentHandler.js'

export const ROLES_ADMIN = new Set(['propietario', 'jefe_finca', 'admin_org', 'director'])

export let _sender: IWhatsAppSender | null = null
export let _llm: IWasagroLLM | null = null
export let _llmAdapter: ILLMAdapter | null = null
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
  _llmAdapter = options.adapter ?? null
  _intentDetector = options.adapter ? new IntentDetector(options.adapter) : null
  _embeddingService = options.embeddingService ?? null
  _ragRetriever = options.ragRetriever ?? null
}

export async function procesarMensajeEntrante(msg: NormalizedMessage, traceId: string): Promise<void> {
  if (!_sender || !_llm) throw new Error('Pipeline no inicializado — llamar inicializarPipeline primero')

  // Trace root: cada inbound webhook abre UNA trace que abarca todo el pipeline
  // downstream (SDR, onboarding, event extraction, etc.). Name + tags + metadata
  // permiten filtrar el dashboard por canal/tipo/teléfono sin escribir queries SQL.
  const trace = langfuse.trace({
    id:       traceId,
    name:     'inbound_message',
    tags:     ['inbound', msg.tipo],
    metadata: { phone: msg.from, tipo_mensaje: msg.tipo, wamid: msg.wamid },
  })

  const existing = await getMensajeByWamid(msg.wamid)
  if (existing) {
    trace.event({ name: 'mensaje_duplicado', level: 'WARNING', input: { wamid: msg.wamid } })
    return
  }

  let mensajeId: string
  try {
    const tipoMensaje = msg.tipo === 'texto' ? 'text' : msg.tipo === 'audio' ? 'audio' : 'image'
    mensajeId = await registrarMensaje({
      wa_message_id: msg.wamid,
      phone: msg.from,
      tipo_mensaje: tipoMensaje,
      contenido_raw: msg.texto ?? null,
      media_ref: msg.mediaId ?? msg.audioUrl ?? null,
      langfuse_trace_id: traceId,
      status: 'processing',
    })
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('duplicate key value') || err.message?.includes('23505')) {
      trace.event({ name: 'webhook_idempotency_hit', level: 'DEFAULT', input: { wamid: msg.wamid } })
      return // Silently ignore duplicate webhook
    }
    throw err
  }

  try {
    const founderPhone = process.env['FOUNDER_PHONE']
    if (founderPhone && msg.from === founderPhone) {
      const handled = await handleFounderApproval(msg, mensajeId, traceId, _sender!)
      if (handled) return
    }

      const usuario = await getUserByPhone(msg.from)

      if (!usuario) {
        // Pause/resume gate (REQ-hand-008/011): must run BEFORE any FSM/LLM
        // call on the SDR branch, and must NEVER be reachable from the
        // `usuario` field-capture branch below.
        const gateHandled = await handleHandoffGate(msg, mensajeId, traceId, _sender!)
        if (gateHandled) return

        const meetingHandled = await handleMeetingConfirmation(msg, mensajeId, traceId, _sender!, _llm!, undefined, _llmAdapter ?? undefined)
        if (meetingHandled) return
        await handleSDRSession(msg, mensajeId, traceId, _sender!, _llm!, undefined, _llmAdapter ?? undefined)
        return
      }

      recordInboundWaCost({
        orgId: usuario.org_id,
        fincaId: usuario.finca_id,
        phone: msg.from,
        messageType: msg.tipo === 'texto' ? 'text' : msg.tipo === 'audio' ? 'audio' : 'image',
        waMessageId: msg.wamid,
      })

      // ── Billing intents: allow even when plan is blocked (so user can pay) ──
      const billingHandled = await handleBillingIntent(msg, usuario, mensajeId, traceId, _sender!)
      if (billingHandled) {
        await actualizarMensaje(mensajeId, { status: 'processed' }).catch(() => {})
        return
      }

      // ── Plan guard: bloquear orgs con trial expirado o sin suscripción activa ──
      const { allowed, state } = await planGuardWhatsApp(usuario.org_id)
      if (!allowed) {
        trace.event({ name: 'plan_guard_blocked', level: 'WARNING', output: { plan: state.plan } })
        const planLabel = state.plan === 'trial' ? 'período de prueba' : 'plan'
        await _sender!.enviarTexto(
          msg.from,
          `Tu ${planLabel} ha expirado. Para seguir usando Wasagro, activá tu suscripción en app.wasagro.ai/billing o contactá a tu administrador.`
        )
        await actualizarMensaje(mensajeId, { status: 'blocked_billing' }).catch(() => {})
        return
      }

    if (!usuario.onboarding_completo) {
      // Guard: a live SDR conversation must not be interrupted by the onboarding
      // fallback. The `usuarios` row can be created mid-pitch (e.g., agendar
      // piloto), and without this guard the very next inbound message would
      // route to handleOnboarding* and emit "estamos terminando de configurar
      // tu acceso" style copy — which made the bot look broken to a real
      // prospect that was about to convert.
      const sdrSession = await loadSessionState(msg.from)
      if (shouldSuppressOnboardingForActiveSDR(sdrSession)) {
        trace.event({
          name:  'onboarding_fallback_suppressed',
          level: 'WARNING',
          input: { phone: msg.from, fsmState: sdrSession?.fsmState },
        })
        await actualizarMensaje(mensajeId, { status: 'processed' }).catch(() => {})
        return
      }

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
