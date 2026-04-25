const BASE_URL = 'https://api.open-meteo.com/v1/forecast'

export interface ForecastManana {
  precipitacion_pct: number   // precipitation_probability_max (0-100)
  precipitacion_mm: number    // precipitation_sum
  weathercode: number         // WMO weather code
}

interface OpenMeteoResponse {
  daily: {
    time: string[]
    precipitation_probability_max: number[]
    precipitation_sum: number[]
    weathercode: number[]
  }
}

export async function getForecast(
  lat: number,
  lng: number,
  deps: { fetchClient?: typeof fetch } = {},
): Promise<ForecastManana> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: 'precipitation_probability_max,precipitation_sum,weathercode',
    timezone: 'auto',
    forecast_days: '2',
  })

  const res = await fetchClient(`${BASE_URL}?${params}`)
  if (!res.ok) throw new Error(`[OpenMeteo] HTTP ${res.status} para lat=${lat} lng=${lng}`)

  const body = (await res.json()) as OpenMeteoResponse

  // index 0 = hoy, index 1 = mañana
  return {
    precipitacion_pct: body.daily.precipitation_probability_max[1] ?? 0,
    precipitacion_mm: body.daily.precipitation_sum[1] ?? 0,
    weathercode: body.daily.weathercode[1] ?? 0,
  }
}
