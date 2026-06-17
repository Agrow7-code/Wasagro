// Agregación pura para el dashboard de finca (KPIs + serie diaria). Sin I/O:
// recibe los eventos crudos del rango y "ahora", devuelve los números que la
// portada (AdminFinca) muestra. Pura y determinista → testeable sin DB ni reloj.

export interface EventoDashboard {
  tipo_evento: string
  created_at: string // ISO (UTC) — timestamp de ingreso del evento
  status: string
  confidence_score: number
  lote_id: string | null
}

export interface DashboardResumen {
  eventosHoy: number
  eventosSemana: number
  alertasSinResolver: number
  porTipo: Record<string, number>
  serieDiaria: { fecha: string; total: number }[] // 7 días [hoy-6 … hoy], cronológico
}

// Día calendario UTC (YYYY-MM-DD) de un timestamp. Normaliza vía Date para
// tolerar offsets; los timestamps de Supabase ya son UTC.
function diaUTC(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export function resumirEventos(eventos: EventoDashboard[], ahora: Date): DashboardResumen {
  const hoyStr = ahora.toISOString().slice(0, 10)

  // Ventana de 7 días calendario terminando hoy: [hoy-6 … hoy].
  const dias: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(ahora)
    d.setUTCDate(d.getUTCDate() - i)
    dias.push(d.toISOString().slice(0, 10))
  }
  const enSemana = new Set(dias)
  const conteoDia = new Map<string, number>(dias.map(d => [d, 0]))

  let eventosHoy = 0
  let eventosSemana = 0
  let alertasSinResolver = 0
  const porTipo: Record<string, number> = {}

  for (const e of eventos) {
    const dia = diaUTC(e.created_at)
    if (dia === hoyStr) eventosHoy++
    if (enSemana.has(dia)) {
      eventosSemana++
      conteoDia.set(dia, (conteoDia.get(dia) ?? 0) + 1)
      porTipo[e.tipo_evento] = (porTipo[e.tipo_evento] ?? 0) + 1
    }
    // "Sin resolver" = el evento quedó marcado para revisión humana (P7).
    if (e.status === 'requires_review') alertasSinResolver++
  }

  const serieDiaria = dias.map(d => ({ fecha: d, total: conteoDia.get(d) ?? 0 }))
  return { eventosHoy, eventosSemana, alertasSinResolver, porTipo, serieDiaria }
}
