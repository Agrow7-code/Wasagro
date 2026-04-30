import React from 'react'

interface PlagaAnalitica {
  id: string
  lote_nombre: string
  plaga_nombre: string
  plaga_individuos: number
  plaga_muestra: number
  plaga_organo: string
  plaga_severidad_pct: number
  fecha_evento: string
}

interface PlagasModuleProps {
  eventos: PlagaAnalitica[]
  cultivoPrincipal?: string
}

export const PlagasModule: React.FC<PlagasModuleProps> = ({ eventos, cultivoPrincipal }) => {
  if (eventos.length === 0) return null

  // Cálculo de promedio de severidad general
  const avgSeveridad = eventos.reduce((acc, curr) => acc + curr.plaga_severidad_pct, 0) / eventos.length
  
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
          Análisis de Plagas y Enfermedades ({cultivoPrincipal})
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {/* Card de Severidad Promedio */}
        <div style={{ 
          background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', 
          padding: 20, display: 'flex', flexDirection: 'column', gap: 8 
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(13,15,12,0.5)' }}>Severidad Promedio</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 32, fontWeight: 800 }}>{avgSeveridad.toFixed(1)}%</span>
            <span style={{ 
              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: avgSeveridad > 20 ? '#D45828' : '#3EBB6A', color: '#fff'
            }}>
              {avgSeveridad > 20 ? 'CRÍTICO' : 'BAJO'}
            </span>
          </div>
        </div>

        {/* Card de Órgano más afectado (Banano Específico) */}
        {cultivoPrincipal?.toLowerCase() === 'banano' && (
          <div style={{ 
            background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', 
            padding: 20, display: 'flex', flexDirection: 'column', gap: 8 
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(13,15,12,0.5)' }}>Órgano en Riesgo</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 700, textTransform: 'capitalize' }}>
                {eventos.filter(e => e.plaga_organo === 'racimo').length > 0 ? 'Racimo ⚠' : 'Hijo (Alerta)'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Detalle por Lote */}
      <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #0D0F0C', background: 'rgba(13,15,12,0.03)' }}>
              {['Lote', 'Plaga', 'Conteo', 'Muestra', 'Órgano', 'Severidad'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', opacity: 0.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eventos.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid rgba(13,15,12,0.1)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{e.lote_nombre}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, textTransform: 'capitalize' }}>{e.plaga_nombre}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace' }}>{e.plaga_individuos}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace' }}>{e.plaga_muestra}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ 
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', border: '1.5px solid #0D0F0C',
                    background: e.plaga_organo === 'racimo' ? '#C9F03B' : 'transparent'
                  }}>
                    {e.plaga_organo?.toUpperCase() || 'N/A'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: 'rgba(13,15,12,0.1)', borderRadius: 3, maxWidth: 60 }}>
                      <div style={{ 
                        height: '100%', borderRadius: 3, 
                        width: `${Math.min(e.plaga_severidad_pct, 100)}%`,
                        background: e.plaga_severidad_pct > 25 ? '#D45828' : '#3EBB6A'
                      }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{e.plaga_severidad_pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
