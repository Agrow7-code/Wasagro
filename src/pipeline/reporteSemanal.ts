import { langfuse } from '../integrations/langfuse.js'
import type { IWasagroLLM, CostContext } from '../integrations/llm/IWasagroLLM.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { EntradaResumenSemanal } from '../types/dominio/Resumen.js'
import { getEventosByFincaRango, getAdminsByFinca, getFincasConCoordenadas, getFincasActivas, getPlagasPorNivelSemanal, type PlaguaNivelResumen } from './supabaseQueries.js'
import { getForecastSemanal, type ForecastSemanal } from '../integrations/weather/OpenMeteoClient.js'

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function rangoSemanaAnterior(): { desde: Date; hasta: Date } {
  const hasta = new Date()
  hasta.setHours(0, 0, 0, 0)
  const desde = new Date(hasta)
  desde.setDate(desde.getDate() - 7)
  return { desde, hasta }
}

export async function generarYEnviarReportes(
  llm: IWasagroLLM,
  sender: IWhatsAppSender,
): Promise<{ procesadas: number; errores: number }> {
  const { desde, hasta } = rangoSemanaAnterior()

  // Obtener fincas con coordenadas (para clima) y sin (fallback)
  const fincasConCoords = await getFincasConCoordenadas().catch(err => {
    console.error('[reporteSemanal] Error al obtener fincas con coordenadas:', err)
    return []
  })
  const todasFincas = await getFincasActivas().catch(err => {
    console.error('[reporteSemanal] Error al obtener fincas activas:', err)
    return []
  })

  // Mapa finca_id → lat/lng para lookup rápido
  const coordsMap = new Map(fincasConCoords.map(f => [f.finca_id, { lat: f.lat, lng: f.lng }]))

  let procesadas = 0
  let errores    = 0

  for (const finca of todasFincas) {
    try {
      const coords  = coordsMap.get(finca.finca_id) ?? null
      const enviado = await procesarReporteFinca(
        finca.finca_id,
        finca.org_id,
        finca.nombre,
        finca.cultivo_principal ?? 'no especificado',
        finca.pais ?? 'EC',
        desde,
        hasta,
        coords,
        llm,
        sender,
      )
      if (enviado) procesadas++
    } catch (err) {
      console.error(`[reporteSemanal] Error procesando finca ${finca.finca_id}:`, err)
      errores++
    }
  }

  return { procesadas, errores }
}

async function procesarReporteFinca(
  fincaId: string,
  orgId: string,
  fincaNombre: string,
  cultivoPrincipal: string,
  pais: string,
  desde: Date,
  hasta: Date,
  coords: { lat: number; lng: number } | null,
  llm: IWasagroLLM,
  sender: IWhatsAppSender,
): Promise<boolean> {
  const trace = langfuse.trace({ name: 'reporte_semanal', tags: ['cron', 'reporte', 'semanal'], metadata: { finca_id: fincaId } })

  const eventos = await getEventosByFincaRango(fincaId, desde, hasta)
  if (eventos.length === 0) {
    trace.event({ name: 'sin_eventos_semana', level: 'DEFAULT', input: { finca_id: fincaId } })
    return false
  }

  const admins = await getAdminsByFinca(fincaId)
  if (admins.length === 0) {
    trace.event({ name: 'sin_admins', level: 'WARNING', input: { finca_id: fincaId } })
    return false
  }

  // Plagas por nivel de umbral (D18)
  const plagasPorNivel = await getPlagasPorNivelSemanal(fincaId, desde, hasta).catch(err => {
    trace.event({ name: 'plagasPorNivel_error', level: 'WARNING', input: { finca_id: fincaId, error: String(err) } })
    console.error(`[reporteSemanal] Error al obtener plagas por nivel para finca ${fincaId}:`, err)
    return [] as PlaguaNivelResumen[]
  })

  // Pronóstico semanal — solo si tenemos coordenadas
  let forecast: ForecastSemanal | null = null
  if (coords) {
    forecast = await getForecastSemanal(coords.lat, coords.lng).catch(err => {
      trace.event({ name: 'forecast_error', level: 'WARNING', input: { error: String(err) } })
      return null
    })
  }

  const entrada: EntradaResumenSemanal = {
    finca_id:          fincaId,
    finca_nombre:      fincaNombre,
    cultivo_principal: cultivoPrincipal,
    pais,
    fecha_inicio:      formatDate(desde),
    fecha_fin:         formatDate(hasta),
    eventos,
    forecast,
    plagasPorNivel,
  }

  let resumen
  try {
    resumen = await llm.resumirSemana(entrada as EntradaResumenSemanal, trace.id, { orgId, fincaId } satisfies CostContext)
  } catch (err) {
    trace.event({ name: 'error_llm_resumen', level: 'ERROR', input: { finca_id: fincaId, error: String(err) } })
    throw err
  }

  if (!resumen.es_solo_informativo) {
    trace.event({ name: 'reporte_bloqueado', level: 'WARNING', input: { finca_id: fincaId } })
    return false
  }

  // Deduplicar phones — un admin puede estar en múltiples fincas
  const phonesSent = new Set<string>()

  for (const admin of admins) {
    if (phonesSent.has(admin.phone)) continue
    phonesSent.add(admin.phone)

    try {
      // UN SOLO MENSAJE — narrativo + alertas integradas
      await sender.enviarTexto(admin.phone, resumen.resumen_narrativo)
    } catch (err) {
      trace.event({
        name:  'error_envio_whatsapp',
        level: 'ERROR',
        input: { admin_phone: admin.phone, finca_id: fincaId, error: String(err) },
      })
      console.error(`[reporteSemanal] Error enviando a ${admin.phone}:`, err)
    }
  }

  trace.event({
    name:   'reporte_enviado',
    level:  'DEFAULT',
    output: {
      finca_id:            fincaId,
      total_eventos:       eventos.length,
      admins_notificados:  phonesSent.size,
      con_forecast:        forecast !== null,
      requiere_atencion:   resumen.requiere_atencion,
    },
  })

  return true
}
