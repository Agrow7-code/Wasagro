import { describe, expect, it, vi } from 'vitest'
import { LLMRouter } from '../../../src/integrations/llm/LLMRouter.js'
import type { ILLMAdapter, LLMGeneracionOpciones } from '../../../src/integrations/llm/ILLMAdapter.js'

function mockOk(name: string): ILLMAdapter {
  return { generarTexto: vi.fn().mockResolvedValue(`respuesta-${name}`) }
}

function mockFail(name: string): ILLMAdapter {
  return { generarTexto: vi.fn().mockRejectedValue(new Error(`fallo-${name}`)) }
}

const OPTS: LLMGeneracionOpciones = {
  traceId: 'trace-test',
  generationName: 'test-gen',
}

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
