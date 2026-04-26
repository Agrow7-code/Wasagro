import type { IWasagroLLM } from './IWasagroLLM.js'
import { GeminiAdapter } from './GeminiAdapter.js'
import { OllamaAdapter } from './OllamaAdapter.js'
import { GroqAdapter } from './GroqAdapter.js'
import { NvidiaAdapter } from './NvidiaAdapter.js'
import { WasagroAIAgent } from './WasagroAIAgent.js'
import { langfuse } from '../langfuse.js'

export type LLMProvider = 'gemini' | 'ollama' | 'groq' | 'deepseek' | 'glm' | 'minimax' | 'qwen'

export function crearLLM(): IWasagroLLM {
  const provider = process.env['WASAGRO_LLM'] as LLMProvider | undefined

  let adapter

  if (provider === 'gemini') {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=gemini requiere GEMINI_API_KEY')
    adapter = new GeminiAdapter({ apiKey })
  } else if (provider === 'ollama') {
    adapter = new OllamaAdapter()
  } else if (provider === 'groq') {
    const apiKey = process.env['GROQ_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=groq requiere GROQ_API_KEY')
    adapter = new GroqAdapter({ apiKey })
  } else if (provider === 'deepseek') {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=deepseek requiere NVIDIA_API_KEY')
    adapter = new NvidiaAdapter({ 
      apiKey, 
      model: 'deepseek-ai/deepseek-v4-pro',
      extraParams: { top_p: 0.95, chat_template_kwargs: { thinking: false } }
    })
  } else if (provider === 'glm') {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=glm requiere NVIDIA_API_KEY')
    adapter = new NvidiaAdapter({ 
      apiKey, 
      model: 'z-ai/glm-5.1',
      extraParams: { top_p: 1, chat_template_kwargs: { enable_thinking: true, clear_thinking: false } }
    })
  } else if (provider === 'minimax') {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=minimax requiere NVIDIA_API_KEY')
    adapter = new NvidiaAdapter({ 
      apiKey, 
      model: 'minimaxai/minimax-m2.7',
      extraParams: { top_p: 0.95 }
    })
  } else if (provider === 'qwen') {
    const apiKey = process.env['NVIDIA_QWEN_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=qwen requiere NVIDIA_QWEN_KEY')
    adapter = new NvidiaAdapter({ 
      apiKey, 
      model: 'qwen/qwen3.5-122b-a10b',
      extraParams: { top_p: 0.95, chat_template_kwargs: { enable_thinking: true } }
    })
  } else {
    throw new Error(
      `WASAGRO_LLM="${provider ?? ''}" no es válido. Valores aceptados: gemini | ollama | groq | deepseek | glm | minimax | qwen`
    )
  }

  return new WasagroAIAgent(adapter, langfuse)
}

export type { IWasagroLLM }
export { LLMError } from './LLMError.js'
export type { LLMErrorCode } from './LLMError.js'
