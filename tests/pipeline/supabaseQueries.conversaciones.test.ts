import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

import { getConversacionesList, getConversacionThread, getSDRProspectoById } from '../../src/pipeline/supabaseQueries.js'

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
    it('merges mensajes_entrada + sdr_interacciones sorted by created_at, tagged by origen', async () => {
      const mock = crearSupabaseMock()
      const prospectoBuilder = queryBuilder({ data: { phone: '593987654321' }, error: null })
      const mensajesBuilder = queryBuilder({
        data: [{ id: 'm1', phone: '593987654321', contenido_raw: 'hola', created_at: '2026-07-01T10:00:00Z' }],
        error: null,
      })
      const interaccionesBuilder = queryBuilder({
        data: [{ id: 'i1', prospecto_id: 'p1', phone: '593987654321', contenido: 'hi back', created_at: '2026-07-01T10:05:00Z' }],
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
      expect(mensajesBuilder['order']).toHaveBeenCalledWith('created_at', { ascending: true })

      expect(mock.from).toHaveBeenNthCalledWith(3, 'sdr_interacciones')
      expect(interaccionesBuilder['eq']).toHaveBeenCalledWith('prospecto_id', 'p1')
      expect(interaccionesBuilder['order']).toHaveBeenCalledWith('created_at', { ascending: true })

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'm1', origen: 'mensajes_entrada' })
      expect(result[1]).toMatchObject({ id: 'i1', origen: 'sdr_interacciones' })
    })

    it('returns [] without throwing when the prospecto id does not exist', async () => {
      const mock = crearSupabaseMock()
      mock.from.mockReturnValueOnce(queryBuilder({ data: null, error: null }))

      const result = await getConversacionThread('unknown-id', mock as any)

      expect(result).toEqual([])
      // Only the prospecto lookup happens — no thread queries for a non-existent id.
      expect(mock.from).toHaveBeenCalledTimes(1)
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
