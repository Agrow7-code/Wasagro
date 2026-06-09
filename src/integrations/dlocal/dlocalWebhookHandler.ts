import { supabase } from '../supabase.js'
import { langfuse } from '../langfuse.js'
import type { PlanSegment } from '../../auth/pricingUtils.js'
import { inferPlanSegment, isPaidPlan } from '../../auth/pricingUtils.js'

export interface DLocalGoWebhookPayload {
  id: string
  status: string
  status_code: string
  status_detail: string
  amount: number
  currency: string
  country: string
  order_id: string
  merchant_checkout_token?: string
  created_date: string
}

export async function handleDLocalGoWebhook(payload: DLocalGoWebhookPayload): Promise<void> {
  const trace = langfuse.trace({ name: 'dlocalgo_webhook', input: { id: payload.id, status: payload.status, status_code: payload.status_code } })

  try {
    const orgId = await extractOrgId(payload)
    if (!orgId) {
      trace.event({ name: 'error', level: 'ERROR', output: { message: 'No org_id found from payment data', order_id: payload.order_id } })
      throw new Error('dLocal Go webhook sin org_id')
    }

    switch (payload.status) {
      case 'PAID':
      case 'COMPLETED':
        await handlePaymentPaid(orgId, payload)
        break

      case 'REJECTED':
      case 'DECLINED':
        await handlePaymentRejected(orgId, payload)
        break

      case 'CANCELLED':
        await handlePaymentCancelled(orgId, payload)
        break

      case 'PENDING':
        trace.event({ name: 'payment_pending', output: { id: payload.id } })
        console.log(`[dlocalgo] Payment pending: org=${orgId} id=${payload.id}`)
        break

      default:
        trace.event({ name: 'unhandled_status', output: { status: payload.status } })
    }

    trace.event({ name: 'webhook_processed', output: { status: payload.status, org_id: orgId } })
  } catch (err) {
    trace.event({ name: 'webhook_error', level: 'ERROR', output: { error: String(err) } })
    throw err
  }
}

async function extractOrgId(payload: DLocalGoWebhookPayload): Promise<string | null> {
  if (payload.merchant_checkout_token) {
    const { data: org } = await supabase
      .from('organizaciones')
      .select('org_id')
      .eq('dlocalgo_checkout_token', payload.merchant_checkout_token)
      .single()

    if (org) return org.org_id
  }

  const match = payload.order_id?.match(/wasagro-\w+-(.+)-\d+/)
  if (match) return match[1] ?? null

  const { data: org } = await supabase
    .from('organizaciones')
    .select('org_id')
    .eq('dlocalgo_payment_id', payload.id)
    .single()

  return org?.org_id ?? null
}

function extractSegmentFromOrderId(orderId: string): PlanSegment | null {
  const match = orderId.match(/wasagro-(agricultor|productor|pyme|corporativo)-/)
  if (match) return match[1] as PlanSegment
  if (orderId.includes('-enterprise-')) return 'pyme'
  if (orderId.includes('-starter-')) return 'productor'
  return null
}

async function handlePaymentPaid(orgId: string, payload: DLocalGoWebhookPayload): Promise<void> {
  const segment = extractSegmentFromOrderId(payload.order_id)

  const { data: org } = await supabase
    .from('organizaciones')
    .select('fincas_contratadas, usuarios_contratados')
    .eq('org_id', orgId)
    .single()

  const plan = segment ?? (org ? inferPlanSegment(org.fincas_contratadas, org.usuarios_contratados) : 'productor')

  const updateData: Record<string, unknown> = {
    plan,
    subscription_status: 'active',
    plan_activo_desde: new Date().toISOString(),
    metodo_pago: 'dlocalgo',
    dlocalgo_payment_id: payload.id,
  }

  if (payload.merchant_checkout_token) {
    updateData['dlocalgo_checkout_token'] = payload.merchant_checkout_token
  }

  await supabase
    .from('organizaciones')
    .update(updateData)
    .eq('org_id', orgId)

  console.log(`[dlocalgo] Payment PAID: org=${orgId} plan=${plan} id=${payload.id}`)
}

async function handlePaymentRejected(orgId: string, payload: DLocalGoWebhookPayload): Promise<void> {
  const { data: org } = await supabase
    .from('organizaciones')
    .select('plan, subscription_status')
    .eq('org_id', orgId)
    .single()

  if (!org) return

  if (org.subscription_status === 'active') {
    await supabase
      .from('organizaciones')
      .update({ subscription_status: 'past_due' })
      .eq('org_id', orgId)

    console.log(`[dlocalgo] Subscription payment REJECTED (past_due): org=${orgId} id=${payload.id} code=${payload.status_code}`)
  } else {
    console.log(`[dlocalgo] Initial payment REJECTED: org=${orgId} id=${payload.id} code=${payload.status_code}`)
  }
}

async function handlePaymentCancelled(orgId: string, payload: DLocalGoWebhookPayload): Promise<void> {
  await supabase
    .from('organizaciones')
    .update({
      plan: 'free',
      subscription_status: 'none',
      plan_cancelado_en: new Date().toISOString(),
      metodo_pago: null,
      dlocalgo_checkout_token: null,
    })
    .eq('org_id', orgId)

  console.log(`[dlocalgo] Subscription CANCELLED: org=${orgId} id=${payload.id}`)
}
