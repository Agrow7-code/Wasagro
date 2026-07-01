import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

// Anti-mock invariant (CLAUDE.md D28 + ADR 020, design.md §5): this nav MUST
// NEVER link to a mock view (gerente / exportadora / agricultor /
// calculadora / insumos / labor / cosecha / plagas / clima / gastos). Real
// per-finca drill-in links (Sigatoka/Setup/Billing) live in ClientDetail,
// scoped to the selected finca — not here.
const NAV_LINKS = [
  { to: '/admin', label: 'Clientes' },
  { to: '/admin/sdr', label: 'SDR' },
]

// Minimal shell for the founder back-office (D28, PR-S3, T-S3.2). Nav links
// are added incrementally in later commits (ClientList / SdrFunnel / the
// drill-in nav in T-S3.7) — this stub only wires the layout + logout so
// directors landing on /admin never see a blank page.
export function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
            style={{ fontSize: 14, fontWeight: 600, color: '#1B3D24', textDecoration: 'none', padding: '8px 4px' }}
          >
            {link.label}
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
