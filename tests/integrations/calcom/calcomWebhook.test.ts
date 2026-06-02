import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyCalcomSignature, handleCalcomWebhook } from '../../../src/integrations/calcom/calcomWebhook.js'
import { createHmac } from 'node:crypto'

// ── Signature verification ──────────────────────────────────────────────────

describe('verifyCalcomSignature', () => {
  const secret = 'test-webhook-secret'

  it('accepts a valid HMAC-SHA256 signature', () => {
    const body = '{"triggerEvent":"BOOKING_CREATED"}'
    const sig = createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyCalcomSignature(body, sig, secret)).toBe(true)
  })

  it('rejects an invalid signature', () => {
    const body = '{"triggerEvent":"BOOKING_CREATED"}'
    expect(verifyCalcomSignature(body, 'badsignature', secret)).toBe(false)
  })

  it('rejects when signature header is missing', () => {
    expect(verifyCalcomSignature('{}', undefined, secret)).toBe(false)
    expect(verifyCalcomSignature('{}', null, secret)).toBe(false)
  })

  it('rejects signatures of different length (timing-safe)', () => {
    const body = '{}'
    expect(verifyCalcomSignature(body, 'short', secret)).toBe(false)
  })
})

// ── Webhook handler ─────────────────────────────────────────────────────────

vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
}))

vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  updateSDRProspecto: vi.fn(() => Promise.resolve()),
  saveSDRInteraccion: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../src/integrations/whatsapp/index.js', () => ({
  crearSenderWhatsApp: vi.fn(() => ({
    enviarTexto: vi.fn(() => Promise.resolve()),
  })),
}))

vi.mock('../../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn(() => ({
      event: vi.fn(),
      id: 'test-trace-id',
    })),
  },
}))

describe('handleCalcomWebhook', () => {
  const secret = 'test-webhook-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env['FOUNDER_PHONE'] = '593999999999'
  })

  function signBody(body: object): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify(body)
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex')
    return { rawBody, signature }
  }

  it('rejects webhook with invalid signature', async () => {
    const result = await handleCalcomWebhook('{"type":"BOOKING_CREATED"}', 'badsig', secret)
    expect(result.status).toBe('rejected')
  })

  it('returns error for unparseable payload', async () => {
    const rawBody = 'not-json'
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex')
    const result = await handleCalcomWebhook(rawBody, signature, secret)
    expect(result.status).toBe('rejected')
  })

  it('ignores unsupported event types', async () => {
    const body = { triggerEvent: 'FORM_SUBMITTED', payload: {} }
    const { rawBody, signature } = signBody(body)
    const result = await handleCalcomWebhook(rawBody, signature, secret)
    expect(result.status).toBe('ignored')
  })

  it('handles BOOKING_CREATED when no matching prospecto exists', async () => {
    const body = {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        bookingId: 'booking-123',
        title: 'Demo Wasagro',
        startTime: '2026-06-15T10:00:00Z',
        attendees: [{ name: 'Juan', email: 'juan@test.com', phoneNumber: '+593987654321' }],
      },
    }
    const { rawBody, signature } = signBody(body)
    const result = await handleCalcomWebhook(rawBody, signature, secret)
    expect(result.status).toBe('no_prospecto')
  })

  it('returns error when bookingId is missing', async () => {
    const body = {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        attendees: [],
      },
    }
    const { rawBody, signature } = signBody(body)
    const result = await handleCalcomWebhook(rawBody, signature, secret)
    expect(result.status).toBe('error')
    expect(result.detail).toContain('Missing bookingId')
  })

  it('handles BOOKING_CANCELLED when no matching booking exists', async () => {
    const body = {
      triggerEvent: 'BOOKING_CANCELLED',
      payload: {
        bookingId: 'nonexistent-booking',
      },
    }
    const { rawBody, signature } = signBody(body)
    const result = await handleCalcomWebhook(rawBody, signature, secret)
    expect(result.status).toBe('no_prospecto')
  })
})
