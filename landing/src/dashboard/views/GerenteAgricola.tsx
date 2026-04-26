import { kpisGerente, fincas } from '../mock/data'
import { KPICard } from '../components/KPICard'
import { Topbar, TopbarPeriod } from '../layout/Topbar'

const SPARKLINES: Record<string, number[]> = {
  eventos: [58,65,72,68,80,75,87],
  cobertura: [70,72,75,74,80,83,87],
  alertas: [1,2,1,3,4,3,5],
}

function Sparkline({ data, color, alertColor }: { data: number[]; color: string; alertColor?: boolean }) {
  const max = Math.max(...data, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28 }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            minHeight: 2,
            height: `${(v / max) * 100}%`,
            background: i === data.length - 1 ? (alertColor ? '#D45828' : '#C9F03B') : color,
            opacity: i === data.length - 1 ? 1 : 0.6,
          }}
        />
      ))}
    </div>
  )
}

export function GerenteAgricola() {
  return (
    <>
      <Topbar
        title="Resumen global"
        avatarInitials="RV"
        rightSlot={
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '2px solid #0D0F0C' }}>
              {['Todas', 'El Progreso', 'La Esperanza', 'San Pedro'].map((f, i) => (
                <button
                  key={f}
                  style={{
                    padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    borderRight: i < 3 ? '2px solid #0D0F0C' : 'none',
                    background: i === 0 ? '#0D0F0C' : 'transparent',
                    color: i === 0 ? '#F5F1E8' : 'rgba(13,15,12,0.45)',
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            <TopbarPeriod>Sem. 17 · Abr 2026</TopbarPeriod>
          </>
        }
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* KPIs */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Semana 17 · todas las fincas
            </span>
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>
              Reporte generado dom. 18:00
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {kpisGerente.map((k) => <KPICard key={k.label} kpi={k} />)}
          </div>
        </section>

        {/* Fincas Grid */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Estado de fincas
            </span>
            <a href="#" style={{ fontSize: 11, fontWeight: 700, color: '#1B3D24', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Agregar finca +
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {fincas.map((f) => {
              const isAlerta = f.estado === 'alerta'
              const metaColor = f.meta >= 90 ? '#3EBB6A' : f.meta >= 70 ? '#1B3D24' : '#F5C443'
              return (
                <div
                  key={f.id}
                  style={{
                    background: '#F5F1E8',
                    border: `2px solid ${isAlerta ? '#D45828' : '#1B3D24'}`,
                    boxShadow: `4px 4px 0 0 ${isAlerta ? '#D45828' : '#1B3D24'}`,
                    padding: '22px',
                    cursor: 'pointer',
                    transition: 'transform 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'translate(-1px,-1px)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'none')}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px' }}>{f.nombre}</span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
                      padding: '3px 8px', letterSpacing: '0.07em', border: '1.5px solid',
                      background: isAlerta ? 'rgba(212,88,40,0.08)' : 'rgba(62,187,106,0.1)',
                      color: isAlerta ? '#D45828' : '#3EBB6A',
                      borderColor: isAlerta ? '#D45828' : '#3EBB6A',
                    }}>
                      {isAlerta ? '⚠ ALERTA' : 'ACTIVA'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)', marginBottom: 18 }}>
                    {f.cultivo} · {f.hectareas} ha · {f.lotes} lotes
                  </div>
                  <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                    {[
                      { val: f.eventos, key: 'eventos / sem.' },
                      { val: f.alertas, key: 'alertas activas', color: isAlerta && f.alertas > 0 ? '#D45828' : undefined },
                      { val: f.trabajadores, key: 'trabajadores' },
                    ].map(({ val, key, color }) => (
                      <div key={key}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 700, lineHeight: 1, color: color ?? '#0D0F0C' }}>{val}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', marginTop: 3 }}>{key}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)' }}>Meta semanal de registros</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, color: metaColor }}>{f.meta}%</span>
                    </div>
                    <div style={{ height: 8, background: 'rgba(13,15,12,0.1)', border: '1.5px solid rgba(13,15,12,0.15)', overflow: 'hidden' }}>
                      <div style={{ width: `${f.meta}%`, height: '100%', background: metaColor }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid rgba(13,15,12,0.1)' }}>
                    <div>
                      {isAlerta && f.alertaDesc ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#D45828' }}>
                          ⚠ {f.alertaDesc}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#3EBB6A' }}>
                          ✓ Sin problemas detectados
                        </div>
                      )}
                      <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)', marginTop: 3 }}>
                        Último evento: {f.ultimoEvento}
                      </div>
                    </div>
                    <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#1B3D24', textDecoration: 'none' }}>
                      Ver detalle ›
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Reporte + Tendencias */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Reporte semanal y tendencias
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '60fr 40fr', gap: 16 }}>
            {/* Reporte */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <div style={{ padding: '18px 22px', borderBottom: '2px solid #0D0F0C', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>Reporte semanal</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, padding: '3px 8px', background: '#1B3D24', color: '#C9F03B', letterSpacing: '0.05em' }}>
                    SEM. 17
                  </span>
                </div>
                <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>
                  Generado dom. 18:00 · automático
                </span>
              </div>
              <div style={{ padding: '22px' }}>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Semana del 21 al 27 de abril</div>
                <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)', marginBottom: 18 }}>
                  Período · Semana 17 de 2026
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.65, padding: '16px 18px', background: 'rgba(27,61,36,0.05)', borderLeft: '3px solid #1B3D24', marginBottom: 20, fontStyle: 'italic' }}>
                  Semana positiva: 241 eventos totales (+8% vs anterior). La Esperanza superó la meta semanal con 104 eventos. Atención prioritaria: Finca San Pedro con cobertura del 58% y 3 alertas activas de moniliasis.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {[
                    'Finca La Esperanza alcanzó 96% de su meta de registros · 104 eventos',
                    'Finca El Progreso activa pero con 2 alertas de sigatoka y dosis excesiva',
                    'Finca San Pedro requiere atención — monilia detectada en 3 lotes',
                    '3 trabajadores sin actividad esta semana (San Pedro)',
                  ].map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
                      <div style={{ width: 6, height: 6, border: '2px solid #1B3D24', flexShrink: 0, marginTop: 5 }} />
                      {b}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={{ padding: '10px 18px', border: '2px solid #0D0F0C', background: '#0D0F0C', color: '#F5F1E8', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Descargar PDF
                  </button>
                  <button style={{ padding: '10px 18px', border: '2px solid #0D0F0C', background: 'transparent', color: '#0D0F0C', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Enviar por WhatsApp
                  </button>
                </div>
              </div>
            </div>

            {/* Tendencias */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <div style={{ padding: '18px 20px', borderBottom: '2px solid #0D0F0C' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>Tendencias 7 semanas</span>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[
                  { name: 'Eventos totales / semana', val: 241, sub: '+ 18 vs anterior', data: SPARKLINES.eventos, delta: '↑ +8%', up: true },
                  { name: 'Cobertura promedio', val: '87%', sub: 'Meta: 90%', data: SPARKLINES.cobertura, delta: '↑ +6pp', up: true },
                  { name: 'Alertas activas', val: 5, sub: '2 fincas con incidencias', data: SPARKLINES.alertas, delta: '↑ +2', up: false },
                ].map((t, i) => (
                  <div key={i} style={{ padding: '14px 0', borderBottom: i < 2 ? '1px solid rgba(13,15,12,0.09)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', fontFamily: "'JetBrains Mono', monospace" }}>{t.sub}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700 }}>{t.val}</div>
                      </div>
                    </div>
                    <Sparkline data={t.data} color="#1B3D24" alertColor={!t.up} />
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: t.up ? '#1B3D24' : '#D45828' }}>{t.delta}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Tabla fincas */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Vista consolidada
            </span>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #0D0F0C' }}>
                  {['Finca', 'Cultivo', 'Eventos / sem.', 'Cobertura', 'Alertas', 'Estado', 'Última actividad'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fincas.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid rgba(13,15,12,0.1)', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(13,15,12,0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '13px 16px', fontWeight: 700, fontSize: 13 }}>{f.nombre}</td>
                    <td style={{ padding: '13px 16px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{f.cultivo}</td>
                    <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700 }}>{f.eventos}</td>
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 80, height: 6, background: 'rgba(13,15,12,0.1)', border: '1.5px solid rgba(13,15,12,0.15)', overflow: 'hidden' }}>
                          <div style={{ width: `${f.meta}%`, height: '100%', background: f.meta >= 90 ? '#3EBB6A' : f.meta >= 70 ? '#1B3D24' : '#F5C443' }} />
                        </div>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700 }}>{f.meta}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: f.alertas > 0 ? '#D45828' : 'rgba(13,15,12,0.45)' }}>
                      {f.alertas}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                        padding: '3px 7px', letterSpacing: '0.04em', border: '1.5px solid',
                        background: f.estado === 'ok' ? 'rgba(62,187,106,0.1)' : 'rgba(212,88,40,0.1)',
                        color: f.estado === 'ok' ? '#3EBB6A' : '#D45828',
                        borderColor: f.estado === 'ok' ? '#3EBB6A' : '#D45828',
                      }}>
                        {f.estado === 'ok' ? 'ACTIVA' : '⚠ ALERTA'}
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'rgba(13,15,12,0.45)' }}>
                      {f.ultimoEvento}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </>
  )
}
