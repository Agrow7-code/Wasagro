import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

import { getConversacionesList, getConversacionThread, getSDRProspectoById } from '../../src/pipeline/supabaseQueries.js'
import type { getSignedUrlEvento } from '../../src/integrations/supabaseStorage.js'

function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function crearSupabaseMock() {
  return { from: vi.fn() }
}

describe('supabaseQueries — conversaciones (T-H2.1, T-H2.2)', () => {
  describe('getConversacionesList', () => {
    it('does ONE round-trip against sdr_prospectos, ordered by ultima_interaccion DESC', async () => {
      const mock = crearSupabaseMock()
      const builder = queryBuilder({
        data: [
          { id: 'p1', phone: '593987654321', nombre: 'Carlos', empresa: null, status: 'en_discovery', handoff_status: 'bot', handoff_reason: null, founder_notified_at: null, ultima_interaccion: '2026-07-01T10:00:00Z' },
        ],
        error: null,
      })
      mock.from.mockReturnValue(builder)

      const result = await getConversacionesList(mock as any)

      expect(mock.from).toHaveBeenCalledTimes(1)
      expect(mock.from).toHaveBeenCalledWith('sdr_prospectos')
      expect(builder['select']).toHaveBeenCalledWith(
        'id, phone, nombre, empresa, status, handoff_status, handoff_reason, founder_notified_at, ultima_interaccion',
      )
      expect(builder['order']).toHaveBeenCalledWith('ultima_interaccion', { ascending: false })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'p1' })
    })

    it('propagates a Supabase error instead of swallowing it', async () => {
      const mock = crearSupabaseMock()
      mock.from.mockReturnValue(queryBuilder({ data: null, error: new Error('boom') }))

      await expect(getConversacionesList(mock as any)).rejects.toThrow('boom')
    })
  })

  describe('getConversacionThread', () => {
    it('builds the thread from mensajes_entrada (inbound) + sdr_interacciones outbound only, tagged by origen', async () => {
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [{ id: 'm1', phone: '593987654321', contenido_raw: 'hola', created_at: '2026-07-01T10:00:00Z' }],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({
        data: [{ id: 'i1', prospecto_id: 'p1', tipo: 'outbound', contenido: 'hi back', created_at: '2026-07-01T10:05:00Z' }],
        error: null,
      })
      mock.from
        .mockReturnValueOnce(prospectoBuilder)
        .mockReturnValueOnce(mensajesBuilder)
        .mockReturnValueOnce(interaccionesBuilder)

      const result = await getConversacionThread('p1', mock as any)

      expect(mock.from).toHaveBeenNthCalledWith(1, 'sdr_prospectos')
      expect(prospectoBuilder['eq']).toHaveBeenCalledWith('id', 'p1')
      expect(mock.from).toHaveBeenNthCalledWith(2, 'mensajes_entrada')
      expect(mensajesBuilder['eq']).toHaveBeenCalledWith('phone', '593987654321')
      expect(mock.from).toHaveBeenNthCalledWith(3, 'sdr_interacciones')
      expect(interaccionesBuilder['eq']).toHaveBeenCalledWith('prospecto_id', 'p1')

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'm1', origen: 'mensajes_entrada', direction: 'inbound' })
      expect(result[1]).toMatchObject({ id: 'i1', origen: 'sdr_interacciones', direction: 'outbound' })
    })

    it('returns [] without throwing when the prospecto id does not exist', async () => {
      const mock = crearSupabaseMock()
      mock.from.mockReturnValueOnce(queryBuilder({ data: null, error: null }))

      const result = await getConversacionThread('unknown-id', mock as any)

      expect(result).toEqual([])
      expect(mock.from).toHaveBeenCalledTimes(1)
    })

    it('EXCLUDES sdr_interacciones inbound + meeting_confirmation rows (inbound comes only from mensajes_entrada — no duplicates)', async () => {
      // Regression for the real prod bug (phones 573108059563 / 573222883844):
      // the same prospect message is logged to BOTH mensajes_entrada AND
      // sdr_interacciones (as 'inbound' or 'meeting_confirmation'), seconds
      // apart. Reading inbound from both duplicated it. Now inbound is taken
      // from mensajes_entrada only; the sdr inbound/meeting_confirmation copies
      // are excluded. Only genuine outbound sdr rows are kept.
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [{ id: 'm1', phone: '593987654321', contenido_raw: 'hola', created_at: '2026-07-01T10:00:00Z' }],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({
        data: [
          { id: 'i1', prospecto_id: 'p1', tipo: 'inbound', contenido: 'hola', created_at: '2026-07-01T10:00:07Z' },
          { id: 'i2', prospecto_id: 'p1', tipo: 'meeting_confirmation', contenido: 'estamos esperando', created_at: '2026-07-01T10:01:00Z' },
          { id: 'i3', prospecto_id: 'p1', tipo: 'founder_override', contenido: 'te ayudo enseguida', created_at: '2026-07-01T10:02:00Z' },
        ],
        error: null,
      })
      mock.from
        .mockReturnValueOnce(prospectoBuilder)
        .mockReturnValueOnce(mensajesBuilder)
        .mockReturnValueOnce(interaccionesBuilder)

      const result = await getConversacionThread('p1', mock as any)

      // m1 (inbound, from mensajes_entrada) + i3 (outbound founder). i1 + i2 excluded.
      expect(result).toHaveLength(2)
      expect(result.find((r) => r['id'] === 'm1')).toMatchObject({ direction: 'inbound', origen: 'mensajes_entrada' })
      expect(result.find((r) => r['id'] === 'i3')).toMatchObject({ direction: 'outbound', isFounder: true })
      expect(result.find((r) => r['id'] === 'i1')).toBeUndefined()
      expect(result.find((r) => r['id'] === 'i2')).toBeUndefined()
    })

    it('shows a placeholder for an audio/image inbound (contenido_raw is null)', async () => {
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [{ id: 'm1', phone: '593987654321', contenido_raw: null, created_at: '2026-07-01T10:00:00Z' }],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({ data: [], error: null })
      mock.from
        .mockReturnValueOnce(prospectoBuilder)
        .mockReturnValueOnce(mensajesBuilder)
        .mockReturnValueOnce(interaccionesBuilder)

      const result = await getConversacionThread('p1', mock as any)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'm1', direction: 'inbound', contenido: '[audio o imagen]' })
    })

    it('orders the thread by created_at across both sources', async () => {
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [
          { id: 'm1', phone: '593987654321', contenido_raw: 'primero', created_at: '2026-07-01T10:00:00Z' },
          { id: 'm2', phone: '593987654321', contenido_raw: 'tercero', created_at: '2026-07-01T10:10:00Z' },
        ],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({
        data: [{ id: 'i1', prospecto_id: 'p1', tipo: 'founder_override', contenido: 'segundo', created_at: '2026-07-01T10:05:00Z' }],
        error: null,
      })
      mock.from
        .mockReturnValueOnce(prospectoBuilder)
        .mockReturnValueOnce(mensajesBuilder)
        .mockReturnValueOnce(interaccionesBuilder)

      const result = await getConversacionThread('p1', mock as any)

      expect(result.map((r) => r['id'])).toEqual(['m1', 'i1', 'm2'])
    })

    it('an inbound row with media_path gets media_url (via the signed-url helper) + media_tipo', async () => {
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [
          {
            id: 'm1', phone: '593987654321', contenido_raw: null, tipo_mensaje: 'image',
            media_path: 'sdr/593987654321/uuid1.jpg', created_at: '2026-07-01T10:00:00Z',
          },
          {
            id: 'm2', phone: '593987654321', contenido_raw: null, tipo_mensaje: 'audio',
            media_path: 'sdr/593987654321/uuid2.ogg', created_at: '2026-07-01T10:01:00Z',
          },
          { id: 'm3', phone: '593987654321', contenido_raw: 'hola', tipo_mensaje: 'text', media_path: null, created_at: '2026-07-01T10:02:00Z' },
        ],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({ data: [], error: null })
      mock.from
        .mockReturnValueOnce(prospectoBuilder)
        .mockReturnValueOnce(mensajesBuilder)
        .mockReturnValueOnce(interaccionesBuilder)

      const getSignedUrl = vi.fn<typeof getSignedUrlEvento>().mockResolvedValue('https://signed.example/media')

      const result = await getConversacionThread('p1', mock as any, getSignedUrl)

      const imageItem = result.find((r) => r['id'] === 'm1')!
      const audioItem = result.find((r) => r['id'] === 'm2')!
      const textItem = result.find((r) => r['id'] === 'm3')!

      expect(getSignedUrl).toHaveBeenCalledWith('sdr/593987654321/uuid1.jpg')
      expect(getSignedUrl).toHaveBeenCalledWith('sdr/593987654321/uuid2.ogg')
      expect(imageItem).toMatchObject({ media_url: 'https://signed.example/media', media_tipo: 'image' })
      expect(audioItem).toMatchObject({ media_url: 'https://signed.example/media', media_tipo: 'audio' })
      expect(textItem['media_url']).toBeUndefined()
      expect(textItem['media_tipo']).toBeUndefined()
    })

    it('a row without media_path is unchanged (no signed-url call for it)', async () => {
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [{ id: 'm1', phone: '593987654321', contenido_raw: 'hola', tipo_mensaje: 'text', created_at: '2026-07-01T10:00:00Z' }],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({ data: [], error: null })
      mock.from
        .mockReturnValueOnce(prospectoBuilder)
        .mockReturnValueOnce(mensajesBuilder)
        .mockReturnValueOnce(interaccionesBuilder)

      const getSignedUrl = vi.fn<typeof getSignedUrlEvento>().mockResolvedValue('https://signed.example/media')

      const result = await getConversacionThread('p1', mock as any, getSignedUrl)

      expect(getSignedUrl).not.toHaveBeenCalled()
      expect(result[0]).toMatchObject({ id: 'm1', contenido: 'hola' })
      expect(result[0]['media_url']).toBeUndefined()
    })
  })

  describe('getSDRProspectoById (T-H3.1)', () => {
    it('known id returns the full row', async () => {
      const mock = crearSupabaseMock()
      const builder = queryBuilder({
        data: { id: 'p1', phone: '593987654321', nombre: 'Carlos', turns_total: 3 },
        error: null,
      })
      mock.from.mockReturnValue(builder)

      const result = await getSDRProspectoById('p1', mock as any)

      expect(mock.from).toHaveBeenCalledWith('sdr_prospectos')
      expect(builder['select']).toHaveBeenCalledWith('*')
      expect(builder['eq']).toHaveBeenCalledWith('id', 'p1')
      expect(result).toMatchObject({ id: 'p1', phone: '593987654321', turns_total: 3 })
    })

    it('unknown id returns null, does not throw', async () => {
      const mock = crearSupabaseMock()
      mock.from.mockReturnValue(queryBuilder({ data: null, error: null }))

      const result = await getSDRProspectoById('unknown-id', mock as any)

      expect(result).toBeNull()
    })
  })
})
