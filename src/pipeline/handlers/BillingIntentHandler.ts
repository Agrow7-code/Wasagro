import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../../integrations/whatsapp/IWhatsAppSender.js'
import { supabase } from '../../integrations/supabase.js'
import { createDeUnaPaymentLink } from '../../integrations/deuna/deunaClient.js'
import { langfuse } from '../../integrations/langfuse.js'
import { calcularPrecio, getSegmentLabel, inferPlanSegment, isPaidPlan } from '../../auth/pricingUtils.js'

const BILLING_KEYWORDS_PAGO = ['pagar', 'pago', 'suscripción', 'suscribirme', 'activar plan', 'comprar', 'payment', 'checkout']
const BILLING_KEYWORDS_CANCELAR = ['cancelar', 'cancelar suscripción', 'cancelar plan', 'dar de baja', 'unsubscribe']

function detectBillingIntent(text: string | null): 'pago_subscription' | 'cancelar_subscription' | null {
  if (!text) return null
  const lower = text.toLowerCase()

  for (const kw of BILLING_KEYWORDS_CANCELAR) {
    if (lower.includes(kw)) return 'cancelar_subscription'
  }
  for (const kw of BILLING_KEYWORDS_PAGO) {
    if (lower.includes(kw)) return 'pago_subscription'
  }
  return null
}

export async function handleBillingIntent(
  msg: NormalizedMessage,
  usuario: { id: string; org_id: string; rol: string },
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender
): Promise<boolean> {
  const intent = detectBillingIntent(msg.texto ?? null)
  if (!intent) return false

  const trace = langfuse.trace({ id: traceId, name: 'billing_intent', input: { intent, phone: msg.from } })

  if (intent === 'pago_subscription') {
    trace.event({ name: 'pago_subscription_detected' })

    const { data: org } = await supabase
      .from('organizaciones')
      .select('plan, nombre, pais, fincas_contratadas, usuarios_contratados')
      .eq('org_id', usuario.org_id)
      .single()

    if (!org) {
      await sender.enviarTexto(msg.from, 'No encontré tu organización. Contactá a soporte.')
      return true
    }

    if (isPaidPlan(org.plan)) {
      await sender.enviarTexto(msg.from, 'Ya tenés un plan activo. Si querés cambiar de plan, ingresá a app.wasagro.ai/billing')
      return true
    }

    const amount = calcularPrecio(org.fincas_contratadas, org.usuarios_contratados)
    const segment = getSegmentLabel(org.fincas_contratadas, org.usuarios_contratados)

    if (org.pais === 'EC') {
      try {
        const link = await createDeUnaPaymentLink(usuario.org_id, amount, `Wasagro ${segment} — ${org.nombre}`)
        await sender.enviarTexto(
          msg.from,
          `Para activar Wasagro ${segment} ($${amount}/mes — ${org.fincas_contratadas} finca${org.fincas_contratadas > 1 ? 's' : ''}, ${org.usuarios_contratados} usuario${org.usuarios_contratados > 1 ? 's' : ''}), pagá con este link: ${link.url}\n\nTambién podés transferir a nuestra cuenta bancaria y enviar el comprobante por aquí.`
        )
      } catch (err: any) {
        trace.event({ name: 'deuna_link_error', level: 'ERROR', output: { message: err?.message ?? String(err) } })
        await sender.enviarTexto(
          msg.from,
          `Para activar tu plan, transferí a nuestra cuenta bancaria y envianos el comprobante por aquí, o ingresá a app.wasagro.ai/billing`
        )
      }
    } else {
      await sender.enviarTexto(
        msg.from,
        `Para activar tu plan de Wasagro, ingresá a app.wasagro.ai/billing y elegí tu suscripción.`
      )
    }

    return true
  }

  if (intent === 'cancelar_subscription') {
    trace.event({ name: 'cancelar_subscription_detected' })

    if (usuario.rol !== 'admin_org' && usuario.rol !== 'director' && usuario.rol !== 'propietario') {
      await sender.enviarTexto(msg.from, 'Solo un administrador puede cancelar la suscripción. Pedile a tu admin que lo haga desde app.wasagro.ai/billing')
      return true
    }

    // Rule 3: no irreversible action without human approval
    await sender.enviarTexto(
      msg.from,
      '¿Confirmás que querés cancelar tu suscripción? Se mantendrá activa hasta el final del período pagado. Respondé "sí" para confirmar.'
    )
    return true
  }

  return false
}
