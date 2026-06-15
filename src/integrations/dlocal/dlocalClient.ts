import { supabase } from '../supabase.js'
import { langfuse } from '../langfuse.js'
import { calcularPrecio, inferPlanSegment } from '../../auth/pricingUtils.js'
import type { PlanSegment } from '../../auth/pricingUtils.js'

const DLOCALGO_API_URL = process.env['DLOCALGO_API_URL'] ?? 'https://api-sbx.dlocalgo.com'
const DLOCALGO_API_KEY = process.env['DLOCALGO_API_KEY'] ?? ''
const DLOCALGO_API_SECRET = process.env['DLOCALGO_API_SECRET'] ?? ''

function requireCredentials(): { apiKey: string; apiSecret: string } {
  if (!DLOCALGO_API_KEY || !DLOCALGO_API_SECRET) {
    throw new Error('dLocal Go credentials not configured — DLOCALGO_API_KEY, DLOCALGO_API_SECRET required')
  }
  return { apiKey: DLOCALGO_API_KEY, apiSecret: DLOCALGO_API_SECRET }
}

function buildAuthHeader(): Record<string, string> {
  const { apiKey, apiSecret } = requireCredentials()
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}:${apiSecret}`,
  }
}

export interface DLocalGoCreatePaymentResponse {
  id: string
  merchant_checkout_token: string
  amount: number
  currency: string
  country: string
  status: string
  order_id: string
  redirect_url?: string
}

export interface DLocalGoConfirmPaymentResponse {
  id: string
  status: string
  status_code: string
  status_detail: string
  amount: number
  currency: string
  redirect_url?: string
}

export interface DLocalGoRecurringPaymentResponse {
  id: string
  status: string
  status_code: string
  amount: number
  currency: string
}

export async function createPayment(
  orgId: string,
  fincas: number,
  usuarios: number,
  country: string
): Promise<DLocalGoCreatePaymentResponse> {
  const trace = langfuse.trace({ name: 'dlocalgo_create_payment', input: { orgId, fincas, usuarios } })

  const amount = calcularPrecio(fincas, usuarios)
  const segment = inferPlanSegment(fincas, usuarios)
  const orderId = `wasagro-${segment}-${orgId}-${Date.now()}`
  // El token compartido viaja en la URL de notificación que NOSOTROS fijamos:
  // el webhook lo verifica timing-safe antes de tocar el estado de suscripción.
  const webhookSecret = process.env['DLOCALGO_WEBHOOK_SECRET'] ?? ''
  const tokenQuery = webhookSecret ? `?token=${encodeURIComponent(webhookSecret)}` : ''
  const notificationUrl = `${process.env['API_URL'] ?? 'https://wasagro-production.up.railway.app'}/api/billing/dlocalgo-webhook${tokenQuery}`
  const successUrl = `${process.env['DASHBOARD_URL'] ?? 'https://app.wasagro.ai'}/billing?dlocalgo=success`

  const body = {
    amount,
    currency: 'USD',
    country,
    order_id: orderId,
    description: `Wasagro ${segment} (${fincas}F/${usuarios}U) — Monthly subscription`,
    notification_url: notificationUrl,
    success_url: successUrl,
    back_url: successUrl,
    allow_transparent: true,
    allow_recurring: true,
  }

  const response = await fetch(`${DLOCALGO_API_URL}/v1/payments`, {
    method: 'POST',
    headers: buildAuthHeader(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    trace.event({ name: 'dlocalgo_create_payment_error', level: 'ERROR', output: { status: response.status, body: errBody } })
    throw new Error(`dLocal Go create payment error ${response.status}: ${errBody}`)
  }

  const data = await response.json() as DLocalGoCreatePaymentResponse

  await supabase
    .from('organizaciones')
    .update({
      dlocalgo_checkout_token: data.merchant_checkout_token,
      dlocalgo_payment_id: data.id,
      fincas_contratadas: fincas,
      usuarios_contratados: usuarios,
      precio_mensual: amount,
    })
    .eq('org_id', orgId)

  trace.event({ name: 'dlocalgo_payment_created', output: { id: data.id, token: data.merchant_checkout_token, amount } })

  return data
}

export async function confirmPayment(
  checkoutToken: string,
  cardToken: string,
  clientFirstName: string,
  clientLastName: string,
  clientDocumentType: string,
  clientDocument: string,
  clientEmail: string
): Promise<DLocalGoConfirmPaymentResponse> {
  const trace = langfuse.trace({ name: 'dlocalgo_confirm_payment', input: { checkoutToken } })

  const body = {
    cardToken,
    clientFirstName,
    clientLastName,
    clientDocumentType,
    clientDocument,
    clientEmail,
  }

  const response = await fetch(`${DLOCALGO_API_URL}/v1/payments/confirm/${checkoutToken}`, {
    method: 'POST',
    headers: buildAuthHeader(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    trace.event({ name: 'dlocalgo_confirm_error', level: 'ERROR', output: { status: response.status, body: errBody } })
    throw new Error(`dLocal Go confirm payment error ${response.status}: ${errBody}`)
  }

  const data = await response.json() as DLocalGoConfirmPaymentResponse
  trace.event({ name: 'dlocalgo_payment_confirmed', output: { id: data.id, status: data.status } })

  return data
}

export async function chargeRecurring(
  checkoutToken: string,
  amount: number,
  description: string
): Promise<DLocalGoRecurringPaymentResponse> {
  const trace = langfuse.trace({ name: 'dlocalgo_recurring_charge', input: { checkoutToken, amount } })

  const body = {
    amount,
    description,
    orderId: `wasagro-recurring-${Date.now()}`,
  }

  const response = await fetch(`${DLOCALGO_API_URL}/v1/payments/recurring/${checkoutToken}`, {
    method: 'POST',
    headers: buildAuthHeader(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    trace.event({ name: 'dlocalgo_recurring_error', level: 'ERROR', output: { status: response.status, body: errBody } })
    throw new Error(`dLocal Go recurring charge error ${response.status}: ${errBody}`)
  }

  const data = await response.json() as DLocalGoRecurringPaymentResponse
  trace.event({ name: 'dlocalgo_recurring_charged', output: { id: data.id, status: data.status } })

  return data
}

export function getSmartFieldsApiKey(): string {
  const key = process.env['DLOCALGO_SMARTFIELDS_API_KEY']
  if (!key) throw new Error('DLOCALGO_SMARTFIELDS_API_KEY not configured')
  return key
}
