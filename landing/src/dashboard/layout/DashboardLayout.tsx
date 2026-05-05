import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar, NAV_ADMIN, type SidebarUser, type NavItem } from './Sidebar'
import { NAV_GERENTE, NAV_EXPORTADORA, NAV_AGRICULTOR } from './Sidebar'
import { useAuth } from '../../auth/useAuth'

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
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar user={user} navItems={nav} />
      <div style={{ marginLeft: 240, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  )
}
