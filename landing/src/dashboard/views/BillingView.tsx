import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../auth/useAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface BillingStatus {
  org_id: string
  nombre: string
  plan: string
  trial_inicio: string | null
  trial_fin: string | null
  subscription_status: string | null
  metodo_pago: string | null
  plan_activo_desde: string | null
  plan_cancelado_en: string | null
}

declare global {
  interface Window {
    dlocalGo: DLocalGoInstance
  }
}

interface DLocalGoInstance {
  initialize: (smartFieldsApiKey: string, checkoutToken: string) => Promise<void>
  fields: () => DLocalGoFields
  createCardToken: (cardField: DLocalGoCardField, data: { name: string }) => Promise<{ token: string }>
}

interface DLocalGoFields {
  create: (type: string, options?: { style?: Record<string, unknown> }) => DLocalGoCardField
}

interface DLocalGoCardField {
  mount: (el: HTMLElement) => void
  addEventListener: (event: string, handler: (e: DLocalGoCardEvent) => void) => void
}

interface DLocalGoCardEvent {
  error?: { message: string }
  complete?: boolean
  brand?: string
}

type Step = 'loading' | 'select_plan' | 'payment_form' | 'processing' | 'success' | 'error'

const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: 29,
    features: ['Eventos ilimitados', 'Hasta 5 fincas', 'Reportes semanales', 'Alertas de plaga y clima', 'Dashboard en tiempo real'],
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    price: 79,
    features: ['Todo de Starter', 'Fincas ilimitadas', 'API para ERP', 'Trazabilidad EUDR', 'Soporte prioritario'],
  },
]

const DLOCALGO_SMARTFIELDS_SCRIPT = import.meta.env.DEV
  ? 'https://checkout-sbx.dlocalgo.com/js/dlocalgo-smartfields-bundled.js'
  : 'https://checkout.dlocalgo.com/js/dlocalgo-smartfields-bundled.js'

export function BillingView() {
  const { user } = useAuth()
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'enterprise'>('starter')
  const [cardError, setCardError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [docType, setDocType] = useState('CI')
  const [docNumber, setDocNumber] = useState('')

  const cardFieldRef = useRef<DLocalGoCardField | null>(null)
  const checkoutTokenRef = useRef<string | null>(null)
  const cardMountedRef = useRef(false)
  const cardContainerRef = useRef<HTMLDivElement>(null)

  const fetchStatus = useCallback(async () => {
    const token = localStorage.getItem('wasagro_token')
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/billing/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
        if (data.plan === 'starter' || data.plan === 'enterprise') {
          setStep('success')
        } else {
          setStep('select_plan')
        }
      } else {
        setStep('select_plan')
      }
    } catch {
      setStep('select_plan')
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    if (step !== 'payment_form') return
    if (cardMountedRef.current) return

    const loadSmartFields = async () => {
      try {
        const authToken = localStorage.getItem('wasagro_token')

        const payRes = await fetch(`${API_BASE}/api/billing/create-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ plan: selectedPlan, country: 'EC' }),
        })

        if (!payRes.ok) {
          const err = await payRes.json()
          throw new Error(err.error || 'Error creando el pago')
        }

        const payData = await payRes.json()
        const checkoutToken = payData.merchant_checkout_token as string
        if (!checkoutToken) throw new Error('No se recibio checkout token')
        checkoutTokenRef.current = checkoutToken

        const keyRes = await fetch(`${API_BASE}/api/billing/smartfields-key`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!keyRes.ok) throw new Error('Failed to fetch SmartFields key')
        const { key } = await keyRes.json()

        if (!window.dlocalGo) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = DLOCALGO_SMARTFIELDS_SCRIPT
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load dLocal Go SmartFields SDK'))
            document.head.appendChild(script)
          })
        }

        await window.dlocalGo.initialize(key, checkoutToken)

        const fields = window.dlocalGo.fields()

        const style = {
          base: {
            fontSize: '16px',
            lineHeight: '24px',
            color: '#1B3D24',
            '::placeholder': { color: '#9C9080' },
          },
          invalid: { color: '#D45828' },
        }

        const card = fields.create('card', { style })
        cardFieldRef.current = card

        card.addEventListener('change', (event: DLocalGoCardEvent) => {
          setCardError(event.error ? event.error.message : '')
        })

        if (cardContainerRef.current) {
          card.mount(cardContainerRef.current)
          cardMountedRef.current = true
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Error cargando formulario de pago')
        setStep('error')
      }
    }

    loadSmartFields()

    return () => {
      cardMountedRef.current = false
      cardFieldRef.current = null
      checkoutTokenRef.current = null
      if (cardContainerRef.current) {
        cardContainerRef.current.innerHTML = ''
      }
    }
  }, [step, selectedPlan])

  const handleSubmit = async () => {
    if (!cardFieldRef.current || !checkoutTokenRef.current) return
    if (!firstName || !lastName || !docType || !docNumber || !email) {
      setSubmitError('Todos los campos son requeridos')
      return
    }

    setStep('processing')
    setSubmitError('')

    try {
      const cardholderName = `${firstName} ${lastName}`.trim()
      const cardTokenResult = await window.dlocalGo.createCardToken(cardFieldRef.current, { name: cardholderName })
      const cardToken = cardTokenResult.token
      const authToken = localStorage.getItem('wasagro_token')

      const res = await fetch(`${API_BASE}/api/billing/confirm-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          checkout_token: checkoutTokenRef.current,
          card_token: cardToken,
          first_name: firstName,
          last_name: lastName,
          document_type: docType,
          document: docNumber,
          email,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error confirmando el pago')
      }

      const data = await res.json()

      if (data.redirect_url) {
        window.location.href = data.redirect_url
        return
      }

      if (data.status === 'PAID' || data.status === 'COMPLETED' || data.status_code === '200') {
        setStep('success')
        await fetchStatus()
      } else {
        setStep('payment_form')
        setSubmitError(`Pago ${data.status || 'pendiente'}. Te notificaremos cuando se confirme.`)
      }
    } catch (err) {
      setStep('payment_form')
      setSubmitError(err instanceof Error ? err.message : 'Error procesando el pago')
    }
  }

  const handleCancel = async () => {
    const token = localStorage.getItem('wasagro_token')
    try {
      const res = await fetch(`${API_BASE}/api/billing/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        await fetchStatus()
      }
    } catch { /* ignore */ }
  }

  if (step === 'loading') {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9C9080' }}>
        Cargando...
      </div>
    )
  }

  if (step === 'success' && status) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{
          border: '2px solid #1B3D24',
          borderRadius: 16,
          overflow: 'hidden',
          background: '#F5F1E8',
        }}>
          <div style={{ background: '#1B3D24', padding: '20px 24px' }}>
            <h2 style={{ color: '#F5F1E8', margin: 0, fontSize: 20, fontWeight: 700 }}>
              Plan {status.plan === 'enterprise' ? 'Enterprise' : 'Starter'} activo
            </h2>
            <p style={{ color: '#C9F03B', margin: '4px 0 0', fontSize: 14, fontWeight: 600 }}>
              ${status.plan === 'enterprise' ? '79' : '29'}/mes
            </p>
          </div>
          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                { label: 'Estado', value: status.subscription_status === 'active' ? 'Activo' : status.subscription_status },
                { label: 'Metodo de pago', value: status.metodo_pago === 'dlocalgo' ? 'Tarjeta (dLocal Go)' : status.metodo_pago },
                { label: 'Activo desde', value: status.plan_activo_desde ? new Date(status.plan_activo_desde).toLocaleDateString() : '-' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #EAE6DC' }}>
                  <span style={{ color: '#9C9080', fontSize: 14 }}>{row.label}</span>
                  <span style={{ color: '#1B3D24', fontSize: 14, fontWeight: 600 }}>{row.value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={handleCancel}
              style={{
                marginTop: 24,
                width: '100%',
                padding: '12px 0',
                background: 'transparent',
                border: '2px solid #D45828',
                borderRadius: 8,
                color: '#D45828',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Cancelar suscripcion
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'processing') {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1B3D24' }}>Procesando pago...</div>
        <div style={{ fontSize: 14, color: '#9C9080', marginTop: 8 }}>No cierres esta pagina</div>
      </div>
    )
  }

  if (step === 'select_plan') {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1B3D24', marginBottom: 8 }}>Elegi tu plan</h2>
        <p style={{ fontSize: 15, color: '#9C9080', marginBottom: 32 }}>
          {status?.plan === 'trial'
            ? `Tu trial termina ${status?.trial_fin ? new Date(status.trial_fin).toLocaleDateString() : 'pronto'}. Activa tu plan para seguir usando Wasagro.`
            : 'Activa un plan para acceder a todas las funcionalidades.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {PLANS.map(plan => (
            <div
              key={plan.id}
              onClick={() => { setSelectedPlan(plan.id); setStep('payment_form'); }}
              style={{
                border: `2px solid ${selectedPlan === plan.id ? '#C9F03B' : '#1B3D24'}`,
                borderRadius: 16,
                padding: 24,
                cursor: 'pointer',
                background: selectedPlan === plan.id ? '#1B3D24' : '#F5F1E8',
                color: selectedPlan === plan.id ? '#F5F1E8' : '#1B3D24',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>{plan.name}</div>
              <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 16 }}>
                ${plan.price}<span style={{ fontSize: 14, fontWeight: 500, opacity: 0.7 }}>/mes</span>
              </div>
              {plan.features.map(f => (
                <div key={f} style={{ fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#C9F03B', fontSize: 16 }}>&#10003;</span>
                  {f}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', padding: '40px 24px' }}>
      <button
        onClick={() => setStep('select_plan')}
        style={{ background: 'none', border: 'none', color: '#9C9080', fontSize: 14, cursor: 'pointer', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        &#8592; Cambiar plan
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1B3D24', marginBottom: 4 }}>
        Pagar plan {selectedPlan === 'enterprise' ? 'Enterprise' : 'Starter'}
      </h2>
      <p style={{ fontSize: 24, fontWeight: 800, color: '#1B3D24', marginBottom: 24 }}>
        ${selectedPlan === 'enterprise' ? '79' : '29'}<span style={{ fontSize: 14, fontWeight: 500, color: '#9C9080' }}>/mes</span>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <input
            placeholder="Nombre"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Apellido"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            style={inputStyle}
          />
        </div>
        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}>
          <select
            value={docType}
            onChange={e => setDocType(e.target.value)}
            style={Object.assign({}, inputStyle, { appearance: 'auto' })}
          >
            <option value="CI">CI</option>
            <option value="PASSPORT">Pasaporte</option>
            <option value="RUC">RUC</option>
          </select>
          <input
            placeholder="Numero de documento"
            value={docNumber}
            onChange={e => setDocNumber(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ border: '2px solid #EAE6DC', borderRadius: 8, padding: '12px 12px', background: '#fff', minHeight: 48 }}>
          <div ref={cardContainerRef} id="dlocalgo-card-field" />
        </div>
        {cardError && <div style={{ color: '#D45828', fontSize: 13 }}>{cardError}</div>}

        {submitError && <div style={{ color: '#D45828', fontSize: 13, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6, border: '1px solid #FECACA' }}>{submitError}</div>}

        <button
          onClick={handleSubmit}
          disabled={!firstName || !lastName || !docType || !docNumber || !email}
          style={{
            padding: '14px 0',
            background: (!firstName || !lastName || !docType || !docNumber || !email) ? '#EAE6DC' : '#1B3D24',
            border: 'none',
            borderRadius: 8,
            color: (!firstName || !lastName || !docType || !docNumber || !email) ? '#9C9080' : '#F5F1E8',
            fontWeight: 700,
            fontSize: 15,
            cursor: (!firstName || !lastName || !docType || !docNumber || !email) ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          Pagar ${selectedPlan === 'enterprise' ? '79' : '29'}/mes
        </button>

        <p style={{ fontSize: 12, color: '#9C9080', textAlign: 'center', marginTop: 8 }}>
          Tu tarjeta se guardara de forma segura para cobros mensuales automaticos. Podes cancelar en cualquier momento.
        </p>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '12px 14px',
  border: '2px solid #EAE6DC',
  borderRadius: 8,
  fontSize: 15,
  color: '#1B3D24',
  background: '#fff',
  outline: 'none',
}
