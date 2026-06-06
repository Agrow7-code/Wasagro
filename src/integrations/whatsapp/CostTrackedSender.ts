import type { IWhatsAppSender } from './IWhatsAppSender.js'
import { supabase } from '../supabase.js'

export interface CostContextResolver {
  (phone: string): Promise<{ orgId: string | null; fincaId: string | null }>
}

interface CostTrackedSenderConfig {
  inner: IWhatsAppSender
  resolveContext?: CostContextResolver
}

const PHONE_CACHE_TTL_MS = 5 * 60 * 1000
const phoneCache = new Map<string, { orgId: string | null; fincaId: string | null; expiresAt: number }>()

async function resolvePhoneContext(phone: string): Promise<{ orgId: string | null; fincaId: string | null }> {
  const cached = phoneCache.get(phone)
  if (cached && Date.now() < cached.expiresAt) return cached

  const { data } = await supabase
    .from('usuarios')
    .select('org_id, finca_id')
    .eq('phone', phone)
    .maybeSingle()

  const result = { orgId: data?.org_id ?? null, fincaId: data?.finca_id ?? null }
  phoneCache.set(phone, { ...result, expiresAt: Date.now() + PHONE_CACHE_TTL_MS })
  return result
}

export class CostTrackedSender implements IWhatsAppSender {
  readonly #inner: IWhatsAppSender
  readonly #resolveContext: CostContextResolver

  constructor(config: CostTrackedSenderConfig) {
    this.#inner = config.inner
    this.#resolveContext = config.resolveContext ?? resolvePhoneContext
  }

  async enviarTexto(to: string, texto: string): Promise<void> {
    await this.#inner.enviarTexto(to, texto)
    this.#recordCost('outbound', 'text', to).catch((err) => {
      console.error('[CostTrackedSender] Error registrando costo WA text:', err)
    })
  }

  async enviarTemplate(to: string, templateName: string, language = 'es'): Promise<void> {
    await this.#inner.enviarTemplate(to, templateName, language)
    this.#recordCost('outbound', 'template', to, { template_name: templateName }).catch((err) => {
      console.error('[CostTrackedSender] Error registrando costo WA template:', err)
    })
  }

  async #recordCost(
    direction: 'inbound' | 'outbound',
    messageType: string,
    phone: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const ctx = await this.#resolveContext(phone)
    if (!ctx.orgId && !ctx.fincaId) return

    const costUsd = this.#calculateCost(messageType, direction)

    const insert: Record<string, unknown> = {
      direction,
      message_type: messageType,
      cost_usd: costUsd,
      phone,
      metadata,
    }

    if (ctx.orgId) insert.org_id = ctx.orgId
    if (ctx.fincaId) insert.finca_id = ctx.fincaId

    const { error } = await supabase.from('wa_message_costs').insert(insert)
    if (error) {
      console.error('[CostTrackedSender] Supabase insert error:', error.message)
    }
  }

  #calculateCost(messageType: string, direction: string): number {
    if (direction === 'inbound') return 0
    if (messageType === 'template') return 0.005
    return 0
  }
}

export function recordInboundWaCost(params: {
  orgId: string | null
  fincaId: string | null
  phone: string
  messageType: string
  conversationType?: string
  waMessageId?: string
}): void {
  if (!params.orgId && !params.fincaId) return

  const insert: Record<string, unknown> = {
    direction: 'inbound',
    message_type: params.messageType,
    cost_usd: 0,
    phone: params.phone,
  }

  if (params.orgId) insert.org_id = params.orgId
  if (params.fincaId) insert.finca_id = params.fincaId
  if (params.conversationType) insert.conversation_type = params.conversationType
  if (params.waMessageId) insert.wa_message_id = params.waMessageId

  supabase.from('wa_message_costs').insert(insert).then(({ error }) => {
    if (error) console.error('[CostTrackedSender] Error registrando costo WA inbound:', error.message)
  })
}
