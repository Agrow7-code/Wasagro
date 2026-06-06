import type Stripe from 'stripe'
import { stripe } from './checkoutService.js'
import { supabase } from '../../integrations/supabase.js'
import { langfuse } from '../../integrations/langfuse.js'

const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] ?? ''

export function verifyWebhookSignature(payload: string | Buffer, sig: string): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, sig, webhookSecret)
}

export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  const trace = langfuse.trace({ name: 'stripe_webhook', input: { type: event.type } })

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      default:
        trace.event({ name: 'unhandled_event', output: { type: event.type } })
    }

    trace.event({ name: 'webhook_processed', output: { type: event.type } })
  } catch (err) {
    trace.event({ name: 'webhook_error', level: 'ERROR', output: { error: String(err) } })
    throw err
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.org_id
  const plan = session.metadata?.plan as 'starter' | 'enterprise' | undefined
  if (!orgId || !plan) throw new Error(`checkout.session.completed sin org_id o plan: ${JSON.stringify(session.metadata)}`)

  const subscription = await stripe.subscriptions.retrieve(session.subscription as string)

  await supabase
    .from('organizaciones')
    .update({
      plan: plan,
      subscription_status: 'active',
      stripe_subscription_id: subscription.id,
      plan_activo_desde: new Date().toISOString(),
      metodo_pago: 'stripe',
    })
    .eq('org_id', orgId)

  console.log(`[stripe] Checkout completado: org=${orgId} plan=${plan}`)
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string

  const { data: org } = await supabase
    .from('organizaciones')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!org) {
    console.error(`[stripe] No se encontró org para customer ${customerId}`)
    return
  }

  const status = subscription.status === 'active' ? 'active'
    : subscription.status === 'past_due' ? 'past_due'
    : subscription.status === 'canceled' ? 'canceled'
    : 'none'

  await supabase
    .from('organizaciones')
    .update({ subscription_status: status })
    .eq('org_id', org.org_id)

  console.log(`[stripe] Subscription actualizada: org=${org.org_id} status=${status}`)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string

  const { data: org } = await supabase
    .from('organizaciones')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!org) return

  await supabase
    .from('organizaciones')
    .update({
      plan: 'free',
      subscription_status: 'none',
      plan_cancelado_en: new Date().toISOString(),
      metodo_pago: null,
    })
    .eq('org_id', org.org_id)

  console.log(`[stripe] Subscription eliminada: org=${org.org_id} → free`)
}
