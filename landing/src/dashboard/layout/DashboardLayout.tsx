import { Outlet } from 'react-router-dom'
import { Sidebar, NAV_ADMIN, type SidebarUser, type NavItem } from './Sidebar'
import { useLocation } from 'react-router-dom'
import { NAV_GERENTE, NAV_EXPORTADORA, NAV_AGRICULTOR } from './Sidebar'

const USERS: Record<string, SidebarUser> = {
  admin: { initials: 'CM', name: 'Carlos Mendoza', role: 'Administrador', sub: 'Finca El Progreso' },
  gerente: { initials: 'RV', name: 'Roberto Vargas', role: 'Gerente Agrícola', sub: '3 fincas activas' },
  exportadora: { initials: 'AE', name: 'AgroExport S.A.', role: 'Exportadora', sub: '12 fincas activas' },
  agricultor: { initials: 'JC', name: 'Juan Caicedo', role: 'Agricultor', sub: 'Finca El Progreso' },
}

function useRole(): { user: SidebarUser; nav: NavItem[] } {
  const { pathname } = useLocation()
  if (pathname.startsWith('/dashboard/gerente')) return { user: USERS.gerente, nav: NAV_GERENTE }
  if (pathname.startsWith('/dashboard/exportadora')) return { user: USERS.exportadora, nav: NAV_EXPORTADORA }
  if (pathname.startsWith('/dashboard/agricultor')) return { user: USERS.agricultor, nav: NAV_AGRICULTOR }
  return { user: USERS.admin, nav: NAV_ADMIN }
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
