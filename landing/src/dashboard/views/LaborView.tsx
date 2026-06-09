import { eventosHoy } from '../mock/data'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

const eventos = eventosHoy.filter(e => e.tipo === 'labor')
const lotes = [...new Set(eventos.map(e => e.lote))]
const avgConf = eventos.length
  ? Math.round(eventos.reduce((s, e) => s + e.confianza, 0) / eventos.length)
  : 0

const ESTADO_COLOR: Record<string, string> = { confirmado: '#3EBB6A', validacion: '#C9A800', alerta: '#D45828' }
const ESTADO_BG: Record<string, string>    = { confirmado: '#F0FFF4', validacion: '#FFFBF0', alerta: '#FFF4F0' }
const FUENTE: Record<string, string>       = { voz: 'Voz', texto: 'Texto', imagen: 'Imagen' }

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

function parseJornales(sub: string): number | null {
  const m = sub.match(/(\d+)\s*jornal/)
  return m ? parseInt(m[1]) : null
}

const totalJornales = eventos.reduce((s, e) => s + (parseJornales(e.sub) ?? 0), 0)

export function LaborView() {
  const { user } = useAuth()

  return (
    <>
      <Topbar
        title="Labor"
        badge={`${eventos.length} labor${eventos.length !== 1 ? 'es' : ''} hoy`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />
      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Labores registradas', value: String(eventos.length),   color: '#0D0F0C' },
            { label: 'Lotes trabajados',    value: String(lotes.length),      color: '#1B3D24' },
{ label: 'Jornales totales', value: totalJornales > 0 ? String(totalJornales) : 'N/A', color: '#2A50D4' },
            { label: 'Confianza promedio',  value: `${avgConf}%`,             color: avgConf >= 90 ? '#3EBB6A' : '#C9A800' },
          ].map(k => (
            <div key={k.label} style={{ background: '#F5F1E8', border: `2px solid ${k.color}`, boxShadow: `3px 3px 0 0 ${k.color}`, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

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
                  {['Labor', 'Lote', 'Trabajador', 'Hora', 'Fuente', 'Estado', 'Conf.'].map(h => (
                    <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, opacity: 0.45 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {eventos.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid rgba(13,15,12,0.08)' }}>
                    <td style={{ padding: '13px 16px' }}>
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
