import { describe, expect, it, vi, beforeEach } from 'vitest'
import { WasagroAIAgent } from '../../../src/integrations/llm/WasagroAIAgent.js'
import type { ILLMAdapter, LLMGeneracionOpciones } from '../../../src/integrations/llm/ILLMAdapter.js'

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
    getPrompt: vi.fn().mockResolvedValue('Prompt de extracción de muestreo Sigatoka'),
    getPromptClient: vi.fn().mockReturnValue(null),
    clearCache: vi.fn(),
  },
}))

vi.mock('../../../src/agents/mcp/SupabaseTools.js', () => ({ SupabaseTools: {} }))
vi.mock('../../../src/integrations/supabase.js', () => ({ supabase: {}, createSupabaseClient: vi.fn() }))

const lfStub = { trace: () => ({ generation: () => ({ end: vi.fn() }), event: vi.fn() }) } as any

// El adapter se llama 1× por pasada. La extracción corre DOS pasadas en paralelo
// (izquierda, derecha) vía Promise.all → la 1ª respuesta va a la izquierda, la 2ª
// a la derecha. Un Error simula falla de red/timeout (429, timeout del router).
function adapterConRespuestas(...respuestas: Array<string | Error>): ILLMAdapter {
  const fn = vi.fn()
  for (const r of respuestas) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r)
    else fn.mockResolvedValueOnce(r)
  }
  return { generarTexto: fn } as unknown as ILLMAdapter
}

// Pasada IZQUIERDA: identidad + matriz + DATOS. A=40 → recálculo limpio:
// H=10 I=5 J=2.5 K=2 L=9 M=9.5.
function izq(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    confidenceScore: 0.9,
    zona: null, codigoFinca: null, nombreFinca: 'Finca Test',
    semana: 15, periodo: null, fecha: null, supervisor: null,
    puntosMuestreo: [],
    resumenColumnas: [{
      A: 40, B: 80, C: 4, D: 2, E: 1, F: 360, G: 380,
      H_formulario: null, I_formulario: null, J_formulario: null,
      K_formulario: null, L_formulario: null, M_formulario: null,
    }],
    ...overrides,
  })
}

// Pasada 2 (TABLAS): 11 y 00 semanas.
function tab(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ confidenceScore: 0.9, plantas11sem: [], plantas00sem: [], ...overrides })
}

// Pasada 3 (PLAGAS): EF + plagas foliares + diferidos.
function plg(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    confidenceScore: 0.9,
    plantas: [],
    plagasFoliares: { ceramida: { h: null, p: null, m: null }, sibine: { h: null, p: null, m: null } },
    pEfFinca: null, erradicadasBsv: null,
    ...overrides,
  })
}

const generarTextoDe = (a: ILLMAdapter) => a.generarTexto as ReturnType<typeof vi.fn>

describe('WasagroAIAgent.extraerMuestreoSigatoka — tres pasadas paralelas + merge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('corre 3 pasadas (tier ultra, json_object, imagen) y mergea las tres zonas', async () => {
    const adapter = adapterConRespuestas(
      izq(),
      tab({ plantas11sem: [{ ht: 8, hVle: 0, q5menos: 3, q5mas: 8, lc: 7 }] }),
      plg({ plagasFoliares: { ceramida: { h: 13, p: 7, m: 12 }, sibine: { h: 13, p: 6, m: 10 } }, erradicadasBsv: 264 }),
    )
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('base64img', 'image/jpeg', 'trace-sig-ok')

    expect(generarTextoDe(adapter)).toHaveBeenCalledTimes(3)
    const opts = generarTextoDe(adapter).mock.calls[0][1] as LLMGeneracionOpciones
    expect(opts.modelClass).toBe('ultra')
    expect(opts.responseFormat).toBe('json_object')
    expect(opts.imageBase64).toBe('base64img')
    expect(opts.timeoutMs).toBe(30_000)

    // Recálculo (pasada izquierda)
    expect(data.resumenColumnas[0]!.H_calculado).toBe(10)
    expect(data.resumenColumnas[0]!.M_calculado).toBe(9.5)
    // Merge: tablas (pasada 2) + plagas/erradicadas (pasada 3)
    expect(data.plantas11sem).toHaveLength(1)
    expect(data.plagasFoliares.ceramida.h).toBe(13)
    expect(data.erradicadasBsv).toBe(264)
    expect(data.nombreFinca).toBe('Finca Test')
    expect(data.requiereValidacion).toBe(false)
    expect(data.camposDudosos).toHaveLength(0)
  })

  it('marca requiereValidacion cuando el formulario discrepa del recálculo', async () => {
    const adapter = adapterConRespuestas(
      izq({
        resumenColumnas: [{
          A: 40, B: 80, C: 4, D: 2, E: 1, F: 360, G: 380,
          H_formulario: 99, I_formulario: null, J_formulario: null,
          K_formulario: null, L_formulario: null, M_formulario: null,
        }],
      }),
      tab(), plg(),
    )
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-disc')

    expect(data.requiereValidacion).toBe(true)
    expect(data.camposDudosos.some(c => c.includes('H'))).toBe(true)
  })

  it('si una pasada complementaria falla, conserva la izquierda (puntos/resumen) sin tirar', async () => {
    const adapter = adapterConRespuestas(izq(), 'no es json', plg())
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-tab-fail')

    expect(data.nombreFinca).toBe('Finca Test')
    expect(data.resumenColumnas[0]!.H_calculado).toBe(10)
    expect(data.plantas11sem).toEqual([])     // tablas fallaron → default
    expect(data.requiereValidacion).toBe(true) // pasada incompleta → revisar
  })

  it('si la pasada IZQUIERDA falla, conserva plagas/tablas sin tirar', async () => {
    const adapter = adapterConRespuestas(
      new Error('timeout'),
      tab({ plantas11sem: [{ ht: 8, hVle: 0, q5menos: 3, q5mas: 8, lc: 7 }] }),
      plg({ plagasFoliares: { ceramida: { h: 5, p: 1, m: 0 }, sibine: { h: 0, p: 0, m: 0 } } }),
    )
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-izq-fail')

    expect(data.plagasFoliares.ceramida.h).toBe(5)
    expect(data.plantas11sem).toHaveLength(1)
    expect(data.puntosMuestreo).toEqual([])
    expect(data.resumenColumnas).toEqual([])
    expect(data.requiereValidacion).toBe(true)
  })

  it('las 3 pasadas tiran (timeout/429) → muestreo vacío requires_review, nunca propaga', async () => {
    const adapter = adapterConRespuestas(new Error('timeout'), new Error('429'), new Error('500'))
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-throw')

    expect(generarTextoDe(adapter)).toHaveBeenCalledTimes(3)
    expect(data.confidenceScore).toBe(0)
    expect(data.requiereValidacion).toBe(true)
    expect(data.puntosMuestreo).toEqual([])
    expect(data.resumenColumnas).toEqual([])
  })

  it('interpretarAclaracionSigatoka mapea la respuesta del tomador a las celdas (tier fast)', async () => {
    const adapter = adapterConRespuestas(JSON.stringify({
      aclaraciones: [
        { punto: 'P3', campo: 'planta2_estadio', valor: 4 },
        { punto: 'P5', campo: 'hVle', valor: null },
      ],
    }))
    const agent = new WasagroAIAgent(adapter, lfStub)

    const ubic = [{ punto: 'P3', campo: 'planta2_estadio' }, { punto: 'P5', campo: 'hVle' }]
    const out = await agent.interpretarAclaracionSigatoka('P3 fue 4, el otro ni idea', ubic, 'trace-acl')

    expect(out).toEqual([
      { punto: 'P3', campo: 'planta2_estadio', valor: 4 },
      { punto: 'P5', campo: 'hVle', valor: null },
    ])
    const opts = generarTextoDe(adapter).mock.calls[0][1] as LLMGeneracionOpciones
    expect(opts.modelClass).toBe('fast')
  })

  it('interpretarAclaracionSigatoka → [] cuando el modelo devuelve basura (no inventa)', async () => {
    const adapter = adapterConRespuestas('no json')
    const agent = new WasagroAIAgent(adapter, lfStub)
    const out = await agent.interpretarAclaracionSigatoka('cualquier cosa', [{ punto: 'P1', campo: 'func' }], 'trace-acl2')
    expect(out).toEqual([])
  })

  it('normaliza el estado por celda de los puntos (I5) en el path de extracción', async () => {
    const izqObj = JSON.parse(izq())
    izqObj.puntosMuestreo = [{
      punto: 'P1', sector: 'Corrijal', lote_id: null, marcaEspecial: null,
      planta1_estadio: 2,                                   // crudo → leida
      planta1_piscas: { valor: null, estado: 'ilegible' },  // ilegible
      planta2_estadio: null,                                // → vacia
      planta2_piscas: null, planta3_estadio: null, planta3_piscas: null,
      hVle: null, hVlq: null, func: null,
    }]
    const adapter = adapterConRespuestas(JSON.stringify(izqObj), tab(), plg())
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-celdas')
    const p = data.puntosMuestreo[0]!
    expect(p.planta1_estadio).toEqual({ valor: 2, estado: 'leida' })
    expect(p.planta1_piscas).toEqual({ valor: null, estado: 'ilegible' })
    expect(p.planta2_estadio).toEqual({ valor: null, estado: 'vacia' })
  })
})
