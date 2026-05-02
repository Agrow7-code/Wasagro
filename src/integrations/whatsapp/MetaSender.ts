import type { IWhatsAppSender } from './IWhatsAppSender.js'

interface MetaSenderConfig {
  phoneNumberId: string
  accessToken: string
  fetchClient?: typeof fetch
}

export class MetaSender implements IWhatsAppSender {
  readonly #phoneNumberId: string
  readonly #accessToken: string
  readonly #fetch: typeof fetch

  constructor(config: MetaSenderConfig) {
    this.#phoneNumberId = config.phoneNumberId
    this.#accessToken = config.accessToken
    this.#fetch = config.fetchClient ?? globalThis.fetch
  }

  async enviarTexto(to: string, texto: string): Promise<void> {
    const url = `https://graph.facebook.com/v21.0/${this.#phoneNumberId}/messages`
    const res = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: texto },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`[MetaSender] HTTP ${res.status} al enviar mensaje: ${detail}`)
    }
  }

  async enviarTemplate(to: string, templateName: string, language = 'es'): Promise<void> {
    const url = `https://graph.facebook.com/v21.0/${this.#phoneNumberId}/messages`
    const res = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language }
        }
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`[MetaSender] HTTP ${res.status} al enviar template: ${detail}`)
    }
  }
}
