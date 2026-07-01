import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { authFetch } from '../auth/api'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// Anti-mock invariant (CLAUDE.md D28 + ADR 020, design.md §5): this nav MUST
// NEVER link to a mock view (gerente / exportadora / agricultor /
// calculadora / insumos / labor / cosecha / plagas / clima / gastos). Real
// per-finca drill-in links (Sigatoka/Setup/Billing) live in ClientDetail,
// scoped to the selected finca — not here.
const NAV_LINKS = [
  { to: '/admin', label: 'Clientes' },
  { to: '/admin/sdr', label: 'SDR' },
  { to: '/admin/inbox', label: 'Inbox' },
]

// T-H4.2 (founder-crm PR4, design Decision 7). Polling, not websockets —
// same infra-minimal approach as D19/D20's cron alerts. Exported so the test
// can drive vi.advanceTimersByTimeAsync against the same interval.
export const POLL_INTERVAL_MS = 15000

interface ConversacionSummary {
  handoff_status: string
}

// Minimal shell for the founder back-office (D28, PR-S3, T-S3.2). Nav links
// are added incrementally in later commits (ClientList / SdrFunnel / the
// drill-in nav in T-S3.7) — this stub only wires the layout + logout so
// directors landing on /admin never see a blank page.
export function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [pausedCount, setPausedCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function pollConversaciones() {
      try {
        const res = await authFetch(`${API_BASE}/admin/conversaciones`)
        if (!res.ok) return
        const data = (await res.json()) as ConversacionSummary[]
        if (!cancelled) {
          setPausedCount(data.filter((c) => c.handoff_status === 'human_paused').length)
        }
      } catch {
        // Best-effort badge — a failed poll just leaves the last known count.
      }
    }

    pollConversaciones()
    const interval = setInterval(pollConversaciones, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div data-testid="admin-layout" style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: '2px solid #1B3D24',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
        aria-label="Navegación de administración"
      >
        <div style={{ fontWeight: 700, fontSize: 14, color: '#1B3D24', marginBottom: 16 }}>
          Wasagro Admin
        </div>
        <div style={{ fontSize: 13, color: '#9C9080', marginBottom: 24 }}>{user?.nombre}</div>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1B3D24',
              textDecoration: 'none',
              padding: '8px 4px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {link.label}
            {link.to === '/admin/inbox' && pausedCount > 0 && (
              <span
                data-testid="inbox-badge"
                style={{
                  background: '#D45828',
                  color: '#F5F1E8',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 7px',
                  lineHeight: 1.5,
                }}
              >
                {pausedCount}
              </span>
            )}
          </Link>
        ))}
        <button
          onClick={handleLogout}
          style={{
            marginTop: 'auto',
            padding: '8px 12px',
            background: 'transparent',
            border: '2px solid #EAE6DC',
            borderRadius: 8,
            color: '#9C9080',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cerrar sesión
        </button>
      </nav>
      <div style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </div>
    </div>
  )
}
