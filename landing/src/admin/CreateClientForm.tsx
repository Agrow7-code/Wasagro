import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../auth/api'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

const DEFAULT_CONSENT_TEXTO =
  'Acepto que Wasagro capture y estructure los datos de campo de mi finca para trazabilidad y reportes, según los términos de uso de Wasagro.'

interface CreateClientResponse {
  org_id: string
  usuario_id: string
  ya_existia: boolean
}

// Body/response shape follows the ACTUAL shipped router
// (src/agents/admin/router.ts), not the older design-doc wording:
//  - response key is `org_id` (snake_case).
//  - duplicate phone is HTTP 200 with `ya_existia: true` (idempotent
//    no-op) — NEVER 409. Treated here as a non-blocking inline notice,
//    since the request itself succeeded (the org/admin already exists).
//  - `nombre_admin` is REQUIRED by ProvisionInputSchema
//    (`z.string().min(1)`), despite tasks.md listing it as optional.
export function CreateClientForm() {
  const navigate = useNavigate()

  const [nombreOrg, setNombreOrg] = useState('')
  const [telefonoAdmin, setTelefonoAdmin] = useState('')
  const [nombreAdmin, setNombreAdmin] = useState('')
  const [pais, setPais] = useState('')
  const [cultivoPrincipal, setCultivoPrincipal] = useState('banano')
  const [consentTexto, setConsentTexto] = useState(DEFAULT_CONSENT_TEXTO)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isValid =
    nombreOrg.trim().length > 0 &&
    telefonoAdmin.trim().length > 0 &&
    nombreAdmin.trim().length > 0 &&
    pais.trim().length === 2 &&
    cultivoPrincipal.trim().length > 0 &&
    consentTexto.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || submitting) return

    setSubmitting(true)
    setError('')
    setNotice('')

    try {
      const res = await authFetch(`${API_BASE}/admin/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre_org: nombreOrg.trim(),
          pais: pais.trim().toUpperCase(),
          telefono_admin: telefonoAdmin.trim(),
          nombre_admin: nombreAdmin.trim(),
          cultivo_principal: cultivoPrincipal,
          consent_texto: consentTexto.trim(),
        }),
      })

      const text = await res.text()
      let data: CreateClientResponse | { error: string }
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('Respuesta inesperada del servidor')
      }

      if (!res.ok) {
        throw new Error('error' in data ? data.error : 'No se pudo crear el cliente')
      }

      const created = data as CreateClientResponse
      if (created.ya_existia) {
        setSubmitting(false)
        setNotice('Este teléfono ya está registrado. No se creó un cliente duplicado.')
        return
      }

      navigate('/admin')
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof Error ? err.message : 'Error creando el cliente')
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3D24', marginBottom: 20 }}>Crear cliente</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Nombre de la organización" htmlFor="nombre_org">
          <input
            id="nombre_org"
            value={nombreOrg}
            onChange={(e) => setNombreOrg(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="Teléfono del administrador" htmlFor="telefono_admin">
          <input
            id="telefono_admin"
            placeholder="+593987654321"
            value={telefonoAdmin}
            onChange={(e) => setTelefonoAdmin(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="Nombre del administrador" htmlFor="nombre_admin">
          <input
            id="nombre_admin"
            value={nombreAdmin}
            onChange={(e) => setNombreAdmin(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="País (código 2 letras)" htmlFor="pais">
          <input
            id="pais"
            placeholder="EC"
            maxLength={2}
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="Cultivo principal" htmlFor="cultivo_principal">
          <select
            id="cultivo_principal"
            value={cultivoPrincipal}
            onChange={(e) => setCultivoPrincipal(e.target.value)}
            style={inputStyle}
          >
            <option value="banano">Banano</option>
            <option value="cacao">Cacao</option>
            <option value="otro">Otro</option>
          </select>
        </Field>

        <Field label="Texto de consentimiento" htmlFor="consent_texto">
          <textarea
            id="consent_texto"
            value={consentTexto}
            onChange={(e) => setConsentTexto(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' as const }}
          />
        </Field>

        {notice && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FEFCE8', border: '1px solid #FDE68A', color: '#92400E' }}>
            {notice}
          </div>
        )}
        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#D45828' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!isValid || submitting}
          style={{
            padding: '12px 0',
            background: !isValid || submitting ? '#EAE6DC' : '#1B3D24',
            border: 'none',
            borderRadius: 8,
            color: !isValid || submitting ? '#9C9080' : '#F5F1E8',
            fontWeight: 700,
            fontSize: 15,
            cursor: !isValid || submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Creando...' : 'Crear cliente'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1B3D24', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '2px solid #EAE6DC',
  borderRadius: 8,
  fontSize: 14,
  color: '#1B3D24',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}
