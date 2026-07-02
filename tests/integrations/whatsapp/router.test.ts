import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../../src/pipeline/procesarMensajeEntrante.js', () => ({
  procesarMensajeEntrante: vi.fn().mockResolvedValue(undefined),
  inicializarPipeline: vi.fn(),
}))

vi.mock('../../../src/workers/pgBoss.js', () => ({
  getBoss: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue('job-id-mock') })
}))

vi.mock('../../../src/pipeline/handlers/FounderManualReplyHandler.js', () => ({
  handleFounderManualReply: vi.fn().mockResolvedValue(undefined),
}))

import { Hono } from 'hono'
import { webhookRouter, inicializarRouter } from '../../../src/webhook/router.js'
import { getBoss } from '../../../src/workers/pgBoss.js'
import { handleFounderManualReply } from '../../../src/pipeline/handlers/FounderManualReplyHandler.js'
import type { IWhatsAppAdapter } from '../../../src/integrations/whatsapp/IWhatsAppAdapter.js'
import type { NormalizedMessage } from '../../../src/integrations/whatsapp/NormalizedMessage.js'

const msgMock: NormalizedMessage = {
  wamid: 'wamid.test-001',
  from: '593987654321',
  timestamp: new Date(),
  tipo: 'texto',
  texto: 'hola',
  rawPayload: { test: true },
}

// Cada test usa un wamid único — el dedup de webhooks (isDuplicate, ver
// router.ts) es un Set module-level compartido dentro del mismo archivo de
// test; reusar un wamid entre tests haría que el 2do request se descarte
// como duplicado ANTES de llegar a la lógica de ruteo bajo prueba, dando un
// falso verde.
let fromMeWamidCounter = 0
function crearMsgFromMe(): NormalizedMessage {
  fromMeWamidCounter += 1
  return {
    wamid: `wamid.test-fromme-${fromMeWamidCounter}`,
    from: '593987654321',
    timestamp: new Date(),
    tipo: 'texto',
    texto: 'te escribo directo',
    rawPayload: { test: true },
    esFromMe: true,
  }
}

let normalWamidCounter = 0
function crearMsgNormal(): NormalizedMessage {
  normalWamidCounter += 1
  return {
    wamid: `wamid.test-normal-${normalWamidCounter}`,
    from: '593987654321',
    timestamp: new Date(),
    tipo: 'texto',
    texto: 'hola',
    rawPayload: { test: true },
  }
}

function crearAdapterMock(valido: boolean, msg: NormalizedMessage | null = msgMock): IWhatsAppAdapter {
  return {
    verificarWebhook: vi.fn().mockResolvedValue(valido),
    parsearMensaje: vi.fn().mockReturnValue(msg),
  }
}

function crearApp(adapter: IWhatsAppAdapter) {
  inicializarRouter(adapter)
  const app = new Hono()
  app.route('/webhook', webhookRouter)
  return app
}

describe('POST /webhook/whatsapp', () => {
  it('retorna 403 con firma inválida', async () => {
    const app = crearApp(crearAdapterMock(false))
    const res = await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(403)
  })

  it('retorna 200 con firma válida y mensaje parseable', async () => {
    const app = crearApp(crearAdapterMock(true))
    const res = await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('received')
  })

  it('retorna 200 cuando parsearMensaje retorna null (mensaje desconocido)', async () => {
    const app = crearApp(crearAdapterMock(true, null))
    const res = await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ desconocido: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })

  it('llama a verificarWebhook en cada request', async () => {
    const adapter = crearAdapterMock(true)
    const app = crearApp(adapter)
    await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(adapter.verificarWebhook).toHaveBeenCalledOnce()
  })

  it('llama a parsearMensaje solo si la firma es válida', async () => {
    const adapter = crearAdapterMock(false)
    const app = crearApp(adapter)
    await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(adapter.parsearMensaje).not.toHaveBeenCalled()
  })
})

describe('POST /webhook/whatsapp — fromMe (founder-crm PR5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('un mensaje esFromMe=true se despacha a handleFounderManualReply y retorna 200', async () => {
    const msg = crearMsgFromMe()
    const app = crearApp(crearAdapterMock(true, msg))
    const res = await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(handleFounderManualReply).toHaveBeenCalledWith(
      expect.objectContaining({ wamid: msg.wamid, esFromMe: true }),
      expect.any(String),
    )
  })

  it('un mensaje esFromMe=true NUNCA se encola en pg-boss (nunca entra a procesarMensajeEntrante)', async () => {
    const msg = crearMsgFromMe()
    const app = crearApp(crearAdapterMock(true, msg))
    await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(getBoss().send).not.toHaveBeenCalled()
  })

  it('un mensaje normal (esFromMe ausente) sigue encolándose normalmente y NO llama a handleFounderManualReply', async () => {
    const msg = crearMsgNormal()
    const app = crearApp(crearAdapterMock(true, msg))
    await app.request('/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(handleFounderManualReply).not.toHaveBeenCalled()
    expect(getBoss().send).toHaveBeenCalled()
  })
})
