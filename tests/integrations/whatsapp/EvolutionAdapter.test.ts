import { describe, expect, it } from 'vitest'
import { EvolutionAdapter } from '../../../src/integrations/whatsapp/EvolutionAdapter.js'
import evoTexto from '../../fixtures/evolution-texto.json'
import evoAudio from '../../fixtures/evolution-audio.json'
import evoUbicacion from '../../fixtures/evolution-ubicacion.json'
import evoFromMeTexto from '../../fixtures/evolution-fromme-texto.json'

const SECRET = 'bearer-secret-token'

// Builds a fake Hono Context with the given X-Webhook-Token header.
// Evolution API sends this header via WEBHOOK_GLOBAL_HEADERS, configured per
// instance via POST /webhook/set/{instance}. The adapter does a timing-safe
// compare against EVOLUTION_WEBHOOK_SECRET. See commit 35977ff for the
// HMAC -> bearer migration rationale and runtime impl.
function mockContext(token: string | undefined) {
  return {
    req: {
      raw: { clone: () => ({ text: async () => '' }) },
      header: (name: string) => name === 'x-webhook-token' ? token : undefined,
    },
  } as any
}

describe('EvolutionAdapter', () => {
  const adapter = new EvolutionAdapter({ secret: SECRET })

  describe('verificarWebhook', () => {
    it('retorna true cuando el header X-Webhook-Token coincide con el secret', async () => {
      expect(await adapter.verificarWebhook(mockContext(SECRET))).toBe(true)
    })

    it('retorna false cuando el token no coincide', async () => {
      expect(await adapter.verificarWebhook(mockContext('token-invalido'))).toBe(false)
    })

    it('retorna false cuando el header viene ausente', async () => {
      expect(await adapter.verificarWebhook(mockContext(undefined))).toBe(false)
    })

    it('retorna false cuando el secret del adapter está vacío (fail-closed)', async () => {
      const sinSecret = new EvolutionAdapter({ secret: '' })
      expect(await sinSecret.verificarWebhook(mockContext(SECRET))).toBe(false)
    })

    it('retorna false aunque el token sea prefijo del secret (length mismatch)', async () => {
      // Evita la trampa de strncmp / startsWith: timingSafeEqual exige misma longitud.
      expect(await adapter.verificarWebhook(mockContext(SECRET.slice(0, 5)))).toBe(false)
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

    it('parsea mensaje de ubicacion con lat/lng', () => {
      const msg = adapter.parsearMensaje(evoUbicacion)
      expect(msg).not.toBeNull()
      expect(msg!.tipo).toBe('ubicacion')
      expect(msg!.latitud).toBe(-1.2345)
      expect(msg!.longitud).toBe(-79.5678)
    })

    it('retorna null para payload desconocido', () => {
      expect(adapter.parsearMensaje({ raro: true })).toBeNull()
    })

    it('preserva rawPayload (P5)', () => {
      const msg = adapter.parsearMensaje(evoTexto)
      expect(msg!.rawPayload).toEqual(evoTexto)
    })

    it('un mensaje normal (no fromMe) no trae esFromMe en true', () => {
      const msg = adapter.parsearMensaje(evoTexto)
      expect(msg!.esFromMe).not.toBe(true)
    })

    it('un mensaje fromMe (founder-crm PR5) se etiqueta esFromMe=true en vez de descartarse', () => {
      const msg = adapter.parsearMensaje(evoFromMeTexto)
      expect(msg).not.toBeNull()
      expect(msg!.esFromMe).toBe(true)
      expect(msg!.tipo).toBe('texto')
      expect(msg!.texto).toBe('hola, te escribo yo directo')
    })

    it('fromMe: from() es el remoteJid (destinatario del mensaje), no el founder', () => {
      const msg = adapter.parsearMensaje(evoFromMeTexto)
      expect(msg!.from).toBe('593987654321')
    })

    it('fromMe=true en un JID de grupo (@g.us) sigue descartándose (regression guard: el filtro de JID no-individual va ANTES del tagging de esFromMe)', () => {
      const payloadGrupoFromMe = {
        ...evoFromMeTexto,
        data: {
          ...evoFromMeTexto.data,
          key: { ...evoFromMeTexto.data.key, remoteJid: '120363000000000000@g.us' },
        },
      }
      expect(adapter.parsearMensaje(payloadGrupoFromMe)).toBeNull()
    })

    it('fromMe=true en un JID de broadcast (@broadcast) sigue descartándose', () => {
      const payloadBroadcastFromMe = {
        ...evoFromMeTexto,
        data: {
          ...evoFromMeTexto.data,
          key: { ...evoFromMeTexto.data.key, remoteJid: 'status@broadcast' },
        },
      }
      expect(adapter.parsearMensaje(payloadBroadcastFromMe)).toBeNull()
    })
  })
})
