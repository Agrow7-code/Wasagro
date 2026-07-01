import { useEffect, useState } from 'react'
import { authFetch } from '../auth/api'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface ProspectoRow {
  id: string
  nombre: string | null
  phone: string // already last-4 masked server-side (T-S2.4) — rendered as-is
  estado: string
  turns_total: number
  calcom_booking_id: string | null
  created_at: string
}

const ESTADO_LABEL: Record<string, string> = {
  new: 'Nuevo',
  nurturing: 'En seguimiento',
  meeting_offered: 'Demo ofrecida',
  meeting_confirmed: 'Demo confirmada',
  meeting_waiting: 'Esperando demo',
  closed_won: 'Cerrado (ganado)',
  closed_lost: 'Cerrado (perdido)',
}

export function SdrFunnel() {
  const [prospectos, setProspectos] = useState<ProspectoRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError('')
      try {
        const res = await authFetch(`${API_BASE}/admin/sdr`)
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
          throw new Error(backendError || `Error ${res.status} cargando prospectos`)
        }
        const data = (await res.json()) as ProspectoRow[]
        if (!cancelled) setProspectos(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando prospectos')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3D24', marginBottom: 20 }}>Prospectos SDR</h1>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#D45828' }}>
          {error}
        </div>
      )}

      {!error && prospectos === null && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9C9080' }}>Cargando...</div>
      )}

      {!error && prospectos !== null && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1B3D24', textAlign: 'left' }}>
              <th style={thStyle}>Nombre</th>
              <th style={thStyle}>Teléfono</th>
              <th style={thStyle}>Estado</th>
              <th style={thStyle}>Turnos</th>
              <th style={thStyle}>Booking</th>
              <th style={thStyle}>Creado</th>
            </tr>
          </thead>
          <tbody>
            {prospectos.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #EAE6DC' }}>
                <td style={tdStyle}>{p.nombre ?? '—'}</td>
                <td style={tdStyle}>{p.phone}</td>
                <td style={tdStyle}>{ESTADO_LABEL[p.estado] ?? p.estado}</td>
                <td style={tdStyle}>{p.turns_total}</td>
                <td style={tdStyle}>{p.calcom_booking_id ?? '—'}</td>
                <td style={tdStyle}>{new Date(p.created_at).toLocaleDateString()}</td>
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
