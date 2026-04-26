import type { Lote } from '../mock/data'

export function LoteCard({ lote }: { lote: Lote }) {
  const max = Math.max(...lote.sparkData, 1)
  return (
    <div
      style={{
        background: '#F5F1E8',
        border: '2px solid #0D0F0C',
        boxShadow: '4px 4px 0 0 #0D0F0C',
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>{lote.nombre}</span>
        {lote.alerta && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D45828" strokeWidth="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
        {lote.cultivo} · {lote.hectareas} ha
      </div>
      {lote.alerta && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          padding: '3px 8px',
          background: 'rgba(212,88,40,0.1)',
          color: '#D45828',
          border: '1.5px solid #D45828',
          marginBottom: 6,
          textTransform: 'uppercase' as const,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          ⚠ {lote.alerta}
        </div>
      )}
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
        {lote.eventos}
      </div>
      <div style={{ fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(13,15,12,0.45)', marginBottom: 12 }}>
        eventos esta semana
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 30, marginBottom: 10 }}>
        {lote.sparkData.map((v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: i === lote.sparkData.length - 1 ? '#C9F03B' : '#1B3D24',
              opacity: i === lote.sparkData.length - 1 ? 1 : 0.7,
              minHeight: 3,
              height: `${(v / max) * 100}%`,
            }}
          />
        ))}
      </div>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: lote.trend === 'up' ? '#1B3D24' : lote.trend === 'down' ? '#D45828' : 'rgba(13,15,12,0.45)',
      }}>
        {lote.trend === 'up' ? '↑ Subiendo' : lote.trend === 'down' ? '↓ Bajando' : '→ Estable'}
      </div>
    </div>
  )
}
