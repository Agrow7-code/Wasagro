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

// Cada string es la respuesta cruda de un intento; un Error simula falla de
// red/timeout del adapter en ese intento (429, timeout del router, etc.).
function adapterConRespuestas(...respuestas: Array<string | Error>): ILLMAdapter {
  const fn = vi.fn()
  for (const r of respuestas) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r)
    else fn.mockResolvedValueOnce(r)
  }
  return { generarTexto: fn } as unknown as ILLMAdapter
}

// Ficha mínima válida. A=40 hace que el recálculo de columna dé números limpios:
// H=10 I=5 J=2.5 K=2 L=9 M=9.5. Los campos *_formulario quedan null salvo override.
function fichaValida(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    confidenceScore: 0.9,
    zona: null, codigoFinca: null, nombreFinca: 'Finca Test',
    semana: 15, periodo: null, fecha: null, supervisor: null,
    puntosMuestreo: [],
    plantas: [],
    resumenColumnas: [{
      A: 40, B: 80, C: 4, D: 2, E: 1, F: 360, G: 380,
      H_formulario: null, I_formulario: null, J_formulario: null,
      K_formulario: null, L_formulario: null, M_formulario: null,
    }],
    plantas11sem: [],
    plagasFoliares: {
      ceramida: { h: null, p: null, m: null },
      sibine: { h: null, p: null, m: null },
    },
    ...overrides,
  })
}

const generarTextoDe = (a: ILLMAdapter) => a.generarTexto as ReturnType<typeof vi.fn>

describe('WasagroAIAgent.extraerMuestreoSigatoka — loop retry + fallback (path de prod)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('primer intento OK: usa tier ultra, json_object, pasa la imagen y recalcula columnas', async () => {
    const adapter = adapterConRespuestas(fichaValida())
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('base64img', 'image/jpeg', 'trace-sig-ok')

    expect(generarTextoDe(adapter)).toHaveBeenCalledOnce()
    const opts = generarTextoDe(adapter).mock.calls[0][1] as LLMGeneracionOpciones
    expect(opts.modelClass).toBe('ultra')
    expect(opts.responseFormat).toBe('json_object')
    expect(opts.imageBase64).toBe('base64img')
    expect(opts.imageMimeType).toBe('image/jpeg')
    expect(opts.timeoutMs).toBe(30_000)

    // Recálculo determinista por columna (la prueba de que calcularColumna corre
    // antes del parse, no que el modelo lo haya inventado).
    const col = data.resumenColumnas[0]
    expect(col.H_calculado).toBe(10)
    expect(col.I_calculado).toBe(5)
    expect(col.J_calculado).toBe(2.5)
    expect(col.K_calculado).toBe(2)
    expect(col.L_calculado).toBe(9)
    expect(col.M_calculado).toBe(9.5)

    // confidence alto y sin discrepancias → no requiere validación.
    expect(data.requiereValidacion).toBe(false)
    expect(data.camposDudosos).toHaveLength(0)
    expect(data.nombreFinca).toBe('Finca Test')
  })

  it('marca requiereValidacion cuando el formulario discrepa del recálculo', async () => {
    // H_formulario=99 pero el recálculo da 10 → discrepancia > 0.5 → dudoso.
    const adapter = adapterConRespuestas(fichaValida({
      resumenColumnas: [{
        A: 40, B: 80, C: 4, D: 2, E: 1, F: 360, G: 380,
        H_formulario: 99, I_formulario: null, J_formulario: null,
        K_formulario: null, L_formulario: null, M_formulario: null,
      }],
    }))
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-disc')

    expect(data.requiereValidacion).toBe(true)
    expect(data.camposDudosos.some(c => c.includes('H'))).toBe(true)
  })

  it('reintenta tras fallo de Zod y devuelve el resultado del segundo intento', async () => {
    // confidenceScore 1.5 viola .max(1) → falla Zod → reintenta → 2º intento OK.
    const adapter = adapterConRespuestas(
      fichaValida({ confidenceScore: 1.5 }),
      fichaValida({ nombreFinca: 'Recuperada al 2do intento' }),
    )
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-retry')

    expect(generarTextoDe(adapter)).toHaveBeenCalledTimes(2)
    // El reintento debe mandar feedback de corrección, no el prompt inicial.
    const segundoUserContent = generarTextoDe(adapter).mock.calls[1][0] as string
    expect(segundoUserContent).toContain('Corrección requerida')
    expect(data.nombreFinca).toBe('Recuperada al 2do intento')
    expect(data.confidenceScore).toBe(0.9)
  })

  it('agota los reintentos por Zod → fallback graceful que rescata lo legible (nunca tira)', async () => {
    // punto faltante (campo requerido) en cada intento → Zod siempre falla.
    const fichaRota = fichaValida({ puntosMuestreo: [{ sector: 'Corrijal' }] })
    const adapter = adapterConRespuestas(fichaRota, fichaRota, fichaRota)
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-exhausted')

    expect(generarTextoDe(adapter)).toHaveBeenCalledTimes(3) // intentos 0,1,2
    expect(data.confidenceScore).toBe(0)
    expect(data.requiereValidacion).toBe(true)
    expect(data.camposDudosos[0]).toContain('extracción incompleta')
    // Rescata lo que se pudo leer en vez de perder la foto.
    expect(data.nombreFinca).toBe('Finca Test')
    expect(data.puntosMuestreo[0].punto).toBe('?')
    expect(data.puntosMuestreo[0].sector).toBe('Corrijal')
  })

  it('adapter tira en TODOS los intentos (timeout/429) → fallback, nunca propaga la excepción', async () => {
    const adapter = adapterConRespuestas(
      new Error('timeout'), new Error('timeout'), new Error('429 rate limit'),
    )
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-throw')

    expect(generarTextoDe(adapter)).toHaveBeenCalledTimes(3)
    expect(data.confidenceScore).toBe(0)
    expect(data.requiereValidacion).toBe(true)
    expect(data.camposDudosos).toHaveLength(1)
    expect(data.puntosMuestreo).toEqual([])
    expect(data.resumenColumnas).toEqual([])
  })

  it('JSON no parseable en todos los intentos → fallback sin datos rescatables', async () => {
    const adapter = adapterConRespuestas('no es json', 'tampoco', 'sigue mal')
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-badjson')

    expect(generarTextoDe(adapter)).toHaveBeenCalledTimes(3)
    expect(data.confidenceScore).toBe(0)
    expect(data.requiereValidacion).toBe(true)
    expect(data.nombreFinca).toBeNull()
    expect(data.camposDudosos[0]).toContain('extracción incompleta')
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
    const ficha = JSON.parse(fichaValida())
    ficha.puntosMuestreo = [{
      punto: 'P1', sector: 'Corrijal', lote_id: null, marcaEspecial: null,
      planta1_estadio: 2,                                   // crudo → leida
      planta1_piscas: { valor: null, estado: 'ilegible' },  // ilegible
      planta2_estadio: null,                                // → vacia
      planta2_piscas: null, planta3_estadio: null, planta3_piscas: null,
      hVle: null, hVlq: null, func: null,
    }]
    const adapter = adapterConRespuestas(JSON.stringify(ficha))
    const agent = new WasagroAIAgent(adapter, lfStub)

    const data = await agent.extraerMuestreoSigatoka('b64', 'image/jpeg', 'trace-sig-celdas')
    const p = data.puntosMuestreo[0]!
    expect(p.planta1_estadio).toEqual({ valor: 2, estado: 'leida' })
    expect(p.planta1_piscas).toEqual({ valor: null, estado: 'ilegible' })
    expect(p.planta2_estadio).toEqual({ valor: null, estado: 'vacia' })
  })
})
