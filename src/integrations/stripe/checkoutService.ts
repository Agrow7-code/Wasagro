import Stripe from 'stripe'
import { supabase } from '../../integrations/supabase.js'

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '', {
  apiVersion: '2026-05-27.dahlia',
})

const STARTER_PRICE_ID = process.env['STRIPE_STARTER_PRICE_ID'] ?? ''
const ENTERPRISE_PRICE_ID = process.env['STRIPE_ENTERPRISE_PRICE_ID'] ?? ''

export interface CheckoutResult {
  url: string
  stripe_customer_id: string
}

export async function createCheckoutSession(orgId: string, plan: 'starter' | 'enterprise'): Promise<CheckoutResult> {
  const { data: org, error } = await supabase
    .from('organizaciones')
    .select('org_id, nombre, stripe_customer_id')
    .eq('org_id', orgId)
    .single()

  if (error || !org) throw new Error(`Org ${orgId} no encontrada`)

  let customerId = org.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { org_id: orgId },
      name: org.nombre,
    })
    customerId = customer.id

    await supabase
      .from('organizaciones')
      .update({ stripe_customer_id: customerId })
      .eq('org_id', orgId)
  }

  const priceId = plan === 'enterprise' ? ENTERPRISE_PRICE_ID : STARTER_PRICE_ID

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env['DASHBOARD_URL'] ?? 'https://app.wasagro.ai'}/billing?success=1`,
    cancel_url: `${process.env['DASHBOARD_URL'] ?? 'https://app.wasagro.ai'}/billing?canceled=1`,
    metadata: { org_id: orgId, plan },
  })

  if (!session.url) throw new Error('Stripe no generó URL de checkout')

  return { url: session.url, stripe_customer_id: customerId }
}

export async function createCustomerPortalSession(orgId: string): Promise<string> {
  const { data: org } = await supabase
    .from('organizaciones')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .single()

  if (!org?.stripe_customer_id) throw new Error('Org no tiene Stripe customer')

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${process.env['DASHBOARD_URL'] ?? 'https://app.wasagro.ai'}/billing`,
  })

  return session.url
}

export async function cancelSubscription(orgId: string): Promise<void> {
  const { data: org } = await supabase
    .from('organizaciones')
    .select('stripe_subscription_id, plan')
    .eq('org_id', orgId)
    .single()

  if (!org?.stripe_subscription_id) throw new Error('Org no tiene Stripe subscription')

  await stripe.subscriptions.update(org.stripe_subscription_id, {
    cancel_at_period_end: true,
  })

  await supabase
    .from('organizaciones')
    .update({
      subscription_status: 'canceled',
      plan_cancelado_en: new Date().toISOString(),
    })
    .eq('org_id', orgId)
}

export { stripe }
