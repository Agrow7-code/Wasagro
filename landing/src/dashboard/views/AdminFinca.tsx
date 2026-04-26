import { kpisAdmin, eventosHoy, alertas, lotes, eventosTabla } from '../mock/data'
import { KPICard } from '../components/KPICard'
import { EventoItem } from '../components/EventoItem'
import { LoteCard } from '../components/LoteCard'
import { AlertaPanel } from '../components/AlertaBadge'
import { Topbar, TopbarPeriod } from '../layout/Topbar'

const TIPO_COLOR: Record<string, string> = {
  insumo: '#2A50D4', plaga: '#D45828', cosecha: '#3EBB6A',
  labor: '#0D0F0C', clima: '#9C9080', gasto: '#C9F03B',
}

export function AdminFinca() {
  return (
    <>
      <Topbar
        title="Resumen"
        badge="HOY"
        avatarInitials="CM"
        rightSlot={
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px',
              border: '2px solid #0D0F0C',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              </svg>
              Finca El Progreso
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <TopbarPeriod>25 Abr 2026</TopbarPeriod>
          </>
        }
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* KPIs */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Métricas del día
            </span>
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>
              Última actualización · 14:31
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {kpisAdmin.map((k) => <KPICard key={k.label} kpi={k} />)}
          </div>
        </section>

        {/* Feed + Alertas */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Actividad reciente
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '70fr 30fr', gap: 16 }}>
            {/* Feed */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '2px solid #0D0F0C' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>Eventos de hoy</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, padding: '2px 7px', background: '#0D0F0C', color: '#F5F1E8' }}>
                  {eventosHoy.length}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', fontFamily: "'JetBrains Mono', monospace" }}>
                  Actualizado · 14:31
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, padding: '12px 20px', borderBottom: '1px solid rgba(13,15,12,0.12)', flexWrap: 'wrap' }}>
                {['Todos', 'Labor', 'Plaga', 'Cosecha', 'Insumo', 'Gasto'].map((f, i) => (
                  <button
                    key={f}
                    style={{
                      fontSize: 11, fontWeight: 600,
                      padding: '4px 10px',
                      border: i === 0 ? '1.5px solid #0D0F0C' : '1.5px solid rgba(13,15,12,0.25)',
                      cursor: 'pointer',
                      letterSpacing: '0.03em',
                      background: i === 0 ? '#0D0F0C' : 'transparent',
                      color: i === 0 ? '#F5F1E8' : 'rgba(13,15,12,0.45)',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div>
                {eventosHoy.map((e) => <EventoItem key={e.id} evento={e} />)}
              </div>
            </div>
            {/* Alertas */}
            <AlertaPanel alertas={alertas} />
          </div>
        </section>

        {/* Lotes */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Estado de lotes
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {lotes.slice(0, 8).map((l) => <LoteCard key={l.id} lote={l} />)}
          </div>
        </section>

        {/* Tabla eventos */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Todos los eventos
            </span>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0D0F0C' }}>
                    {['ID', 'Tipo', 'Descripción', 'Lote', 'Trabajador', 'Hora', 'Fuente', 'Confianza'].map((h) => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eventosTabla.map((e) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid rgba(13,15,12,0.1)', cursor: 'pointer' }}
                      onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(13,15,12,0.03)')}
                      onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'rgba(13,15,12,0.45)' }}>{e.id}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '3px 8px', border: '1.5px solid #0D0F0C', color: TIPO_COLOR[e.tipo] }}>
                          {e.tipo.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600 }}>{e.titulo}</td>
                      <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{e.lote}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13 }}>{e.trabajador}</td>
                      <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{e.hora}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
                          padding: '2px 6px', letterSpacing: '0.05em', border: '1.5px solid',
                          background: e.fuente === 'voz' ? 'rgba(27,61,36,0.1)' : e.fuente === 'imagen' ? 'rgba(43,78,160,0.1)' : 'rgba(13,15,12,0.07)',
                          color: e.fuente === 'voz' ? '#1B3D24' : e.fuente === 'imagen' ? '#2B4EA0' : 'rgba(13,15,12,0.55)',
                          borderColor: e.fuente === 'voz' ? '#1B3D24' : e.fuente === 'imagen' ? '#2B4EA0' : 'rgba(13,15,12,0.25)',
                        }}>
                          {e.fuente.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                          padding: '3px 7px', border: '1.5px solid',
                          background: e.confianza >= 95 ? '#1B3D24' : e.confianza >= 80 ? 'rgba(245,196,67,0.2)' : 'rgba(212,88,40,0.12)',
                          color: e.confianza >= 95 ? '#C9F03B' : e.confianza >= 80 ? '#9C6B00' : '#D45828',
                          borderColor: e.confianza >= 95 ? '#1B3D24' : e.confianza >= 80 ? '#F5C443' : '#D45828',
                        }}>
                          {e.confianza}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '2px solid #0D0F0C' }}>
              <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>
                Mostrando 1–5 de 23 eventos
              </span>
              <div style={{ display: 'flex' }}>
                {['←', '1', '2', '3', '→'].map((p, i) => (
                  <button key={p} style={{
                    padding: '6px 14px',
                    border: '2px solid #0D0F0C',
                    background: i === 1 ? '#0D0F0C' : '#F5F1E8',
                    color: i === 1 ? '#F5F1E8' : '#0D0F0C',
                    fontSize: 12, fontWeight: 700,
                    cursor: 'pointer',
                    marginLeft: -2,
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

      </main>
    </>
  )
}
