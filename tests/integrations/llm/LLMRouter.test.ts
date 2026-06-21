import { describe, expect, it, vi } from 'vitest'
import { LLMRouter } from '../../../src/integrations/llm/LLMRouter.js'
import type { ILLMAdapter, LLMGeneracionOpciones } from '../../../src/integrations/llm/ILLMAdapter.js'

function mockOk(name: string): ILLMAdapter {
  return { generarTexto: vi.fn().mockResolvedValue(`respuesta-${name}`) }
}

function mockFail(name: string): ILLMAdapter {
  return { generarTexto: vi.fn().mockRejectedValue(new Error(`fallo-${name}`)) }
}

function mockOkTools(name: string): ILLMAdapter {
  return { generarTexto: vi.fn().mockResolvedValue(`respuesta-${name}`), supportsTools: true }
}

const OPTS: LLMGeneracionOpciones = {
  traceId: 'trace-test',
  generationName: 'test-gen',
}

const TOOLS = [{ name: 'obtener_lotes_finca', description: 'x', parameters: { type: 'object', properties: {} } }]

describe('LLMRouter', () => {
  it('usa el primer adapter si responde correctamente', async () => {
    const a = mockOk('a')
    const b = mockOk('b')
    const router = new LLMRouter([
      { name: 'A', adapter: a, tier: 'reasoning' },
      { name: 'B', adapter: b, tier: 'reasoning' },
    ])

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-a')
    expect(a.generarTexto).toHaveBeenCalledOnce()
    expect(b.generarTexto).not.toHaveBeenCalled()
  })

  it('hace fallback al segundo adapter si el primero falla', async () => {
    const a = mockFail('a')
    const b = mockOk('b')
    const router = new LLMRouter([
      { name: 'A', adapter: a, tier: 'reasoning' },
      { name: 'B', adapter: b, tier: 'reasoning' },
    ])

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-b')
    expect(a.generarTexto).toHaveBeenCalledOnce()
    expect(b.generarTexto).toHaveBeenCalledOnce()
  })

  it('propaga el error si todos los adapters fallan', async () => {
    const a = mockFail('a')
    const b = mockFail('b')
    const router = new LLMRouter([
      { name: 'A', adapter: a, tier: 'reasoning' },
      { name: 'B', adapter: b, tier: 'reasoning' },
    ])

    await expect(router.generarTexto('hola', OPTS)).rejects.toThrow('fallo-b')
  })

  it('registra métricas de latencia por adapter', async () => {
    const onMetric = vi.fn()
    const a = mockOk('a')
    const router = new LLMRouter(
      [{ name: 'A', adapter: a, tier: 'reasoning' }],
      { onMetric },
    )

    await router.generarTexto('hola', OPTS)

    expect(onMetric).toHaveBeenCalledOnce()
    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterName: 'A',
        success: true,
        latencyMs: expect.any(Number),
      }),
    )
  })

  it('registra fallo en métricas cuando el adapter lanza error', async () => {
    const onMetric = vi.fn()
    const a = mockFail('a')
    const b = mockOk('b')
    const router = new LLMRouter(
      [
        { name: 'A', adapter: a, tier: 'reasoning' },
        { name: 'B', adapter: b, tier: 'reasoning' },
      ],
      { onMetric },
    )

    await router.generarTexto('hola', OPTS)

    expect(onMetric).toHaveBeenCalledTimes(2)
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({ adapterName: 'A', success: false }))
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({ adapterName: 'B', success: true }))
  })

  it('lanza error si se construye sin adapters', () => {
    expect(() => new LLMRouter([])).toThrow()
  })

  it('con tools, rutea SOLO al adapter tool-capaz aunque no sea el primero', async () => {
    const noTool = mockOk('notool')        // primero, pero NO soporta tools
    const conTool = mockOkTools('contool') // segundo, tool-capaz
    const router = new LLMRouter([
      { name: 'NoTool', adapter: noTool, tier: 'reasoning' },
      { name: 'ConTool', adapter: conTool, tier: 'reasoning' },
    ])

    const result = await router.generarTexto('hola', { ...OPTS, tools: TOOLS })

    expect(result).toBe('respuesta-contool')
    expect(noTool.generarTexto).not.toHaveBeenCalled() // nunca se le pasó la petición con tools
    expect(conTool.generarTexto).toHaveBeenCalledOnce()
  })

  it('con tools y SIN adapter tool-capaz, falla explícito (no degrada en silencio)', async () => {
    const onMetric = vi.fn()
    const noTool = mockOk('notool')
    const router = new LLMRouter(
      [{ name: 'NoTool', adapter: noTool, tier: 'reasoning' }],
      { onMetric },
    )

    await expect(router.generarTexto('hola', { ...OPTS, tools: TOOLS })).rejects.toThrow(/tool-capaz/)
    expect(noTool.generarTexto).not.toHaveBeenCalled()
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({ error: 'no_tool_capable_adapter' }))
  })

  it('sin tools, NO restringe por capacidad (usa el primero aunque no sea tool-capaz)', async () => {
    const noTool = mockOk('notool')
    const conTool = mockOkTools('contool')
    const router = new LLMRouter([
      { name: 'NoTool', adapter: noTool, tier: 'reasoning' },
      { name: 'ConTool', adapter: conTool, tier: 'reasoning' },
    ])

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-notool')
    expect(noTool.generarTexto).toHaveBeenCalledOnce()
  })

  it('supportsTools refleja si algún nodo es tool-capaz', () => {
    expect(new LLMRouter([{ name: 'A', adapter: mockOk('a'), tier: 'reasoning' }]).supportsTools).toBe(false)
    expect(new LLMRouter([{ name: 'A', adapter: mockOkTools('a'), tier: 'reasoning' }]).supportsTools).toBe(true)
  })

  it('reintenta el MISMO nodo ante un fallo transitorio (429) y recupera sin pasar al fallback', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const a: ILLMAdapter = {
      generarTexto: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('Too Many Requests'), { status: 429 }))
        .mockResolvedValueOnce('ok-tras-retry'),
    }
    const b = mockOk('b')
    const router = new LLMRouter(
      [
        { name: 'A', adapter: a, tier: 'reasoning' },
        { name: 'B', adapter: b, tier: 'reasoning' },
      ],
      { sleep },
    )

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('ok-tras-retry')
    expect(a.generarTexto).toHaveBeenCalledTimes(2) // 1 fallo transitorio + 1 retry OK
    expect(b.generarTexto).not.toHaveBeenCalled()   // no hizo falta el fallback
    expect(sleep).toHaveBeenCalled()                // hubo backoff antes del retry
  })

  it('NO reintenta ante un fallo no-transitorio: falla rápido al fallback sin esperar', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const a: ILLMAdapter = { generarTexto: vi.fn().mockRejectedValue(new Error('JSON inválido del modelo')) }
    const b = mockOk('b')
    const router = new LLMRouter(
      [
        { name: 'A', adapter: a, tier: 'reasoning' },
        { name: 'B', adapter: b, tier: 'reasoning' },
      ],
      { sleep },
    )

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-b')
    expect(a.generarTexto).toHaveBeenCalledTimes(1) // sin retry: 'otro' falla rápido
    expect(sleep).not.toHaveBeenCalled()
  })

  it('agota los reintentos transitorios de un nodo y pasa al fallback', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const a: ILLMAdapter = {
      generarTexto: vi.fn().mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 })),
    }
    const b = mockOk('b')
    const router = new LLMRouter(
      [
        { name: 'A', adapter: a, tier: 'reasoning' },
        { name: 'B', adapter: b, tier: 'reasoning' },
      ],
      { sleep, maxReintentosPorNodo: 2 },
    )

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-b')
    expect(a.generarTexto).toHaveBeenCalledTimes(3) // intento inicial + 2 reintentos
    expect(b.generarTexto).toHaveBeenCalledOnce()
  })

  it('excluir saltea los nodos cuyo nombre incluye el substring (2ª opinión de otro modelo)', async () => {
    const gem = mockOk('gem')
    const mini = mockOk('mini')
    const router = new LLMRouter([
      { name: 'Gemini-2.5-F', adapter: gem, tier: 'ultra' },
      { name: 'Minimax', adapter: mini, tier: 'ultra' },
    ])
    const result = await router.generarTexto('hola', { ...OPTS, modelClass: 'ultra', excluir: 'Gemini' })
    expect(result).toBe('respuesta-mini')
    expect(gem.generarTexto).not.toHaveBeenCalled()
    expect(mini.generarTexto).toHaveBeenCalledOnce()
  })

  it('excluir acepta varios separados por coma (saltea Gemini Y Minimax → Gemma)', async () => {
    const gem = mockOk('gem'); const mini = mockOk('mini'); const gemma = mockOk('gemma')
    const router = new LLMRouter([
      { name: 'Gemini-2.5-F', adapter: gem, tier: 'ultra' },
      { name: 'Minimax', adapter: mini, tier: 'ultra' },
      { name: 'Gemma-4', adapter: gemma, tier: 'ultra' },
    ])
    const r = await router.generarTexto('hola', { ...OPTS, modelClass: 'ultra', excluir: 'Gemini,Minimax' })
    expect(r).toBe('respuesta-gemma')
    expect(gem.generarTexto).not.toHaveBeenCalled()
    expect(mini.generarTexto).not.toHaveBeenCalled()
    expect(gemma.generarTexto).toHaveBeenCalledOnce()
  })

  it('excluir sin alternativa en el tier → falla explícito', async () => {
    const gem = mockOk('gem')
    const router = new LLMRouter([{ name: 'Gemini-2.5-F', adapter: gem, tier: 'ultra' }])
    await expect(router.generarTexto('hola', { ...OPTS, modelClass: 'ultra', excluir: 'Gemini' })).rejects.toThrow(/sin nodos/)
  })

  it('rutea a tier ocr cuando modelClass es ocr', async () => {
    const reasoningAdapter = mockOk('reasoning')
    const ocrAdapter = mockOk('ocr')
    const router = new LLMRouter([
      { name: 'Reasoning-A', adapter: reasoningAdapter, tier: 'reasoning' },
      { name: 'OCR-A', adapter: ocrAdapter, tier: 'ocr' },
    ])

    const result = await router.generarTexto('Extrae datos', { ...OPTS, modelClass: 'ocr' })

    expect(result).toBe('respuesta-ocr')
    expect(reasoningAdapter.generarTexto).not.toHaveBeenCalled()
    expect(ocrAdapter.generarTexto).toHaveBeenCalledOnce()
  })
})
