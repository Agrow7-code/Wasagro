import { kpisAdmin, eventosHoy, alertas } from '../mock/data'
import { EventoItem } from '../components/EventoItem'
import { AlertaPanel } from '../components/AlertaBadge'
import { Topbar, TopbarPeriod } from '../layout/Topbar'

const TIPO_COLOR: Record<string, string> = {
  insumo:  '#2A50D4',
  plaga:   '#D45828',
  cosecha: '#3EBB6A',
  labor:   '#0D0F0C',
  clima:   '#9C9080',
  gasto:   '#C9F03B',
}

const TIPO_LABEL: Record<string, string> = {
  insumo:  'Insumo',
  plaga:   'Plaga',
  cosecha: 'Cosecha',
  labor:   'Labor',
  clima:   'Clima',
  gasto:   'Gasto',
}

// Actividad de los últimos 7 días por tipo (mock)
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
const maxTotal = Math.max(...ACTIVIDAD_SEMANA.map(d => TIPOS.reduce((s, t) => s + d[t], 0)))

export function AdminFinca() {
  return (
    <>
      <Topbar
        title="Resumen"
        badge="H0-R"
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
              Finca El Progreso (Banano)
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <TopbarPeriod>29 Abr 2026</TopbarPeriod>
          </>
        }
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* 1. KPIs — 4 métricas clave, nada más */}
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
              <div style={{ fontSize: 11, marginTop: 6, color: k.deltaType === 'negative' ? '#D45828' : k.deltaType === 'positive' ? '#1B3D24' : 'rgba(13,15,12,0.45)', fontWeight: 600 }}>{k.delta}</div>
            </div>
          ))}
        </div>

        {/* 2. Actividad por tipo — últimos 7 días */}
        <section>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
              Actividad por tipo · últimos 7 días
            </span>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: '20px 24px' }}>
            {/* Leyenda */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
              {TIPOS.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 10, height: 10, background: TIPO_COLOR[t], border: '1px solid rgba(13,15,12,0.2)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.6)' }}>{TIPO_LABEL[t]}</span>
                </div>
              ))}
            </div>
            {/* Barras por día */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 100 }}>
              {ACTIVIDAD_SEMANA.map(d => {
                const total = TIPOS.reduce((s, t) => s + d[t], 0)
                const pct = total / maxTotal
                return (
                  <div key={d.dia} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(13,15,12,0.4)', fontFamily: 'monospace' }}>{total}</span>
                    <div style={{ width: '100%', height: 72 * pct, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      {TIPOS.filter(t => d[t] > 0).map(t => (
                        <div key={t} style={{
                          width: '100%',
                          height: `${(d[t] / total) * 100}%`,
                          background: TIPO_COLOR[t],
                          minHeight: 3,
                        }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: d.dia === 'Hoy' ? 800 : 600, color: d.dia === 'Hoy' ? '#0D0F0C' : 'rgba(13,15,12,0.45)' }}>{d.dia}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* 3. Últimos eventos + alertas */}
        <section>
          <div style={{ display: 'grid', gridTemplateColumns: '70fr 30fr', gap: 16 }}>
            {/* Feed reciente */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '2px solid #0D0F0C' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Últimos eventos</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, padding: '2px 7px', background: '#0D0F0C', color: '#F5F1E8' }}>
                  {eventosHoy.length}
                </span>
              </div>
              {eventosHoy.slice(0, 5).map(e => <EventoItem key={e.id} evento={e} />)}
            </div>
            {/* Alertas */}
            <AlertaPanel alertas={alertas} />
          </div>
        </section>

      </main>
    </>
  )
}
