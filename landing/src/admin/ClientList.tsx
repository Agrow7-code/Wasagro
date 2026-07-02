import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../auth/api'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface OrgListItem {
  org_id: string
  nombre: string
  plan: string
  subscription_status: string | null
  trial_inicio: string | null
  trial_fin: string | null
  fincas_count: number
  usuarios_count: number
  fincas_contratadas: number
  usuarios_contratados: number
  precio_mensual: number | null
}

const PLAN_LABEL: Record<string, string> = {
  trial: 'Prueba',
  agricultor: 'Agricultor',
  productor: 'Productor',
  pyme: 'Pyme / Agroexportadora',
  corporativo: 'Corporativo',
  starter: 'Starter',
  enterprise: 'Enterprise',
  free: 'Gratis',
}

function planLabel(plan: string): string {
  return PLAN_LABEL[plan] ?? plan
}

export function ClientList() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<OrgListItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError('')
      try {
        const res = await authFetch(`${API_BASE}/admin/orgs`)
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
          throw new Error(backendError || `Error ${res.status} cargando clientes`)
        }
        const data = (await res.json()) as OrgListItem[]
        if (!cancelled) setOrgs(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando clientes')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3D24', margin: 0 }}>Clientes</h1>
        <button
          onClick={() => navigate('/admin/clients/new')}
          style={{
            padding: '10px 16px',
            background: '#1B3D24',
            border: 'none',
            borderRadius: 8,
            color: '#F5F1E8',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Crear cliente
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#D45828', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!error && orgs === null && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9C9080' }}>Cargando...</div>
      )}

      {!error && orgs !== null && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1B3D24', textAlign: 'left' }}>
              <th style={thStyle}>Nombre</th>
              <th style={thStyle}>Plan</th>
              <th style={thStyle}>Estado</th>
              <th style={thStyle}>Fincas</th>
              <th style={thStyle}>Usuarios</th>
              <th style={thStyle}>Precio mensual</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr
                key={org.org_id}
                data-testid="org-row"
                data-org-id={org.org_id}
                onClick={() => navigate(`/admin/orgs/${org.org_id}`)}
                style={{ borderBottom: '1px solid #EAE6DC', cursor: 'pointer' }}
              >
                <td style={tdStyle}>{org.nombre}</td>
                <td style={tdStyle}>{planLabel(org.plan)}</td>
                <td style={tdStyle}>{org.subscription_status ?? 'N/D'}</td>
                <td style={tdStyle}>{org.fincas_count}</td>
                <td style={tdStyle}>{org.usuarios_count}</td>
                <td style={tdStyle}>{org.precio_mensual != null ? `$${org.precio_mensual}` : 'N/D'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: '#9C9080', fontWeight: 700 }
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 14, color: '#1B3D24' }
