import { describe, expect, it, vi } from 'vitest'
import { MetaSender } from '../../../src/integrations/whatsapp/MetaSender.js'

const config = { phoneNumberId: '123456789', accessToken: 'test-token' }

function crearFetchMock(status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => '',
  })
}

describe('MetaSender', () => {
  it('envía POST a Graph API con Authorization header', async () => {
    const fetchMock = crearFetchMock()
    const sender = new MetaSender({ ...config, fetchClient: fetchMock as any })

    await sender.enviarTexto('593987654321', 'Mensaje de prueba')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '593987654321',
      type: 'text',
      text: { body: 'Mensaje de prueba' },
    })
  })

  it('lanza error si la respuesta HTTP no es ok', async () => {
    const fetchMock = crearFetchMock(401)
    const sender = new MetaSender({ ...config, fetchClient: fetchMock as any })

    await expect(sender.enviarTexto('593987654321', 'hola')).rejects.toThrow('HTTP 401')
  })
})
