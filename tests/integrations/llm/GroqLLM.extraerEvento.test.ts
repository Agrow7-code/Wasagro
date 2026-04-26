import { describe, expect, it, vi } from 'vitest'
import { GroqAdapter } from '../../../src/integrations/llm/GroqAdapter.js'
import { WasagroAIAgent } from '../../../src/integrations/llm/WasagroAIAgent.js'
import type { EntradaEvento } from '../../../src/types/dominio/EventoCampo.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('mocked-prompt-content') }
})

// ─── fixtures ─────────────────────────────────────────────────────────────────

const entradaMock: EntradaEvento = {
  transcripcion: 'Apliqué mancozeb en lote 3',
  finca_id: 'F001',
  usuario_id: 'usr-1',
  nombre_usuario: 'Carlos',
  finca_nombre: 'Finca Uno',
  cultivo_principal: 'cacao',
  pais: 'EC',
  lista_lotes: '- F001-L01: "El de arriba" (2 ha)',
}

const clasificacionBase = {
  tipo_evento: 'insumo',
  confidence: 0.95,
  requiere_imagen_para_confirmar: false,
  motivo_ambiguo: null,
  mensaje_clarificacion: null,
}

const eventoBase = {
  tipo_evento: 'insumo',
  lote_id: 'F001-L01',
  lote_detectado_raw: null,
  fecha_evento: null,
  confidence_score: 0.90,
  requiere_validacion: false,
  alerta_urgente: false,
  campos_extraidos: { producto: 'mancozeb', dosis_cantidad: 2 },
  confidence_por_campo: { producto: 0.95 },
  campos_faltantes: [],
  requiere_clarificacion: false,
  pregunta_sugerida: null,
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function crearSdk(...responses: string[]) {
  const create = vi.fn()
  for (const r of responses) {
    create.mockResolvedValueOnce({ choices: [{ message: { content: r } }] })
  }
  return { chat: { completions: { create } } }
}

function crearLangfuse() {
  const generation = { end: vi.fn() }
  const trace = { generation: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace), _gen: generation, _trace: trace }
}

function crearLlm(sdk: ReturnType<typeof crearSdk>, lf = crearLangfuse()) {
  return new WasagroAIAgent(new GroqAdapter({ apiKey: 'test', sdkClient: sdk as any, }), lf as any )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GroqLLM.extraerEvento — clasificador + extractor', () => {

  describe('happy path por tipo de evento', () => {
    it.each([
      ['insumo'],
      ['labor'],
      ['cosecha'],
      ['plaga'],
      ['clima'],
    ])('tipo=%s → hace 2 llamadas al LLM y retorna EventoCampoExtraido válido', async (tipo) => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: tipo }),
        JSON.stringify({ ...eventoBase, tipo_evento: tipo }),
      )
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-1')

      expect(sdk.chat.completions.create).toHaveBeenCalledTimes(2)
      expect(result.tipo_evento).toBe(tipo)
      expect(result.confidence_score).toBe(0.90)
    })

    it('infraestructura usa sp-01-extraccion-evento.md como fallback (no está en EXTRACTOR_POR_TIPO)', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'infraestructura' }),
        JSON.stringify({ ...eventoBase, tipo_evento: 'infraestructura' }),
      )
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-infra')

      expect(sdk.chat.completions.create).toHaveBeenCalledTimes(2)
      expect(result.tipo_evento).toBe('infraestructura')
    })

    it('alerta_urgente=true se preserva desde el extractor de plaga', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'plaga' }),
        JSON.stringify({ ...eventoBase, tipo_evento: 'plaga', alerta_urgente: true }),
      )
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-plaga')

      expect(result.alerta_urgente).toBe(true)
    })

    it('lote_detectado_raw se preserva cuando el lote no se resuelve', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'insumo' }),
        JSON.stringify({ ...eventoBase, lote_id: null, lote_detectado_raw: 'lote cinco' }),
      )
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-lote-raw')

      expect(result.lote_detectado_raw).toBe('lote cinco')
      expect(result.lote_id).toBeNull()
    })

    it('confidence_score y campos_faltantes del extractor se retornan intactos', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'cosecha' }),
        JSON.stringify({
          ...eventoBase,
          tipo_evento: 'cosecha',
          confidence_score: 0.72,
          campos_faltantes: ['fecha_evento', 'peso_kg'],
          confidence_por_campo: { tipo_fruto: 0.9, peso_kg: 0.0 },
        }),
      )
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-conf')

      expect(result.confidence_score).toBe(0.72)
      expect(result.campos_faltantes).toContain('fecha_evento')
      expect(result.campos_faltantes).toContain('peso_kg')
    })
  })

  describe('no-eventos (sin llamar al extractor)', () => {
    it('saludo → retorna sin_evento con pregunta de bienvenida, solo 1 llamada LLM', async () => {
      const sdk = crearSdk(JSON.stringify({ ...clasificacionBase, tipo_evento: 'saludo' }))
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-sal')

      expect(sdk.chat.completions.create).toHaveBeenCalledTimes(1)
      expect(result.tipo_evento).toBe('sin_evento')
      expect(result.pregunta_sugerida).toContain('Hola')
    })

    it('consulta → retorna sin_evento, solo 1 llamada LLM', async () => {
      const sdk = crearSdk(JSON.stringify({ ...clasificacionBase, tipo_evento: 'consulta' }))
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-con')

      expect(sdk.chat.completions.create).toHaveBeenCalledTimes(1)
      expect(result.tipo_evento).toBe('sin_evento')
    })

    it('ambiguo → retorna observacion con requiere_clarificacion=true y usa mensaje_clarificacion', async () => {
      const sdk = crearSdk(JSON.stringify({
        ...clasificacionBase,
        tipo_evento: 'ambiguo',
        confidence: 0.55,
        mensaje_clarificacion: '¿Qué actividad realizaste exactamente?',
      }))
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-amb')

      expect(sdk.chat.completions.create).toHaveBeenCalledTimes(1)
      expect(result.tipo_evento).toBe('observacion')
      expect(result.requiere_clarificacion).toBe(true)
      expect(result.pregunta_sugerida).toBe('¿Qué actividad realizaste exactamente?')
      expect(result.confidence_score).toBe(0.55)
    })

    it('ambiguo sin mensaje_clarificacion → usa pregunta genérica de fallback', async () => {
      const sdk = crearSdk(JSON.stringify({
        ...clasificacionBase,
        tipo_evento: 'ambiguo',
        mensaje_clarificacion: null,
      }))
      const result = await crearLlm(sdk).extraerEvento(entradaMock, 'trace-amb-gen')

      expect(result.requiere_clarificacion).toBe(true)
      expect(result.pregunta_sugerida).toBeTruthy()
    })
  })

  describe('errores del clasificador', () => {
    it('clasificador devuelve texto libre → lanza PARSE_ERROR', async () => {
      const sdk = crearSdk('No pude clasificar este mensaje')
      await expect(crearLlm(sdk).extraerEvento(entradaMock, 'trace-err-1'))
        .rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })

    it('clasificador devuelve JSON con tipo_evento fuera del enum → lanza PARSE_ERROR', async () => {
      const sdk = crearSdk(JSON.stringify({ tipo_evento: 'UNKNOWN_TYPE', confidence: 0.9 }))
      await expect(crearLlm(sdk).extraerEvento(entradaMock, 'trace-err-2'))
        .rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })

    it('clasificador devuelve JSON con "error": "INPUT_INVALIDO" (prompt injection) → lanza PARSE_ERROR', async () => {
      const sdk = crearSdk(JSON.stringify({ error: 'INPUT_INVALIDO', motivo: 'patron_sospechoso' }))
      await expect(crearLlm(sdk).extraerEvento(entradaMock, 'trace-inj'))
        .rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })

    it('clasificador SDK lanza excepción → lanza GROQ_ERROR', async () => {
      const sdk = { chat: { completions: { create: vi.fn().mockRejectedValue(new Error('network error')) } } }
      await expect(crearLlm(sdk as any).extraerEvento(entradaMock, 'trace-err-3'))
        .rejects.toMatchObject({ code: 'GROQ_ERROR' })
    })

    it('clasificador retorna content vacío → lanza PARSE_ERROR', async () => {
      const sdk = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '' } }] }) } } }
      await expect(crearLlm(sdk as any).extraerEvento(entradaMock, 'trace-empty'))
        .rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })
  })

  describe('errores del extractor', () => {
    it('extractor devuelve texto libre → lanza PARSE_ERROR', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'insumo' }),
        'No pude extraer los campos',
      )
      await expect(crearLlm(sdk).extraerEvento(entradaMock, 'trace-ext-1'))
        .rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })

    it('extractor devuelve JSON sin campos requeridos → lanza PARSE_ERROR', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'insumo' }),
        JSON.stringify({ tipo_evento: 'insumo' }), // falta lote_id, confidence_score, etc.
      )
      await expect(crearLlm(sdk).extraerEvento(entradaMock, 'trace-ext-2'))
        .rejects.toMatchObject({ code: 'PARSE_ERROR' })
    })

    it('extractor SDK lanza excepción → lanza GROQ_ERROR', async () => {
      const sdk = {
        chat: {
          completions: {
            create: vi.fn()
              .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ ...clasificacionBase, tipo_evento: 'insumo' }) } }] })
              .mockRejectedValueOnce(new Error('rate limit exceeded')),
          },
        },
      }
      await expect(crearLlm(sdk as any).extraerEvento(entradaMock, 'trace-ext-3'))
        .rejects.toMatchObject({ code: 'GROQ_ERROR' })
    })
  })

  describe('observabilidad LangFuse', () => {
    it('emite generation "clasificar_mensaje" y "extraer_{tipo}"', async () => {
      const sdk = crearSdk(
        JSON.stringify({ ...clasificacionBase, tipo_evento: 'insumo' }),
        JSON.stringify(eventoBase),
      )
      const lf = crearLangfuse()
      await crearLlm(sdk, lf).extraerEvento(entradaMock, 'trace-lf-1')

      expect(lf._trace.generation).toHaveBeenCalledWith(expect.objectContaining({ name: 'clasificar_mensaje' }))
      expect(lf._trace.generation).toHaveBeenCalledWith(expect.objectContaining({ name: 'extraer_insumo' }))
      expect(lf._gen.end).toHaveBeenCalledTimes(2)
    })

    it('clasificador=saludo emite evento "mensaje_saludo" en LangFuse', async () => {
      const sdk = crearSdk(JSON.stringify({ ...clasificacionBase, tipo_evento: 'saludo' }))
      const lf = crearLangfuse()
      await crearLlm(sdk, lf).extraerEvento(entradaMock, 'trace-lf-sal')

      expect(lf._trace.event).toHaveBeenCalledWith(expect.objectContaining({ name: 'mensaje_saludo' }))
    })

    it('clasificador=consulta emite evento "mensaje_consulta" en LangFuse', async () => {
      const sdk = crearSdk(JSON.stringify({ ...clasificacionBase, tipo_evento: 'consulta' }))
      const lf = crearLangfuse()
      await crearLlm(sdk, lf).extraerEvento(entradaMock, 'trace-lf-con')

      expect(lf._trace.event).toHaveBeenCalledWith(expect.objectContaining({ name: 'mensaje_consulta' }))
    })
  })
})
