import type { CSSProperties } from 'react'
import { kpisExportadora, fincasProveedoras, lotesTraza, certificaciones } from '../mock/data'
import { KPICard } from '../components/KPICard'
import { Topbar, TopbarPeriod } from '../layout/Topbar'

export function Exportadora() {
  const selectedLote = lotesTraza[0]
  return (
    <>
      <Topbar
        title="Fincas proveedoras"
        avatarInitials="AE"
        rightSlot={
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', border: '2px solid #0D0F0C', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Ciclo Mayo 2026
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <TopbarPeriod>Sem. 17 · Abr 2026</TopbarPeriod>
          </>
        }
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* KPIs */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Métricas del ciclo
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {kpisExportadora.map((k) => <KPICard key={k.label} kpi={k} />)}
          </div>
        </section>

        {/* Fincas table + Detalle lote */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Fincas proveedoras
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
            {/* Table */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0D0F0C' }}>
                    {['Finca', 'Productor', 'Ha', 'Cobertura', 'Eventos', 'Alertas', 'Estado', 'Última actividad', ''].map((h) => (
                      <th key={h + Math.random()} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fincasProveedoras.map((f) => {
                    const estadoStyle: Record<string, CSSProperties> = {
                      completo: { background: 'rgba(62,187,106,0.1)', color: '#3EBB6A', borderColor: '#3EBB6A' },
                      parcial: { background: 'rgba(245,196,67,0.2)', color: '#9C6B00', borderColor: '#F5C443' },
                      incompleto: { background: 'rgba(212,88,40,0.1)', color: '#D45828', borderColor: '#D45828' },
                    }
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid rgba(13,15,12,0.1)', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(13,15,12,0.03)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '13px 16px', fontWeight: 700, fontSize: 13 }}>{f.nombre}</td>
                        <td style={{ padding: '13px 16px', fontSize: 13 }}>{f.productor}</td>
                        <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{f.hectareas}</td>
                        <td style={{ padding: '13px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 90, height: 6, background: 'rgba(13,15,12,0.1)', border: '1.5px solid rgba(13,15,12,0.15)', overflow: 'hidden' }}>
                              <div style={{ width: `${f.cobertura}%`, height: '100%', background: f.cobertura >= 80 ? '#3EBB6A' : f.cobertura >= 60 ? '#F5C443' : '#D45828' }} />
                            </div>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700 }}>{f.cobertura}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{f.eventos}</td>
                        <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: f.alertas > 0 ? '#D45828' : 'rgba(13,15,12,0.45)' }}>
                          {f.alertas}
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                            padding: '3px 7px', letterSpacing: '0.04em', border: '1.5px solid',
                            ...estadoStyle[f.estado],
                            borderColor: estadoStyle[f.estado].borderColor,
                          }}>
                            {f.estado.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'rgba(13,15,12,0.45)' }}>
                          {f.ultimaActividad}
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <a href="#" style={{ fontSize: 11, fontWeight: 700, color: '#1B3D24', textDecoration: 'none', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            Ver →
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Detalle lote panel */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <div style={{ padding: '18px 22px', borderBottom: '2px solid #0D0F0C', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{selectedLote.nombre} · {selectedLote.finca}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, padding: '3px 8px', background: '#0D0F0C', color: '#C9F03B', letterSpacing: '0.06em' }}>
                  LOTE SELECCIONADO
                </span>
              </div>
              <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Mapa placeholder */}
                <div style={{
                  height: 140,
                  background: 'repeating-linear-gradient(45deg,rgba(27,61,36,0.06) 0px,rgba(27,61,36,0.06) 1px,transparent 1px,transparent 12px)',
                  border: '2px solid rgba(13,15,12,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    width: '70%', height: '75%',
                    border: '2.5px solid #1B3D24',
                    background: 'rgba(27,61,36,0.08)',
                    clipPath: 'polygon(10% 0%, 90% 5%, 100% 60%, 75% 100%, 5% 85%)',
                  }} />
                  <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>
                    2.4 ha · PostGIS
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { val: `${selectedLote.cobertura}%`, key: 'Trazabilidad' },
                    { val: String(selectedLote.eventos), key: 'Eventos / sem.' },
                    { val: '14', key: 'Aplicaciones' },
                    { val: '3', key: 'Cosechas' },
                  ].map(({ val, key }) => (
                    <div key={key} style={{ padding: '10px 12px', border: '1.5px solid rgba(13,15,12,0.15)' }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700 }}>{val}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', marginTop: 2 }}>{key}</div>
                    </div>
                  ))}
                </div>

                {/* Timeline */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', marginBottom: 12 }}>
                    Últimos eventos
                  </div>
                  {[
                    { title: 'Aplicación fungicida', sub: '2.5 L/ha · Mancozeb', worker: 'J. Caicedo', date: '25 Abr', type: 'default' },
                    { title: 'Cosecha banano', sub: '420 kg · calidad 1ra', worker: 'L. Mendoza', date: '24 Abr', type: 'cosecha' },
                    { title: 'Sigatoka detectada', sub: 'Severidad 3/5 · 0.8 ha', worker: 'M. Torres', date: '24 Abr', type: 'plaga' },
                  ].map((ev, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: i < 2 ? '1px solid rgba(13,15,12,0.08)' : 'none' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0 }}>
                        <div style={{
                          width: 10, height: 10, border: `2px solid ${ev.type === 'plaga' ? '#D45828' : ev.type === 'cosecha' ? '#1B3D24' : '#0D0F0C'}`,
                          background: ev.type === 'plaga' ? 'rgba(212,88,40,0.1)' : ev.type === 'cosecha' ? 'rgba(27,61,36,0.1)' : '#F5F1E8',
                        }} />
                        {i < 2 && <div style={{ flex: 1, width: 2, background: 'rgba(13,15,12,0.12)', marginTop: 3 }} />}
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(13,15,12,0.45)', textAlign: 'center', lineHeight: 1.3, marginTop: 4 }}>
                          {ev.date}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{ev.title}</div>
                        <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)', marginBottom: 4 }}>{ev.sub}</div>
                        <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)' }}>{ev.worker}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <button style={{ padding: '10px 18px', border: '2px solid #0D0F0C', background: '#0D0F0C', color: '#F5F1E8', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', width: '100%' }}>
                  Ver historial completo
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Trazabilidad lotes */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Trazabilidad por lote
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {lotesTraza.map((l) => (
              <div
                key={l.id}
                style={{
                  background: '#F5F1E8',
                  border: `2px solid ${l.selected ? '#1B3D24' : '#0D0F0C'}`,
                  boxShadow: `4px 4px 0 0 ${l.selected ? '#1B3D24' : '#0D0F0C'}`,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  transition: 'transform 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translate(-1px,-1px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'none')}
              >
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>{l.nombre}</div>
                <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)', marginBottom: 10 }}>{l.finca}</div>
                <div style={{ height: 5, background: 'rgba(13,15,12,0.1)', border: '1px solid rgba(13,15,12,0.15)', overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ width: `${l.cobertura}%`, height: '100%', background: l.cobertura >= 80 ? '#3EBB6A' : l.cobertura >= 60 ? '#F5C443' : '#D45828' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700 }}>{l.cobertura}%</span>
                  <span style={{ fontSize: 10, color: 'rgba(13,15,12,0.45)', fontFamily: "'JetBrains Mono', monospace" }}>{l.eventos} eventos</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Certificaciones */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Certificaciones
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {certificaciones.map((c) => {
              const badgeStyle: Record<string, CSSProperties> = {
                vigente: { background: 'rgba(62,187,106,0.1)', color: '#3EBB6A', borderColor: '#3EBB6A' },
                vence: { background: 'rgba(245,196,67,0.2)', color: '#9C6B00', borderColor: '#F5C443' },
                vencida: { background: 'rgba(212,88,40,0.1)', color: '#D45828', borderColor: '#D45828' },
              }
              return (
                <div key={c.id} style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: '18px 20px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{c.nombre}</div>
                  <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)', marginBottom: 14 }}>{c.emisor}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                      padding: '3px 8px', letterSpacing: '0.05em', border: '1.5px solid',
                      ...badgeStyle[c.estado],
                      borderColor: badgeStyle[c.estado].borderColor,
                    }}>
                      {c.estado.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>
                      {c.vencimiento}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

      </main>
    </>
  )
}
