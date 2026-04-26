import { historialAgricultor, lotes } from '../mock/data'
import { FuenteBadge } from '../components/FuenteBadge'
import { ConfianzaLLM } from '../components/ConfianzaLLM'
import { Topbar, TopbarPeriod } from '../layout/Topbar'

const TIPO_ICON_COLOR: Record<string, string> = {
  insumo: '#2A50D4', plaga: '#D45828', cosecha: '#3EBB6A',
  labor: '#0D0F0C', clima: '#9C9080', gasto: '#C9F03B',
}
const TIPO_LABEL: Record<string, string> = {
  insumo: 'INSUMO', plaga: 'PLAGA', cosecha: 'COSECHA',
  labor: 'LABOR', clima: 'CLIMA', gasto: 'GASTO',
}

export function AgricultorIndividual() {
  const registrosHoy = historialAgricultor[0].eventos.length
  const alertasActivas = 1

  return (
    <>
      <Topbar
        title="Mis registros"
        avatarInitials="JC"
        rightSlot={
          <>
            <TopbarPeriod>25 Abr 2026</TopbarPeriod>
          </>
        }
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* KPI duo */}
        <section>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 600 }}>
            <div style={{ background: '#F5F1E8', border: '2px solid #1B3D24', boxShadow: '4px 4px 0 0 #1B3D24', padding: '20px 22px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', marginBottom: 10 }}>
                Registros hoy
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: '-2px', color: '#1B3D24', marginBottom: 8 }}>
                {registrosHoy}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1B3D24', marginBottom: 4 }}>
                ✓ Bien — sigue así
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(13,15,12,0.45)' }}>
                Meta: 5 por día
              </div>
            </div>
            <div style={{
              background: '#F5F1E8',
              border: `2px solid ${alertasActivas > 0 ? '#D45828' : '#0D0F0C'}`,
              boxShadow: `4px 4px 0 0 ${alertasActivas > 0 ? '#D45828' : '#0D0F0C'}`,
              padding: '20px 22px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', marginBottom: 10 }}>
                Alertas activas
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: '-2px', color: alertasActivas > 0 ? '#D45828' : '#0D0F0C', marginBottom: 8 }}>
                {alertasActivas}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: alertasActivas > 0 ? '#D45828' : 'rgba(13,15,12,0.45)', marginBottom: 4 }}>
                {alertasActivas > 0 ? '⚠ Sigatoka · Lote 7' : '✓ Sin alertas'}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: alertasActivas > 0 ? '#D45828' : 'rgba(13,15,12,0.45)' }}>
                {alertasActivas > 0 ? 'Revisión recomendada' : 'Todo normal'}
              </div>
            </div>
          </div>
        </section>

        {/* Lotes grid */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Mis lotes
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {lotes.slice(0, 6).map((l) => {
              const max = Math.max(...l.sparkData, 1)
              return (
                <div key={l.id} style={{ background: '#F5F1E8', border: `2px solid ${l.alerta ? '#D45828' : '#0D0F0C'}`, boxShadow: `4px 4px 0 0 ${l.alerta ? '#D45828' : '#0D0F0C'}`, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>{l.nombre}</span>
                    {l.alerta && (
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, padding: '2px 6px', background: 'rgba(212,88,40,0.1)', color: '#D45828', border: '1.5px solid #D45828' }}>
                        ⚠ {l.alerta}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                    {l.cultivo} · {l.hectareas} ha
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
                    {l.eventos}
                  </div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.45)', marginBottom: 12 }}>
                    eventos esta semana
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28, marginBottom: 8 }}>
                    {l.sparkData.map((v, i) => (
                      <div key={i} style={{ flex: 1, background: i === l.sparkData.length - 1 ? '#C9F03B' : '#1B3D24', opacity: i === l.sparkData.length - 1 ? 1 : 0.6, minHeight: 3, height: `${(v / max) * 100}%` }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: l.trend === 'up' ? '#1B3D24' : l.trend === 'down' ? '#D45828' : 'rgba(13,15,12,0.45)' }}>
                    {l.trend === 'up' ? '↑ Subiendo' : l.trend === 'down' ? '↓ Bajando' : '→ Estable'}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Historial grouped by day */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Historial de registros
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {historialAgricultor.map((dia) => (
              <div key={dia.fecha}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, color: 'rgba(13,15,12,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {dia.fecha}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, padding: '1px 6px', background: '#0D0F0C', color: '#F5F1E8' }}>
                    {dia.eventos.length}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(13,15,12,0.1)' }} />
                </div>
                <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
                  {dia.eventos.map((ev, i) => (
                    <div
                      key={ev.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 14,
                        padding: '14px 20px',
                        borderBottom: i < dia.eventos.length - 1 ? '1px solid rgba(13,15,12,0.1)' : 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(13,15,12,0.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{
                        width: 36, height: 36,
                        border: `2px solid ${ev.tipo === 'plaga' ? '#D45828' : '#0D0F0C'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        color: TIPO_ICON_COLOR[ev.tipo],
                      }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700 }}>
                          {TIPO_LABEL[ev.tipo]}
                        </span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{ev.titulo}</div>
                        <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.45)', fontFamily: "'JetBrains Mono', monospace" }}>{ev.sub}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'rgba(13,15,12,0.45)' }}>{ev.hora}</span>
                        <FuenteBadge fuente={ev.fuente} />
                        <ConfianzaLLM value={ev.confianza} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA bottom */}
        <div style={{
          position: 'sticky', bottom: 0,
          background: '#1B3D24',
          border: '2px solid #0D0F0C',
          padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 8,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F1E8' }}>¿Algo nuevo en el campo?</div>
            <div style={{ fontSize: 11, color: 'rgba(245,241,232,0.55)', marginTop: 2 }}>Envía un mensaje por WhatsApp · solo habla</div>
          </div>
          <a
            href="https://wa.me/593999999999?text=Hola%20Wasagro"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px',
              background: '#C9F03B', color: '#0D0F0C',
              border: '2px solid #C9F03B',
              fontWeight: 700, fontSize: 13,
              textDecoration: 'none',
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="#0D0F0C" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Enviar por WhatsApp
          </a>
        </div>

      </main>
    </>
  )
}
