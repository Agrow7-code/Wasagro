import type { IWasagroLLM } from './IWasagroLLM.js'
import type { ILLMAdapter, ModelClass } from './ILLMAdapter.js'
import { GeminiAdapter } from './GeminiAdapter.js'
import { OllamaAdapter } from './OllamaAdapter.js'
import { GroqAdapter } from './GroqAdapter.js'
import { NvidiaAdapter } from './NvidiaAdapter.js'
import { LLMRouter } from './LLMRouter.js'
import { WasagroAIAgent } from './WasagroAIAgent.js'
import { langfuse } from '../langfuse.js'

export type LLMProvider = 'auto' | 'gemini' | 'ollama' | 'groq' | 'deepseek' | 'glm' | 'minimax' | 'qwen' | 'gemma'

function buildAdapter(provider: string): ILLMAdapter {
  if (provider === 'gemini') {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('gemini requiere GEMINI_API_KEY')
    return new GeminiAdapter({ apiKey })
  }
  if (provider === 'groq') {
    const apiKey = process.env['GROQ_API_KEY']
    if (!apiKey) throw new Error('groq requiere GROQ_API_KEY')
    return new GroqAdapter({ apiKey })
  }
  if (provider === 'deepseek') {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('deepseek requiere NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'deepseek-ai/deepseek-v4-pro', extraParams: { top_p: 0.95, chat_template_kwargs: { thinking: false } } })
  }
  if (provider === 'glm') {
    const apiKey = process.env['NVIDIA_GLM_KEY'] ?? process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('glm requiere NVIDIA_GLM_KEY')
    return new NvidiaAdapter({ apiKey, model: 'z-ai/glm-5.1', extraParams: { top_p: 1, chat_template_kwargs: { enable_thinking: true, clear_thinking: true } } })
  }
  if (provider === 'minimax') {
    const apiKey = process.env['NVIDIA_MINIMAX_KEY'] ?? process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('minimax requiere NVIDIA_MINIMAX_KEY')
    return new NvidiaAdapter({ apiKey, model: 'minimaxai/minimax-m2.7', extraParams: { top_p: 0.95 } })
  }
  if (provider === 'qwen') {
    const apiKey = process.env['NVIDIA_QWEN_KEY']
    if (!apiKey) throw new Error('qwen requiere NVIDIA_QWEN_KEY')
    return new NvidiaAdapter({ apiKey, model: 'qwen/qwen3.5-122b-a10b', extraParams: { top_p: 0.95, chat_template_kwargs: { enable_thinking: true, clear_thinking: true } } })
  }
  if (provider === 'gemma') {
    const apiKey = process.env['NVIDIA_GEMMA_KEY'] ?? process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('gemma requiere NVIDIA_GEMMA_KEY')
    return new NvidiaAdapter({ apiKey, model: 'google/gemma-4-31b-it', extraParams: { top_p: 0.95, chat_template_kwargs: { enable_thinking: true, clear_thinking: true } } })
  }
  if (provider === 'ollama') return new OllamaAdapter()
  throw new Error(`Provider desconocido: ${provider}`)
}

export function crearAdapterLLM(): ILLMAdapter {
  const provider = (process.env['WASAGRO_LLM'] ?? 'auto') as LLMProvider

  if (provider === 'auto') {
    // TIERED ROUTING POOL (Control activo de cuota y capacidades)
    const poolConfig: Array<{ name: string; key: string; provider: string; tier: ModelClass }> = [
      // TIER 1 (Fast): Extracción simple, clasificación rápida, sin penalización por fallos masivos
      { name: 'Groq',     key: 'GROQ_API_KEY',       provider: 'groq',     tier: 'fast' },
      { name: 'Gemini',   key: 'GEMINI_API_KEY',     provider: 'gemini',   tier: 'fast' }, 

      // TIER 2 (Reasoning): Reflexión profunda, PDR/SR (ReAct)
      { name: 'Deepseek', key: 'NVIDIA_API_KEY',     provider: 'deepseek', tier: 'reasoning' },
      { name: 'GLM-5.1',  key: 'NVIDIA_GLM_KEY',     provider: 'glm',      tier: 'reasoning' },
      { name: 'Gemini',   key: 'GEMINI_API_KEY',     provider: 'gemini',   tier: 'reasoning' },

      // TIER 3 (Ultra): Casos críticos, Diagnóstico complejo, V2VK
      { name: 'Minimax',  key: 'NVIDIA_MINIMAX_KEY', provider: 'minimax',  tier: 'ultra' },
      { name: 'Gemma-4',  key: 'NVIDIA_GEMMA_KEY',   provider: 'gemma',    tier: 'ultra' },
      { name: 'Qwen',     key: 'NVIDIA_QWEN_KEY',    provider: 'qwen',     tier: 'ultra' },
    ]

    const pool = []
    
    for (const config of poolConfig) {
      if (process.env[config.key] || (config.key.includes('NVIDIA_') && process.env['NVIDIA_API_KEY'])) {
        try {
          const adapter = buildAdapter(config.provider)
          pool.push({ name: config.name, adapter, tier: config.tier })
        } catch (e) {
           console.warn(`[llm] Saltando ${config.name} por error de inicialización`)
        }
      }
    }

    if (pool.length === 0) throw new Error('WASAGRO_LLM=auto requiere al menos una API key configurada')
    
    return new LLMRouter(pool, {
      onMetric: (m) => console.log(`[llm_router] Tier:${m.tier} | ${m.adapterName} ${m.success ? '✓' : '✗'} ${m.latencyMs}ms ${m.error ? '— ' + m.error.slice(0, 80) : ''}`)
    })
  }

  return buildAdapter(provider)
}

export function crearLLM(adapter?: ILLMAdapter): IWasagroLLM {
  return new WasagroAIAgent(adapter ?? crearAdapterLLM(), langfuse)
}

export type { IWasagroLLM }
export { LLMError } from './LLMError.js'
export type { LLMErrorCode } from './LLMError.js'
