import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sdrChaserHandler } from '../../src/workers/sdrChaserWorker.js'
import * as supabaseQueries from '../../src/pipeline/supabaseQueries.js'
import * as whatsappIndex from '../../src/integrations/whatsapp/index.js'

// Mocking dependencies
vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getSDRProspecto: vi.fn(),
  saveSDRInteraccion: vi.fn(),
}))

vi.mock('../../src/integrations/whatsapp/index.js', () => ({
  crearSenderWhatsApp: vi.fn(),
}))

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn()
        }))
      }))
    }))
  }
}))

describe('sdrChaserWorker', () => {
  it('should abort if turns_total does not match expected_turn', async () => {
    const { supabase } = await import('../../src/integrations/supabase.js')
    const maybeSingleMock = vi.fn().mockResolvedValue({ 
        data: { id: '123', turns_total: 5, phone: '123456', status: 'en_discovery' }, 
        error: null 
    })
    
    // @ts-ignore
    supabase.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock
        })
      })
    })

    const job = {
      data: { prospecto_id: '123', expected_turn: 4 } // Turn is already 5, user replied
    }

    await sdrChaserHandler(job as any)

    expect(whatsappIndex.crearSenderWhatsApp).not.toHaveBeenCalled()
    expect(supabaseQueries.saveSDRInteraccion).not.toHaveBeenCalled()
  })

  it('should send message if turns_total matches expected_turn', async () => {
    const { supabase } = await import('../../src/integrations/supabase.js')
    const maybeSingleMock = vi.fn().mockResolvedValue({ 
        data: { id: '123', turns_total: 4, phone: '123456', status: 'en_discovery' }, 
        error: null 
    })
    
    // @ts-ignore
    supabase.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock
        })
      })
    })

    const mockSender = { enviarTexto: vi.fn().mockResolvedValue(true) }
    // @ts-ignore
    whatsappIndex.crearSenderWhatsApp.mockReturnValue(mockSender)

    const job = {
      data: { prospecto_id: '123', expected_turn: 4 }
    }

    await sdrChaserHandler(job as any)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith('123456', expect.stringContaining('¿pudiste revisar'))
    expect(supabaseQueries.saveSDRInteraccion).toHaveBeenCalled()
  })
})
