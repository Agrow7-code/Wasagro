import { describe, expect, it, vi } from 'vitest'
import { OllamaAdapter } from '../../../src/integrations/llm/OllamaAdapter.js'
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

function crearHttpMock(responses: any[]) {
  const fetchMock = vi.fn()
  responses.forEach(r => fetchMock.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }) }))
  fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ message: { content: typeof responses[responses.length - 1] === 'string' ? responses[responses.length - 1] : JSON.stringify(responses[responses.length - 1]) } }) })
  return fetchMock
}

function crearLangfuseMock() {
  const generation = { end: vi.fn() }
  const trace = { generation: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace), _generation: generation, _trace: trace }
}

describe('OllamaLLM', () => {
  describe('extraerEvento', () => {
    it('parsea respuesta JSON válida', async () => {
      const fetch = crearHttpMock([respuestaClasificacion, respuestaEventoMock])
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new OllamaAdapter({ fetchClient: fetch as any }), lf as any)

      const resultado = await llm.extraerEvento(entradaMock, 'trace-002')
      expect(resultado.tipo_evento).toBe('insumo')
      expect(resultado.campos_extraidos['producto']).toBe('mancozeb')
    })

    it('llama a LangFuse con traceId (P4)', async () => {
      const fetch = crearHttpMock([respuestaClasificacion, respuestaEventoMock])
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new OllamaAdapter({ fetchClient: fetch as any }), lf as any)

      await llm.extraerEvento(entradaMock, 'trace-002')
      expect(lf.trace).toHaveBeenCalledWith(expect.objectContaining({ id: 'trace-002' }))
    })

    it('lanza LLMError OLLAMA_UNAVAILABLE en connection refused', async () => {
      const fetchFail = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new OllamaAdapter({ fetchClient: fetchFail as any }), lf as any)

      await expect(llm.extraerEvento(entradaMock, 'trace-002')).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' })
    })

    it('lanza LLMError PARSE_ERROR si respuesta no es JSON', async () => {
      const fetchBad = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ message: { content: 'esto no es json' } }),
      })
      const lf = crearLangfuseMock()
      const llm = new WasagroAIAgent(new OllamaAdapter({ fetchClient: fetchBad as any }), lf as any)

      await expect(llm.extraerEvento(entradaMock, 'trace-002')).rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })
  })
})
