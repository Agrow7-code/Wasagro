import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../auth/useAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

const PRICE_PER_FINCA = 8
const PRICE_PER_USER = 4

function getBasePrice(fincas: number, usuarios: number): number {
  if (fincas === 1 && usuarios <= 3) return 10
  if (fincas === 1 && usuarios >= 4) return 15
  if (fincas >= 2 && fincas <= 5) return 15
  if (fincas >= 6 && fincas <= 20) return 25
  return 50
}

function calcularPrecio(fincas: number, usuarios: number): number {
  return getBasePrice(fincas, usuarios) + PRICE_PER_FINCA * fincas + PRICE_PER_USER * usuarios
}

function getSegmentLabel(fincas: number, usuarios: number): string {
  if (fincas === 1 && usuarios <= 3) return 'Agricultor'
  if (fincas === 1 && usuarios >= 4) return 'Productor'
  if (fincas >= 2 && fincas <= 5) return 'Productor'
  if (fincas >= 6 && fincas <= 20) return 'Pyme / Agroexportadora'
  return 'Corporativo'
}

interface BillingStatus {
  org_id: string
  nombre: string
  plan: string
  segment_label: string
  trial_inicio: string | null
  trial_fin: string | null
  subscription_status: string | null
  metodo_pago: string | null
  plan_activo_desde: string | null
  plan_cancelado_en: string | null
  fincas_contratadas: number
  usuarios_contratados: number
  precio_mensual: number | null
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

type Step = 'loading' | 'configure' | 'payment_form' | 'processing' | 'success' | 'error'

const DLOCALGO_SMARTFIELDS_SCRIPT = import.meta.env.DEV
  ? 'https://checkout-sbx.dlocalgo.com/js/dlocalgo-smartfields-bundled.js'
  : 'https://checkout.dlocalgo.com/js/dlocalgo-smartfields-bundled.js'

export function BillingView() {
  const { user } = useAuth()
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [fincas, setFincas] = useState(1)
  const [usuarios, setUsuarios] = useState(1)
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

  const price = calcularPrecio(fincas, usuarios)
  const base = getBasePrice(fincas, usuarios)
  const segment = getSegmentLabel(fincas, usuarios)

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
        if (data.plan === 'agricultor' || data.plan === 'productor' || data.plan === 'pyme' || data.plan === 'corporativo' || data.plan === 'starter' || data.plan === 'enterprise') {
          setStep('success')
        } else {
          setStep('configure')
        }
      } else {
        setStep('configure')
      }
    } catch {
      setStep('configure')
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
          body: JSON.stringify({ fincas, usuarios, country: 'EC' }),
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
  }, [step, fincas, usuarios])

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
    const planLabel = status.segment_label || status.plan
    const monthlyPrice = status.precio_mensual ?? calcularPrecio(status.fincas_contratadas, status.usuarios_contratados)

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
              Plan {planLabel} activo
            </h2>
            <p style={{ color: '#C9F03B', margin: '4px 0 0', fontSize: 14, fontWeight: 600 }}>
              ${monthlyPrice}/mes
            </p>
          </div>
          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                { label: 'Fincas', value: status.fincas_contratadas },
                { label: 'Usuarios', value: status.usuarios_contratados },
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

  if (step === 'configure') {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 24px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1B3D24', marginBottom: 8 }}>Configura tu plan</h2>
        <p style={{ fontSize: 15, color: '#9C9080', marginBottom: 32 }}>
          {status?.plan === 'trial'
            ? `Tu trial termina ${status?.trial_fin ? new Date(status.trial_fin).toLocaleDateString() : 'pronto'}. Activa tu plan para seguir usando Wasagro.`
            : 'Selecciona cuantas fincas y usuarios necesitas.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1B3D24', marginBottom: 8 }}>
              Fincas
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setFincas(Math.max(1, fincas - 1))}
                disabled={fincas <= 1}
                style={counterBtnStyle(fincas <= 1)}
              >
                -
              </button>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#1B3D24', minWidth: 40, textAlign: 'center' }}>{fincas}</span>
              <button
                onClick={() => setFincas(fincas + 1)}
                style={counterBtnStyle(false)}
              >
                +
              </button>
            </div>
            <span style={{ fontSize: 13, color: '#9C9080' }}>$8 cada una</span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1B3D24', marginBottom: 8 }}>
              Usuarios
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setUsuarios(Math.max(1, usuarios - 1))}
                disabled={usuarios <= 1}
                style={counterBtnStyle(usuarios <= 1)}
              >
                -
              </button>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#1B3D24', minWidth: 40, textAlign: 'center' }}>{usuarios}</span>
              <button
                onClick={() => setUsuarios(usuarios + 1)}
                style={counterBtnStyle(false)}
              >
                +
              </button>
            </div>
            <span style={{ fontSize: 13, color: '#9C9080' }}>$4 cada uno</span>
          </div>
        </div>

        <div style={{
          border: '2px solid #1B3D24',
          borderRadius: 16,
          padding: 24,
          background: '#F5F1E8',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1B3D24' }}>Segmento: {segment}</span>
          </div>

          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Base', value: `$${base}` },
              { label: `${fincas} finca${fincas > 1 ? 's' : ''}`, value: `$${PRICE_PER_FINCA * fincas}` },
              { label: `${usuarios} usuario${usuarios > 1 ? 's' : ''}`, value: `$${PRICE_PER_USER * usuarios}` },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9C9080', fontSize: 14 }}>{row.label}</span>
                <span style={{ color: '#1B3D24', fontSize: 14, fontWeight: 600 }}>{row.value}</span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '2px solid #1B3D24', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1B3D24' }}>Total mensual</span>
            <span style={{ fontSize: 28, fontWeight: 800, color: '#1B3D24' }}>
              ${price}<span style={{ fontSize: 14, fontWeight: 500, color: '#9C9080' }}>/mes</span>
            </span>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1B3D24', marginBottom: 12 }}>Que incluye:</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              'Eventos ilimitados',
              'Alertas de plaga y clima',
              'Dashboard en tiempo real',
              'Reportes semanales',
              'Captura via WhatsApp',
              'Clasificacion inteligente',
              ...(fincas >= 6 ? ['API para integraciones'] : []),
              ...(fincas >= 6 ? ['Soporte prioritario'] : []),
              ...(fincas >= 21 ? ['Trazabilidad avanzada', 'Gestion multi-org'] : []),
            ].map(f => (
              <div key={f} style={{ fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#C9F03B', fontSize: 16 }}>&#10003;</span>
                {f}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => setStep('payment_form')}
          style={{
            width: '100%',
            padding: '14px 0',
            background: '#1B3D24',
            border: 'none',
            borderRadius: 8,
            color: '#F5F1E8',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Continuar al pago — ${price}/mes
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', padding: '40px 24px' }}>
      <button
        onClick={() => setStep('configure')}
        style={{ background: 'none', border: 'none', color: '#9C9080', fontSize: 14, cursor: 'pointer', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        &#8592; Cambiar configuracion
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1B3D24', marginBottom: 4 }}>
        Pagar plan {segment}
      </h2>
      <p style={{ fontSize: 24, fontWeight: 800, color: '#1B3D24', marginBottom: 4 }}>
        ${price}<span style={{ fontSize: 14, fontWeight: 500, color: '#9C9080' }}>/mes</span>
      </p>
      <p style={{ fontSize: 13, color: '#9C9080', marginBottom: 24 }}>
        {fincas} finca{fincas > 1 ? 's' : ''} · {usuarios} usuario{usuarios > 1 ? 's' : ''}
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
          Pagar ${price}/mes
        </button>

        <p style={{ fontSize: 12, color: '#9C9080', textAlign: 'center', marginTop: 8 }}>
          Tu tarjeta se guardara de forma segura para cobros mensuales automaticos. Podes cancelar en cualquier momento.
        </p>
      </div>
    </div>
  )
}

function counterBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    border: `2px solid ${disabled ? '#EAE6DC' : '#1B3D24'}`,
    borderRadius: 8,
    background: disabled ? '#F5F1E8' : '#1B3D24',
    color: disabled ? '#9C9080' : '#F5F1E8',
    fontSize: 18,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
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
