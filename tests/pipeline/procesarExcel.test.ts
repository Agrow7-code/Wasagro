import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleDocumento, procesarFilasExcelConfirmadas } from '../../src/pipeline/procesarExcel.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn(), id: 'trace-mock' }) },
}))

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getOrCreateSession: vi.fn(),
  updateSession: vi.fn().mockResolvedValue(undefined),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  saveEvento: vi.fn().mockResolvedValue('evt-001'),
}))

import * as queries from '../../src/pipeline/supabaseQueries.js'

// ─── fixtures ─────────────────────────────────────────────────────────────────

const csvVentas = `fecha,cantidad_qq,precio_qq,comprador
2026-04-01,10,120,Exportadora Oro
2026-04-05,15,118,Don Pedro
2026-04-10,8,125,Exportadora Sur`

const usuarioBase = { id: 'u1', finca_id: 'F001', finca_nombre: 'Finca Uno', cultivo_principal: 'cacao' }
const sessionBase = { session_id: 'ses-1', status: 'active', clarification_count: 0, contexto_parcial: {} }

function crearMsg(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    wamid: 'wamid-xlsx-1',
    from: '593987654321',
    timestamp: new Date(),
    tipo: 'documento',
    rawPayload: {},
    documentoUrl: 'https://example.com/ventas.csv',
    documentoNombre: 'ventas.csv',
    documentoMimetype: 'text/csv',
    ...overrides,
  }
}

function crearSender() {
  return { enviarTexto: vi.fn().mockResolvedValue(undefined) }
}

function crearLlm(clasificacion = {
  tipo_datos: 'venta' as const,
  filas_detectadas: 3,
  columnas_detectadas: ['fecha', 'cantidad_qq', 'precio_qq', 'comprador'],
  cultivo_detectado: 'cacao',
  confianza: 0.92,
  mensaje_confirmacion: 'Recibí tu archivo con 3 filas de registros de *venta*. ¿Los proceso? Responde *sí* o *no*. ✅',
}) {
  return { clasificarExcel: vi.fn().mockResolvedValue(clasificacion) }
}

function csvToArrayBuffer(csv: string): ArrayBuffer {
  const enc = new TextEncoder()
  return enc.encode(csv).buffer
}

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: () => Promise.resolve(csvToArrayBuffer(csvVentas)),
}) as unknown as typeof fetch

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleDocumento', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionBase as any)
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(csvToArrayBuffer(csvVentas)),
    })
  })

  it('sin finca → avisa al usuario, no llama al LLM', async () => {
    const sender = crearSender()
    const llm = crearLlm()
    await handleDocumento(crearMsg(), { id: 'u1', finca_id: null }, 'msg-1', 'trace-1', sender, llm as any)

    expect(llm.clasificarExcel).not.toHaveBeenCalled()
    expect(sender.enviarTexto).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('registrar tu finca'))
  })

  it('CSV válido → clasifica con LLM y manda confirmación al usuario', async () => {
    const sender = crearSender()
    const llm = crearLlm()
    await handleDocumento(crearMsg(), usuarioBase, 'msg-1', 'trace-1', sender, llm as any)

    expect(llm.clasificarExcel).toHaveBeenCalledWith(
      expect.objectContaining({ nombre_archivo: 'ventas.csv', total_filas: 3 }),
      'trace-1',
    )
    expect(sender.enviarTexto).toHaveBeenCalledWith(
      '593987654321',
      expect.stringContaining('Recibí tu archivo'),
    )
  })

  it('guarda session con status pending_excel_confirm y filas en contexto_parcial', async () => {
    const sender = crearSender()
    const llm = crearLlm()
    await handleDocumento(crearMsg(), usuarioBase, 'msg-1', 'trace-1', sender, llm as any)

    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-1',
      expect.objectContaining({
        status: 'pending_excel_confirm',
        contexto_parcial: expect.objectContaining({
          excel_tipo: 'venta',
          excel_filas: expect.any(Array),
        }),
      }),
    )
  })

  it('tipo desconocido → envía mensaje LLM, NO guarda session pending', async () => {
    const sender = crearSender()
    const llm = crearLlm({
      tipo_datos: 'desconocido' as const,
      filas_detectadas: 3,
      columnas_detectadas: ['col1'],
      cultivo_detectado: null,
      confianza: 0.3,
      mensaje_confirmacion: 'No pude identificar qué tipo de datos tiene tu archivo.',
    })
    await handleDocumento(crearMsg(), usuarioBase, 'msg-1', 'trace-1', sender, llm as any)

    expect(queries.updateSession).not.toHaveBeenCalled()
    expect(sender.enviarTexto).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('No pude identificar'))
  })

  it('fetch falla → lanza error (no swallowed)', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    const sender = crearSender()
    const llm = crearLlm()

    await expect(handleDocumento(crearMsg(), usuarioBase, 'msg-1', 'trace-1', sender, llm as any))
      .rejects.toThrow('Error descargando archivo')
  })

  it('CSV vacío → avisa al usuario, no guarda session', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })
    const sender = crearSender()
    const llm = crearLlm()
    await handleDocumento(crearMsg(), usuarioBase, 'msg-1', 'trace-1', sender, llm as any)

    expect(llm.clasificarExcel).not.toHaveBeenCalled()
    expect(sender.enviarTexto).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('vacío'))
    expect(queries.updateSession).not.toHaveBeenCalled()
  })

  it('usa punto y coma como separador en CSV europeo', async () => {
    const csvEuro = 'fecha;cantidad;precio\n2026-04-01;10;120\n2026-04-02;5;115'
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(csvToArrayBuffer(csvEuro)),
    })
    const sender = crearSender()
    const llm = crearLlm()
    await handleDocumento(crearMsg({ documentoNombre: 'data.csv' }), usuarioBase, 'msg-1', 'trace-1', sender, llm as any)

    expect(llm.clasificarExcel).toHaveBeenCalledWith(
      expect.objectContaining({ columnas: ['fecha', 'cantidad', 'precio'] }),
      'trace-1',
    )
  })
})

describe('procesarFilasExcelConfirmadas', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserta todas las filas y retorna conteo correcto', async () => {
    vi.mocked(queries.saveEvento).mockResolvedValue('evt-ok')
    const contexto = {
      excel_tipo: 'venta',
      excel_filas: [
        { fecha: '2026-04-01', cantidad_qq: 10, precio_qq: 120, comprador: 'Exportadora' },
        { fecha: '2026-04-05', cantidad_qq: 15, precio_qq: 118, comprador: 'Don Pedro' },
      ],
    }

    const result = await procesarFilasExcelConfirmadas(contexto, 'u1', 'F001', 'trace-x')

    expect(queries.saveEvento).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ insertados: 2, errores: 0 })
  })

  it('fila con error → no detiene el lote, cuenta en errores', async () => {
    vi.mocked(queries.saveEvento)
      .mockResolvedValueOnce('evt-1')
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce('evt-3')
    const contexto = {
      excel_tipo: 'gasto',
      excel_filas: [
        { monto: 100, descripcion: 'Mancozeb' },
        { monto: null, descripcion: null },
        { monto: 50, descripcion: 'Jornales' },
      ],
    }

    const result = await procesarFilasExcelConfirmadas(contexto, 'u1', 'F001', 'trace-y')

    expect(result).toEqual({ insertados: 2, errores: 1 })
  })

  it('tipo mixto → inserta como nota_libre', async () => {
    vi.mocked(queries.saveEvento).mockResolvedValue('evt-mix')
    const contexto = {
      excel_tipo: 'mixto',
      excel_filas: [{ col1: 'val1' }],
    }

    await procesarFilasExcelConfirmadas(contexto, 'u1', 'F001', 'trace-z')

    expect(queries.saveEvento).toHaveBeenCalledWith(
      expect.objectContaining({ tipo_evento: 'nota_libre', requiere_validacion: true }),
    )
  })
})
