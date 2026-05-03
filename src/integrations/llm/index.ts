import type { IWasagroLLM } from './IWasagroLLM.js'
import type { ILLMAdapter, ModelClass } from './ILLMAdapter.js'
import { GeminiAdapter } from './GeminiAdapter.js'
import { OllamaAdapter } from './OllamaAdapter.js'
import { GroqAdapter } from './GroqAdapter.js'
import { NvidiaAdapter } from './NvidiaAdapter.js'
import { LLMRouter } from './LLMRouter.js'
import { WasagroAIAgent } from './WasagroAIAgent.js'
import { langfuse } from '../langfuse.js'

export type LLMProvider = 'auto' | 'gemini' | 'ollama' | 'groq' | 'deepseek' | 'deepseek-ocr' | 'internvl' | 'glm' | 'minimax' | 'qwen' | 'gemma' | 'nemotron-ocr' | 'kimi-k2'

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
  if (provider === 'deepseek-ocr') {
    const apiKey = process.env['NVIDIA_OCR_KEY'] ?? process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('deepseek-ocr requiere NVIDIA_OCR_KEY o NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'deepseek-ai/deepseek-ocr-v2', extraParams: { top_p: 0.1, temperature: 0.05 } })
  }
  if (provider === 'internvl') {
    const apiKey = process.env['NVIDIA_INTERVL_KEY'] ?? process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('internvl requiere NVIDIA_INTERVL_KEY o NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'nvidia/internvl-3.0-78b', extraParams: { top_p: 0.1, temperature: 0.05 } })
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
  if (provider === 'nemotron-ocr') {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('nemotron-ocr requiere NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'nvidia/nemotron-ocr-v1', extraParams: { temperature: 0, top_p: 0.1, max_tokens: 8192 } })
  }
  if (provider === 'kimi-k2') {
    const apiKey = process.env['KIMI_K2_API_KEY'] ?? process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('kimi-k2 requiere KIMI_K2_API_KEY o NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'moonshotai/kimi-k2.6', extraParams: { max_tokens: 16384, temperature: 1.0, top_p: 1.0, chat_template_kwargs: { thinking: true } } })
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
    // Restauramos Gemini como principal porque los endpoints de Nvidia están dando Timeout (20s) y Error 500
    { name: 'Gemini', key: 'GEMINI_API_KEY', provider: 'gemini', tier: 'fast' },
    { name: 'Groq', key: 'GROQ_API_KEY', provider: 'groq', tier: 'fast' },
    { name: 'GLM-5.1', key: 'NVIDIA_GLM_KEY', provider: 'glm', tier: 'fast' },
    { name: 'Deepseek', key: 'NVIDIA_API_KEY', provider: 'deepseek', tier: 'fast' },

    // TIER 2 (Reasoning): Reflexión profunda, PDR/SR (ReAct)
    { name: 'Gemini', key: 'GEMINI_API_KEY', provider: 'gemini', tier: 'reasoning' },
    { name: 'Qwen', key: 'NVIDIA_QWEN_KEY', provider: 'qwen', tier: 'reasoning' },
    { name: 'Gemma-4', key: 'NVIDIA_GEMMA_KEY', provider: 'gemma', tier: 'reasoning' },
    { name: 'Deepseek', key: 'NVIDIA_API_KEY', provider: 'deepseek', tier: 'reasoning' },
    { name: 'GLM-5.1', key: 'NVIDIA_GLM_KEY', provider: 'glm', tier: 'reasoning' },

    // TIER 3 (Ultra): Casos críticos, Diagnóstico complejo, V2VK
    { name: 'Gemini', key: 'GEMINI_API_KEY', provider: 'gemini', tier: 'ultra' }, // Soporte Multimodal nativo
    { name: 'Minimax', key: 'NVIDIA_MINIMAX_KEY', provider: 'minimax', tier: 'ultra' },
    { name: 'Gemma-4', key: 'NVIDIA_GEMMA_KEY', provider: 'gemma', tier: 'ultra' },
    { name: 'Qwen', key: 'NVIDIA_QWEN_KEY', provider: 'qwen', tier: 'ultra' },

    // TIER 4 (OCR): Procesamiento de documentos manuscritos, box-free parsing
    { name: 'Nemotron-OCR-v1', key: 'NVIDIA_API_KEY', provider: 'nemotron-ocr', tier: 'ocr' },
    { name: 'Kimi-K2.6', key: 'KIMI_K2_API_KEY', provider: 'kimi-k2', tier: 'ocr' },
    { name: 'DeepSeek-OCR', key: 'NVIDIA_OCR_KEY', provider: 'deepseek-ocr', tier: 'ocr' },
    { name: 'InternVL', key: 'NVIDIA_INTERVL_KEY', provider: 'internvl', tier: 'ocr' },
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

    const hasOcrTier = pool.some(p => p.tier === 'ocr')
    if (!hasOcrTier) {
      const hasUltraTier = pool.some(p => p.tier === 'ultra')
      if (hasUltraTier) {
        console.warn('[llm] ⚠️ No hay adapters de tier OCR. Fallback a tier ultra para procesamiento de documentos.')
        pool.filter(p => p.tier === 'ultra').forEach(p => {
          pool.push({ name: `${p.name}-ocr-fallback`, adapter: p.adapter, tier: 'ocr' })
        })
      } else {
        console.warn('[llm] ⚠️ No hay adapters de tier OCR ni ultra. OCR de documentos no estará disponible.')
      }
    }

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
