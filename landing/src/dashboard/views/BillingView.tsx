import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../auth/useAuth'
import { Plus, Minus, CreditCard, Users, MapPin, Calendar, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'

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
  pais: string
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

type PaymentStep = 'none' | 'card_form'

const DLOCALGO_SMARTFIELDS_SCRIPT = import.meta.env.DEV
  ? 'https://checkout-sbx.dlocalgo.com/js/dlocalgo-smartfields-bundled.js'
  : 'https://checkout.dlocalgo.com/js/dlocalgo-smartfields-bundled.js'

const EC_PAYMENT_METHODS = [
  { name: 'Visa', icon: '💳' },
  { name: 'Mastercard', icon: '💳' },
  { name: 'Diners Club', icon: '💳' },
  { name: 'American Express', icon: '💳' },
  { name: 'Débito Visa/MC', icon: '🏦' },
]

export function BillingView() {
  const { user } = useAuth()
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('none')
  const [fincas, setFincas] = useState(1)
  const [usuarios, setUsuarios] = useState(1)
  const [cardError, setCardError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [docType, setDocType] = useState('CI')
  const [docNumber, setDocNumber] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [savingPlan, setSavingPlan] = useState(false)
  const [planSaved, setPlanSaved] = useState('')
  const [processing, setProcessing] = useState(false)
  const [showModify, setShowModify] = useState(false)

  const cardFieldRef = useRef<DLocalGoCardField | null>(null)
  const checkoutTokenRef = useRef<string | null>(null)
  const cardMountedRef = useRef(false)
  const cardContainerRef = useRef<HTMLDivElement>(null)

  const price = calcularPrecio(fincas, usuarios)
  const base = getBasePrice(fincas, usuarios)
  const segment = getSegmentLabel(fincas, usuarios)
  const isPaid = status ? ['agricultor', 'productor', 'pyme', 'corporativo', 'starter', 'enterprise'].includes(status.plan) : false
  const isTrial = status ? status.plan === 'trial' : false
  const country = status?.pais ?? 'EC'

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
        setFincas(data.fincas_contratadas ?? 1)
        setUsuarios(data.usuarios_contratados ?? 1)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    if (paymentStep !== 'card_form') return
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
          body: JSON.stringify({ fincas, usuarios, country }),
        })

        if (!payRes.ok) {
          const text = await payRes.text()
          let errMsg = 'Error creando el pago'
          try { errMsg = JSON.parse(text).error || errMsg } catch { /* use default */ }
          throw new Error(errMsg)
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
  }, [paymentStep, fincas, usuarios, country])

  const handleSubmit = async () => {
    if (!cardFieldRef.current || !checkoutTokenRef.current) return
    if (!firstName || !lastName || !docType || !docNumber || !email) {
      setSubmitError('Todos los campos son requeridos')
      return
    }

    setProcessing(true)
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

      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { throw new Error('Respuesta inesperada del servidor') }

      if (!res.ok) throw new Error(data.error || 'Error confirmando el pago')

      if (data.redirect_url) {
        window.location.href = data.redirect_url
        return
      }

      if (data.status === 'PAID' || data.status === 'COMPLETED' || data.status_code === '200') {
        setProcessing(false)
        setPaymentStep('none')
        await fetchStatus()
      } else {
        setProcessing(false)
        setSubmitError(`Pago ${data.status || 'pendiente'}. Te notificaremos cuando se confirme.`)
      }
    } catch (err) {
      setProcessing(false)
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
        setConfirmCancel(false)
        await fetchStatus()
      }
    } catch { /* ignore */ }
  }

  const handleChangePlan = async () => {
    const token = localStorage.getItem('wasagro_token')
    setSavingPlan(true)
    setPlanSaved('')
    try {
      const res = await fetch(`${API_BASE}/api/billing/change-plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fincas, usuarios }),
      })
      const data = await res.json()
      if (res.ok) {
        setPlanSaved(`Plan actualizado a ${data.segment_label}, $${data.precio_mensual}/mes`)
        await fetchStatus()
        setTimeout(() => { setShowModify(false); setPlanSaved('') }, 2000)
      } else {
        setPlanSaved(data.error || 'Error cambiando el plan')
      }
    } catch {
      setPlanSaved('Error de conexión')
    }
    setSavingPlan(false)
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9C9080' }}>Cargando...</div>
  }

  if (processing) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1B3D24' }}>Procesando pago...</div>
        <div style={{ fontSize: 14, color: '#9C9080', marginTop: 8 }}>No cierres esta pagina</div>
      </div>
    )
  }

  // ── CARD FORM (inline, not separate tab) ──
  if (paymentStep === 'card_form') {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
        <button
          onClick={() => setPaymentStep('none')}
          style={{ background: 'none', border: 'none', color: '#9C9080', fontSize: 14, cursor: 'pointer', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← Volver
        </button>

        <div style={{ border: '2px solid #1B3D24', borderRadius: 16, overflow: 'hidden', background: '#F5F1E8', marginBottom: 24 }}>
          <div style={{ background: '#1B3D24', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ color: '#F5F1E8', margin: 0, fontSize: 18, fontWeight: 700 }}>
                Pagar plan {segment}
              </h2>
              <p style={{ color: '#C9F03B', margin: '4px 0 0', fontSize: 14, fontWeight: 600 }}>
                ${price}/mes · {fincas} finca{fincas > 1 ? 's' : ''} · {usuarios} usuario{usuarios > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {/* Metodos de pago disponibles */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1B3D24', margin: '0 0 8px' }}>Metodos de pago disponibles (Ecuador)</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {EC_PAYMENT_METHODS.map(m => (
                  <span key={m.name} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #EAE6DC', background: '#fff', color: '#3A3530' }}>
                    {m.icon} {m.name}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input placeholder="Nombre" value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} />
                <input placeholder="Apellido" value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
              </div>
              <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}>
                <select value={docType} onChange={e => setDocType(e.target.value)} style={Object.assign({}, inputStyle, { appearance: 'auto' as const })}>
                  <option value="CI">CI</option>
                  <option value="PASSPORT">Pasaporte</option>
                  <option value="RUC">RUC</option>
                </select>
                <input placeholder="Numero de documento" value={docNumber} onChange={e => setDocNumber(e.target.value)} style={inputStyle} />
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

              <p style={{ fontSize: 12, color: '#9C9080', textAlign: 'center', marginTop: 4 }}>
                Tu tarjeta se guardara de forma segura para cobros mensuales automaticos. Podes cancelar en cualquier momento.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── MAIN VIEW: plan management (unified, not tabs) ──
  const currentPrice = status?.precio_mensual ?? (status ? calcularPrecio(status.fincas_contratadas, status.usuarios_contratados) : 0)
  const diffFincas = fincas - (status?.fincas_contratadas ?? 0)
  const diffUsuarios = usuarios - (status?.usuarios_contratados ?? 0)
  const priceDiff = price - currentPrice
  const planLabel = status?.segment_label ?? status?.plan ?? ''

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>

      {/* ── PLAN ACTIVO (si ya paga o esta en trial) ── */}
      {status && (isPaid || isTrial) && (
        <div style={{ border: '2px solid #1B3D24', borderRadius: 16, overflow: 'hidden', background: '#F5F1E8', marginBottom: 24 }}>
          <div style={{ background: '#1B3D24', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ color: '#F5F1E8', margin: 0, fontSize: 20, fontWeight: 700 }}>
                {isTrial ? 'Periodo de prueba' : `Plan ${planLabel}`}
              </h2>
              {isTrial ? (
                <p style={{ color: '#C9F03B', margin: '4px 0 0', fontSize: 14, fontWeight: 600 }}>
                  Termina {status.trial_fin ? new Date(status.trial_fin).toLocaleDateString() : 'pronto'}
                </p>
              ) : (
                <p style={{ color: '#C9F03B', margin: '4px 0 0', fontSize: 14, fontWeight: 600 }}>
                  ${currentPrice}/mes
                  {status.subscription_status === 'active' && (
                    <span style={{ marginLeft: 10, background: '#3EBB6A', borderRadius: 6, padding: '2px 8px', color: '#fff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', verticalAlign: 'middle' }}>
                      Activo
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {/* Datos del plan */}
            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              {[
                { icon: MapPin, label: 'Fincas', value: String(status.fincas_contratadas) },
                { icon: Users, label: 'Usuarios', value: String(status.usuarios_contratados) },
                { icon: CreditCard, label: 'Metodo de pago', value: status.metodo_pago === 'dlocalgo' ? 'Tarjeta (dLocal Go)' : (status.metodo_pago ?? 'No configurado') },
                { icon: Calendar, label: 'Activo desde', value: status.plan_activo_desde ? new Date(status.plan_activo_desde).toLocaleDateString() : 'N/A' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #EAE6DC', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <row.icon size={16} color="#9C9080" strokeWidth={2} />
                    <span style={{ color: '#9C9080', fontSize: 14 }}>{row.label}</span>
                  </div>
                  <span style={{ color: '#1B3D24', fontSize: 14, fontWeight: 700 }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Desglose del precio */}
            {isPaid && (
              <div style={{ border: '2px solid #EAE6DC', borderRadius: 12, padding: 16, background: '#fff', marginBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1B3D24', margin: '0 0 10px' }}>Desglose</p>
                {[
                  { label: 'Base', value: `$${getBasePrice(status.fincas_contratadas, status.usuarios_contratados)}` },
                  { label: `${status.fincas_contratadas} finca${status.fincas_contratadas > 1 ? 's' : ''}`, value: `$${PRICE_PER_FINCA * status.fincas_contratadas}` },
                  { label: `${status.usuarios_contratados} usuario${status.usuarios_contratados > 1 ? 's' : ''}`, value: `$${PRICE_PER_USER * status.usuarios_contratados}` },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#9C9080', fontSize: 13 }}>{row.label}</span>
                    <span style={{ color: '#1B3D24', fontSize: 13, fontWeight: 600 }}>{row.value}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #EAE6DC', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#1B3D24', fontSize: 14, fontWeight: 700 }}>Total</span>
                  <span style={{ color: '#1B3D24', fontSize: 14, fontWeight: 800 }}>${currentPrice}/mes</span>
                </div>
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'grid', gap: 10 }}>
              {isTrial && (
                <button
                  onClick={() => { setShowModify(true); setPaymentStep('none') }}
                  style={primaryBtnStyle}
                >
                  Activar plan
                </button>
              )}

              {isPaid && (
                <button
                  onClick={() => setShowModify(!showModify)}
                  style={primaryBtnStyle}
                >
                  {showModify ? 'Cerrar modificacion' : 'Modificar fincas o usuarios'}
                  {!showModify && <ChevronDown size={15} style={{ marginLeft: 6 }} />}
                  {showModify && <ChevronUp size={15} style={{ marginLeft: 6 }} />}
                </button>
              )}

              {/* Cancelar (solo si ya paga) */}
              {isPaid && !confirmCancel && (
                <button
                  onClick={() => setConfirmCancel(true)}
                  style={{ width: '100%', padding: '10px 0', background: 'transparent', border: '2px solid #D45828', borderRadius: 8, color: '#D45828', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancelar suscripcion
                </button>
              )}
              {isPaid && confirmCancel && (
                <div style={{ border: '2px solid #D45828', borderRadius: 8, padding: 16, background: '#FEF2F2' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <AlertTriangle size={16} color="#D45828" />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#D45828' }}>Confirmar cancelacion</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#3A3530', marginBottom: 12 }}>
                    Se mantendra activa hasta el final del periodo pagado. No se realizara otro cobro.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button onClick={handleCancel} style={{ padding: '10px 0', background: '#D45828', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                      Si, cancelar
                    </button>
                    <button onClick={() => setConfirmCancel(false)} style={{ padding: '10px 0', background: '#fff', border: '2px solid #EAE6DC', borderRadius: 6, color: '#9C9080', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                      No, volver
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODIFY PLAN (collapsible section) ── */}
      {showModify && status && (
        <div style={{ border: '2px solid #1B3D24', borderRadius: 16, padding: 24, background: '#fff', marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1B3D24', margin: '0 0 8px' }}>
            {isPaid ? 'Modificar tu plan' : 'Configura tu plan'}
          </h3>
          <p style={{ fontSize: 14, color: '#9C9080', marginBottom: 20 }}>
            {isTrial
              ? 'Selecciona cuantas fincas y usuarios necesitas para activar tu plan.'
              : 'Agrega o quita fincas y usuarios. El cambio se aplica de inmediato.'}
          </p>

          {/* Selectors */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1B3D24', marginBottom: 8 }}>
                <MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Fincas
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setFincas(Math.max(1, fincas - 1))} disabled={fincas <= 1} style={counterBtnStyle(fincas <= 1)}>
                  <Minus size={16} strokeWidth={3} />
                </button>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#1B3D24', minWidth: 40, textAlign: 'center' }}>{fincas}</span>
                <button onClick={() => setFincas(fincas + 1)} style={counterBtnStyle(false)}>
                  <Plus size={16} strokeWidth={3} />
                </button>
              </div>
              <span style={{ fontSize: 13, color: '#9C9080' }}>$8 cada una</span>
              {isPaid && diffFincas !== 0 && (
                <span style={{ fontSize: 12, color: diffFincas > 0 ? '#D45828' : '#3EBB6A', marginLeft: 8 }}>
                  {diffFincas > 0 ? `+${diffFincas}` : diffFincas}
                </span>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1B3D24', marginBottom: 8 }}>
                <Users size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Usuarios
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setUsuarios(Math.max(1, usuarios - 1))} disabled={usuarios <= 1} style={counterBtnStyle(usuarios <= 1)}>
                  <Minus size={16} strokeWidth={3} />
                </button>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#1B3D24', minWidth: 40, textAlign: 'center' }}>{usuarios}</span>
                <button onClick={() => setUsuarios(usuarios + 1)} style={counterBtnStyle(false)}>
                  <Plus size={16} strokeWidth={3} />
                </button>
              </div>
              <span style={{ fontSize: 13, color: '#9C9080' }}>$4 cada uno</span>
              {isPaid && diffUsuarios !== 0 && (
                <span style={{ fontSize: 12, color: diffUsuarios > 0 ? '#D45828' : '#3EBB6A', marginLeft: 8 }}>
                  {diffUsuarios > 0 ? `+${diffUsuarios}` : diffUsuarios}
                </span>
              )}
            </div>
          </div>

          {/* Price breakdown */}
          <div style={{ border: '2px solid #EAE6DC', borderRadius: 12, padding: 16, background: '#F5F1E8', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1B3D24' }}>Segmento: {segment}</span>
            </div>
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
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
            {isPaid && priceDiff !== 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: priceDiff > 0 ? '#FEF2F2' : '#F0FFF4', border: `1px solid ${priceDiff > 0 ? '#FECACA' : '#BBF7D0'}` }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: priceDiff > 0 ? '#D45828' : '#3EBB6A' }}>
                  {priceDiff > 0 ? `+$${priceDiff}/mes` : `-$${Math.abs(priceDiff)}/mes`} respecto a tu plan actual
                </span>
              </div>
            )}
          </div>

          {/* Features */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#1B3D24', marginBottom: 10 }}>Que incluye:</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                'Eventos ilimitados',
                'Alertas de plaga y clima',
                'Dashboard en tiempo real',
                'Reportes semanales',
                'Captura via WhatsApp',
                'Clasificacion inteligente',
                ...(fincas >= 6 ? ['API para integraciones'] : []),
                ...(fincas >= 2 || (fincas === 1 && usuarios >= 4) ? ['Soporte prioritario'] : []),
                ...(fincas >= 21 ? ['Trazabilidad avanzada', 'Gestion multi-org'] : []),
              ].map(f => (
                <div key={f} style={{ fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={14} color="#3EBB6A" strokeWidth={2.5} />
                  <span style={{ color: '#3A3530' }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {planSaved && (
            <div style={{ padding: '12px 16px', borderRadius: 8, background: planSaved.includes('Error') ? '#FEF2F2' : '#F0FFF4', border: `1px solid ${planSaved.includes('Error') ? '#FECACA' : '#BBF7D0'}`, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: planSaved.includes('Error') ? '#D45828' : '#3EBB6A' }}>{planSaved}</span>
            </div>
          )}

          {isPaid ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <button
                onClick={handleChangePlan}
                disabled={savingPlan || (diffFincas === 0 && diffUsuarios === 0)}
                style={{
                  ...primaryBtnStyle,
                  background: (diffFincas === 0 && diffUsuarios === 0) ? '#EAE6DC' : '#1B3D24',
                  color: (diffFincas === 0 && diffUsuarios === 0) ? '#9C9080' : '#F5F1E8',
                  cursor: (diffFincas === 0 && diffUsuarios === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {savingPlan ? 'Guardando...' : `Guardar cambios, $${price}/mes`}
              </button>
              <button
                onClick={() => setPaymentStep('card_form')}
                style={{ width: '100%', padding: '12px 0', background: 'transparent', border: '2px solid #1B3D24', borderRadius: 8, color: '#1B3D24', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <CreditCard size={15} />
                Actualizar metodo de pago
              </button>
            </div>
          ) : (
            <button
              onClick={() => setPaymentStep('card_form')}
              style={primaryBtnStyle}
            >
              Continuar al pago, ${price}/mes
            </button>
          )}
        </div>
      )}

      {/* ── SI NO HAY PLAN (no trial, no paid) ── */}
      {status && !isPaid && !isTrial && !showModify && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p style={{ fontSize: 16, color: '#9C9080', marginBottom: 16 }}>No tenes un plan activo.</p>
          <button
            onClick={() => setShowModify(true)}
            style={primaryBtnStyle}
          >
            Configurar plan
          </button>
        </div>
      )}
    </div>
  )
}

const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 0',
  background: '#1B3D24',
  border: 'none',
  borderRadius: 8,
  color: '#F5F1E8',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
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
