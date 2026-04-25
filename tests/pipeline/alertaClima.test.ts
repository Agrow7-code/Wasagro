import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({ supabase: {} }))
vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({ event: vi.fn() }),
  },
}))

import { buildMensajeAlerta, enviarAlertasClima } from '../../src/pipeline/alertaClima.js'
import type { ForecastManana } from '../../src/integrations/weather/OpenMeteoClient.js'

// ─── buildMensajeAlerta ───────────────────────────────────────────────────────

describe('buildMensajeAlerta', () => {
  const base: ForecastManana = { precipitacion_pct: 0, precipitacion_mm: 0, weathercode: 1 }

  it('retorna null si lluvia < 60%', () => {
    expect(buildMensajeAlerta('Juan', { ...base, precipitacion_pct: 59 })).toBeNull()
  })

  it('retorna mensaje de lluvia leve con 60-79%', () => {
    const msg = buildMensajeAlerta('Juan', { ...base, precipitacion_pct: 65 })
    expect(msg).not.toBeNull()
    expect(msg).toContain('65%')
    expect(msg).toContain('🌦️')
  })

  it('retorna mensaje de lluvia fuerte con >= 80%', () => {
    const msg = buildMensajeAlerta('María', { ...base, precipitacion_pct: 85, precipitacion_mm: 12 })
    expect(msg).not.toBeNull()
    expect(msg).toContain('85%')
    expect(msg).toContain('🌧️')
    expect(msg).toContain('12 mm')
  })

  it('retorna mensaje de tormenta con weathercode >= 95', () => {
    const msg = buildMensajeAlerta('Juan', { ...base, precipitacion_pct: 40, weathercode: 95 })
    expect(msg).not.toBeNull()
    expect(msg).toContain('⛈️')
    expect(msg).toContain('tormenta')
  })

  it('tormenta tiene prioridad sobre lluvia', () => {
    const msg = buildMensajeAlerta('Juan', { precipitacion_pct: 90, precipitacion_mm: 20, weathercode: 99 })
    expect(msg).toContain('⛈️')
    expect(msg).not.toContain('🌧️')
  })

  it('usa solo el primer nombre del admin', () => {
    const msg = buildMensajeAlerta('Juan Carlos Pérez', { ...base, precipitacion_pct: 70 })
    expect(msg).toContain('Juan,')
    expect(msg).not.toContain('Carlos')
  })

  it('funciona sin nombre (nombre null)', () => {
    const msg = buildMensajeAlerta(null, { ...base, precipitacion_pct: 75 })
    expect(msg).not.toBeNull()
    expect(msg).toContain('75%')
  })
})

// ─── enviarAlertasClima ───────────────────────────────────────────────────────

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getFincasConCoordenadas: vi.fn(),
  getAdminsByFinca: vi.fn(),
}))

import { getFincasConCoordenadas, getAdminsByFinca } from '../../src/pipeline/supabaseQueries.js'

describe('enviarAlertasClima', () => {
  function crearSenderMock() {
    return { enviarTexto: vi.fn().mockResolvedValue(undefined) }
  }

  it('envía alerta a admins cuando hay lluvia >= 60%', async () => {
    vi.mocked(getFincasConCoordenadas).mockResolvedValue([
      { finca_id: 'F001', nombre: 'Finca Prueba', cultivo_principal: 'cacao', lat: -1.23, lng: -79.56 },
    ])
    vi.mocked(getAdminsByFinca).mockResolvedValue([
      { id: 'u1', phone: '593987654321', nombre: 'Juan Campo', rol: 'propietario' },
    ])
    const getForecastFn = vi.fn().mockResolvedValue({ precipitacion_pct: 80, precipitacion_mm: 10, weathercode: 61 })
    const sender = crearSenderMock()

    const result = await enviarAlertasClima(sender as any, { getForecastFn })

    expect(sender.enviarTexto).toHaveBeenCalledOnce()
    expect(sender.enviarTexto.mock.calls[0][0]).toBe('593987654321')
    expect(sender.enviarTexto.mock.calls[0][1]).toContain('80%')
    expect(result.enviadas).toBe(1)
    expect(result.errores).toBe(0)
  })

  it('no envía si la lluvia < 60%', async () => {
    vi.mocked(getFincasConCoordenadas).mockResolvedValue([
      { finca_id: 'F001', nombre: 'Finca Prueba', cultivo_principal: 'cacao', lat: -1.23, lng: -79.56 },
    ])
    vi.mocked(getAdminsByFinca).mockResolvedValue([
      { id: 'u1', phone: '593987654321', nombre: 'Juan', rol: 'propietario' },
    ])
    const getForecastFn = vi.fn().mockResolvedValue({ precipitacion_pct: 30, precipitacion_mm: 0, weathercode: 1 })
    const sender = crearSenderMock()

    const result = await enviarAlertasClima(sender as any, { getForecastFn })

    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(result.enviadas).toBe(0)
  })

  it('no envía si la finca no tiene admins', async () => {
    vi.mocked(getFincasConCoordenadas).mockResolvedValue([
      { finca_id: 'F001', nombre: 'Finca Prueba', cultivo_principal: 'cacao', lat: -1.23, lng: -79.56 },
    ])
    vi.mocked(getAdminsByFinca).mockResolvedValue([])
    const getForecastFn = vi.fn().mockResolvedValue({ precipitacion_pct: 90, precipitacion_mm: 20, weathercode: 61 })
    const sender = crearSenderMock()

    const result = await enviarAlertasClima(sender as any, { getForecastFn })

    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(result.enviadas).toBe(0)
  })

  it('cuenta errores y continúa con otras fincas si una falla', async () => {
    vi.mocked(getFincasConCoordenadas).mockResolvedValue([
      { finca_id: 'F001', nombre: 'Finca 1', cultivo_principal: null, lat: -1.23, lng: -79.56 },
      { finca_id: 'F002', nombre: 'Finca 2', cultivo_principal: null, lat: -2.34, lng: -78.45 },
    ])
    vi.mocked(getAdminsByFinca).mockResolvedValue([
      { id: 'u1', phone: '593987654321', nombre: 'Juan', rol: 'propietario' },
    ])
    const getForecastFn = vi.fn()
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce({ precipitacion_pct: 80, precipitacion_mm: 10, weathercode: 61 })
    const sender = crearSenderMock()

    const result = await enviarAlertasClima(sender as any, { getForecastFn })

    expect(result.errores).toBe(1)
    expect(result.enviadas).toBe(1)
    expect(sender.enviarTexto).toHaveBeenCalledOnce()
  })

  it('retorna 0/0 si no hay fincas con coordenadas', async () => {
    vi.mocked(getFincasConCoordenadas).mockResolvedValue([])
    const sender = crearSenderMock()

    const result = await enviarAlertasClima(sender as any)

    expect(result).toEqual({ enviadas: 0, errores: 0 })
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })
})
