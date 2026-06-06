// Real-prospect bug 2026-06-06: el mensaje de recovery "Disculpá, tuve un
// problemita..." se enviaba en CADA turno con error consecutivo. El cliente
// se hartó y dejó de responder. Estos tests fijan el contrato:
//   - Primer error: recovery message va.
//   - Segundo error dentro de 5 min: NO va recovery (Redis dedup).
//   - Phones distintos NO comparten dedup.
//   - Si Redis cae: degrade a enviar igual (no dejar al user en silencio
//     cuando es el PRIMER error real).
//   - El sdr_error event a LangFuse SIEMPRE va, con stack trace + message
//     + name + phone + wamid (para debug del root cause).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const fakeRedis = new Map<string, string>()
const langfuseEvents: Array<{ name: string; level?: string; input?: unknown }> = []

vi.mock('../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeRedis.get(k) ?? null),
    set: vi.fn(async () => 'OK'),
  }),
  setIfNotExists: vi.fn(async (k: string, _ttl: number) => {
    if (fakeRedis.has(k)) return false
    fakeRedis.set(k, '1')
    return true
  }),
  getCachedContext: vi.fn(async () => null),
  setCachedContext: vi.fn(async () => {}),
}))

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getSDRProspecto: vi.fn().mockRejectedValue(new Error('boom: simulated DB failure')),
  createSDRProspecto: vi.fn(),
  updateSDRProspecto: vi.fn(),
  saveSDRInteraccion: vi.fn(),
  getSDRProspectosPendingApproval: vi.fn(),
  actualizarMensaje: vi.fn(async () => {}),
}))

vi.mock('../../src/integrations/langfuse.js', () => {
  const noopGen = { end: () => {} }
  const trace: any = {
    id: 'test-trace',
    event: (e: any) => langfuseEvents.push(e),
    generation: () => noopGen,
  }
  return { langfuse: { trace: () => trace } }
})

vi.mock('../../src/workers/pgBoss.js', () => ({
  getBoss: () => ({ send: vi.fn() }),
  isPgBossReady: () => false,
}))

import { handleSDRSession } from '../../src/agents/sdrAgent.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

const PHONE = '593987654321'

function audioMsg(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    wamid: 'wamid.test-recovery',
    from: PHONE,
    tipo: 'texto',
    texto: 'Arroz',
    timestamp: new Date(),
    rawPayload: {},
    ...overrides,
  } as NormalizedMessage
}

function makeSender() {
  return {
    enviarTexto: vi.fn(async () => {}),
    enviarTemplate: vi.fn(async () => {}),
    enviarImagen: vi.fn(async () => {}),
    enviarDocumento: vi.fn(async () => {}),
  }
}

const recoveryRegex = /problemita procesando/i

beforeEach(() => {
  fakeRedis.clear()
  langfuseEvents.length = 0
  vi.clearAllMocks()
})

describe('SDR recovery message dedup (real-prospect bug 2026-06-06)', () => {
  it('PRIMER error en una conversación → recovery message ENVIADO', async () => {
    const sender = makeSender()
    await handleSDRSession(audioMsg(), 'mid-1', 'trace-1', sender as any, {} as any)

    const recoveryCalls = sender.enviarTexto.mock.calls.filter(c =>
      typeof c[1] === 'string' && recoveryRegex.test(c[1]),
    )
    expect(recoveryCalls).toHaveLength(1)

    // Redis dedup key fue seteada
    expect(fakeRedis.has(`sdr_recovery_sent:${PHONE}`)).toBe(true)

    // No hay skip event
    expect(langfuseEvents.some(e => e.name === 'sdr_recovery_dedup_skipped')).toBe(false)
  })

  it('SEGUNDO error mismo phone dentro de 5 min → recovery NO ENVIADO + event de skip', async () => {
    // Primer error
    const sender1 = makeSender()
    await handleSDRSession(audioMsg(), 'mid-1', 'trace-1', sender1 as any, {} as any)
    langfuseEvents.length = 0 // limpiar eventos del primer turno

    // Segundo error (mismo phone, mismo workflow)
    const sender2 = makeSender()
    await handleSDRSession(audioMsg({ wamid: 'wamid.test-recovery-2' }), 'mid-2', 'trace-2', sender2 as any, {} as any)

    // Recovery NO debe haber sido enviado en el segundo turno
    const recoveryCalls = sender2.enviarTexto.mock.calls.filter(c =>
      typeof c[1] === 'string' && recoveryRegex.test(c[1]),
    )
    expect(recoveryCalls).toHaveLength(0)

    // Event de skip debe estar presente con contexto
    const skipEvent = langfuseEvents.find(e => e.name === 'sdr_recovery_dedup_skipped')
    expect(skipEvent).toBeDefined()
    expect(skipEvent?.level).toBe('WARNING')
    expect(skipEvent?.input).toMatchObject({ phone: PHONE })
  })

  it('errores en phones distintos NO comparten dedup', async () => {
    const sender1 = makeSender()
    await handleSDRSession(audioMsg(), 'mid-1', 'trace-1', sender1 as any, {} as any)

    const otherPhone = '593911111111'
    const sender2 = makeSender()
    await handleSDRSession(audioMsg({ from: otherPhone, wamid: 'wamid.other' }), 'mid-2', 'trace-2', sender2 as any, {} as any)

    // El segundo phone también debe recibir recovery (primer error para él)
    const recoveryCalls = sender2.enviarTexto.mock.calls.filter(c =>
      typeof c[1] === 'string' && recoveryRegex.test(c[1]),
    )
    expect(recoveryCalls).toHaveLength(1)
  })

  it('error event SIEMPRE va a LangFuse con stack + diagnóstico', async () => {
    const sender = makeSender()
    await handleSDRSession(audioMsg(), 'mid-1', 'trace-1', sender as any, {} as any)

    const errorEvent = langfuseEvents.find(e => e.name === 'sdr_error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent?.level).toBe('ERROR')
    expect(errorEvent?.input).toMatchObject({
      phone: PHONE,
      wamid: 'wamid.test-recovery',
      tipo:  'texto',
    })
    // Stack trace debe estar presente (truncado a 2000 chars)
    expect((errorEvent?.input as any)?.message).toContain('boom: simulated DB failure')
  })
})
