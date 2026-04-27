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
    const router = new LLMRouter([a, b])

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-a')
    expect(a.generarTexto).toHaveBeenCalledOnce()
    expect(b.generarTexto).not.toHaveBeenCalled()
  })

  it('hace fallback al segundo adapter si el primero falla', async () => {
    const a = mockFail('a')
    const b = mockOk('b')
    const router = new LLMRouter([a, b])

    const result = await router.generarTexto('hola', OPTS)

    expect(result).toBe('respuesta-b')
    expect(a.generarTexto).toHaveBeenCalledOnce()
    expect(b.generarTexto).toHaveBeenCalledOnce()
  })

  it('propaga el error si todos los adapters fallan', async () => {
    const a = mockFail('a')
    const b = mockFail('b')
    const router = new LLMRouter([a, b])

    await expect(router.generarTexto('hola', OPTS)).rejects.toThrow('fallo-b')
  })

  it('registra métricas de latencia por adapter', async () => {
    const onMetric = vi.fn()
    const a = mockOk('a')
    const router = new LLMRouter([a], { onMetric })

    await router.generarTexto('hola', OPTS)

    expect(onMetric).toHaveBeenCalledOnce()
    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: 0,
        success: true,
        latencyMs: expect.any(Number),
      }),
    )
  })

  it('registra fallo en métricas cuando el adapter lanza error', async () => {
    const onMetric = vi.fn()
    const a = mockFail('a')
    const b = mockOk('b')
    const router = new LLMRouter([a, b], { onMetric })

    await router.generarTexto('hola', OPTS)

    expect(onMetric).toHaveBeenCalledTimes(2)
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({ adapter: 0, success: false }))
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({ adapter: 1, success: true }))
  })

  it('lanza error si se construye sin adapters', () => {
    expect(() => new LLMRouter([])).toThrow()
  })
})
