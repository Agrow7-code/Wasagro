import React from 'react'

interface CostoAnalitico {
  id: string
  lote_nombre: string
  costo_monto: number
  costo_categoria: string
  fecha_evento: string
}

interface CostosModuleProps {
  eventos: CostoAnalitico[]
}

export const CostosModule: React.FC<CostosModuleProps> = ({ eventos }) => {
  if (eventos.length === 0) return null

  const totalGasto = eventos.reduce((acc, curr) => acc + (Number(curr.costo_monto) || 0), 0)
  
  // Agrupar por categoría
  const porCategoria = eventos.reduce((acc, curr) => {
    const cat = curr.costo_categoria || 'Otros'
    acc[cat] = (acc[cat] || 0) + (Number(curr.costo_monto) || 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
          Costos y Eficiencia de Campo
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Card Gasto Total */}
        <div style={{ 
          background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', 
          padding: 24, display: 'flex', flexDirection: 'column', gap: 8 
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(13,15,12,0.5)' }}>Inversión Total del Periodo</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 36, fontWeight: 800 }}>${totalGasto.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: '#3EBB6A', fontWeight: 700 }}>↑ 4% vs mes ant.</span>
          </div>
        </div>

        {/* Distribución por Categoría */}
        <div style={{ 
          background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', 
          padding: 24, display: 'flex', flexDirection: 'column', gap: 12 
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(13,15,12,0.5)' }}>Distribución de Gastos</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(porCategoria).map(([cat, monto]) => {
              const pct = (monto / totalGasto) * 100
              return (
                <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
                    <span style={{ textTransform: 'capitalize' }}>{cat}</span>
                    <span>${monto.toLocaleString()} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(13,15,12,0.06)', borderRadius: 2 }}>
                    <div style={{ height: '100%', background: '#0D0F0C', width: `${pct}%`, borderRadius: 2 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Resumen por Lote */}
      <div style={{ background: '#0D0F0C', color: '#F5F1E8', padding: 24, borderRadius: 0, border: '2px solid #0D0F0C' }}>
        <h4 style={{ margin: '0 0 16px 0', fontSize: 14, fontWeight: 700 }}>Gasto acumulado por lote</h4>
        <div style={{ display: 'flex', gap: 24, overflowX: 'auto', paddingBottom: 8 }}>
          {Array.from(new Set(eventos.map(e => e.lote_nombre))).map(lote => {
            const gastoLote = eventos.filter(e => e.lote_nombre === lote).reduce((sum, e) => sum + Number(e.costo_monto), 0)
            return (
              <div key={lote} style={{ display: 'flex', flexDirection: 'column', minWidth: 100 }}>
                <span style={{ fontSize: 10, color: 'rgba(245,241,232,0.5)', textTransform: 'uppercase' }}>{lote}</span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>${gastoLote.toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
