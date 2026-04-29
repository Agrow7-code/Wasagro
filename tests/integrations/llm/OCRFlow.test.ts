import { describe, expect, it, vi, beforeEach } from 'vitest'
import { WasagroAIAgent } from '../../../src/integrations/llm/WasagroAIAgent.js'
import type { ILLMAdapter, LLMGeneracionOpciones } from '../../../src/integrations/llm/ILLMAdapter.js'
import type { ContextoOCR } from '../../../src/integrations/llm/IWasagroLLM.js'
import { ResultadoOCRSchema } from '../../../src/types/dominio/OCR.js'

vi.mock('../../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: () => ({
      generation: () => ({ end: vi.fn() }),
      event: vi.fn(),
    }),
  },
}))

vi.mock('../../../src/pipeline/promptManager.js', () => ({
  PromptManager: {
    getPrompt: vi.fn().mockResolvedValue('Prompt de OCR con {{FINCA_NOMBRE}} {{CULTIVO_PRINCIPAL}} {{LISTA_LOTES}}'),
  },
}))

vi.mock('../../../src/agents/mcp/SupabaseTools.js', () => ({
  SupabaseTools: {},
}))

vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: {},
  createSupabaseClient: vi.fn(),
}))

function createMockAdapter(response: string): ILLMAdapter {
  return {
    generarTexto: vi.fn().mockResolvedValue(response),
  }
}

describe('WasagroAIAgent.extraerDocumentoOCR — flujo con tier OCR', () => {
  let agent: WasagroAIAgent

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('usa modelClass ocr cuando se llama a extraerDocumentoOCR', async () => {
    const mockResponse = JSON.stringify({
      tipo_documento: 'planilla_aplicacion',
      fecha_documento: '2026-04-15',
      registros: [{
        fila: 1,
        lote_raw: 'Lote 3',
        lote_id: null,
        actividad: 'Aplicación fungicida',
        producto: 'Entrust',
        cantidad: 20,
        unidad: 'litros',
        trabajadores: 5,
        monto: 45.0,
        fecha_raw: '15/04',
        notas: null,
        ilegible: false,
      }],
      texto_completo_visible: 'Planilla del 15 de abril...',
      confianza_lectura: 0.85,
      advertencia: null,
    })

    const adapter = createMockAdapter(mockResponse)
    agent = new WasagroAIAgent(adapter, { trace: () => ({ generation: () => ({ end: vi.fn() }), event: vi.fn() }) } as any)

    const resultado = await agent.extraerDocumentoOCR(
      'base64data',
      'image/jpeg',
      { finca_nombre: 'Finca Test', cultivo_principal: 'Banano', lista_lotes: '- Lote 3' },
      'trace-ocr-001',
    )

    expect(adapter.generarTexto).toHaveBeenCalledOnce()
    const callOpts = (adapter.generarTexto as ReturnType<typeof vi.fn>).mock.calls[0][1] as LLMGeneracionOpciones
    expect(callOpts.modelClass).toBe('ocr')
    expect(callOpts.imageBase64).toBe('base64data')
    expect(callOpts.imageMimeType).toBe('image/jpeg')
    expect(callOpts.responseFormat).toBe('json_object')

    expect(resultado.tipo_documento).toBe('planilla_aplicacion')
    expect(resultado.registros).toHaveLength(1)
    expect(resultado.registros[0].cantidad).toBe(20)
    expect(resultado.registros[0].monto).toBe(45.0)
    expect(resultado.confianza_lectura).toBe(0.85)
  })

  it('valida con Zod y rechaza tipos incorrectos — hace fallback graceful', async () => {
    const mockResponse = JSON.stringify({
      tipo_documento: 'planilla_aplicacion',
      fecha_documento: '2026-04-15',
      registros: [{
        fila: 1,
        lote_raw: null,
        lote_id: null,
        actividad: null,
        producto: null,
        cantidad: { valor: 20 },
        unidad: null,
        trabajadores: null,
        monto: '$$$',
        fecha_raw: null,
        notas: null,
        ilegible: false,
      }],
      texto_completo_visible: '',
      confianza_lectura: 0.5,
      advertencia: null,
    })

    const adapter = createMockAdapter(mockResponse)
    agent = new WasagroAIAgent(adapter, { trace: () => ({ generation: () => ({ end: vi.fn() }), event: vi.fn() }) } as any)

    const resultado = await agent.extraerDocumentoOCR(
      'base64data',
      'image/jpeg',
      { finca_nombre: 'Finca Test', cultivo_principal: 'Banano', lista_lotes: '- Lote 3' },
      'trace-ocr-002',
    )

    expect(resultado.advertencia).toContain('zod_validation_issues')
    expect(resultado.registros[0].cantidad).toBeNull()
    expect(resultado.registros[0].monto).toBeNull()
  })

  it('maneja confianza_lectura baja con advertencia de imagen borrosa', async () => {
    const mockResponse = JSON.stringify({
      tipo_documento: 'otro',
      fecha_documento: null,
      registros: [],
      texto_completo_visible: '',
      confianza_lectura: 0,
      advertencia: 'imagen borrosa',
    })

    const adapter = createMockAdapter(mockResponse)
    agent = new WasagroAIAgent(adapter, { trace: () => ({ generation: () => ({ end: vi.fn() }), event: vi.fn() }) } as any)

    const resultado = await agent.extraerDocumentoOCR(
      'base64borrosa',
      'image/jpeg',
      {},
      'trace-ocr-003',
    )

    expect(resultado.confianza_lectura).toBe(0)
    expect(resultado.advertencia).toContain('imagen borrosa')
  })

  it('transforma monto string con símbolo de moneda a número vía Zod', async () => {
    const mockResponse = JSON.stringify({
      tipo_documento: 'registro_gastos',
      fecha_documento: null,
      registros: [{
        fila: 1,
        lote_raw: null,
        lote_id: null,
        actividad: 'Compra insumos',
        producto: 'Entrust',
        cantidad: '2.5',
        unidad: 'litros',
        trabajadores: null,
        monto: '$45.50',
        fecha_raw: null,
        notas: null,
        ilegible: false,
      }],
      texto_completo_visible: 'Gastos de la semana',
      confianza_lectura: 0.9,
      advertencia: null,
    })

    const adapter = createMockAdapter(mockResponse)
    agent = new WasagroAIAgent(adapter, { trace: () => ({ generation: () => ({ end: vi.fn() }), event: vi.fn() }) } as any)

    const resultado = await agent.extraerDocumentoOCR(
      'base64data',
      'image/jpeg',
      {},
      'trace-ocr-004',
    )

    expect(resultado.registros[0].cantidad).toBe(2.5)
    expect(resultado.registros[0].monto).toBe(45.5)
  })
})

describe('WasagroAIAgent.clasificarTipoImagen — usa tier fast', () => {
  it('usa modelClass fast para clasificación visual', async () => {
    const mockResponse = JSON.stringify({ tipo: 'documento_tabla', confianza: 0.95 })
    const adapter = createMockAdapter(mockResponse)

    const agent = new WasagroAIAgent(adapter, { trace: () => ({ generation: () => ({ end: vi.fn() }), event: vi.fn() }) } as any)

    const tipo = await agent.clasificarTipoImagen('base64data', 'image/jpeg', 'trace-cls-001')

    expect(adapter.generarTexto).toHaveBeenCalledOnce()
    const callOpts = (adapter.generarTexto as ReturnType<typeof vi.fn>).mock.calls[0][1] as LLMGeneracionOpciones
    expect(callOpts.modelClass).toBe('fast')
    expect(tipo).toBe('documento_tabla')
  })
})

describe('LLMRouter — tier OCR fallback a ultra', () => {
  it('fallback a ultra cuando no hay adapters OCR', async () => {
    const { LLMRouter } = await import('../../../src/integrations/llm/LLMRouter.js')
    const ultraAdapter: ILLMAdapter = { generarTexto: vi.fn().mockResolvedValue('respuesta-ultra') }

    const router = new LLMRouter([
      { name: 'Ultra-Gemini', adapter: ultraAdapter, tier: 'ultra' },
      { name: 'Ultra-Gemini-OCR', adapter: ultraAdapter, tier: 'ocr' },
    ])

    const result = await router.generarTexto('Extrae datos', {
      traceId: 'trace-router-001',
      generationName: 'ocr_test',
      modelClass: 'ocr',
    })

    expect(result).toBe('respuesta-ultra')
  })

  it('lanza error si no hay adapters para tier OCR ni fallback', async () => {
    const { LLMRouter } = await import('../../../src/integrations/llm/LLMRouter.js')
    const fastAdapter: ILLMAdapter = { generarTexto: vi.fn().mockResolvedValue('respuesta-fast') }

    const router = new LLMRouter([
      { name: 'Groq', adapter: fastAdapter, tier: 'fast' },
    ])

    await expect(router.generarTexto('Extrae datos', {
      traceId: 'trace-router-002',
      generationName: 'ocr_test',
      modelClass: 'ocr',
    })).rejects.toThrow('No hay adaptadores configurados para el tier: ocr')
  })
})
