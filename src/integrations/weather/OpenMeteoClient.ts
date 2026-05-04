const BASE_URL = 'https://api.open-meteo.com/v1/forecast'

export interface ForecastManana {
  precipitacion_pct: number
  precipitacion_mm: number
  weathercode: number
}

export interface ForecastDia {
  fecha:              string
  precipitacion_pct:  number
  precipitacion_mm:   number
  temp_min:           number
  weathercode:        number
}

export interface ForecastSemanal {
  dias:              ForecastDia[]
  dias_lluvia:       number   // días con >60% prob. lluvia
  mm_total:          number   // lluvia acumulada de la semana
  ventana_aplicacion: string  // descripción legible de cuándo aplicar
}

interface OpenMeteoResponse {
  daily: {
    time:                           string[]
    precipitation_probability_max:  number[]
    precipitation_sum:              number[]
    temperature_2m_min:             number[]
    weathercode:                    number[]
  }
}

export async function getForecast(
  lat: number,
  lng: number,
  deps: { fetchClient?: typeof fetch } = {},
): Promise<ForecastManana> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch

  const params = new URLSearchParams({
    latitude:     String(lat),
    longitude:    String(lng),
    daily:        'precipitation_probability_max,precipitation_sum,weathercode,temperature_2m_min',
    timezone:     'auto',
    forecast_days: '2',
  })

  const res = await fetchClient(`${BASE_URL}?${params}`)
  if (!res.ok) throw new Error(`[OpenMeteo] HTTP ${res.status} para lat=${lat} lng=${lng}`)

  const body = (await res.json()) as OpenMeteoResponse

  return {
    precipitacion_pct: body.daily.precipitation_probability_max[1] ?? 0,
    precipitacion_mm:  body.daily.precipitation_sum[1] ?? 0,
    weathercode:       body.daily.weathercode[1] ?? 0,
  }
}

export async function getForecastSemanal(
  lat: number,
  lng: number,
  deps: { fetchClient?: typeof fetch } = {},
): Promise<ForecastSemanal> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch

  const params = new URLSearchParams({
    latitude:     String(lat),
    longitude:    String(lng),
    daily:        'precipitation_probability_max,precipitation_sum,temperature_2m_min,weathercode',
    timezone:     'auto',
    forecast_days: '7',
  })

  const res = await fetchClient(`${BASE_URL}?${params}`)
  if (!res.ok) throw new Error(`[OpenMeteo] HTTP ${res.status} para lat=${lat} lng=${lng}`)

  const body = (await res.json()) as OpenMeteoResponse
  const { time, precipitation_probability_max, precipitation_sum, temperature_2m_min, weathercode } = body.daily

  const dias: ForecastDia[] = time.map((fecha, i) => ({
    fecha,
    precipitacion_pct: precipitation_probability_max[i] ?? 0,
    precipitacion_mm:  precipitation_sum[i] ?? 0,
    temp_min:          temperature_2m_min[i] ?? 0,
    weathercode:       weathercode[i] ?? 0,
  }))

  const diasLluvia = dias.filter(d => d.precipitacion_pct > 60).length
  const mmTotal    = dias.reduce((acc, d) => acc + d.precipitacion_mm, 0)

  // Construir descripción de ventana óptima para aplicaciones
  const diasSecos = dias
    .map((d, i) => ({ ...d, idx: i }))
    .filter(d => d.precipitacion_pct <= 30)

  let ventana_aplicacion: string
  if (diasSecos.length === 0) {
    ventana_aplicacion = 'Semana muy lluviosa — esperar ventana seca antes de aplicar'
  } else if (diasSecos.length >= 4) {
    ventana_aplicacion = 'Buena semana para aplicaciones — mayoría de días secos'
  } else {
    const nombres = diasSecos.map(d => new Date(d.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'short' }))
    ventana_aplicacion = `Ventana de aplicación: ${nombres.join(', ')}`
  }

  return { dias, dias_lluvia: diasLluvia, mm_total: Math.round(mmTotal), ventana_aplicacion }
}
