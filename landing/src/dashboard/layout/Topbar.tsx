import type { ReactNode } from 'react'

export interface TopbarProps {
  title: string
  badge?: string
  avatarInitials: string
  rightSlot?: ReactNode
}

export function Topbar({ title, badge, avatarInitials, rightSlot }: TopbarProps) {
  return (
    <header
      style={{
        height: 64,
        background: '#F5F1E8',
        borderBottom: '2px solid #0D0F0C',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{title}</span>
        {badge && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, fontWeight: 700,
            padding: '3px 8px',
            background: '#1B3D24',
            color: '#C9F03B',
            letterSpacing: '0.5px',
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {rightSlot}
        <div style={{
          width: 36, height: 36,
          background: '#0D0F0C',
          color: '#F5F1E8',
          fontWeight: 700, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {avatarInitials}
        </div>
      </div>
    </header>
  )
}

export function TopbarPeriod({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '7px 12px',
      border: '2px solid #0D0F0C',
      fontSize: 12, fontWeight: 500,
      fontFamily: "'JetBrains Mono', monospace",
      cursor: 'pointer',
      color: 'rgba(13,15,12,0.45)',
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      {children}
    </div>
  )
}
