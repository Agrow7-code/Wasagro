import type { ILLMAdapter, LLMGeneracionOpciones, ModelClass } from './ILLMAdapter.js'

export interface RouterMetric {
  adapterName: string
  tier: ModelClass
  success: boolean
  latencyMs: number
  error?: string
}

export interface LLMRouterOptions {
  onMetric?: (metric: RouterMetric) => void
}

export interface RouterNode {
  name: string
  adapter: ILLMAdapter
  tier: ModelClass
  failures: number
  nextAvailableAt: number
}

const ADAPTER_TIMEOUT_MS = 20_000 // 20s hard limit per adapter
const WAIT_BACKOFF_MS = 3_000 // 3s delay base on 429 Rate Limit
const STOP_DURATION_MS = 60_000 // 1m penalty on full crash (500 or timeout)

export class LLMRouter implements ILLMAdapter {
  readonly #nodes: RouterNode[]
  readonly #onMetric: ((metric: RouterMetric) => void) | undefined

  constructor(
    adapters: { name: string; adapter: ILLMAdapter; tier: ModelClass }[],
    options: LLMRouterOptions = {}
  ) {
    if (adapters.length === 0) throw new Error('[LLMRouter] Se requiere al menos un adapter en el pool')
    
    this.#nodes = adapters.map(a => ({
      name: a.name,
      adapter: a.adapter,
      tier: a.tier,
      failures: 0,
      nextAvailableAt: 0,
    }))
    this.#onMetric = options.onMetric
  }

  // El router es tool-capaz si ALGÚN nodo lo es (rutea las tools a ese nodo).
  get supportsTools(): boolean {
    return this.#nodes.some(n => n.adapter.supportsTools === true)
  }

  async generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string> {
    const targetTier = opciones.modelClass ?? 'reasoning'
    let availableNodes = this.#nodes.filter(n => n.tier === targetTier)

    if (availableNodes.length === 0) {
      throw new Error(`[LLMRouter] No hay adaptadores configurados para el tier: ${targetTier}`)
    }

    // Routing por capacidad: si la petición pide tools, SOLO se enruta a adapters
    // tool-capaces. Servir una petición con tools en un adapter que las ignora
    // haría que el modelo respondiera sin poder consultar la DB → riesgo de
    // inventar datos (P1). Si no hay nodo tool-capaz disponible, se falla
    // explícito (el worker reintenta cuando el nodo vuelva) en vez de degradar
    // en silencio a una respuesta sin herramientas.
    const requiereTools = !!(opciones.tools && opciones.tools.length > 0)
    if (requiereTools) {
      const toolNodes = availableNodes.filter(n => n.adapter.supportsTools === true)
      if (toolNodes.length === 0) {
        const msg = `[LLMRouter] Petición con tools en tier '${targetTier}' sin ningún adapter tool-capaz configurado`
        this.#onMetric?.({ adapterName: 'none', tier: targetTier, success: false, latencyMs: 0, error: 'no_tool_capable_adapter' })
        throw new Error(msg)
      }
      availableNodes = toolNodes
    }

    let lastError: unknown

    for (const node of availableNodes) {
      const now = Date.now()
      
      // STOP Strategy: Skip dead nodes proactively
      if (now < node.nextAvailableAt) {
        console.warn(`[LLMRouter] 🛑 SKIP ${node.name} (En penalty hasta ${new Date(node.nextAvailableAt).toISOString()})`)
        continue
      }

      const t0 = Date.now()
      const effectiveTimeout = opciones.timeoutMs ?? ADAPTER_TIMEOUT_MS

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`adapter_timeout_${effectiveTimeout}ms`)), effectiveTimeout)
        )
        
        // Ejecución competitiva con timeout
        const result = await Promise.race([node.adapter.generarTexto(userContent, opciones), timeoutPromise])
        
        // Success -> Reset health status
        node.failures = 0
        node.nextAvailableAt = 0
        
        this.#onMetric?.({ adapterName: node.name, tier: node.tier, success: true, latencyMs: Date.now() - t0 })
        return result

      } catch (err: any) {
        const latencyMs = Date.now() - t0
        const errMsg = err instanceof Error ? err.message : String(err)
        lastError = err

        node.failures++

        // WAIT-CAP-STOP Strategies
        if (errMsg.includes('429') || errMsg.includes('Rate limit')) {
          // WAIT: Exponencial backoff para rate limits
          const penalty = WAIT_BACKOFF_MS * Math.pow(2, node.failures - 1)
          node.nextAvailableAt = Date.now() + penalty
          console.warn(`[LLMRouter] ⏳ WAIT ${node.name} (429 Rate Limit) -> Penalty: ${penalty}ms`)
        } else if (errMsg.includes('50') || errMsg.includes('timeout')) {
          // STOP: Si el proveedor está caído o súper lento 2 veces seguidas, lo sacamos del pool temporalmente
          if (node.failures >= 2) {
            node.nextAvailableAt = Date.now() + STOP_DURATION_MS
            console.error(`[LLMRouter] 🛑 STOP ${node.name} (Server Error) -> Aislado por 1 minuto`)
          }
        }

        this.#onMetric?.({
          adapterName: node.name,
          tier: node.tier,
          success: false,
          latencyMs,
          error: errMsg,
        })
      }
    }

    throw new Error(`[LLMRouter] Cadena fallida para Tier '${targetTier}'. Todos los nodos agotaron intentos. Último error: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  }
}
