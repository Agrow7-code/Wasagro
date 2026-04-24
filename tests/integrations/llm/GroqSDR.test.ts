import { describe, expect, it, vi } from 'vitest'
import { GroqLLM } from '../../../src/integrations/llm/GroqLLM.js'
import { LLMError } from '../../../src/integrations/llm/LLMError.js'
import type { EntradaSDR } from '../../../src/types/dominio/SDRTypes.js'

vi.mock('../../../src/integrations/llm/sdrUtils.js', () => ({
  cargarSDRPrompt: vi.fn().mockReturnValue('system-prompt-sdr'),
  buildSDRContexto: vi.fn().mockReturnValue('contexto-mock'),
}))

const entradaMock: EntradaSDR = {
  mensaje: 'Tenemos 45 fincas en Ecuador',
  prospecto: {
    nombre: 'Carlos',
    empresa: 'Agrocuador',
    segmento_icp: 'exportadora',
    narrativa: 'A',
    score_total: 30,
    scores_por_dimension: {
      eudr_urgency: 10,
      tamano_cartera: 15,
      calidad_dato: 0,
      champion: 5,
      timeline_decision: 0,
      presupuesto: 0,
    },
    preguntas_realizadas: [],
    objeciones_manejadas: [],
    punto_de_dolor_principal: null,
  },
  narrativa: 'A',
  preguntas_realizadas: [],
  score_actual: 30,
  turno: 3,
  objection_detected: null,
  segmento_icp: 'exportadora',
}

const respuestaSDRMock = {
  respuesta: '¿Cuántas fincas tienes bajo manejo EUDR?',
  preguntas_respondidas: [],
  score_delta: { eudr_urgency: 0, tamano_cartera: 0, calidad_dato: 0, champion: 0, timeline_decision: 0, presupuesto: 0 },
  action: 'continue_discovery',
  objection_type: null,
  requires_founder_approval: false,
  deal_brief: null,
}

function crearOpenAIMock(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  }
}

function crearLangfuseMock() {
  const generation = { end: vi.fn() }
  const trace = { generation: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace), _generation: generation, _trace: trace }
}

describe('GroqLLM.atenderSDR', () => {
  it('carga SP-SDR-01-master.md y llama al LLM', async () => {
    const { cargarSDRPrompt } = await import('../../../src/integrations/llm/sdrUtils.js')
    const sdk = crearOpenAIMock(JSON.stringify(respuestaSDRMock))
    const lf = crearLangfuseMock()
    const llm = new GroqLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

    await llm.atenderSDR(entradaMock, 'trace-sdr-001')

    expect(cargarSDRPrompt).toHaveBeenCalledWith('SP-SDR-01-master.md')
  })

  it('parsea RespuestaSDRSchema y retorna acción correcta', async () => {
    const sdk = crearOpenAIMock(JSON.stringify(respuestaSDRMock))
    const lf = crearLangfuseMock()
    const llm = new GroqLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

    const result = await llm.atenderSDR(entradaMock, 'trace-sdr-001')

    expect(result.action).toBe('continue_discovery')
    expect(result.respuesta).toBe('¿Cuántas fincas tienes bajo manejo EUDR?')
  })

  it('emite LangFuse generation con nombre atender_sdr', async () => {
    const sdk = crearOpenAIMock(JSON.stringify(respuestaSDRMock))
    const lf = crearLangfuseMock()
    const llm = new GroqLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

    await llm.atenderSDR(entradaMock, 'trace-sdr-001')

    expect(lf._trace.generation).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'atender_sdr' }),
    )
    expect(lf._generation.end).toHaveBeenCalled()
  })

  it('lanza LLMError PARSE_ERROR cuando el LLM devuelve no-JSON', async () => {
    const sdk = crearOpenAIMock('no es json')
    const lf = crearLangfuseMock()
    const llm = new GroqLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

    await expect(llm.atenderSDR(entradaMock, 'trace-sdr-001')).rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })

  it('lanza LLMError GROQ_ERROR cuando el SDK falla', async () => {
    const sdk = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('rate limit')) } },
    }
    const lf = crearLangfuseMock()
    const llm = new GroqLLM({ apiKey: 'test-key', sdkClient: sdk as any, langfuseClient: lf as any })

    await expect(llm.atenderSDR(entradaMock, 'trace-sdr-001')).rejects.toMatchObject({ code: 'GROQ_ERROR' })
  })
})
