import { useState } from 'react'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// Dashboard ACUMULADO de Sigatoka: muchas fichas a lo largo de varias semanas,
// agrupadas por lote, para decidir dónde actuar. Los datos son REPRESENTATIVOS
// (demo) — curados para mostrar la capacidad: un lote que escala (Corrijal),
// otros bajo control. Cuando haya volumen real, se alimenta de eventos_campo.

const SEMANAS = [18, 19, 20, 21, 22, 23]

interface SerieLote {
  lote: string
  // % de plantas con EE2 (1-3) por semana — el indicador de avance de Sigatoka
  ee2: number[]
  // mínimo de hojas funcionales por semana (cae = problema)
  func: number[]
}

// Historia curada: Corrijal escala fuerte, Carrizal moderado, resto controlado.
const SERIES: SerieLote[] = [
  { lote: 'Corrijal',     ee2: [8, 14, 21, 30, 39, 47], func: [13, 12.5, 12, 11.6, 11.4, 11.4] },
  { lote: 'Carrizal',     ee2: [5, 7, 9, 12, 16, 21],   func: [13, 13, 12.6, 12.3, 12, 11.8] },
  { lote: 'Arrastradero', ee2: [3, 4, 4, 6, 7, 10],     func: [13.5, 13.4, 13.2, 13, 12.8, 12.6] },
  { lote: 'Río',          ee2: [2, 3, 2, 4, 3, 5],      func: [14, 13.8, 13.9, 13.6, 13.7, 13.5] },
  { lote: 'Central',      ee2: [6, 6, 5, 7, 6, 8],      func: [13, 13.1, 13, 12.9, 12.8, 12.9] },
]

const idxActual = SEMANAS.length - 1
const semanaActual = SEMANAS[idxActual]!

// Escala de severidad por % EE2 (1-3) — umbral de alerta 30 (UMBRAL_EE2_LEVE).
function sev(pct: number) {
  if (pct <= 10) return { fill: '#3EBB6A', text: '#0D3A1A', label: 'OK' }
  if (pct <= 20) return { fill: '#96C93D', text: '#233800', label: 'BAJA' }
  if (pct <= 30) return { fill: '#D4A017', text: '#3A2800', label: 'MEDIA' }
  if (pct <= 40) return { fill: '#E06820', text: '#fff', label: 'ALTA' }
  return { fill: '#C43020', text: '#fff', label: 'CRÍTICA' }
}

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

const card = { background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' } as const
const labelStyle = { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)' }

// ── Gráfico de tendencia (promedio EE2 1-3 entre lotes, por semana) ───────────
function TendenciaChart({ series }: { series: SerieLote[] }) {
  const promedios = SEMANAS.map((_, i) => Math.round(series.reduce((s, l) => s + l.ee2[i]!, 0) / series.length))
  const peor = SEMANAS.map((_, i) => Math.max(...series.map(l => l.ee2[i]!)))
  const W = 600, H = 160, PL = 30, PR = 14, PT = 14, PB = 28
  const IW = W - PL - PR, IH = H - PT - PB
  const xOf = (i: number) => PL + (i / (SEMANAS.length - 1)) * IW
  const yOf = (v: number) => PT + IH - (v / 60) * IH
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(v)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 20, 40, 60].map(t => (
        <g key={t}>
          <line x1={PL} y1={yOf(t)} x2={W - PR} y2={yOf(t)} stroke="rgba(13,15,12,0.08)" />
          <text x={PL - 5} y={yOf(t) + 3} fontSize={8} fill="rgba(13,15,12,0.4)" textAnchor="end">{t}%</text>
        </g>
      ))}
      {/* umbral de alerta 30% */}
      <line x1={PL} y1={yOf(30)} x2={W - PR} y2={yOf(30)} stroke="#C43020" strokeWidth={1} strokeDasharray="5 3" opacity={0.5} />
      <text x={W - PR} y={yOf(30) - 4} fontSize={8} fill="#C43020" textAnchor="end">umbral 30%</text>
      <path d={path(peor)} fill="none" stroke="#E06820" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
      <path d={path(promedios)} fill="none" stroke="#1B3D24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {SEMANAS.map((s, i) => (
        <g key={s}>
          <circle cx={xOf(i)} cy={yOf(promedios[i]!)} r={3} fill="#1B3D24" />
          <text x={xOf(i)} y={H - 8} fontSize={8} fill="rgba(13,15,12,0.5)" textAnchor="middle" fontWeight={i === idxActual ? 800 : 400}>S{s}</text>
        </g>
      ))}
    </svg>
  )
}

export function SigatokaDashboardView() {
  const { user } = useAuth()
  const [loteSel, setLoteSel] = useState<string>(SERIES[0]!.lote)

  const ranking = [...SERIES].sort((a, b) => b.ee2[idxActual]! - a.ee2[idxActual]!)
  const peorLote = ranking[0]!
  const promActual = Math.round(SERIES.reduce((s, l) => s + l.ee2[idxActual]!, 0) / SERIES.length)
  const promPrevio = Math.round(SERIES.reduce((s, l) => s + l.ee2[idxActual - 1]!, 0) / SERIES.length)
  const delta = promActual - promPrevio
  const enAlerta = SERIES.filter(l => l.ee2[idxActual]! > 30).length
  const sel = SERIES.find(l => l.lote === loteSel)!

  const kpis = [
    { label: 'Lotes monitoreados', value: String(SERIES.length), sub: `semana ${semanaActual}` },
    { label: 'Lotes en alerta', value: String(enAlerta), sub: 'EE2 (1-3) > 30%', alerta: enAlerta > 0 },
    { label: 'Peor lote', value: `${peorLote.ee2[idxActual]}%`, sub: peorLote.lote, alerta: peorLote.ee2[idxActual]! > 30 },
    { label: 'Tendencia (prom)', value: `${delta >= 0 ? '+' : ''}${delta}pp`, sub: `vs semana ${SEMANAS[idxActual - 1]}`, alerta: delta > 0 },
  ]

  return (
    <>
      <Topbar
        title="Sigatoka — Tendencia"
        badge={`${SERIES.length} lotes · semanas ${SEMANAS[0]}–${semanaActual}`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ background: 'rgba(201,240,59,0.12)', border: '1px solid rgba(201,240,59,0.4)', padding: '8px 14px', fontSize: 11, color: 'rgba(13,15,12,0.6)' }}>
          Datos acumulados de muestreos por WhatsApp — agrupados por lote y semana.
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ ...card, padding: '14px 16px', borderColor: k.alerta ? '#C43020' : '#0D0F0C', boxShadow: `3px 3px 0 0 ${k.alerta ? '#C43020' : '#0D0F0C'}` }}>
              <div style={labelStyle}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, marginTop: 5, color: k.alerta ? '#C43020' : '#1B3D24' }}>{k.value}</div>
              <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.5)', marginTop: 3 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Tendencia + ranking */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
          <div style={{ ...card, padding: '16px 18px' }}>
            <div style={{ ...labelStyle, marginBottom: 10 }}>Avance de Sigatoka · % plantas EE2 (1-3) · promedio finca vs. peor lote</div>
            <TendenciaChart series={SERIES} />
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: 'rgba(13,15,12,0.55)' }}>
              <span><span style={{ color: '#1B3D24', fontWeight: 800 }}>━</span> promedio finca</span>
              <span><span style={{ color: '#E06820', fontWeight: 800 }}>┅</span> peor lote</span>
              <span><span style={{ color: '#C43020', fontWeight: 800 }}>┄</span> umbral acción</span>
            </div>
          </div>

          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 13px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
              <span style={labelStyle}>Prioridad de fumigación · semana {semanaActual}</span>
            </div>
            {ranking.map((l, i) => {
              const c = sev(l.ee2[idxActual]!)
              return (
                <div key={l.lote} onClick={() => setLoteSel(l.lote)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderBottom: '1px solid rgba(13,15,12,0.06)', cursor: 'pointer', background: loteSel === l.lote ? 'rgba(201,240,59,0.1)' : 'transparent', borderLeft: loteSel === l.lote ? '3px solid #C9F03B' : '3px solid transparent' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(13,15,12,0.3)', width: 14 }}>#{i + 1}</span>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#0D0F0C' }}>{l.lote}</div>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', background: c.fill, color: c.text }}>{c.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: c.fill, width: 38, textAlign: 'right' }}>{l.ee2[idxActual]}%</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Heatmap lote × semana */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
            <span style={labelStyle}>Mapa de calor · % EE2 (1-3) por lote y semana · clic para ver el lote</span>
          </div>
          <div style={{ padding: 14, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 3, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...labelStyle, textAlign: 'left', padding: '4px 8px' }}>Lote</th>
                  {SEMANAS.map(s => <th key={s} style={{ ...labelStyle, textAlign: 'center', padding: '4px 6px' }}>S{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {SERIES.map(l => (
                  <tr key={l.lote} onClick={() => setLoteSel(l.lote)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontSize: 12, fontWeight: 700, color: loteSel === l.lote ? '#1B3D24' : '#0D0F0C', padding: '4px 8px', whiteSpace: 'nowrap' }}>
                      {loteSel === l.lote ? '▸ ' : ''}{l.lote}
                    </td>
                    {l.ee2.map((v, i) => {
                      const c = sev(v)
                      return (
                        <td key={i} style={{ background: c.fill, color: c.text, textAlign: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'monospace', padding: '8px 4px', minWidth: 42, outline: i === idxActual ? '2px solid #0D0F0C' : 'none' }}>
                          {v}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detalle del lote seleccionado */}
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#0D0F0C' }}>{sel.lote}</span>
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}>EE2 (1-3) S{SEMANAS[0]}→S{semanaActual}: {sel.ee2[0]}% → {sel.ee2[idxActual]}%</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: 'rgba(255,255,255,0.55)', padding: '10px 12px' }}>
              <div style={labelStyle}>EE2 (1-3) actual</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sev(sel.ee2[idxActual]!).fill }}>{sel.ee2[idxActual]}%</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.55)', padding: '10px 12px' }}>
              <div style={labelStyle}>Hojas funcionales (mín)</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sel.func[idxActual]! < 9 ? '#C43020' : '#1B3D24' }}>{sel.func[idxActual]}</div>
            </div>
          </div>
        </div>

        {/* Recomendación */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', background: 'rgba(201,240,59,0.08)', border: '1px solid rgba(201,240,59,0.3)' }}>
          <div style={{ width: 6, height: 6, background: '#C9F03B', borderRadius: '50%', flexShrink: 0, marginTop: 6 }} />
          <span style={{ fontSize: 13, color: 'rgba(13,15,12,0.7)', lineHeight: 1.5 }}>
            <strong style={{ color: '#0D0F0C' }}>Wasagro AI — </strong>
            {peorLote.lote} pasó de {peorLote.ee2[0]}% a {peorLote.ee2[idxActual]}% de EE2 (1-3) en {SEMANAS.length} semanas (tendencia {delta >= 0 ? `+${delta}` : delta}pp). Priorizar fumigación en {peorLote.lote}{enAlerta > 1 ? ` y ${enAlerta - 1} lote(s) más sobre el umbral` : ''}; el resto se mantiene bajo control.
          </span>
        </div>
      </main>
    </>
  )
}
