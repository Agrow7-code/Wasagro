import { describe, expect, it, vi } from 'vitest'
import { getForecast } from '../../../src/integrations/weather/OpenMeteoClient.js'

function crearFetchMock(body: object, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })
}

const RESPUESTA_TIPICA = {
  daily: {
    time: ['2026-04-24', '2026-04-25'],
    precipitation_probability_max: [10, 85],
    precipitation_sum: [0, 14.2],
    weathercode: [1, 61],
  },
}

describe('getForecast', () => {
  it('retorna los datos de mañana (índice 1) correctamente', async () => {
    const fetch = crearFetchMock(RESPUESTA_TIPICA)
    const result = await getForecast(-1.2345, -79.5678, { fetchClient: fetch as any })

    expect(result.precipitacion_pct).toBe(85)
    expect(result.precipitacion_mm).toBe(14.2)
    expect(result.weathercode).toBe(61)
  })

  it('incluye lat/lng en la URL de la petición', async () => {
    const fetch = crearFetchMock(RESPUESTA_TIPICA)
    await getForecast(-1.2345, -79.5678, { fetchClient: fetch as any })

    const url = fetch.mock.calls[0][0] as string
    expect(url).toContain('latitude=-1.2345')
    expect(url).toContain('longitude=-79.5678')
  })

  it('solicita los campos daily necesarios', async () => {
    const fetch = crearFetchMock(RESPUESTA_TIPICA)
    await getForecast(-1.2345, -79.5678, { fetchClient: fetch as any })

    const url = fetch.mock.calls[0][0] as string
    expect(url).toContain('precipitation_probability_max')
    expect(url).toContain('precipitation_sum')
    expect(url).toContain('weathercode')
  })

  it('lanza error si la API responde con error HTTP', async () => {
    const fetch = crearFetchMock({}, false)
    await expect(getForecast(-1.2345, -79.5678, { fetchClient: fetch as any })).rejects.toThrow('HTTP 500')
  })

  it('devuelve 0 si el índice de mañana es undefined', async () => {
    const respuestaVacia = {
      daily: {
        time: ['2026-04-24'],
        precipitation_probability_max: [10],
        precipitation_sum: [0],
        weathercode: [1],
      },
    }
    const fetch = crearFetchMock(respuestaVacia)
    const result = await getForecast(-1.2345, -79.5678, { fetchClient: fetch as any })
    expect(result.precipitacion_pct).toBe(0)
  })
})
