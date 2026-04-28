import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'

export interface RouterMetric {
  adapter: number
  success: boolean
  latencyMs: number
  error?: string
}

export interface LLMRouterOptions {
  onMetric?: (metric: RouterMetric) => void
}

// 20s per adapter — prevents slow NVIDIA endpoints from blocking the chain for minutes
const ADAPTER_TIMEOUT_MS = 20_000

export class LLMRouter implements ILLMAdapter {
  readonly #adapters: readonly ILLMAdapter[]
  readonly #onMetric: ((metric: RouterMetric) => void) | undefined

  constructor(adapters: ILLMAdapter[], options: LLMRouterOptions = {}) {
    if (adapters.length === 0) throw new Error('[LLMRouter] Se requiere al menos un adapter')
    this.#adapters = adapters
    this.#onMetric = options.onMetric
  }

  async generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string> {
    let lastError: unknown

    for (let i = 0; i < this.#adapters.length; i++) {
      const adapter = this.#adapters[i]!
      const t0 = Date.now()

      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`adapter_timeout_${ADAPTER_TIMEOUT_MS}ms`)), ADAPTER_TIMEOUT_MS)
        )
        const result = await Promise.race([adapter.generarTexto(userContent, opciones), timeout])
        this.#onMetric?.({ adapter: i, success: true, latencyMs: Date.now() - t0 })
        return result
      } catch (err) {
        const latencyMs = Date.now() - t0
        lastError = err
        this.#onMetric?.({
          adapter: i,
          success: false,
          latencyMs,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    throw lastError
  }
}
