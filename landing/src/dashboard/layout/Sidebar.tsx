import { useState, useEffect, type ReactNode, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export interface SidebarUser {
  initials: string
  name: string
  role: string
  sub: string
}

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

export interface TipoConfig {
  tipo: string
  label: string
  to: string
  color: string
}

// ── Iconos ────────────────────────────────────────────────────────────────────

function iconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  )
}
function iconCalc() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="10" x2="10" y2="10"/><line x1="12" y1="10" x2="14" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/>
      <line x1="8" y1="14" x2="10" y2="14"/><line x1="12" y1="14" x2="14" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/>
      <line x1="8" y1="18" x2="10" y2="18"/><line x1="12" y1="18" x2="14" y2="18"/><line x1="16" y1="18" x2="16" y2="18"/>
    </svg>
  )
}
function iconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M12 2a10 10 0 0 1 0 20M4.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>
  )
}
function iconBilling() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  )
}
function iconMap() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
      <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  )
}
function iconBarChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )
}
function iconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function iconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

// Icono mini para los tipos del accordion
const TIPO_DOT_COLOR: Record<string, string> = {
  insumo:  '#2A50D4',
  labor:   '#6B7280',
  cosecha: '#3EBB6A',
  plaga:   '#D45828',
  gasto:   '#C9A800',
  clima:   '#9C9080',
}

// ── Nav sets ─────────────────────────────────────────────────────────────────

function iconClipboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/>
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  )
}

export const NAV_ADMIN: NavItem[] = [
  { to: '/dashboard', label: 'Resumen', icon: iconGrid(), end: true },
  { to: '/dashboard/calculadora', label: 'Calculadora', icon: iconCalc() },
  { to: '/dashboard/sigatoka', label: 'Revisión Sigatoka', icon: iconClipboard() },
]

export const NAV_GERENTE: NavItem[] = [
  { to: '/dashboard/gerente', label: 'Resumen global', icon: iconGrid(), end: true },
  { to: '/dashboard/gerente/fincas', label: 'Mis fincas', icon: iconMap() },
  { to: '/dashboard/gerente/reportes', label: 'Reportes', icon: iconBarChart() },
  { to: '/dashboard/gerente/equipo', label: 'Equipo', icon: iconUsers() },
]

export const NAV_EXPORTADORA: NavItem[] = [
  { to: '/dashboard/exportadora', label: 'Fincas proveedoras', icon: iconMap(), end: true },
  { to: '/dashboard/exportadora/trazabilidad', label: 'Trazabilidad por lote', icon: iconSearch() },
  { to: '/dashboard/exportadora/reportes', label: 'Reportes de exportación', icon: iconBarChart() },
]

export const NAV_AGRICULTOR: NavItem[] = [
  { to: '/dashboard/agricultor', label: 'Mis registros', icon: iconGrid(), end: true },
  { to: '/dashboard/agricultor/lotes', label: 'Mis lotes', icon: iconMap() },
  { to: '/dashboard/agricultor/alertas', label: 'Alertas', icon: iconBarChart() },
]

function iconDrawPolygon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 19 8 22 18 12 22 2 18 5 8"/>
      <circle cx="12" cy="2" r="1.5" fill="currentColor"/>
      <circle cx="19" cy="8" r="1.5" fill="currentColor"/>
      <circle cx="22" cy="18" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="22" r="1.5" fill="currentColor"/>
      <circle cx="2" cy="18" r="1.5" fill="currentColor"/>
      <circle cx="5" cy="8" r="1.5" fill="currentColor"/>
    </svg>
  )
}

const NAV_SETTINGS: NavItem[] = [
  { to: '/dashboard/billing', label: 'Billing', icon: iconBilling() },
  { to: '/dashboard/finca/setup', label: 'Dibujar lotes', icon: iconDrawPolygon() },
  { to: '/dashboard/config', label: 'Configuracion', icon: iconSettings() },
]

// ── Sidebar ──────────────────────────────────────────────────────────────────

const DASHBOARD_ROUTES = [
  '/dashboard/insumos',
  '/dashboard/labor',
  '/dashboard/cosecha',
  '/dashboard/plagas',
  '/dashboard/gastos',
  '/dashboard/clima',
]

function navLinkStyle(isActive: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    cursor: 'pointer',
    color: isActive ? '#C9F03B' : 'rgba(245,241,232,0.65)',
    fontSize: 14,
    fontWeight: 500,
    background: isActive ? 'rgba(201,240,59,0.15)' : 'transparent',
    borderLeft: isActive ? '3px solid #C9F03B' : '3px solid transparent',
    textDecoration: 'none',
    transition: 'background 0.1s',
  }
}

export function Sidebar({
  user,
  navItems,
  tiposActivos = [],
  onLogout,
}: {
  user: SidebarUser
  navItems: NavItem[]
  tiposActivos?: TipoConfig[]
  onLogout?: () => void
}) {
  const { pathname } = useLocation()
  const isOnDashRoute = DASHBOARD_ROUTES.includes(pathname)
  const [open, setOpen] = useState(isOnDashRoute)

  useEffect(() => {
    if (isOnDashRoute) setOpen(true)
  }, [isOnDashRoute])

  const showAccordion = tiposActivos.length > 0

  return (
    <aside
      style={{
        width: 240,
        minHeight: '100vh',
        background: '#1B3D24',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: '#C9F03B',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 16, color: '#1B3D24',
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            W
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#F5F1E8', letterSpacing: '-0.3px' }}>
            Wasagro<span style={{ color: '#C9F03B' }}>.</span>
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '16px 0' }}>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '0 0 8px' }} />

        {/* Items principales */}
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => navLinkStyle(isActive)}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              if (!el.style.borderLeftColor.includes('C9F03B')) {
                el.style.background = 'rgba(255,255,255,0.06)'
                el.style.color = '#F5F1E8'
              }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              if (!el.style.borderLeftColor.includes('C9F03B')) {
                el.style.background = 'transparent'
                el.style.color = 'rgba(245,241,232,0.65)'
              }
            }}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        {/* Accordion: Dashboards por tipo */}
        {showAccordion && (
          <>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />

            {/* Botón toggle */}
            <button
              onClick={() => setOpen(prev => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '10px 20px',
                background: 'transparent',
                border: 'none',
                borderLeft: isOnDashRoute ? '3px solid #C9F03B' : '3px solid transparent',
                cursor: 'pointer',
                color: isOnDashRoute ? '#C9F03B' : 'rgba(245,241,232,0.65)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="6" height="6"/><rect x="9" y="3" width="6" height="6"/><rect x="16" y="3" width="6" height="6"/>
                  <rect x="2" y="10" width="6" height="11"/><rect x="9" y="10" width="6" height="6"/><rect x="16" y="10" width="6" height="11"/>
                </svg>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Dashboard</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800,
                  background: 'rgba(201,240,59,0.2)',
                  color: '#C9F03B',
                  padding: '1px 6px',
                  fontFamily: 'monospace',
                }}>
                  {tiposActivos.length}
                </span>
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </button>

            {/* Sub-items */}
            {open && (
              <div style={{ paddingTop: 2, paddingBottom: 4 }}>
                {tiposActivos.map(t => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 20px 8px 36px',
                      textDecoration: 'none',
                      color: isActive ? '#F5F1E8' : 'rgba(245,241,232,0.5)',
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 400,
                      background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                      borderLeft: isActive ? `3px solid ${t.color}` : '3px solid transparent',
                      transition: 'background 0.1s',
                    })}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement
                      if (!el.style.background.includes('0.08')) {
                        el.style.background = 'rgba(255,255,255,0.04)'
                        el.style.color = 'rgba(245,241,232,0.8)'
                      }
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement
                      if (!el.style.background.includes('0.08')) {
                        el.style.background = 'transparent'
                        el.style.color = 'rgba(245,241,232,0.5)'
                      }
                    }}
                  >
                    <div style={{ width: 6, height: 6, background: t.color ?? TIPO_DOT_COLOR[t.tipo] ?? '#9C9080', borderRadius: '50%', flexShrink: 0 }} />
                    {t.label}
                  </NavLink>
                ))}
              </div>
            )}

            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />
          </>
        )}

        {/* Settings */}
        {NAV_SETTINGS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => navLinkStyle(isActive)}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36,
            background: '#C9F03B',
            color: '#1B3D24',
            fontWeight: 700, fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {user.initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F1E8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(245,241,232,0.55)', marginTop: 1 }}>{user.role}</div>
            <div style={{ fontSize: 11, color: '#C9F03B', marginTop: 1, opacity: 0.85 }}>{user.sub}</div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              title="Cerrar sesión"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(245,241,232,0.4)', padding: 4, flexShrink: 0,
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#C43020')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(245,241,232,0.4)')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
