import { langfuse } from '../integrations/langfuse.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import { getFincasConCoordenadas, getAdminsByFinca } from './supabaseQueries.js'
import { getForecast, type ForecastManana } from '../integrations/weather/OpenMeteoClient.js'

// WMO codes >= 95 = thunderstorm
const WEATHERCODE_TORMENTA = 95

type GetForecastFn = typeof getForecast

function buildMensajeAlerta(
  nombre: string | null,
  forecast: ForecastManana,
): string | null {
  const primerNombre = nombre?.split(' ')[0] ?? null
  const saludo = primerNombre ? `${primerNombre}, ` : ''

  if (forecast.weathercode >= WEATHERCODE_TORMENTA) {
    return `⛈️ ${saludo}mañana hay pronóstico de tormenta en tu zona. Precaución con el personal de campo y los equipos.`
  }
  if (forecast.precipitacion_pct >= 80) {
    const mmTexto = forecast.precipitacion_mm > 0 ? ` (${forecast.precipitacion_mm} mm estimados)` : ''
    return `🌧️ ${saludo}mañana hay ${forecast.precipitacion_pct}% de probabilidad de lluvia en tu zona${mmTexto}. Si tienes fumigaciones programadas, conviene posponerlas.`
  }
  if (forecast.precipitacion_pct >= 60) {
    return `🌦️ ${saludo}mañana puede llover en tu zona (${forecast.precipitacion_pct}%). Tómalo en cuenta si tienes trabajo de campo.`
  }
  return null
}

export async function enviarAlertasClima(
  sender: IWhatsAppSender,
  deps: { getForecastFn?: GetForecastFn } = {},
): Promise<{ enviadas: number; errores: number }> {
  const getForecastFn = deps.getForecastFn ?? getForecast
  const trace = langfuse.trace({ name: 'alertas_clima' })

  const fincas = await getFincasConCoordenadas()
  let enviadas = 0
  let errores = 0

  for (const finca of fincas) {
    try {
      const forecast = await getForecastFn(finca.lat, finca.lng)

      const admins = await getAdminsByFinca(finca.finca_id)
      if (admins.length === 0) continue

      for (const admin of admins) {
        const mensaje = buildMensajeAlerta(admin.nombre, forecast)
        if (!mensaje) continue

        await sender.enviarTexto(admin.phone, mensaje)
        enviadas++

        trace.event({
          name: 'alerta_clima_enviada',
          input: {
            finca_id: finca.finca_id,
            phone: admin.phone,
            pct: forecast.precipitacion_pct,
            weathercode: forecast.weathercode,
          },
        })
      }
    } catch (err) {
      console.error(`[alertaClima] Error procesando finca ${finca.finca_id}:`, err)
      trace.event({ name: 'alerta_clima_error', level: 'ERROR', input: { finca_id: finca.finca_id, error: String(err) } })
      errores++
    }
  }

  trace.event({ name: 'alertas_clima_completado', output: { enviadas, errores } })
  return { enviadas, errores }
}

export { buildMensajeAlerta }
