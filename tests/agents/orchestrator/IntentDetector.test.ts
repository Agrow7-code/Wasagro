import { describe, expect, it, vi } from 'vitest'
import { IntentDetector } from '../../../src/agents/orchestrator/IntentDetector.js'
import type { ILLMAdapter } from '../../../src/integrations/llm/ILLMAdapter.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('mocked-prompt') }
})

function mockAdapter(response: object): ILLMAdapter {
  return { generarTexto: vi.fn().mockResolvedValue(JSON.stringify(response)) }
}

const BASE_INPUT = {
  mensaje_usuario: 'No, era un gasto, no un insumo',
  tipo_previo: 'insumo' as const,
  transcripcion_previa: 'Compré motor para la bomba',
}

describe('IntentDetector', () => {
  it('detecta correccion_tipo y extrae tipo_forzado', async () => {
    const adapter = mockAdapter({ tipo: 'correccion_tipo', tipo_forzado: 'gasto', confianza: 0.95 })
    const detector = new IntentDetector(adapter)
    const result = await detector.detectar(BASE_INPUT, 'trace-1')

    expect(result.tipo).toBe('correccion_tipo')
    expect(result.tipo_forzado).toBe('gasto')
    expect(result.confianza).toBeGreaterThan(0.5)
  })

  it('detecta completar_dato cuando el usuario agrega info faltante', async () => {
    const adapter = mockAdapter({ tipo: 'completar_dato', tipo_forzado: null, confianza: 0.88 })
    const detector = new IntentDetector(adapter)
    const result = await detector.detectar(
      { ...BASE_INPUT, mensaje_usuario: 'Fue en el lote 3' },
      'trace-2',
    )
    expect(result.tipo).toBe('completar_dato')
    expect(result.tipo_forzado).toBeUndefined()
  })

  it('detecta nuevo_evento cuando el usuario manda algo distinto', async () => {
    const adapter = mockAdapter({ tipo: 'nuevo_evento', tipo_forzado: null, confianza: 0.92 })
    const detector = new IntentDetector(adapter)
    const result = await detector.detectar(
      { ...BASE_INPUT, mensaje_usuario: 'Mejor, cosechamos 30 quintales hoy' },
      'trace-3',
    )
    expect(result.tipo).toBe('nuevo_evento')
  })

  it('retorna fallback nuevo_evento si el LLM devuelve JSON inválido', async () => {
    const adapter = mockAdapter({ tipo_malformado: true })
    const detector = new IntentDetector(adapter)
    const result = await detector.detectar(BASE_INPUT, 'trace-4')
    expect(result.tipo).toBe('nuevo_evento')
    expect(result.confianza).toBe(0)
  })

  it('retorna fallback nuevo_evento si el LLM lanza error', async () => {
    const adapter: ILLMAdapter = { generarTexto: vi.fn().mockRejectedValue(new Error('timeout')) }
    const detector = new IntentDetector(adapter)
    const result = await detector.detectar(BASE_INPUT, 'trace-5')
    expect(result.tipo).toBe('nuevo_evento')
    expect(result.confianza).toBe(0)
  })
})
