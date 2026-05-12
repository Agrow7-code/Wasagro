import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar, NAV_ADMIN, type SidebarUser, type NavItem, type TipoConfig } from './Sidebar'
import { NAV_GERENTE, NAV_EXPORTADORA, NAV_AGRICULTOR } from './Sidebar'
import { useAuth } from '../../auth/useAuth'
import { eventosHoy } from '../mock/data'

const ROL_LABEL: Record<string, string> = {
  administrador: 'Administrador',
  propietario:   'Propietario',
  admin_org:     'Administrador',
  gerente:       'Gerente Agrícola',
  director:      'Director',
  analista:      'Exportadora',
  agricultor:    'Agricultor',
  tecnico:       'Técnico de campo',
  jefe_finca:    'Jefe de finca',
}

const TIPO_META: Record<string, { label: string; to: string; color: string }> = {
  insumo:  { label: 'Insumos',  to: '/dashboard/insumos',  color: '#2A50D4' },
  labor:   { label: 'Labor',    to: '/dashboard/labor',    color: '#6B7280' },
  cosecha: { label: 'Cosecha',  to: '/dashboard/cosecha',  color: '#3EBB6A' },
  plaga:   { label: 'Plagas',   to: '/dashboard/plagas',   color: '#D45828' },
  gasto:   { label: 'Gastos',   to: '/dashboard/gastos',   color: '#C9A800' },
  clima:   { label: 'Clima',    to: '/dashboard/clima',    color: '#9C9080' },
}

// Deriva los tipos activos desde los eventos reales del mock
const uniqueTipos = [...new Set(eventosHoy.map(e => e.tipo))]
const tiposActivos: TipoConfig[] = uniqueTipos
  .filter(t => t in TIPO_META)
  .map(t => ({ tipo: t, ...TIPO_META[t] }))

function getInitials(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('')
}

function useRole(): { user: SidebarUser; nav: NavItem[] } {
  const { pathname } = useLocation()
  const { user }     = useAuth()

  const sidebarUser: SidebarUser = user
    ? {
        initials: getInitials(user.nombre),
        name:     user.nombre,
        role:     ROL_LABEL[user.rol] ?? user.rol,
        sub:      user.phone,
      }
    : { initials: '?', name: 'Usuario', role: 'Sin sesión', sub: '' }

  if (pathname.startsWith('/dashboard/gerente'))     return { user: sidebarUser, nav: NAV_GERENTE }
  if (pathname.startsWith('/dashboard/exportadora')) return { user: sidebarUser, nav: NAV_EXPORTADORA }
  if (pathname.startsWith('/dashboard/agricultor'))  return { user: sidebarUser, nav: NAV_AGRICULTOR }
  return { user: sidebarUser, nav: NAV_ADMIN }
}

export function DashboardLayout() {
  const { user, nav } = useRole()
  const { pathname }  = useLocation()
  const isAdminRoute  = !pathname.startsWith('/dashboard/gerente') &&
                        !pathname.startsWith('/dashboard/exportadora') &&
                        !pathname.startsWith('/dashboard/agricultor')

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        user={user}
        navItems={nav}
        tiposActivos={isAdminRoute ? tiposActivos : []}
      />
      <div style={{ marginLeft: 240, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  )
}
