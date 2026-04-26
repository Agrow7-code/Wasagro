import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

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

function iconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
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
function iconClipboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>
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
function iconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M12 2a10 10 0 0 1 0 20M4.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>
  )
}

export const NAV_ADMIN: NavItem[] = [
  { to: '/dashboard', label: 'Resumen', icon: iconGrid(), end: true },
  { to: '/dashboard/eventos', label: 'Eventos', icon: iconClipboard() },
  { to: '/dashboard/lotes', label: 'Lotes', icon: iconMap() },
  { to: '/dashboard/equipo', label: 'Equipo', icon: iconUsers() },
  { to: '/dashboard/reportes', label: 'Reportes', icon: iconBarChart() },
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
  { to: '/dashboard/exportadora/reportes', label: 'Reportes de exportación', icon: iconClipboard() },
]

export const NAV_AGRICULTOR: NavItem[] = [
  { to: '/dashboard/agricultor', label: 'Mis registros', icon: iconGrid(), end: true },
  { to: '/dashboard/agricultor/lotes', label: 'Mis lotes', icon: iconMap() },
  { to: '/dashboard/agricultor/alertas', label: 'Alertas', icon: iconBarChart() },
]

const NAV_SETTINGS: NavItem[] = [
  { to: '/dashboard/config', label: 'Configuración', icon: iconSettings() },
]

export function Sidebar({ user, navItems }: { user: SidebarUser; navItems: NavItem[] }) {
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
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => ({
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
            })}
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
        <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />
        {NAV_SETTINGS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => ({
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
            })}
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
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F1E8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(245,241,232,0.55)', marginTop: 1 }}>{user.role}</div>
            <div style={{ fontSize: 11, color: '#C9F03B', marginTop: 1, opacity: 0.85 }}>{user.sub}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
