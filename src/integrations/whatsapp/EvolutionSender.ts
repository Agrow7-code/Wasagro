import type { IWhatsAppSender } from './IWhatsAppSender.js'

interface EvolutionSenderConfig {
  apiUrl: string
  apiKey: string
  instance: string
  fetchClient?: typeof fetch
}

export class EvolutionSender implements IWhatsAppSender {
  readonly #apiUrl: string
  readonly #apiKey: string
  readonly #instance: string
  readonly #fetch: typeof fetch

  constructor(config: EvolutionSenderConfig) {
    this.#apiUrl = config.apiUrl
    this.#apiKey = config.apiKey
    this.#instance = config.instance
    this.#fetch = config.fetchClient ?? globalThis.fetch
  }

  async enviarTexto(to: string, texto: string): Promise<void> {
    const url = `${this.#apiUrl}/message/sendText/${this.#instance}`
    const res = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.#apiKey,
      },
      body: JSON.stringify({ number: to, text: texto }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`[EvolutionSender] HTTP ${res.status} al enviar mensaje: ${detail}`)
    }
  }
}
