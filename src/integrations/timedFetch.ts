const DEFAULT_TIMEOUT_MS = 15_000

export function timedFetch(timeoutMs = DEFAULT_TIMEOUT_MS): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await globalThis.fetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}
