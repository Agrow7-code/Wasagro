import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({ supabase: {} }))
vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn() }) },
}))
vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getFincasActivas: vi.fn(),
  getAdminsByFinca: vi.fn(),
}))

import { buildMensajePrecio, enviarAlertasPrecio } from '../../src/pipeline/alertaPrecio.js'
import { getFincasActivas, getAdminsByFinca } from '../../src/pipeline/supabaseQueries.js'

// ─── buildMensajePrecio ───────────────────────────────────────────────────────

describe('buildMensajePrecio', () => {
  it('retorna mensaje de subida con 📈', () => {
    const msg = buildMensajePrecio('Juan', 5.00, 4.50, '24.04.2026')
    expect(msg).not.toBeNull()
    expect(msg).toContain('📈')
    expect(msg).toContain('subió')
    expect(msg).toContain('$5.00')
    expect(msg).toContain('$4.50')
  })

  it('retorna mensaje de bajada con 📉', () => {
    const msg = buildMensajePrecio('María', 4.00, 5.00, '24.04.2026')
    expect(msg).toContain('📉')
    expect(msg).toContain('bajó')
    expect(msg).toContain('$4.00')
  })

  it('retorna null si el precio no cambió', () => {
    expect(buildMensajePrecio('Juan', 5.00, 5.00, '24.04.2026')).toBeNull()
  })

  it('usa solo el primer nombre', () => {
    const msg = buildMensajePrecio('Juan Carlos Mora', 5.00, 4.50, '24.04.2026')
    expect(msg).toContain('Juan,')
    expect(msg).not.toContain('Carlos')
  })

  it('funciona sin nombre (null)', () => {
    const msg = buildMensajePrecio(null, 5.00, 4.50, '24.04.2026')
    expect(msg).not.toBeNull()
    expect(msg).toContain('📈')
  })
})

// ─── enviarAlertasPrecio ──────────────────────────────────────────────────────

describe('enviarAlertasPrecio', () => {
  function crearSenderMock() {
    return { enviarTexto: vi.fn().mockResolvedValue(undefined) }
  }

  const preciosSubida = [
    { fecha: '24.04.2026', precio: 5.00 },
    { fecha: '17.04.2026', precio: 4.50 },
  ] as const

  const preciosSinCambio = [
    { fecha: '24.04.2026', precio: 5.00 },
    { fecha: '17.04.2026', precio: 5.00 },
  ] as const

  it('envía alerta solo a fincas bananeras cuando el precio cambió', async () => {
    vi.mocked(getFincasActivas).mockResolvedValue([
      { finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Banana', pais: 'EC', cultivo_principal: 'banano' },
      { finca_id: 'F002', org_id: 'ORG001', nombre: 'Finca Cacao', pais: 'EC', cultivo_principal: 'cacao' },
    ])
    vi.mocked(getAdminsByFinca).mockResolvedValue([
      { id: 'u1', phone: '593987654321', nombre: 'Juan', rol: 'propietario' },
    ])
    const getPreciosFn = vi.fn().mockResolvedValue(preciosSubida)
    const sender = crearSenderMock()

    const result = await enviarAlertasPrecio(sender as any, { getPreciosFn })

    // Solo F001 (banano) debe recibir alerta
    expect(sender.enviarTexto).toHaveBeenCalledOnce()
    expect(sender.enviarTexto.mock.calls[0][1]).toContain('📈')
    expect(result.enviadas).toBe(1)
  })

  it('no envía si el precio no cambió', async () => {
    vi.mocked(getFincasActivas).mockResolvedValue([
      { finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Banana', pais: 'EC', cultivo_principal: 'banano' },
    ])
    vi.mocked(getAdminsByFinca).mockResolvedValue([
      { id: 'u1', phone: '593987654321', nombre: 'Juan', rol: 'propietario' },
    ])
    const getPreciosFn = vi.fn().mockResolvedValue(preciosSinCambio)
    const sender = crearSenderMock()

    const result = await enviarAlertasPrecio(sender as any, { getPreciosFn })

    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(result.enviadas).toBe(0)
  })

  it('no envía nada si getUltimosPreciosBanano retorna null', async () => {
    const getPreciosFn = vi.fn().mockResolvedValue(null)
    const sender = crearSenderMock()

    const result = await enviarAlertasPrecio(sender as any, { getPreciosFn })

    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(result).toEqual({ enviadas: 0, errores: 0 })
  })

  it('cuenta error si el fetch de precios falla', async () => {
    const getPreciosFn = vi.fn().mockRejectedValue(new Error('timeout'))
    const sender = crearSenderMock()

    const result = await enviarAlertasPrecio(sender as any, { getPreciosFn })

    expect(result.errores).toBe(1)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('no envía a fincas sin cultivo_principal banano/banana', async () => {
    vi.mocked(getFincasActivas).mockResolvedValue([
      { finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Café', pais: 'GT', cultivo_principal: 'cafe' },
    ])
    const getPreciosFn = vi.fn().mockResolvedValue(preciosSubida)
    const sender = crearSenderMock()

    await enviarAlertasPrecio(sender as any, { getPreciosFn })

    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })
})
