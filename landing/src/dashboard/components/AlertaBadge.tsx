import type { Alerta } from '../mock/data'

export function AlertaPanel({ alertas }: { alertas: Alerta[] }) {
  return (
    <div
      style={{
        background: '#F5F1E8',
        border: '2px solid #0D0F0C',
        boxShadow: '4px 4px 0 0 #0D0F0C',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '2px solid #0D0F0C' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Alertas activas</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, fontWeight: 700,
          padding: '2px 7px',
          background: '#D45828',
          color: '#F5F1E8',
        }}>
          {alertas.length}
        </span>
      </div>
      {alertas.length === 0 ? (
        <div style={{ padding: '32px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.45)' }}>Sin alertas activas</div>
        </div>
      ) : (
        alertas.map((a) => (
          <div key={a.id} style={{ padding: '14px 18px', borderBottom: '1px solid rgba(13,15,12,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: '#D45828', marginBottom: 6, textTransform: 'uppercase' as const }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {a.tipo}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)' }}>Lote</span>
                <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{a.lote}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)' }}>{a.descripcion}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                  color: a.valorColor === 'red' ? '#D45828' : '#9C6B00',
                }}>
                  {a.valor}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)' }}>Tiempo</span>
                <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>{a.hace}</span>
              </div>
            </div>
            <button
              style={{
                width: '100%',
                padding: '7px 0',
                border: '2px solid #D45828',
                background: 'transparent',
                color: '#D45828',
                fontSize: 11, fontWeight: 700,
                fontFamily: "'Space Grotesk', sans-serif",
                letterSpacing: '0.05em',
                textTransform: 'uppercase' as const,
                cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#D45828'; (e.currentTarget as HTMLButtonElement).style.color = '#F5F1E8' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#D45828' }}
            >
              Revisar alerta
            </button>
          </div>
        ))
      )}
    </div>
  )
}
