import type { CSSProperties } from 'react'
import type { KPIData } from '../mock/data'

const ARROW_UP = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
)
const ARROW_DOWN = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </svg>
)

const deltaColor: Record<string, string> = {
  positive: '#1B3D24',
  negative: '#D45828',
  neutral: 'rgba(13,15,12,0.45)',
}

const cardStyle: Record<string, CSSProperties> = {
  default: { border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' },
  alert: { border: '2px solid #D45828', boxShadow: '4px 4px 0 0 #D45828' },
  success: { border: '2px solid #1B3D24', boxShadow: '4px 4px 0 0 #1B3D24' },
}

const valueColor: Record<string, string> = {
  default: '#0D0F0C',
  alert: '#D45828',
  success: '#1B3D24',
}

export function KPICard({ kpi }: { kpi: KPIData }) {
  const variant = kpi.variant ?? 'default'
  return (
    <div
      style={{
        ...cardStyle[variant],
        background: '#F5F1E8',
        padding: '20px 22px',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          color: 'rgba(13,15,12,0.45)',
          marginBottom: 10,
        }}
      >
        {kpi.label}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 48,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-2px',
          color: valueColor[variant],
          marginBottom: 8,
        }}
      >
        {kpi.value}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 8,
          color: deltaColor[kpi.deltaType],
        }}
      >
        {kpi.deltaType === 'positive' && ARROW_UP}
        {kpi.deltaType === 'negative' && ARROW_DOWN}
        {kpi.delta}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: variant === 'alert' ? '#D45828' : 'rgba(13,15,12,0.45)',
          marginTop: 4,
        }}
      >
        {kpi.source}
      </div>
    </div>
  )
}
