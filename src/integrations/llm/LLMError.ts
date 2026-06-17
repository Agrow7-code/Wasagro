export type LLMErrorCode =
  | 'OLLAMA_UNAVAILABLE'
  | 'GEMINI_ERROR'
  | 'GROQ_ERROR'
  | 'NVIDIA_ERROR'
  | 'PARSE_ERROR'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'REACT_ERROR'

export class LLMError extends Error {
  readonly code: LLMErrorCode
  readonly cause?: unknown

  constructor(code: LLMErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.cause = cause
  }
}

export type FalloLLM = 'rate_limit' | 'server' | 'timeout' | 'otro'

// Extrae un status HTTP numérico de las formas comunes de error de los SDKs
// (OpenAI: err.status; fetch-wrap: err.response.status) recorriendo la cadena de
// causas. Devuelve null si no hay un número de status reconocible.
function extraerStatus(err: unknown, depth = 0): number | null {
  if (err == null || depth > 3 || typeof err !== 'object') return null
  const e = err as Record<string, unknown>
  const candidatos = [e['status'], e['statusCode'], (e['response'] as Record<string, unknown> | undefined)?.['status']]
  for (const c of candidatos) {
    if (typeof c === 'number' && Number.isFinite(c)) return c
  }
  return extraerStatus(e['cause'], depth + 1)
}

// Concatena el mensaje del error y los de su cadena de causas, para poder
// inspeccionar el texto crudo del proveedor cuando no expone un status numérico.
function mensajeCompleto(err: unknown, depth = 0): string {
  if (err == null || depth > 3) return ''
  if (typeof err === 'string') return err
  if (typeof err !== 'object') return String(err)
  const e = err as Record<string, unknown>
  const msg = typeof e['message'] === 'string' ? e['message'] : ''
  return `${msg} ${mensajeCompleto(e['cause'], depth + 1)}`.trim()
}

// Clasifica un fallo de un adapter LLM en una categoría estructurada para que el
// router decida reintentar (transitorios) o fallar rápido. Prioriza la señal
// estructurada (LLMError.code → status numérico de la causa) y sólo cae a regex
// con WORD-BOUNDARY como último recurso. NUNCA usa `.includes('50')` u otro
// substring suelto que matchea números de latencia/tokens (el bug que reemplaza).
export function clasificarFalloLLM(err: unknown): FalloLLM {
  if (err instanceof LLMError && err.code === 'RATE_LIMIT') return 'rate_limit'

  const status = extraerStatus(err)
  if (status === 429) return 'rate_limit'
  if (status != null && status >= 500 && status < 600) return 'server'

  const msg = mensajeCompleto(err)
  if (/\b429\b/.test(msg) || /rate.?limit/i.test(msg) || /too many requests/i.test(msg)) return 'rate_limit'
  if (/\btimeout\b/i.test(msg) || /timed out/i.test(msg) || /adapter_timeout_/.test(msg)) return 'timeout'
  if (/\b5\d\d\b/.test(msg) || /\bECONN/i.test(msg) || /socket hang up/i.test(msg)) return 'server'
  return 'otro'
}

// Un fallo transitorio es recuperable esperando: el router puede reintentar.
export function esTransitorio(fallo: FalloLLM): boolean {
  return fallo !== 'otro'
}
