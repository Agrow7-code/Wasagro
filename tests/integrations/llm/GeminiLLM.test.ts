import { describe, expect, it, vi } from 'vitest'
import { GeminiLLM } from '../../../src/integrations/llm/GeminiLLM.js'
import { LLMError } from '../../../src/integrations/llm/LLMError.js'
import type { EntradaEvento } from '../../../src/types/dominio/EventoCampo.js'

const entradaMock: EntradaEvento = {
  transcripcion: 'Apliqué 2 bombadas de mancozeb en lote 3',
  finca_id: 'F001',
  usuario_id: 'usr-123',
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

function crearSdkMock(responseText: string) {
  return {
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => responseText },
      }),
    }),
  }
}

function crearLangfuseMock() {
  const generation = { end: vi.fn() }
  const trace = { startGeneration: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace), _generation: generation, _trace: trace }
}

describe('GeminiLLM', () => {
  describe('extraerEvento', () => {
    it('parsea respuesta JSON válida del SDK', async () => {
      const sdk = crearSdkMock(JSON.stringify(respuestaEventoMock))
      const lf = crearLangfuseMock()
      const llm = new GeminiLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

      const resultado = await llm.extraerEvento(entradaMock, 'trace-001')
      expect(resultado.tipo_evento).toBe('insumo')
      expect(resultado.campos_extraidos['producto']).toBe('mancozeb')
      expect(resultado.campos_extraidos['dosis_cantidad']).toBe(2)
      expect(resultado.fecha_evento).toBeNull()
    })

    it('llama a LangFuse con traceId (P4)', async () => {
      const sdk = crearSdkMock(JSON.stringify(respuestaEventoMock))
      const lf = crearLangfuseMock()
      const llm = new GeminiLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

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
      const llm = new GeminiLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

      await expect(llm.extraerEvento(entradaMock, 'trace-001')).rejects.toThrow(LLMError)
      await expect(llm.extraerEvento(entradaMock, 'trace-001')).rejects.toMatchObject({ code: 'GEMINI_ERROR' })
    })

    it('lanza LLMError PARSE_ERROR si la respuesta no es JSON válido', async () => {
      const sdk = crearSdkMock('esto no es json')
      const lf = crearLangfuseMock()
      const llm = new GeminiLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

      await expect(llm.extraerEvento(entradaMock, 'trace-001')).rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })
  })

  describe('onboardar — Regla 2: máximo 2 preguntas', () => {
    it('retorna fallback sin llamar al LLM cuando preguntas_realizadas >= 2', async () => {
      const sdk = crearSdkMock('{}')
      const lf = crearLangfuseMock()
      const llm = new GeminiLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })
      const contexto = { historial: [], preguntas_realizadas: 2, datos_recolectados: {} }

      const resultado = await llm.onboardar('hola', contexto, 'trace-003')

      expect(resultado.onboarding_completo).toBe(false)
      expect(resultado.siguiente_pregunta).toBeNull()
      expect(sdk.getGenerativeModel).not.toHaveBeenCalled()
    })
  })
})
