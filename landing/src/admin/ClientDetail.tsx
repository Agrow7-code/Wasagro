import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { authFetch } from '../auth/api'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface FincaRow {
  finca_id: string
  nombre: string
  cultivo_principal: string
  config: Record<string, unknown>
}

interface UsuarioRow {
  id: string
  nombre: string | null
  rol: string
  phone: string // already last-4 masked server-side — rendered as-is (D31/P5)
}

interface OrgDetail {
  org_id: string
  nombre: string
  plan: string
  subscription_status: string | null
  trial_inicio: string | null
  trial_fin: string | null
  fincas_contratadas: number
  usuarios_contratados: number
  precio_mensual: number | null
  fincas: FincaRow[]
  usuarios: UsuarioRow[]
}

// Drill-in exposes ONLY real-data views (S4 deferred). Do not add links to
// mock views until each view is migrated (see CLAUDE.md D28 + ADR 020).
function fincaDrillInLinks(fincaId: string) {
  return [
    { label: 'Sigatoka', href: `/dashboard/sigatoka?finca_id=${fincaId}` },
    { label: 'Setup', href: `/dashboard/finca/setup?finca_id=${fincaId}` },
    { label: 'Billing', href: `/dashboard/billing?finca_id=${fincaId}` },
  ]
}

export function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError('')
      setNotFound(false)
      try {
        const res = await authFetch(`${API_BASE}/admin/orgs/${id}`)
        if (res.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!res.ok) {
          // Surface the backend's own error body when present (matches the
          // pattern in CreateClientForm.tsx); fall back to a generic status
          // message when the body isn't JSON or has no `error` field.
          const text = await res.text()
          let backendError: string | undefined
          try {
            backendError = (JSON.parse(text) as { error?: string }).error
          } catch {
            // not JSON — use the fallback below
          }
          throw new Error(backendError || `Error ${res.status} cargando el cliente`)
        }
        const data = (await res.json()) as OrgDetail
        if (!cancelled) setOrg(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando el cliente')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <button
        onClick={() => navigate('/admin')}
        style={{ background: 'none', border: 'none', color: '#9C9080', fontSize: 14, cursor: 'pointer', marginBottom: 20, padding: 0 }}
      >
        ← Volver
      </button>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#D45828' }}>
          {error}
        </div>
      )}

      {notFound && !error && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9C9080' }}>Cliente no encontrado.</div>
      )}

      {!error && !notFound && org === null && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9C9080' }}>Cargando...</div>
      )}

      {org && (
        <>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3D24', marginBottom: 4 }}>{org.nombre}</h1>
          <p style={{ fontSize: 13, color: '#9C9080', marginBottom: 24 }}>
            {org.plan} · {org.subscription_status ?? 'sin estado'} · ${org.precio_mensual ?? 0}/mes
          </p>

          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3D24', marginBottom: 10 }}>Fincas</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            {org.fincas.map((finca) => (
              <div key={finca.finca_id} style={{ border: '1px solid #EAE6DC', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1B3D24' }}>{finca.nombre}</div>
                    <div style={{ fontSize: 12, color: '#9C9080' }}>{finca.cultivo_principal}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {fincaDrillInLinks(finca.finca_id).map((link) => (
                    <Link
                      key={link.label}
                      to={link.href}
                      style={{ fontSize: 12, fontWeight: 700, color: '#1B3D24', border: '1px solid #1B3D24', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {org.fincas.length === 0 && <div style={{ fontSize: 13, color: '#9C9080' }}>Sin fincas registradas.</div>}
          </div>

          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3D24', marginBottom: 10 }}>Usuarios</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1B3D24', textAlign: 'left' }}>
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Rol</th>
                <th style={thStyle}>Teléfono</th>
              </tr>
            </thead>
            <tbody>
              {org.usuarios.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #EAE6DC' }}>
                  <td style={tdStyle}>{u.nombre ?? '—'}</td>
                  <td style={tdStyle}>{u.rol}</td>
                  <td style={tdStyle}>{u.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: '#9C9080', fontWeight: 700 }
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 14, color: '#1B3D24' }
