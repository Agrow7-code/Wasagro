import { describe, expect, it, vi } from 'vitest'
import { OllamaLLM } from '../../../src/integrations/llm/OllamaLLM.js'
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
  confidence_score: 0.85,
  campos_extraidos: {
    producto: 'mancozeb',
    dosis_cantidad: 2,
    dosis_unidad: 'bombadas',
  },
  confidence_por_campo: { tipo_evento: 0.85, lote_id: 0.75 },
  campos_faltantes: [],
  requiere_clarificacion: false,
  pregunta_sugerida: null,
}

function crearHttpMock(respuesta: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message: { content: JSON.stringify(respuesta) } }),
  })
}

function crearLangfuseMock() {
  const generation = { end: vi.fn() }
  const trace = { startGeneration: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace) }
}

describe('OllamaLLM', () => {
  describe('extraerEvento', () => {
    it('parsea respuesta JSON válida', async () => {
      const fetch = crearHttpMock(respuestaEventoMock)
      const lf = crearLangfuseMock()
      const llm = new OllamaLLM({ fetchClient: fetch as any, langfuseClient: lf as any })

      const resultado = await llm.extraerEvento(entradaMock, 'trace-002')
      expect(resultado.tipo_evento).toBe('insumo')
      expect(resultado.campos_extraidos['producto']).toBe('mancozeb')
      expect(resultado.campos_extraidos['dosis_cantidad']).toBe(2)
    })

    it('llama a LangFuse con traceId (P4)', async () => {
      const fetch = crearHttpMock(respuestaEventoMock)
      const lf = crearLangfuseMock()
      const llm = new OllamaLLM({ fetchClient: fetch as any, langfuseClient: lf as any })

      await llm.extraerEvento(entradaMock, 'trace-002')
      expect(lf.trace).toHaveBeenCalledWith(expect.objectContaining({ id: 'trace-002' }))
    })

    it('lanza LLMError OLLAMA_UNAVAILABLE en connection refused', async () => {
      const fetchFail = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
      const lf = crearLangfuseMock()
      const llm = new OllamaLLM({ fetchClient: fetchFail as any, langfuseClient: lf as any })

      await expect(llm.extraerEvento(entradaMock, 'trace-002')).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' })
    })

    it('lanza LLMError PARSE_ERROR si respuesta no es JSON', async () => {
      const fetchBad = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: 'esto no es json' } }),
      })
      const lf = crearLangfuseMock()
      const llm = new OllamaLLM({ fetchClient: fetchBad as any, langfuseClient: lf as any })

      await expect(llm.extraerEvento(entradaMock, 'trace-002')).rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })
  })

  describe('onboardar — Regla 2: máximo 2 preguntas', () => {
    it('retorna fallback sin llamar al LLM cuando preguntas_realizadas >= 2', async () => {
      const fetch = crearHttpMock({})
      const lf = crearLangfuseMock()
      const llm = new OllamaLLM({ fetchClient: fetch as any, langfuseClient: lf as any })
      const contexto = { historial: [], preguntas_realizadas: 2, datos_recolectados: {} }

      const resultado = await llm.onboardar('hola', contexto, 'trace-003')

      expect(resultado.onboarding_completo).toBe(false)
      expect(resultado.siguiente_pregunta).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
