import { supabase } from '../../integrations/supabase.js'
import { langfuse } from '../../integrations/langfuse.js'

const DEUNA_API_URL = process.env['DEUNA_API_URL'] ?? 'https://api.deuna.io'
const DEUNA_API_KEY = process.env['DEUNA_API_KEY'] ?? ''
const DEUNA_MERCHANT_ID = process.env['DEUNA_MERCHANT_ID'] ?? ''

interface DeUnaPaymentLink {
  id: string
  url: string
  status: string
}

export async function createDeUnaPaymentLink(
  orgId: string,
  amount: number,
  description: string
): Promise<DeUnaPaymentLink> {
  const trace = langfuse.trace({ name: 'deuna_create_payment_link', input: { orgId, amount } })

  if (!DEUNA_API_KEY) throw new Error('DEUNA_API_KEY no configurada')
  if (!DEUNA_MERCHANT_ID) throw new Error('DEUNA_MERCHANT_ID no configurada')

  const response = await fetch(`${DEUNA_API_URL}/v1/payment-links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': DEUNA_API_KEY,
    },
    body: JSON.stringify({
      merchant_id: DEUNA_MERCHANT_ID,
      amount,
      currency: 'USD',
      description,
      metadata: { org_id: orgId },
      redirect_url: `${process.env['DASHBOARD_URL'] ?? 'https://app.wasagro.ai'}/billing?deuna=1`,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    trace.event({ name: 'deuna_error', level: 'ERROR', output: { status: response.status, body } })
    throw new Error(`DeUna API error ${response.status}: ${body}`)
  }

  const data = await response.json() as DeUnaPaymentLink
  trace.event({ name: 'deuna_link_created', output: { id: data.id, url: data.url } })

  return data
}

export async function handleDeUnaWebhook(payload: {
  event: string
  data: { id: string; metadata?: { org_id?: string }; status: string }
}): Promise<void> {
  const trace = langfuse.trace({ name: 'deuna_webhook', input: { event: payload.event } })

  if (payload.event !== 'payment.success') {
    trace.event({ name: 'unhandled_event', output: { event: payload.event } })
    return
  }

  const orgId = payload.data.metadata?.org_id
  if (!orgId) {
    trace.event({ name: 'error', level: 'ERROR', output: { message: 'No org_id in metadata' } })
    throw new Error('DeUna webhook sin org_id en metadata')
  }

  await supabase
    .from('organizaciones')
    .update({
      plan: 'starter',
      subscription_status: 'active',
      plan_activo_desde: new Date().toISOString(),
      metodo_pago: 'deuna',
    })
    .eq('org_id', orgId)

  trace.event({ name: 'deuna_payment_activated', output: { org_id: orgId } })
  console.log(`[deuna] Pago confirmado: org=${orgId}`)
}
