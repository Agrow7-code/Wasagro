import type { IWasagroLLM } from './IWasagroLLM.js'
import type { ILLMAdapter } from './ILLMAdapter.js'
import { GeminiAdapter } from './GeminiAdapter.js'
import { OllamaAdapter } from './OllamaAdapter.js'
import { GroqAdapter } from './GroqAdapter.js'
import { NvidiaAdapter } from './NvidiaAdapter.js'
import { LLMRouter } from './LLMRouter.js'
import { WasagroAIAgent } from './WasagroAIAgent.js'
import { langfuse } from '../langfuse.js'

export type LLMProvider = 'auto' | 'gemini' | 'ollama' | 'groq' | 'deepseek' | 'glm' | 'minimax' | 'qwen'

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
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('glm requiere NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'z-ai/glm-5.1', extraParams: { top_p: 1, chat_template_kwargs: { enable_thinking: true, clear_thinking: false } } })
  }
  if (provider === 'minimax') {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('minimax requiere NVIDIA_API_KEY')
    return new NvidiaAdapter({ apiKey, model: 'minimaxai/minimax-m2.7', extraParams: { top_p: 0.95 } })
  }
  if (provider === 'qwen') {
    const apiKey = process.env['NVIDIA_QWEN_KEY']
    if (!apiKey) throw new Error('qwen requiere NVIDIA_QWEN_KEY')
    return new NvidiaAdapter({ apiKey, model: 'qwen/qwen3.5-122b-a10b', extraParams: { top_p: 0.95, chat_template_kwargs: { enable_thinking: true } } })
  }
  if (provider === 'ollama') return new OllamaAdapter()
  throw new Error(`Provider desconocido: ${provider}`)
}

export function crearAdapterLLM(): ILLMAdapter {
  const provider = (process.env['WASAGRO_LLM'] ?? 'auto') as LLMProvider

  // Modo auto: fallback chain Groq → Gemini → Deepseek
  if (provider === 'auto') {
    const adapters: ILLMAdapter[] = []
    if (process.env['GROQ_API_KEY']) adapters.push(buildAdapter('groq'))
    if (process.env['GEMINI_API_KEY']) adapters.push(buildAdapter('gemini'))
    if (process.env['NVIDIA_API_KEY']) adapters.push(buildAdapter('deepseek'))
    if (adapters.length === 0) throw new Error('WASAGRO_LLM=auto requiere al menos GROQ_API_KEY o GEMINI_API_KEY')
    console.log(`[llm] modo auto — cadena: ${adapters.length} adapter(s)`)
    return new LLMRouter(adapters, {
      onMetric: (m) => console.log(`[llm] adapter[${m.adapter}] ${m.success ? '✓' : '✗'} ${m.latencyMs}ms${m.error ? ' — ' + m.error.slice(0, 80) : ''}`)
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
