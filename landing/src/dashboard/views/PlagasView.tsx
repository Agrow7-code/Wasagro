import { eventosHoy } from '../mock/data'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

const eventos = eventosHoy.filter(e => e.tipo === 'plaga')
const lotes = [...new Set(eventos.map(e => e.lote))]
const alertas = eventos.filter(e => e.estado === 'alerta')

const ESTADO_COLOR: Record<string, string> = { confirmado: '#3EBB6A', validacion: '#C9A800', alerta: '#D45828' }
const ESTADO_BG: Record<string, string>    = { confirmado: '#F0FFF4', validacion: '#FFFBF0', alerta: '#FFF4F0' }
const FUENTE: Record<string, string>       = { voz: 'Voz', texto: 'Texto', imagen: 'Imagen' }

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

export function PlagasView() {
  const { user } = useAuth()

  return (
    <>
      <Topbar
        title="Plagas"
        badge={alertas.length > 0 ? `${alertas.length} ALERTA${alertas.length !== 1 ? 'S' : ''}` : `${eventos.length} foco${eventos.length !== 1 ? 's' : ''}`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />
      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Focos detectados',  value: String(eventos.length), color: '#D45828', bg: '#FFF4F0' },
            { label: 'Lotes afectados',   value: String(lotes.length),   color: '#D45828', bg: '#FFF4F0' },
            { label: 'Alertas activas',   value: String(alertas.length), color: alertas.length > 0 ? '#D45828' : '#3EBB6A', bg: alertas.length > 0 ? '#FFF4F0' : '#F0FFF4' },
            { label: 'Sin alertas',       value: String(eventos.length - alertas.length), color: '#3EBB6A', bg: '#F0FFF4' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, border: `2px solid ${k.color}`, boxShadow: `3px 3px 0 0 ${k.color}`, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {alertas.length > 0 && (
          <div style={{ background: '#FFF4F0', border: '2px solid #D45828', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#D45828', marginBottom: 8 }}>⚠ Focos con alerta activa</div>
            {alertas.map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 6 }}>
                <div style={{ width: 6, height: 6, background: '#D45828', flexShrink: 0, marginTop: 4, borderRadius: '50%' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{e.titulo} — {e.lote}</div>
                  {e.nota && <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.55)', marginTop: 2 }}>{e.nota}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <section>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.45)' }}>
              Registros · hoy
            </span>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #0D0F0C', background: 'rgba(13,15,12,0.03)' }}>
                  {['Plaga / Enfermedad', 'Lote', 'Trabajador', 'Hora', 'Fuente', 'Estado', 'Conf.'].map(h => (
                    <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, opacity: 0.45 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {eventos.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid rgba(13,15,12,0.08)', background: e.estado === 'alerta' ? 'rgba(212,88,40,0.04)' : 'transparent' }}>
                    <td style={{ padding: '13px 16px', borderLeft: e.estado === 'alerta' ? '3px solid #D45828' : '3px solid transparent' }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{e.titulo}</div>
                      <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>{e.sub}</div>
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: 13, fontWeight: 600 }}>{e.lote}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13 }}>{e.trabajador}</td>
                    <td style={{ padding: '13px 16px', fontSize: 12, fontFamily: 'monospace' }}>{e.hora}</td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'rgba(13,15,12,0.55)' }}>{FUENTE[e.fuente]}</td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', background: ESTADO_BG[e.estado], color: ESTADO_COLOR[e.estado], border: `1.5px solid ${ESTADO_COLOR[e.estado]}` }}>
                        {e.estado.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: e.confianza >= 90 ? '#3EBB6A' : '#C9A800' }}>
                      {e.confianza}%
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
