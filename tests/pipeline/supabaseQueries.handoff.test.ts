import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

import { getHandoffEstado, setHandoffEstado } from '../../src/pipeline/supabaseQueries.js'

function crearSupabaseMock() {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  }
  return { from: vi.fn().mockReturnValue(chainMethods), _chain: chainMethods }
}

describe('supabaseQueries — handoff (T-H1.2)', () => {
  describe('getHandoffEstado', () => {
    it('selecciona solo id, handoff_status, handoff_last_pinged_at, turns_total filtrado por phone', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({
        data: { id: 'uuid-1', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 2 },
        error: null,
      })

      const result = await getHandoffEstado('593987654321', mock as any)

      expect(mock.from).toHaveBeenCalledWith('sdr_prospectos')
      expect(mock._chain.select).toHaveBeenCalledWith('id, handoff_status, handoff_last_pinged_at, turns_total')
      expect(mock._chain.eq).toHaveBeenCalledWith('phone', '593987654321')
      expect(result).toEqual({ id: 'uuid-1', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 2 })
    })

    it('retorna null cuando no hay prospecto con ese phone', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })

      const result = await getHandoffEstado('593000000000', mock as any)

      expect(result).toBeNull()
    })
  })

  describe('setHandoffEstado', () => {
    it('emite update(updates).eq(id, id)', async () => {
      const mock = crearSupabaseMock()
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['eq'] = vi.fn().mockResolvedValue({ data: null, error: null })

      await setHandoffEstado('uuid-1', { handoff_status: 'human_paused', handoff_reason: 'auto_human_request' }, mock as any)

      expect(mock._chain.update).toHaveBeenCalledWith({ handoff_status: 'human_paused', handoff_reason: 'auto_human_request' })
      expect(mock._chain.eq).toHaveBeenCalledWith('id', 'uuid-1')
    })
  })
})
