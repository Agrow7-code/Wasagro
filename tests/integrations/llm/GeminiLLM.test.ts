import { describe, expect, it, vi } from 'vitest'
import { GeminiAdapter } from '../../../src/integrations/llm/GeminiAdapter.js'
import { WasagroAIAgent } from '../../../src/integrations/llm/WasagroAIAgent.js'
import { LLMError } from '../../../src/integrations/llm/LLMError.js'
import type { EntradaEvento } from '../../../src/types/dominio/EventoCampo.js'

const entradaMock: EntradaEvento = {
  transcripcion: 'Apliqué 2 bombadas de mancozeb en lote 3',
  finca_id: 'F001',
  usuario_id: 'usr-123',
}

const respuestaClasificacion = {
  tipo_evento: 'insumo',
  confidence: 0.95,
  requiere_imagen_para_confirmar: false
}

const respuestaEventoMock = {
  tipo_evento: 'insumo',
  lote_id: 'F001-L03',
  fecha_evento: null,
  confidence_score: 0.90,
  campos_extraidos: {
    producto: 'mancozeb',
    dosis_cantidad: 2,
    dosis_unidad: 'bombadas',
  },
  confidence_por_campo: { tipo_evento: 0.95, lote_id: 0.80 },
  campos_faltantes: [],
  requiere_clarificacion: false,
  pregunta_sugerida: null,
}

function crearSdkMock(responses: string[]) {
  const generateContent = vi.fn()
  responses.forEach(r => generateContent.mockResolvedValueOnce({ response: { text: () => r } }))
  // Fallback a ultimo
  generateContent.mockResolvedValue({ response: { text: () => responses[responses.length - 1] } })
  return {
    getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
  }
}

function crearLangfuseMock() {
  const generation = { end: vi.fn() }
  const trace = { generation: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace), _generation: generation, _trace: trace }
}

describe('GeminiLLM', () => {
  describe('extraerEvento', () => {
    it('parsea respuesta JSON válida del SDK', async () => {
      const sdk = crearSdkMock([JSON.stringify(respuestaClasificacion), JSON.stringify(respuestaEventoMock)])
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new GeminiAdapter({ apiKey: 'test-key', sdkClient: sdk as any }), lf as any)

      const resultado = await llm.extraerEvento(entradaMock, 'trace-001')
      expect(resultado.tipo_evento).toBe('insumo')
      expect(resultado.campos_extraidos['producto']).toBe('mancozeb')
      expect(resultado.campos_extraidos['dosis_cantidad']).toBe(2)
      expect(resultado.fecha_evento).toBeNull()
    })

    it('llama a LangFuse con traceId (P4)', async () => {
      const sdk = crearSdkMock([JSON.stringify(respuestaClasificacion), JSON.stringify(respuestaEventoMock)])
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new GeminiAdapter({ apiKey: 'test-key', sdkClient: sdk as any }), lf as any)

      await llm.extraerEvento(entradaMock, 'trace-001')
      expect(lf.trace).toHaveBeenCalledWith(expect.objectContaining({ id: 'trace-001' }))
    })

    it('lanza LLMError GEMINI_ERROR si el SDK falla', async () => {
      const sdk = {
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: vi.fn().mockRejectedValue(new Error('API key invalid')),
        }),
      }
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new GeminiAdapter({ apiKey: 'test-key', sdkClient: sdk as any }), lf as any)

      await expect(llm.extraerEvento(entradaMock, 'trace-001')).rejects.toThrow(LLMError)
      await expect(llm.extraerEvento(entradaMock, 'trace-001')).rejects.toMatchObject({ code: 'GEMINI_ERROR' })
    })

    it('lanza LLMError PARSE_ERROR si la respuesta no es JSON válido', async () => {
      const sdk = crearSdkMock(['esto no es json'])
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new GeminiAdapter({ apiKey: 'test-key', sdkClient: sdk as any }), lf as any)

      await expect(llm.extraerEvento(entradaMock, 'trace-001')).rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })
  })
})
