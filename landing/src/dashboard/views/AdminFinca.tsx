import { useNavigate } from 'react-router-dom'
import { kpisAdmin, eventosHoy, alertas, lotes } from '../mock/data'
import { EventoItem } from '../components/EventoItem'
import { AlertaPanel } from '../components/AlertaBadge'
import { Topbar, TopbarPeriod } from '../layout/Topbar'
import { useMetricas, type MetricaGuardada } from '../store/metricasStore'

// ── Colores por tipo de evento ─────────────────────────────────────────────────

const TIPO_COLOR: Record<string, string> = {
  insumo:  '#2A50D4',
  plaga:   '#D45828',
  cosecha: '#3EBB6A',
  labor:   '#0D0F0C',
  clima:   '#9C9080',
  gasto:   '#C9F03B',
}
const TIPO_LABEL: Record<string, string> = {
  insumo: 'Insumo', plaga: 'Plaga', cosecha: 'Cosecha',
  labor: 'Labor',   clima: 'Clima', gasto: 'Gasto',
}

// ── Actividad semana ───────────────────────────────────────────────────────────

const ACTIVIDAD_SEMANA = [
  { dia: 'Lun', insumo: 4, labor: 3, cosecha: 2, plaga: 1, gasto: 1, clima: 0 },
  { dia: 'Mar', insumo: 5, labor: 4, cosecha: 3, plaga: 0, gasto: 2, clima: 1 },
  { dia: 'Mié', insumo: 2, labor: 2, cosecha: 1, plaga: 2, gasto: 0, clima: 1 },
  { dia: 'Jue', insumo: 6, labor: 5, cosecha: 4, plaga: 1, gasto: 1, clima: 1 },
  { dia: 'Vie', insumo: 4, labor: 3, cosecha: 3, plaga: 2, gasto: 1, clima: 1 },
  { dia: 'Sáb', insumo: 1, labor: 2, cosecha: 1, plaga: 0, gasto: 1, clima: 0 },
  { dia: 'Hoy', insumo: 5, labor: 3, cosecha: 4, plaga: 2, gasto: 2, clima: 0 },
]
const TIPOS = ['insumo', 'labor', 'cosecha', 'plaga', 'gasto', 'clima'] as const

// Solo tipos con al menos 1 evento en la semana
const TIPOS_ACTIVOS = TIPOS.filter(t => ACTIVIDAD_SEMANA.some(d => d[t] > 0))
const maxTotal = Math.max(...ACTIVIDAD_SEMANA.map(d => TIPOS_ACTIVOS.reduce((s, t) => s + d[t], 0)))

// ── Colores de categoría para métricas ───────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
  Plagas: '#D45828', Cosecha: '#3EBB6A', Insumos: '#2A50D4',
  Gastos: '#C9A800', Labor:  '#0D0F0C',
}
const CAT_BG: Record<string, string> = {
  Plagas: '#FFF4F0', Cosecha: '#F0FFF4', Insumos: '#F0F4FF',
  Gastos: '#FFFBF0', Labor:  '#F5F1E8',
}

// ── KPIs específicos por cultivo ──────────────────────────────────────────────

interface CropKPI { label: string; value: string; delta: string; deltaType: 'positive' | 'negative' | 'neutral'; variant?: 'alert' | 'success' }

const CROP_KPIS: Record<string, CropKPI[]> = {
  Banano: [
    { label: 'Cajas cortadas · semana',  value: '47',       delta: '+5 vs semana ant.',    deltaType: 'positive', variant: 'success' },
    { label: 'Trips/hijo · promedio',    value: '0.45',     delta: 'Umbral: 0.5 · OK',     deltaType: 'neutral'  },
    { label: 'Sigatoka activa · lotes',  value: '1',        delta: 'Lote 7 · Severidad 3', deltaType: 'negative', variant: 'alert'   },
    { label: 'Rendimiento promedio',     value: '198 kg/ha',delta: '+12 vs mes ant.',       deltaType: 'positive' },
  ],
  Cacao: [
    { label: 'qq cosechados · semana',   value: '3.2 qq',   delta: '+0.4 vs semana ant.',  deltaType: 'positive', variant: 'success' },
    { label: 'Monilia activa · lotes',   value: '0',        delta: 'Sin focos activos',    deltaType: 'positive' },
    { label: 'Escobas detectadas',       value: '0',        delta: 'Limpio esta semana',   deltaType: 'neutral'  },
    { label: 'Gastos insumos · semana',  value: '$186',     delta: '$22 bajo presupuesto', deltaType: 'positive' },
  ],
}

// ── Componente: card de métrica ───────────────────────────────────────────────

function MetricaCard({ m }: { m: MetricaGuardada }) {
  const validos = m.resultados.filter(r => r.valor !== null).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
  const maxVal  = validos.length ? Math.max(...validos.map(r => r.valor as number)) : 1
  const avg     = validos.length ? validos.reduce((s, r) => s + (r.valor ?? 0), 0) / validos.length : 0
  const top3    = validos.slice(0, 3)
  const color   = CAT_COLOR[m.categoria] ?? '#0D0F0C'
  const bg      = CAT_BG[m.categoria] ?? '#F5F1E8'

  return (
    <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '3px 3px 0 0 #0D0F0C', padding: '14px 16px', minWidth: 220 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 8, height: 8, background: color, flexShrink: 0, marginTop: 4 }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)' }}>{m.categoria}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C', lineHeight: 1.2, marginTop: 2 }}>{m.nombre}</div>
        </div>
      </div>

      {/* Valor promedio */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
          {avg.toLocaleString('es-EC', { maximumFractionDigits: 2 })}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)' }}>{m.unidad} · prom.</span>
      </div>

      {/* Mini barras top 3 lotes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {top3.map(r => {
          const pct = maxVal > 0 ? ((r.valor ?? 0) / maxVal) * 100 : 0
          return (
            <div key={r.loteId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, width: 40, color: 'rgba(13,15,12,0.55)', flexShrink: 0 }}>{r.nombre}</span>
              <div style={{ flex: 1, height: 12, background: 'rgba(13,15,12,0.07)', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#0D0F0C', width: 36, textAlign: 'right', flexShrink: 0 }}>
                {r.valor?.toLocaleString('es-EC', { maximumFractionDigits: 1 })}
              </span>
            </div>
          )
        })}
      </div>

      {/* Fórmula */}
      <div style={{ marginTop: 10, padding: '4px 8px', background, fontSize: 10, fontWeight: 600, color, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {m.formulaTexto}
      </div>
    </div>
  )
}

// ── Componente: estado fitosanitario por lote ─────────────────────────────────

function EstadoFitosanitario() {
  const conAlerta  = lotes.filter(l => l.alerta)
  const sinAlerta  = lotes.filter(l => !l.alerta)

  return (
    <section>
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
          Estado fitosanitario · por lote
        </span>
      </div>
      <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          {lotes.map(l => {
            const esAlerta = !!l.alerta
            const color = esAlerta ? '#D45828' : '#3EBB6A'
            const bg    = esAlerta ? '#FFF4F0' : '#F0FFF4'
            return (
              <div key={l.id} style={{
                background: bg,
                border: `2px solid ${color}`,
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, background: color, borderRadius: '50%' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{l.nombre}</span>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.5)', marginBottom: 2 }}>{l.cultivo} · {l.hectareas} ha</div>
                {l.alerta ? (
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#D45828', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ⚠ {l.alerta}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#3EBB6A' }}>OK</div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(13,15,12,0.08)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#3EBB6A' }}>✓ {sinAlerta.length} lotes OK</span>
          {conAlerta.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#D45828' }}>⚠ {conAlerta.length} con alertas</span>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export function AdminFinca() {
  const navigate = useNavigate()
  const metricasGuardadas = useMetricas()

  // ── Detectar cultivos disponibles en la finca ─────────────────────────────

  const cultivoSet = new Set(lotes.map(l => l.cultivo))
  const cultivosList = Array.from(cultivoSet)
  // Cultivo dominante (más lotes)
  const cultivoCount: Record<string, number> = {}
  lotes.forEach(l => { cultivoCount[l.cultivo] = (cultivoCount[l.cultivo] ?? 0) + 1 })
  const cultivoDominante = Object.entries(cultivoCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Banano'

  // ── Detectar qué tipos de eventos existen en los datos ────────────────────

  const tiposPresentes = new Set(eventosHoy.map(e => e.tipo))
  const hasPlagas      = tiposPresentes.has('plaga')
  const hasCosecha     = tiposPresentes.has('cosecha')

  // ── KPIs crop-aware ───────────────────────────────────────────────────────

  const cropKPIs = CROP_KPIS[cultivoDominante] ?? CROP_KPIS['Banano']

  return (
    <>
      <Topbar
        title="Resumen"
        badge="H0-R"
        avatarInitials="CM"
        rightSlot={
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', border: '2px solid #0D0F0C', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              </svg>
              Finca El Progreso
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <TopbarPeriod>29 Abr 2026</TopbarPeriod>
          </>
        }
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* ── 1. Distribución de cultivos ──────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.45)' }}>
            Cultivos activos
          </span>
          {cultivosList.map(c => {
            const count = cultivoCount[c]!
            const pct   = Math.round((count / lotes.length) * 100)
            return (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '2px solid #0D0F0C', background: c === cultivoDominante ? '#0D0F0C' : '#F5F1E8' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: c === cultivoDominante ? '#C9F03B' : '#0D0F0C' }}>{c}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: c === cultivoDominante ? 'rgba(201,240,59,0.6)' : 'rgba(13,15,12,0.45)' }}>
                  {count} lotes · {pct}%
                </span>
              </div>
            )
          })}
          <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.35)', marginLeft: 4 }}>
            · Mostrando métricas de {cultivoDominante} (dominante)
          </span>
        </div>

        {/* ── 2. KPIs operacionales ────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {kpisAdmin.map(k => (
            <div key={k.label} style={{
              background: k.variant === 'alert' ? '#FFF4F0' : '#F5F1E8',
              border: `2px solid ${k.variant === 'alert' ? '#D45828' : '#0D0F0C'}`,
              boxShadow: `3px 3px 0 0 ${k.variant === 'alert' ? '#D45828' : '#0D0F0C'}`,
              padding: '16px 18px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.45)', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: k.variant === 'alert' ? '#D45828' : '#0D0F0C' }}>{k.value}</div>
              <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: k.deltaType === 'negative' ? '#D45828' : k.deltaType === 'positive' ? '#1B3D24' : 'rgba(13,15,12,0.45)' }}>{k.delta}</div>
            </div>
          ))}
        </div>

        {/* ── 3. KPIs agronómicos crop-aware ───────────────────────────── */}
        <section>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Métricas {cultivoDominante} · esta semana
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {cropKPIs.map(k => (
              <div key={k.label} style={{
                background: k.variant === 'alert' ? '#FFF4F0' : k.variant === 'success' ? '#F0FFF4' : '#F5F1E8',
                border: `2px solid ${k.variant === 'alert' ? '#D45828' : k.variant === 'success' ? '#3EBB6A' : '#0D0F0C'}`,
                boxShadow: `3px 3px 0 0 ${k.variant === 'alert' ? '#D45828' : k.variant === 'success' ? '#3EBB6A' : '#0D0F0C'}`,
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: k.variant === 'alert' ? '#D45828' : k.variant === 'success' ? '#3EBB6A' : '#0D0F0C' }}>{k.value}</div>
                <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: k.deltaType === 'negative' ? '#D45828' : k.deltaType === 'positive' ? '#1B3D24' : 'rgba(13,15,12,0.45)' }}>{k.delta}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. Actividad por tipo · últimos 7 días ───────────────────── */}
        <section>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Actividad por tipo · últimos 7 días
            </span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {TIPOS_ACTIVOS.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 9, height: 9, background: TIPO_COLOR[t], border: '1px solid rgba(13,15,12,0.15)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.6)' }}>{TIPO_LABEL[t]}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: '20px 24px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 100 }}>
              {ACTIVIDAD_SEMANA.map(d => {
                const total = TIPOS_ACTIVOS.reduce((s, t) => s + d[t], 0)
                const pct   = total / maxTotal
                return (
                  <div key={d.dia} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(13,15,12,0.4)', fontFamily: 'monospace' }}>{total}</span>
                    <div style={{ width: '100%', height: 72 * pct, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      {TIPOS_ACTIVOS.filter(t => d[t] > 0).map(t => (
                        <div key={t} style={{ width: '100%', height: `${(d[t] / total) * 100}%`, background: TIPO_COLOR[t], minHeight: 3 }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: d.dia === 'Hoy' ? 800 : 600, color: d.dia === 'Hoy' ? '#0D0F0C' : 'rgba(13,15,12,0.45)' }}>{d.dia}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── 5. Estado fitosanitario (condicional: solo si hay plagas) ── */}
        {hasPlagas && <EstadoFitosanitario />}

        {/* ── 6. Mis métricas guardadas (condicional) ───────────────────── */}
        {metricasGuardadas.length > 0 && (
          <section>
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
                  Mis métricas guardadas
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, padding: '2px 6px', background: '#0D0F0C', color: '#C9F03B', marginLeft: 10 }}>
                  {metricasGuardadas.length}
                </span>
              </div>
              <button
                onClick={() => navigate('/dashboard/calculadora')}
                style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C', background: 'none', border: '2px solid rgba(13,15,12,0.2)', padding: '5px 12px', cursor: 'pointer' }}
              >
                + Crear métrica
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {metricasGuardadas.map(m => (
                <MetricaCard key={m.id} m={m} />
              ))}
            </div>
          </section>
        )}

        {/* ── 7. Últimos eventos + alertas ─────────────────────────────── */}
        <section>
          <div style={{ display: 'grid', gridTemplateColumns: '70fr 30fr', gap: 16 }}>
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '2px solid #0D0F0C' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Últimos eventos</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, padding: '2px 7px', background: '#0D0F0C', color: '#F5F1E8' }}>
                  {eventosHoy.length}
                </span>
              </div>
              {eventosHoy.slice(0, 5).map(e => <EventoItem key={e.id} evento={e} />)}
            </div>
            <AlertaPanel alertas={alertas} />
          </div>
        </section>

      </main>
    </>
  )
}
