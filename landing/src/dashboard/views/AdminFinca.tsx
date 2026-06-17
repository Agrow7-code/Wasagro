import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Topbar, TopbarPeriod } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'
import { useResumen, useEventos, useLotes, type EventoFeed } from '../hooks/useDashboard'

// ── Paleta y etiquetas de tipo de evento ─────────────────────────────────────

const TIPO_COLOR: Record<string, string> = {
  insumo: '#2A50D4', plaga: '#D45828', cosecha: '#3EBB6A',
  labor: '#0D0F0C', clima: '#9C9080', gasto: '#C9A800', observacion: '#6B7280',
}
const TIPO_LABEL: Record<string, string> = {
  insumo: 'Insumo', plaga: 'Plaga', cosecha: 'Cosecha',
  labor: 'Labor', clima: 'Clima', gasto: 'Gasto', observacion: 'Observación',
}
const tipoColor = (t: string) => TIPO_COLOR[t] ?? '#6B7280'
const tipoLabel = (t: string) => TIPO_LABEL[t] ?? t

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function fechaHoy(): string {
  const d = new Date()
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`
}
function getInitials(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('') || 'WA'
}
// 'YYYY-MM-DD' → 'Jue 18' (UTC, consistente con la serie del backend)
function diaCorto(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`
}
function horaFecha(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MESES[d.getMonth()]} · ${hh}:${mm}`
}

// ── Primitivos de UI ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
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
function EstadoCarga({ children }: { children: React.ReactNode }) {
  return <Card style={{ padding: '24px 20px', color: 'rgba(13,15,12,0.45)', fontSize: 13, fontWeight: 600 }}>{children}</Card>
}
function EstadoError({ msg }: { msg: string }) {
  return (
    <Card style={{ padding: '20px', borderColor: '#D45828', boxShadow: '4px 4px 0 0 #D45828' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#D45828', marginBottom: 4 }}>No se pudo cargar</div>
      <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.55)' }}>{msg}</div>
    </Card>
  )
}

// ── KPIs operacionales (reales) ───────────────────────────────────────────────

function KpiCard({ label, value, sub, variant }: { label: string; value: string; sub?: string; variant?: 'alert' }) {
  const accent = variant === 'alert' ? '#D45828' : '#0D0F0C'
  const bg = variant === 'alert' ? '#FFF4F0' : '#F5F1E8'
  return (
    <div style={{ background: bg, border: `2px solid ${accent}`, boxShadow: `3px 3px 0 0 ${accent}`, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.45)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: accent }}>{value}</div>
      {sub && <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: 'rgba(13,15,12,0.45)' }}>{sub}</div>}
    </div>
  )
}

// ── Tooltip del chart (estilo del dashboard) ──────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0D0F0C', color: '#F5F1E8', padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>
      <div style={{ opacity: 0.6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div>{payload[0]!.value} evento{payload[0]!.value === 1 ? '' : 's'}</div>
    </div>
  )
}

// ── Feed de eventos (real) ────────────────────────────────────────────────────

function FeedItem({ e }: { e: EventoFeed }) {
  const color = tipoColor(e.tipo)
  const enRevision = e.status === 'requires_review'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderBottom: '1px solid rgba(13,15,12,0.08)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color }}>{tipoLabel(e.tipo)}</span>
          {e.lote_id && <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(13,15,12,0.4)', fontFamily: 'monospace' }}>{e.lote_id}</span>}
          {enRevision && <span style={{ fontSize: 9, fontWeight: 800, color: '#D45828', textTransform: 'uppercase' }}>⚠ en revisión</span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D0F0C', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.descripcion || '(sin descripción)'}
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(13,15,12,0.4)', marginTop: 3 }}>
          {horaFecha(e.created_at)} · confianza {Math.round((e.confianza ?? 0) * 100)}%
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export function AdminFinca() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  // finca_id de la sesión; ?finca_id habilita el drill-in del director (S4.0).
  const fincaId = user?.finca_id ?? searchParams.get('finca_id') ?? null
  const initials = user ? getInitials(user.nombre) : 'WA'

  const resumen = useResumen(fincaId)
  const eventos = useEventos(fincaId)
  const lotes = useLotes(fincaId)

  const r = resumen.data
  const serie = r?.serieDiaria.map(d => ({ dia: diaCorto(d.fecha), total: d.total })) ?? []
  const porTipo = r ? Object.entries(r.porTipo).sort((a, b) => b[1] - a[1]) : []
  const maxTipo = porTipo.length ? Math.max(...porTipo.map(([, n]) => n)) : 1

  return (
    <>
      <Topbar
        title="Resumen"
        avatarInitials={initials}
        rightSlot={<TopbarPeriod>{fechaHoy()}</TopbarPeriod>}
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {!fincaId && (
          <EstadoCarga>No hay una finca asignada a tu cuenta todavía.</EstadoCarga>
        )}

        {fincaId && (
          <>
            {/* ── KPIs operacionales (reales) ──────────────────────────────── */}
            <section>
              <div style={{ marginBottom: 14 }}><SectionLabel>Actividad · últimos 7 días</SectionLabel></div>
              {resumen.isLoading && <EstadoCarga>Cargando indicadores…</EstadoCarga>}
              {resumen.isError && <EstadoError msg={(resumen.error as Error).message} />}
              {r && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  <KpiCard label="Eventos hoy" value={String(r.eventosHoy)} />
                  <KpiCard label="Eventos · 7 días" value={String(r.eventosSemana)} />
                  <KpiCard label="Alertas sin resolver" value={String(r.alertasSinResolver)} sub={r.alertasSinResolver > 0 ? 'Requieren revisión' : 'Todo al día'} variant={r.alertasSinResolver > 0 ? 'alert' : undefined} />
                  <KpiCard label="Lotes activos" value={lotes.data ? String(lotes.data.length) : '–'} sub={lotes.data ? `${lotes.data.reduce((s, l) => s + (l.hectareas ?? 0), 0).toFixed(1)} ha` : undefined} />
                </div>
              )}
            </section>

            {/* ── Gráfico de actividad diaria (Recharts, real) ─────────────── */}
            {r && (
              <section>
                <div style={{ marginBottom: 14 }}><SectionLabel>Eventos por día</SectionLabel></div>
                <Card style={{ padding: '20px 16px 12px' }}>
                  {r.eventosSemana === 0 ? (
                    <div style={{ padding: '28px 4px', textAlign: 'center', color: 'rgba(13,15,12,0.4)', fontSize: 13, fontWeight: 600 }}>
                      Sin eventos registrados en los últimos 7 días.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={serie} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,15,12,0.08)" vertical={false} />
                        <XAxis dataKey="dia" tick={{ fontSize: 11, fill: 'rgba(13,15,12,0.5)' }} axisLine={{ stroke: '#0D0F0C' }} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgba(13,15,12,0.5)' }} axisLine={false} tickLine={false} width={32} />
                        <Tooltip cursor={{ fill: 'rgba(13,15,12,0.05)' }} content={<ChartTooltip />} />
                        <Bar dataKey="total" fill="#1B3D24" radius={[3, 3, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}

                  {/* Desglose por tipo (real) */}
                  {porTipo.length > 0 && (
                    <div style={{ borderTop: '2px solid rgba(13,15,12,0.08)', marginTop: 8, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {porTipo.map(([tipo, n]) => (
                        <div key={tipo}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#0D0F0C' }}>{tipoLabel(tipo)}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>{n}</span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(13,15,12,0.07)' }}>
                            <div style={{ height: '100%', width: `${(n / maxTipo) * 100}%`, background: tipoColor(tipo) }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </section>
            )}

            {/* ── Feed de eventos (real) ───────────────────────────────────── */}
            <section>
              <div style={{ marginBottom: 14 }}><SectionLabel>Últimos eventos</SectionLabel></div>
              {eventos.isLoading && <EstadoCarga>Cargando eventos…</EstadoCarga>}
              {eventos.isError && <EstadoError msg={(eventos.error as Error).message} />}
              {eventos.data && (
                <Card style={{ overflow: 'hidden', padding: 0 }}>
                  {eventos.data.length === 0 ? (
                    <div style={{ padding: '28px 20px', textAlign: 'center', color: 'rgba(13,15,12,0.4)', fontSize: 13, fontWeight: 600 }}>
                      Todavía no hay eventos en esta finca.
                    </div>
                  ) : (
                    eventos.data.slice(0, 12).map(e => <FeedItem key={e.id} e={e} />)
                  )}
                </Card>
              )}
            </section>
          </>
        )}
      </main>
    </>
  )
}
