import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sdrChaserHandler } from '../../src/workers/sdrChaserWorker.js'
import * as supabaseQueries from '../../src/pipeline/supabaseQueries.js'
import * as whatsappIndex from '../../src/integrations/whatsapp/index.js'
import { langfuse } from '../../src/integrations/langfuse.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  saveSDRInteraccion: vi.fn(),
}))

vi.mock('../../src/integrations/whatsapp/index.js', () => ({
 crearSenderWhatsApp: vi.fn(),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
 langfuse: {
 trace: vi.fn(() => ({
 event: vi.fn(),
 id: 'test-chaser-trace-id',
 })),
 },
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

async function setupProspectoMock(prospecto: Record<string, unknown>) {
  const { supabase } = await import('../../src/integrations/supabase.js')
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: prospecto, error: null })
  // @ts-ignore
  supabase.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: maybeSingleMock
      })
    })
  })
  return maybeSingleMock
}

function setupSenderMock() {
  const mockSender = {
    enviarTexto: vi.fn().mockResolvedValue(true),
    enviarTemplate: vi.fn().mockResolvedValue(true),
  }
  // @ts-ignore
  whatsappIndex.crearSenderWhatsApp.mockReturnValue(mockSender)
  return mockSender
}

describe('sdrChaserWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generic reengagement (no reminder_type)', () => {
    it('should abort if turns_total does not match expected_turn', async () => {
      await setupProspectoMock({ id: '123', turns_total: 5, phone: '123456', status: 'en_discovery' })

      const job = {
        data: { prospecto_id: '123', expected_turn: 4 }
      }

      await sdrChaserHandler(job as any)

      expect(whatsappIndex.crearSenderWhatsApp).not.toHaveBeenCalled()
      expect(supabaseQueries.saveSDRInteraccion).not.toHaveBeenCalled()
    })

    it('should send HSM template if turns_total matches expected_turn', async () => {
      await setupProspectoMock({ id: '123', turns_total: 4, phone: '123456', status: 'en_discovery' })
      const mockSender = setupSenderMock()

      const job = {
        data: { prospecto_id: '123', expected_turn: 4 }
      }

      await sdrChaserHandler(job as any)

      expect(mockSender.enviarTemplate).toHaveBeenCalledWith('123456', 'sdr_reenganche_24h', 'es')
      expect(supabaseQueries.saveSDRInteraccion).toHaveBeenCalledWith(
        expect.objectContaining({ action_taken: 'chaser_sequence_1' })
      )
    })

 it('should abort if prospect already has a Cal.com booking', async () => {
 await setupProspectoMock({ id: '456', turns_total: 4, phone: '123456', status: 'en_discovery', calcom_booking_id: 'booking-789' })

 const job = {
 data: { prospecto_id: '456', expected_turn: 4 }
 }

 await sdrChaserHandler(job as any)

 expect(whatsappIndex.crearSenderWhatsApp).not.toHaveBeenCalled()
 expect(supabaseQueries.saveSDRInteraccion).not.toHaveBeenCalled()
 })

 it('should abort and log chaser_skipped_paused if prospect is handoff_status human_paused (T-H1.5)', async () => {
 await setupProspectoMock({ id: '458', turns_total: 4, phone: '123458', status: 'en_discovery', handoff_status: 'human_paused' })

 const job = {
 data: { prospecto_id: '458', expected_turn: 4 }
 }

 await sdrChaserHandler(job as any)

 expect(whatsappIndex.crearSenderWhatsApp).not.toHaveBeenCalled()
 expect(supabaseQueries.saveSDRInteraccion).not.toHaveBeenCalled()
 const traceReturnValue = vi.mocked(langfuse.trace).mock.results.find(r => r.value)?.value
 expect(traceReturnValue?.event).toHaveBeenCalledWith(expect.objectContaining({ name: 'chaser_skipped_paused' }))
 })

 it('should NOT abort if prospect has a Cal.com booking but it was cancelled', async () => {
 await setupProspectoMock({ id: '457', turns_total: 4, phone: '123457', status: 'en_discovery', calcom_booking_id: 'booking-789', booking_cancelled_at: '2026-06-02T12:00:00Z' })
 const mockSender = setupSenderMock()

 const job = {
 data: { prospecto_id: '457', expected_turn: 4 }
 }

 await sdrChaserHandler(job as any)

 expect(whatsappIndex.crearSenderWhatsApp).toHaveBeenCalled()
 })
  })

  describe('booking reminder (reminder_type=booking)', () => {
    it('should send booking reminder text with URL when CALCOM_BOOKING_URL is set', async () => {
      process.env.CALCOM_BOOKING_URL = 'https://cal.example.com/demo'
      await setupProspectoMock({ id: '789', turns_total: 4, phone: '549111234', status: 'en_discovery', nombre: 'María', calcom_booking_id: null })
      const mockSender = setupSenderMock()

      const job = {
        data: { prospecto_id: '789', expected_turn: 4, reminder_type: 'booking' }
      }

      await sdrChaserHandler(job as any)

      expect(mockSender.enviarTexto).toHaveBeenCalledWith(
        '549111234',
        'María, ¿Te quedó alguna duda sobre la demo? Podés agendar cuando te quede bien: https://cal.example.com/demo?prospecto_id=789'
      )
      expect(supabaseQueries.saveSDRInteraccion).toHaveBeenCalledWith(
        expect.objectContaining({ action_taken: 'booking_reminder_24h' })
      )
      delete process.env.CALCOM_BOOKING_URL
    })

    it('should send booking reminder text without URL when no booking URL is configured', async () => {
      delete process.env.CALCOM_BOOKING_URL
      delete process.env.DEMO_BOOKING_URL
      await setupProspectoMock({ id: 'abc', turns_total: 3, phone: '549115678', status: 'en_discovery', nombre: null, calcom_booking_id: null })
      const mockSender = setupSenderMock()

      const job = {
        data: { prospecto_id: 'abc', expected_turn: 3, reminder_type: 'booking' }
      }

      await sdrChaserHandler(job as any)

      expect(mockSender.enviarTexto).toHaveBeenCalledWith(
        '549115678',
        '¿Te quedó alguna duda sobre la demo? Dime qué día y hora te viene bien y lo coordinamos.'
      )
      expect(supabaseQueries.saveSDRInteraccion).toHaveBeenCalledWith(
        expect.objectContaining({ action_taken: 'booking_reminder_24h' })
      )
    })

    it('should abort booking reminder if prospect already booked via Cal.com', async () => {
      await setupProspectoMock({ id: 'def', turns_total: 3, phone: '549119999', status: 'en_discovery', calcom_booking_id: 'booking-xyz' })

      const job = {
        data: { prospecto_id: 'def', expected_turn: 3, reminder_type: 'booking' }
      }

      await sdrChaserHandler(job as any)

      expect(whatsappIndex.crearSenderWhatsApp).not.toHaveBeenCalled()
      expect(supabaseQueries.saveSDRInteraccion).not.toHaveBeenCalled()
    })

    it('should not send HSM template for booking reminder', async () => {
      process.env.CALCOM_BOOKING_URL = 'https://cal.example.com/demo'
      await setupProspectoMock({ id: 'ghi', turns_total: 2, phone: '549110000', status: 'en_discovery', nombre: 'Carlos', calcom_booking_id: null })
      const mockSender = setupSenderMock()

      const job = {
        data: { prospecto_id: 'ghi', expected_turn: 2, reminder_type: 'booking' }
      }

      await sdrChaserHandler(job as any)

      expect(mockSender.enviarTemplate).not.toHaveBeenCalled()
      expect(mockSender.enviarTexto).toHaveBeenCalled()
      delete process.env.CALCOM_BOOKING_URL
    })
  })
})
