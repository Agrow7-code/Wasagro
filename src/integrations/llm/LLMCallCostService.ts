import { supabase } from '../supabase.js'
import type { ModelClass } from '../llm/ILLMAdapter.js'

interface LLMCallCostRecord {
  orgId: string | null
  fincaId: string | null
  provider: string
  model: string
  modelClass: ModelClass
  promptTokens: number
  completionTokens: number
  totalTokens: number
  traceId: string | null
  latencyMs: number | null
}

const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gemini-2.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
  'deepseek-ai/deepseek-v4-pro': { inputPer1M: 0.14, outputPer1M: 0.42 },
  'deepseek-ai/deepseek-ocr-v2': { inputPer1M: 0.14, outputPer1M: 0.42 },
  'nvidia/nemotron-ocr-v1': { inputPer1M: 0.16, outputPer1M: 0.16 },
  'moonshotai/kimi-k2.6': { inputPer1M: 0.60, outputPer1M: 2.50 },
  'nvidia/internvl-3.0-78b': { inputPer1M: 0.16, outputPer1M: 0.16 },
  'z-ai/glm-5.1': { inputPer1M: 0.14, outputPer1M: 0.42 },
  'minimaxai/minimax-m2.7': { inputPer1M: 0.16, outputPer1M: 0.16 },
  'qwen/qwen3.5-122b-a10b': { inputPer1M: 0.18, outputPer1M: 0.54 },
  'google/gemma-4-31b-it': { inputPer1M: 0.12, outputPer1M: 0.36 },
}

function calculateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M
  return Number((inputCost + outputCost).toFixed(6))
}

export function recordLLMCallCost(params: LLMCallCostRecord): void {
  if (params.totalTokens === 0 && params.promptTokens === 0 && params.completionTokens === 0) return

  const costUsd = calculateCostUsd(params.model, params.promptTokens, params.completionTokens)

  const insert: Record<string, unknown> = {
    provider: params.provider,
    model: params.model,
    model_class: params.modelClass,
    prompt_tokens: params.promptTokens,
    completion_tokens: params.completionTokens,
    total_tokens: params.totalTokens,
    cost_usd: costUsd,
    trace_id: params.traceId,
    latency_ms: params.latencyMs,
  }

  if (params.orgId) insert.org_id = params.orgId
  if (params.fincaId) insert.finca_id = params.fincaId

  supabase.from('llm_call_costs').insert(insert).then(({ error }) => {
    if (error) console.error('[LLMCallCostService] Error registrando costo LLM:', error.message)
  })
}

export { MODEL_PRICING, calculateCostUsd }
