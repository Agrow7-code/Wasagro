import { useNavigate } from 'react-router-dom'
import { kpisAdmin, eventosHoy, alertas, lotes } from '../mock/data'
import { EventoItem } from '../components/EventoItem'
import { AlertaPanel } from '../components/AlertaBadge'
import { Topbar, TopbarPeriod } from '../layout/Topbar'
import { useMetricas, type MetricaGuardada } from '../store/metricasStore'

// ── Paleta de tipos de evento ─────────────────────────────────────────────────

const TIPO_COLOR: Record<string, string> = {
  insumo: '#2A50D4', plaga: '#D45828', cosecha: '#3EBB6A',
  labor:  '#0D0F0C', clima: '#9C9080', gasto:   '#C9F03B',
}
const TIPO_LABEL: Record<string, string> = {
  insumo: 'Insumo', plaga: 'Plaga', cosecha: 'Cosecha',
  labor:  'Labor',  clima: 'Clima', gasto:   'Gasto',
}

const CAT_COLOR: Record<string, string> = {
  Plagas: '#D45828', Cosecha: '#3EBB6A', Insumos: '#2A50D4',
  Gastos: '#C9A800', Labor:  '#0D0F0C',
}
const CAT_BG: Record<string, string> = {
  Plagas: '#FFF4F0', Cosecha: '#F0FFF4', Insumos: '#F0F4FF',
  Gastos: '#FFFBF0', Labor:  '#F5F1E8',
}

// ── Actividad semana (mock derivado de eventos) ───────────────────────────────

const ACTIVIDAD_SEMANA = [
  { dia: 'Lun', insumo: 4, labor: 3, cosecha: 2, plaga: 1, gasto: 1, clima: 0 },
  { dia: 'Mar', insumo: 5, labor: 4, cosecha: 3, plaga: 0, gasto: 2, clima: 1 },
  { dia: 'Mié', insumo: 2, labor: 2, cosecha: 1, plaga: 2, gasto: 0, clima: 1 },
  { dia: 'Jue', insumo: 6, labor: 5, cosecha: 4, plaga: 1, gasto: 1, clima: 1 },
  { dia: 'Vie', insumo: 4, labor: 3, cosecha: 3, plaga: 2, gasto: 1, clima: 1 },
  { dia: 'Sáb', insumo: 1, labor: 2, cosecha: 1, plaga: 0, gasto: 1, clima: 0 },
  { dia: 'Hoy', insumo: 5, labor: 3, cosecha: 4, plaga: 2, gasto: 2, clima: 0 },
]
const TIPOS_ALL = ['insumo', 'labor', 'cosecha', 'plaga', 'gasto', 'clima'] as const
const TIPOS_ACTIVOS = TIPOS_ALL.filter(t => ACTIVIDAD_SEMANA.some(d => d[t] > 0))
const MAX_TOTAL = Math.max(...ACTIVIDAD_SEMANA.map(d => TIPOS_ACTIVOS.reduce((s, t) => s + d[t], 0)))

// ── Datos financieros (derivados del tipo de evento) ─────────────────────────

const FINANZAS_SEMANA = {
  gastos: [
    { label: 'Insumos',       monto: 186, color: '#2A50D4' },
    { label: 'Labor',         monto: 135, color: '#0D0F0C' },
    { label: 'Otros',         monto: 45,  color: '#9C9080' },
  ],
  ingresos: [
    { label: 'Banano',        monto: 376, color: '#3EBB6A' },
    { label: 'Cacao',         monto: 576, color: '#C9A800' },
  ],
}
const TOTAL_GASTOS   = FINANZAS_SEMANA.gastos.reduce((s, g) => s + g.monto, 0)
const TOTAL_INGRESOS = FINANZAS_SEMANA.ingresos.reduce((s, i) => s + i.monto, 0)
const MARGEN_NETO    = TOTAL_INGRESOS - TOTAL_GASTOS
const PCT_MARGEN     = Math.round((MARGEN_NETO / TOTAL_INGRESOS) * 100)

// ── KPIs agronómicos por cultivo ──────────────────────────────────────────────

interface CropKPI { label: string; value: string; delta: string; deltaType: 'positive'|'negative'|'neutral'; variant?: 'alert'|'success' }

const CROP_KPIS: Record<string, CropKPI[]> = {
  Banano: [
    { label: 'Cajas cortadas · semana', value: '47',        delta: '+5 vs semana ant.',    deltaType: 'positive', variant: 'success' },
    { label: 'Trips/hijo · promedio',   value: '0.45',      delta: 'Umbral: 0.5 · OK',    deltaType: 'neutral'  },
    { label: 'Sigatoka activa',         value: '1 foco',    delta: 'Lote 7 · Revisar',    deltaType: 'negative', variant: 'alert'   },
    { label: 'Rendimiento promedio',    value: '198 kg/ha', delta: '+12 vs mes ant.',      deltaType: 'positive' },
  ],
  Cacao: [
    { label: 'qq cosechados · semana',  value: '3.2 qq',    delta: '+0.4 vs semana ant.', deltaType: 'positive', variant: 'success' },
    { label: 'Monilia activa',          value: '0 focos',   delta: 'Sin focos activos',   deltaType: 'positive' },
    { label: 'Escobas detectadas',      value: '0',         delta: 'Limpio esta semana',  deltaType: 'neutral'  },
    { label: 'Gastos insumos · semana', value: '$186',      delta: '$22 bajo presupuesto',deltaType: 'positive' },
  ],
}

// ── Helpers de render ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.45)' }}>
      {children}
    </span>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', ...style }}>
      {children}
    </div>
  )
}

// ── Sección: Estado fitosanitario ─────────────────────────────────────────────

function EstadoFitosanitario() {
  const conAlerta = lotes.filter(l => l.alerta)
  const sinAlerta = lotes.filter(l => !l.alerta)
  return (
    <section>
      <div style={{ marginBottom: 14 }}><SectionLabel>Estado fitosanitario · por lote</SectionLabel></div>
      <Card style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {lotes.map(l => {
            const color = l.alerta ? '#D45828' : '#3EBB6A'
            const bg    = l.alerta ? '#FFF4F0' : '#F0FFF4'
            return (
              <div key={l.id} style={{ background: bg, border: `2px solid ${color}`, padding: '9px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                  <div style={{ width: 6, height: 6, background: color, borderRadius: '50%' }} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{l.nombre}</span>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.5)', marginBottom: 3 }}>{l.cultivo} · {l.hectareas} ha</div>
                {l.alerta
                  ? <div style={{ fontSize: 10, fontWeight: 800, color: '#D45828', textTransform: 'uppercase' as const }}>⚠ {l.alerta}</div>
                  : <div style={{ fontSize: 10, fontWeight: 700, color: '#3EBB6A' }}>OK</div>
                }
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(13,15,12,0.08)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#3EBB6A' }}>✓ {sinAlerta.length} lotes OK</span>
          {conAlerta.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#D45828' }}>⚠ {conAlerta.length} con alertas</span>}
        </div>
      </Card>
    </section>
  )
}

// ── Sección: Finanzas (gastos + ingresos) ─────────────────────────────────────

function FinanzasSection() {
  const maxGasto   = Math.max(...FINANZAS_SEMANA.gastos.map(g => g.monto))
  const maxIngreso = Math.max(...FINANZAS_SEMANA.ingresos.map(i => i.monto))

  return (
    <section>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <SectionLabel>Finanzas · esta semana</SectionLabel>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', background: MARGEN_NETO >= 0 ? '#1B3D24' : '#D45828', color: '#F5F1E8' }}>
          {MARGEN_NETO >= 0 ? 'RENTABLE' : 'PÉRDIDA'}
        </span>
      </div>

      {/* Tres KPIs financieros */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Gastos totales',   value: `$${TOTAL_GASTOS}`,   delta: 'Insumos + labor + otros', color: '#D45828', bg: '#FFF4F0', border: '#D45828' },
          { label: 'Ingresos cosecha', value: `$${TOTAL_INGRESOS}`, delta: 'Banano + Cacao',           color: '#3EBB6A', bg: '#F0FFF4', border: '#3EBB6A' },
          { label: 'Margen neto',      value: `$${MARGEN_NETO}`,    delta: `${PCT_MARGEN}% del ingreso`, color: PCT_MARGEN > 40 ? '#1B3D24' : '#C9A800', bg: '#F5F1E8', border: '#0D0F0C' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `2px solid ${k.border}`, boxShadow: `3px 3px 0 0 ${k.border}`, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)', marginTop: 5 }}>{k.delta}</div>
          </div>
        ))}
      </div>

      {/* Desglose visual */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Gastos por categoría */}
        <Card style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: '#0D0F0C' }}>Gastos por categoría</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FINANZAS_SEMANA.gastos.map(g => {
              const pct = Math.round((g.monto / TOTAL_GASTOS) * 100)
              const barPct = (g.monto / maxGasto) * 100
              return (
                <div key={g.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{g.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>${g.monto} <span style={{ color: 'rgba(13,15,12,0.4)', fontWeight: 600 }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(13,15,12,0.07)' }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: g.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Ingresos por cultivo */}
        <Card style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: '#0D0F0C' }}>Ingresos por cultivo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FINANZAS_SEMANA.ingresos.map(i => {
              const pct    = Math.round((i.monto / TOTAL_INGRESOS) * 100)
              const barPct = (i.monto / maxIngreso) * 100
              return (
                <div key={i.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{i.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>${i.monto} <span style={{ color: 'rgba(13,15,12,0.4)', fontWeight: 600 }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(13,15,12,0.07)' }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: i.color }} />
                  </div>
                </div>
              )
            })}
          </div>
          {/* Ratio gastos/ingresos */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(13,15,12,0.08)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)', marginBottom: 6 }}>Gastos vs Ingresos</div>
            <div style={{ height: 12, background: 'rgba(13,15,12,0.07)', position: 'relative', display: 'flex' }}>
              <div style={{ height: '100%', width: `${Math.round((TOTAL_GASTOS / TOTAL_INGRESOS) * 100)}%`, background: '#D45828' }} />
              <div style={{ height: '100%', flex: 1, background: '#3EBB6A' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#D45828' }}>{Math.round((TOTAL_GASTOS / TOTAL_INGRESOS) * 100)}% gastos</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#3EBB6A' }}>{PCT_MARGEN}% margen</span>
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}

// ── Sección: Actividad + Métricas (combinada) ─────────────────────────────────

function MetricaMiniCard({ m }: { m: MetricaGuardada }) {
  const validos = m.resultados.filter(r => r.valor !== null).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
  const maxVal  = validos.length ? Math.max(...validos.map(r => r.valor as number)) : 1
  const avg     = validos.length ? validos.reduce((s, r) => s + (r.valor ?? 0), 0) / validos.length : 0
  const color   = CAT_COLOR[m.categoria] ?? '#0D0F0C'
  const bg      = CAT_BG[m.categoria] ?? '#F5F1E8'

  return (
    <div style={{ background: bg, border: `2px solid ${color}`, padding: '12px 14px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ width: 6, height: 6, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#0D0F0C', lineHeight: 1.2 }}>{m.nombre}</span>
      </div>

      {/* Valor promedio */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
          {avg.toLocaleString('es-EC', { maximumFractionDigits: 2 })}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(13,15,12,0.45)' }}>{m.unidad}</span>
      </div>

      {/* Mini barras: top 4 lotes */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 28 }}>
        {validos.slice(0, 9).map(r => {
          const h = maxVal > 0 ? ((r.valor ?? 0) / maxVal) * 28 : 0
          return (
            <div key={r.loteId} style={{ flex: 1, height: Math.max(h, 2), background: color, opacity: 0.6 + ((r.valor ?? 0) / maxVal) * 0.4 }} title={`${r.nombre}: ${r.valor}`} />
          )
        })}
      </div>

      <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(13,15,12,0.4)', marginTop: 6, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {m.formulaTexto}
      </div>
    </div>
  )
}

function ActividadYMetricas({ metricas, onCrearMetrica }: { metricas: MetricaGuardada[]; onCrearMetrica: () => void }) {
  return (
    <section>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <SectionLabel>Actividad · últimos 7 días</SectionLabel>
          {/* Leyenda inline */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
            {TIPOS_ACTIVOS.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, background: TIPO_COLOR[t] }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(13,15,12,0.55)' }}>{TIPO_LABEL[t]}</span>
              </div>
            ))}
          </div>
        </div>
        {metricas.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.4)' }}>
            {metricas.length} métrica{metricas.length > 1 ? 's' : ''} activa{metricas.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <Card style={{ padding: '20px 24px' }}>
        {/* Gráfico de barras apiladas */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 100, marginBottom: metricas.length ? 20 : 0 }}>
          {ACTIVIDAD_SEMANA.map(d => {
            const total = TIPOS_ACTIVOS.reduce((s, t) => s + d[t], 0)
            const pct   = total / MAX_TOTAL
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

        {/* Métricas calculadas — integradas en esta sección */}
        {metricas.length > 0 && (
          <>
            <div style={{ borderTop: '2px solid rgba(13,15,12,0.08)', paddingTop: 16, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(13,15,12,0.45)' }}>
                  Métricas calculadas
                </span>
                <button onClick={onCrearMetrica} style={{ fontSize: 11, fontWeight: 700, color: '#0D0F0C', background: 'none', border: '2px solid rgba(13,15,12,0.2)', padding: '4px 10px', cursor: 'pointer' }}>
                  + Nueva métrica
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {metricas.map(m => <MetricaMiniCard key={m.id} m={m} />)}
              </div>
            </div>
          </>
        )}

        {/* Placeholder si no hay métricas */}
        {metricas.length === 0 && (
          <div style={{ borderTop: '2px solid rgba(13,15,12,0.06)', paddingTop: 14, marginTop: 4 }}>
            <button onClick={onCrearMetrica} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'transparent', border: '2px dashed rgba(13,15,12,0.15)',
              padding: '10px 16px', cursor: 'pointer', width: '100%',
              color: 'rgba(13,15,12,0.4)', fontSize: 12, fontWeight: 600,
            }}>
              <span style={{ fontSize: 16 }}>+</span>
              Crear métrica calculada para esta finca
            </button>
          </div>
        )}
      </Card>
    </section>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export function AdminFinca() {
  const navigate = useNavigate()
  const metricas = useMetricas()

  // Detectar cultivos y dominante
  const cultivoCount: Record<string, number> = {}
  lotes.forEach(l => { cultivoCount[l.cultivo] = (cultivoCount[l.cultivo] ?? 0) + 1 })
  const cultivosList      = Object.entries(cultivoCount).sort((a, b) => b[1] - a[1])
  const cultivoDominante  = cultivosList[0]?.[0] ?? 'Banano'
  const cropKPIs          = CROP_KPIS[cultivoDominante] ?? CROP_KPIS['Banano']

  // Condiciones para secciones opcionales
  const tiposPresentes = new Set(eventosHoy.map(e => e.tipo))
  const hasPlagas      = tiposPresentes.has('plaga')
  const hasFinanzas    = tiposPresentes.has('gasto') && tiposPresentes.has('cosecha')

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

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── Distribución de cultivos ──────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)' }}>
            Cultivos
          </span>
          {cultivosList.map(([cult, count]) => (
            <div key={cult} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '2px solid #0D0F0C', background: cult === cultivoDominante ? '#0D0F0C' : '#F5F1E8' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: cult === cultivoDominante ? '#C9F03B' : '#0D0F0C' }}>{cult}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: cult === cultivoDominante ? 'rgba(201,240,59,0.55)' : 'rgba(13,15,12,0.4)' }}>
                {count} lotes
              </span>
            </div>
          ))}
        </div>

        {/* ── KPIs operacionales ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {kpisAdmin.map(k => (
            <div key={k.label} style={{
              background: k.variant === 'alert' ? '#FFF4F0' : '#F5F1E8',
              border:     `2px solid ${k.variant === 'alert' ? '#D45828' : '#0D0F0C'}`,
              boxShadow:  `3px 3px 0 0 ${k.variant === 'alert' ? '#D45828' : '#0D0F0C'}`,
              padding: '16px 18px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.45)', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: k.variant === 'alert' ? '#D45828' : '#0D0F0C' }}>{k.value}</div>
              <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: k.deltaType === 'negative' ? '#D45828' : k.deltaType === 'positive' ? '#1B3D24' : 'rgba(13,15,12,0.45)' }}>{k.delta}</div>
            </div>
          ))}
        </div>

        {/* ── KPIs agronómicos crop-aware ───────────────────────────────── */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Métricas {cultivoDominante} · esta semana</SectionLabel>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {cropKPIs.map(k => (
              <div key={k.label} style={{
                background: k.variant === 'alert' ? '#FFF4F0' : k.variant === 'success' ? '#F0FFF4' : '#F5F1E8',
                border:     `2px solid ${k.variant === 'alert' ? '#D45828' : k.variant === 'success' ? '#3EBB6A' : '#0D0F0C'}`,
                boxShadow:  `3px 3px 0 0 ${k.variant === 'alert' ? '#D45828' : k.variant === 'success' ? '#3EBB6A' : '#0D0F0C'}`,
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: k.variant === 'alert' ? '#D45828' : k.variant === 'success' ? '#3EBB6A' : '#0D0F0C' }}>{k.value}</div>
                <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: k.deltaType === 'negative' ? '#D45828' : k.deltaType === 'positive' ? '#1B3D24' : 'rgba(13,15,12,0.45)' }}>{k.delta}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Actividad + métricas calculadas (siempre) ────────────────── */}
        <ActividadYMetricas
          metricas={metricas}
          onCrearMetrica={() => navigate('/dashboard/calculadora')}
        />

        {/* ── Finanzas (si hay gastos + cosecha registrados) ────────────── */}
        {hasFinanzas && <FinanzasSection />}

        {/* ── Estado fitosanitario (si hay plagas) ──────────────────────── */}
        {hasPlagas && <EstadoFitosanitario />}

        {/* ── Feed de eventos + alertas ─────────────────────────────────── */}
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
