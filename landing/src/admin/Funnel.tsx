import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../auth/api'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface ConversacionRow {
  id: string
  phone: string
  nombre: string | null
  empresa: string | null
  status: string
  handoff_status: string
  handoff_reason: string | null
  ultima_interaccion: string | null
  needs_attention: boolean
}

// Real `status` enum values assigned by the SDR FSM (sdrAgent.ts), in
// pipeline order. Any status not in this list falls into the trailing
// "Otros" column (defensive — never drop a conversation silently, P1).
const STAGE_ORDER = [
  'new',
  'en_discovery',
  'qualified',
  'piloto_propuesto',
  'reunion_agendada',
  'unqualified',
  'dormant',
  'descartado',
] as const

const STAGE_LABEL: Record<string, string> = {
  new: 'Nuevo',
  en_discovery: 'En discovery',
  qualified: 'Calificado',
  piloto_propuesto: 'Piloto propuesto',
  reunion_agendada: 'Reunión agendada',
  unqualified: 'No calificado',
  dormant: 'Dormido',
  descartado: 'Descartado',
}

const OTROS_STATUS = 'otros'
const OTROS_LABEL = 'Otros'

async function readBackendError(res: Response, fallback: string): Promise<string> {
  const text = await res.text()
  try {
    const parsed = JSON.parse(text) as { error?: string }
    return parsed.error || fallback
  } catch {
    return fallback
  }
}

function isKnownStage(status: string): status is (typeof STAGE_ORDER)[number] {
  return (STAGE_ORDER as readonly string[]).includes(status)
}

function groupByStatus(rows: ConversacionRow[]): Map<string, ConversacionRow[]> {
  const columns = new Map<string, ConversacionRow[]>()
  for (const status of STAGE_ORDER) columns.set(status, [])
  columns.set(OTROS_STATUS, [])

  for (const row of rows) {
    const key = isKnownStage(row.status) ? row.status : OTROS_STATUS
    columns.get(key)!.push(row)
  }
  return columns
}

// PR6 (founder-crm) — read-only SDR funnel kanban. Reuses the EXISTING
// GET /api/admin/conversaciones endpoint (same one Inbox.tsx already uses) —
// no new backend, no migration. Grouping by `status` happens entirely on the
// client. Read-only: cards never write back — the `status` shown here is
// whatever the SDR FSM already assigned; there is no drag-to-persist.
export function Funnel() {
  const navigate = useNavigate()
  const [conversaciones, setConversaciones] = useState<ConversacionRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError('')
      try {
        const res = await authFetch(`${API_BASE}/admin/conversaciones`)
        if (!res.ok) throw new Error(await readBackendError(res, `Error ${res.status} cargando el funnel`))
        const data = (await res.json()) as ConversacionRow[]
        if (!cancelled) setConversaciones(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando el funnel')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <div style={errorBoxStyle}>{error}</div>
  }

  if (conversaciones === null) {
    return <div style={loadingStyle}>Cargando...</div>
  }

  const columns = groupByStatus(conversaciones)
  const columnKeys = [...STAGE_ORDER, OTROS_STATUS]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3D24', marginBottom: 20 }}>Funnel SDR</h1>
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
        {columnKeys.map((status) => {
          const rows = columns.get(status) ?? []
          const label = status === OTROS_STATUS ? OTROS_LABEL : STAGE_LABEL[status]
          return (
            <div
              key={status}
              data-testid="funnel-column"
              data-status={status}
              style={{ minWidth: 240, flexShrink: 0, background: '#F5F1E8', borderRadius: 8, padding: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#1B3D24' }}>{label}</span>
                <span data-testid="funnel-column-count" style={countBadgeStyle}>
                  {rows.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((row) => (
                  <button
                    key={row.id}
                    data-testid="funnel-card"
                    data-needs-attention={row.needs_attention}
                    onClick={() => navigate('/admin/inbox')}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #EAE6DC',
                      background: row.needs_attention ? '#FEF2F2' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1B3D24' }}>
                      {row.nombre || row.phone}
                      {row.needs_attention && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#D45828', fontWeight: 700 }}>
                          ⚠ Requiere atención
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#9C9080' }}>{row.phone}</div>
                    <div style={{ fontSize: 11, color: '#9C9080' }}>{row.ultima_interaccion ?? '—'}</div>
                  </button>
                ))}
                {rows.length === 0 && (
                  <div style={{ fontSize: 12, color: '#9C9080', padding: '8px 0' }}>Sin prospectos.</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const errorBoxStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 8,
  background: '#FEF2F2',
  border: '1px solid #FECACA',
  color: '#D45828',
}
const loadingStyle: React.CSSProperties = { padding: 40, textAlign: 'center', color: '#9C9080' }
const countBadgeStyle: React.CSSProperties = {
  background: '#1B3D24',
  color: '#F5F1E8',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  padding: '1px 8px',
}
