import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EvolutionAdapter } from '../../../src/integrations/whatsapp/EvolutionAdapter.js'
import evoTexto from '../../fixtures/evolution-texto.json'
import evoAudio from '../../fixtures/evolution-audio.json'

const SECRET = 'evo-secret'

function firmarPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function mockContext(body: string, signature: string) {
  return {
    req: {
      raw: { clone: () => ({ text: async () => body }) },
      header: (name: string) => name === 'x-evolution-signature' ? signature : undefined,
    },
  } as any
}

describe('EvolutionAdapter', () => {
  const adapter = new EvolutionAdapter({ secret: SECRET })

  describe('verificarWebhook', () => {
    it('retorna true con firma válida', async () => {
      const body = JSON.stringify(evoTexto)
      const sig = firmarPayload(body, SECRET)
      expect(await adapter.verificarWebhook(mockContext(body, sig))).toBe(true)
    })

    it('retorna false con firma inválida', async () => {
      const body = JSON.stringify(evoTexto)
      expect(await adapter.verificarWebhook(mockContext(body, 'invalida'))).toBe(false)
    })
  })

  describe('parsearMensaje', () => {
    it('parsea mensaje de texto correctamente', () => {
      const msg = adapter.parsearMensaje(evoTexto)
      expect(msg).not.toBeNull()
      expect(msg!.tipo).toBe('texto')
      expect(msg!.wamid).toBe('wamid.evo_texto_001')
      expect(msg!.from).toBe('593987654321')
      expect(msg!.texto).toBe('Apliqué 2 bombadas de mancozeb en lote 3')
    })

    it('elimina @s.whatsapp.net del from (E.164)', () => {
      const msg = adapter.parsearMensaje(evoTexto)
      expect(msg!.from).toMatch(/^\d+$/)
      expect(msg!.from).not.toContain('@')
    })

    it('parsea mensaje de audio con audioUrl', () => {
      const msg = adapter.parsearMensaje(evoAudio)
      expect(msg).not.toBeNull()
      expect(msg!.tipo).toBe('audio')
      expect(msg!.audioUrl).toBe('https://cdn.evolution-api.com/audio/abc123.opus')
    })

    it('retorna null para payload desconocido', () => {
      expect(adapter.parsearMensaje({ raro: true })).toBeNull()
    })

    it('preserva rawPayload (P5)', () => {
      const msg = adapter.parsearMensaje(evoTexto)
      expect(msg!.rawPayload).toEqual(evoTexto)
    })
  })
})
