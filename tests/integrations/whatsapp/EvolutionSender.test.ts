import { describe, expect, it, vi } from 'vitest'
import { EvolutionSender } from '../../../src/integrations/whatsapp/EvolutionSender.js'

const config = { apiUrl: 'http://localhost:8080', apiKey: 'test-key', instance: 'default' }

function crearFetchMock(status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => '',
  })
}

describe('EvolutionSender', () => {
  it('envía POST al endpoint correcto con apikey header', async () => {
    const fetchMock = crearFetchMock()
    const sender = new EvolutionSender({ ...config, fetchClient: fetchMock as any })

    await sender.enviarTexto('593987654321', 'Hola agricultor')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8080/message/sendText/default')
    expect((init.headers as Record<string, string>)['apikey']).toBe('test-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ number: '593987654321', text: 'Hola agricultor' })
  })

  it('lanza error si la respuesta HTTP no es ok', async () => {
    const fetchMock = crearFetchMock(500)
    const sender = new EvolutionSender({ ...config, fetchClient: fetchMock as any })

    await expect(sender.enviarTexto('593987654321', 'hola')).rejects.toThrow('HTTP 500')
  })
})
