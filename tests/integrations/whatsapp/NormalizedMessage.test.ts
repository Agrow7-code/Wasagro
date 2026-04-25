import { describe, expect, it } from 'vitest'
import { NormalizedMessageSchema } from '../../../src/integrations/whatsapp/NormalizedMessage.js'

describe('NormalizedMessageSchema', () => {
  const base = {
    wamid: 'wamid.abc123',
    from: '593987654321',
    timestamp: new Date(),
    tipo: 'texto' as const,
    rawPayload: { original: true },
  }

  it('valida un mensaje de texto válido', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, texto: 'hola' })
    expect(result.success).toBe(true)
  })

  it('valida un mensaje de audio con audioUrl', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, tipo: 'audio', audioUrl: 'https://cdn.example.com/audio.opus' })
    expect(result.success).toBe(true)
  })

  it('valida un mensaje con mediaId (Meta audio)', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, tipo: 'audio', mediaId: 'media-123' })
    expect(result.success).toBe(true)
  })

  it('valida tipo otro sin campos opcionales', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, tipo: 'otro' })
    expect(result.success).toBe(true)
  })

  it('falla si from no es E.164 (contiene @)', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, from: '593987654321@s.whatsapp.net' })
    expect(result.success).toBe(false)
  })

  it('falla si falta wamid', () => {
    const { wamid: _, ...sinWamid } = base
    const result = NormalizedMessageSchema.safeParse(sinWamid)
    expect(result.success).toBe(false)
  })

  it('falla si falta rawPayload', () => {
    const { rawPayload: _, ...sinRaw } = base
    const result = NormalizedMessageSchema.safeParse(sinRaw)
    expect(result.success).toBe(false)
  })

  it('valida mensaje de ubicacion con latitud y longitud', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, tipo: 'ubicacion', latitud: -1.2345, longitud: -79.5678 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.latitud).toBe(-1.2345)
      expect(result.data.longitud).toBe(-79.5678)
    }
  })

  it('tipo debe ser uno de los valores permitidos', () => {
    const result = NormalizedMessageSchema.safeParse({ ...base, tipo: 'video' })
    expect(result.success).toBe(false)
  })
})
