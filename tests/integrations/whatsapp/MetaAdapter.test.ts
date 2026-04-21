import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MetaAdapter } from '../../../src/integrations/whatsapp/MetaAdapter.js'
import metaTexto from '../../fixtures/meta-texto.json'
import metaAudio from '../../fixtures/meta-audio.json'

const APP_SECRET = 'test-secret'

function firmarPayload(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function mockContext(body: string, signature: string) {
  return {
    req: {
      raw: { clone: () => ({ text: async () => body }) },
      header: (name: string) => name === 'x-hub-signature-256' ? signature : undefined,
      query: (name: string) => name === 'hub.mode' ? 'subscribe' : name === 'hub.verify_token' ? 'verify-token' : name === 'hub.challenge' ? 'challenge-abc' : undefined,
    },
  } as any
}

describe('MetaAdapter', () => {
  const adapter = new MetaAdapter({ appSecret: APP_SECRET, verifyToken: 'verify-token' })

  describe('verificarWebhook', () => {
    it('retorna true con firma HMAC válida', async () => {
      const body = JSON.stringify(metaTexto)
      const sig = firmarPayload(body, APP_SECRET)
      expect(await adapter.verificarWebhook(mockContext(body, sig))).toBe(true)
    })

    it('retorna false con firma inválida', async () => {
      const body = JSON.stringify(metaTexto)
      expect(await adapter.verificarWebhook(mockContext(body, 'sha256=invalida'))).toBe(false)
    })

    it('retorna false sin firma', async () => {
      const body = JSON.stringify(metaTexto)
      expect(await adapter.verificarWebhook(mockContext(body, ''))).toBe(false)
    })
  })

  describe('parsearMensaje', () => {
    it('parsea mensaje de texto correctamente', () => {
      const msg = adapter.parsearMensaje(metaTexto)
      expect(msg).not.toBeNull()
      expect(msg!.tipo).toBe('texto')
      expect(msg!.wamid).toBe('wamid.meta_texto_001')
      expect(msg!.from).toBe('593987654321')
      expect(msg!.texto).toBe('Apliqué 2 bombadas de mancozeb en lote 3')
      expect(msg!.rawPayload).toEqual(metaTexto)
    })

    it('parsea mensaje de audio con mediaId', () => {
      const msg = adapter.parsearMensaje(metaAudio)
      expect(msg).not.toBeNull()
      expect(msg!.tipo).toBe('audio')
      expect(msg!.mediaId).toBe('MEDIA_ID_456')
      expect(msg!.audioUrl).toBeUndefined()
    })

    it('from siempre en E.164 (solo dígitos)', () => {
      const msg = adapter.parsearMensaje(metaTexto)
      expect(msg!.from).toMatch(/^\d+$/)
    })

    it('retorna null para payload desconocido', () => {
      expect(adapter.parsearMensaje({ raro: true })).toBeNull()
    })

    it('retorna null para payload null', () => {
      expect(adapter.parsearMensaje(null)).toBeNull()
    })

    it('preserva rawPayload (P5)', () => {
      const msg = adapter.parsearMensaje(metaTexto)
      expect(msg!.rawPayload).toEqual(metaTexto)
    })
  })
})
