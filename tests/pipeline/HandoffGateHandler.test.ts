import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getHandoffEstado: vi.fn(),
  setHandoffEstado: vi.fn().mockResolvedValue(undefined),
  saveSDRInteraccion: vi.fn().mockResolvedValue(undefined),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/agents/sdrAgent.js', () => ({
  detectarHandoffTrigger: vi.fn(),
}))

vi.mock('../../src/integrations/whatsapp/founderAlerts.js', () => ({
  alertarFounder: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn() }) },
}))

import { handleHandoffGate } from '../../src/pipeline/handlers/HandoffGateHandler.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as sdrAgent from '../../src/agents/sdrAgent.js'
import * as founderAlerts from '../../src/integrations/whatsapp/founderAlerts.js'
import { langfuse } from '../../src/integrations/langfuse.js'

function crearSenderMock() {
  return { enviarTexto: vi.fn().mockResolvedValue(undefined), enviarTemplate: vi.fn().mockResolvedValue(undefined) }
}

const msgTexto: NormalizedMessage = {
  wamid: 'wamid.001', from: '593987654321', timestamp: new Date(),
  tipo: 'texto', texto: 'quiero hablar con alguien del equipo', rawPayload: {},
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleHandoffGate (T-H1.3)', () => {
  it('1. no existe prospecto (getHandoffEstado → null) → false, sin writes', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue(null)
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-1', 'trace-1', sender)

    expect(result).toBe(false)
    expect(queries.setHandoffEstado).not.toHaveBeenCalled()
    expect(queries.saveSDRInteraccion).not.toHaveBeenCalled()
    expect(sdrAgent.detectarHandoffTrigger).not.toHaveBeenCalled()
    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
  })

  it('2. handoff_status human_paused → loguea inbound, marca processed, no FSM/LLM, no ping duplicado, true', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-1', handoff_status: 'human_paused', handoff_last_pinged_at: '2026-06-30T10:00:00Z', turns_total: 3,
    })
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-2', 'trace-2', sender)

    expect(result).toBe(true)
    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'inbound' }))
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-2', { status: 'processed' })
    expect(sdrAgent.detectarHandoffTrigger).not.toHaveBeenCalled()
    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('3. bot + detectarHandoffTrigger human_request → pausa, ack, ping una vez, true', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-2', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 1,
    })
    vi.mocked(sdrAgent.detectarHandoffTrigger).mockReturnValue('human_request')
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-3', 'trace-3', sender)

    expect(result).toBe(true)
    expect(queries.setHandoffEstado).toHaveBeenCalledWith('uuid-2', expect.objectContaining({
      handoff_status: 'human_paused',
      handoff_reason: 'auto_human_request',
      handoff_paused_at: expect.any(String),
      handoff_last_pinged_at: expect.any(String),
    }))
    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'inbound' }))
    expect(sender.enviarTexto).toHaveBeenCalledOnce()
    expect(founderAlerts.alertarFounder).toHaveBeenCalledWith('sdr_handoff_solicitado', expect.any(Object))
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-3', { status: 'processed' })
  })

  it('4. bot + trigger null → false, cae al flujo normal', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-3', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 2,
    })
    vi.mocked(sdrAgent.detectarHandoffTrigger).mockReturnValue(null)
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-4', 'trace-4', sender)

    expect(result).toBe(false)
    expect(queries.setHandoffEstado).not.toHaveBeenCalled()
    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
  })

  it('4b. bot + trigger price_readiness → false (inerte), cae al flujo normal', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-4', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 4,
    })
    vi.mocked(sdrAgent.detectarHandoffTrigger).mockReturnValue('price_readiness')
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-4b', 'trace-4b', sender)

    expect(result).toBe(false)
    expect(queries.setHandoffEstado).not.toHaveBeenCalled()
    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
  })

  it('6. resiliencia — si el ack (enviarTexto) falla, igual pingea al founder y marca processed', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-6', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 1,
    })
    vi.mocked(sdrAgent.detectarHandoffTrigger).mockReturnValue('human_request')
    const sender = crearSenderMock()
    sender.enviarTexto.mockRejectedValueOnce(new Error('evolution down'))

    const result = await handleHandoffGate(msgTexto, 'msg-6', 'trace-6', sender)

    // The prospect ack failing must NOT lose the founder ping nor leave the
    // message unprocessed (which would retry into the paused branch, dropping
    // the notification). Ping fires first; ack is best-effort.
    expect(result).toBe(true)
    expect(founderAlerts.alertarFounder).toHaveBeenCalledWith('sdr_handoff_solicitado', expect.any(Object))
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-6', { status: 'processed' })
  })

  it('5. regresión — 3 inbounds consecutivos en human_paused → alertarFounder NUNCA se llama (ping ya ocurrió en la transición)', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-5', handoff_status: 'human_paused', handoff_last_pinged_at: '2026-06-30T10:00:00Z', turns_total: 5,
    })
    const sender = crearSenderMock()

    await handleHandoffGate(msgTexto, 'msg-5a', 'trace-5a', sender)
    await handleHandoffGate(msgTexto, 'msg-5b', 'trace-5b', sender)
    await handleHandoffGate(msgTexto, 'msg-5c', 'trace-5c', sender)

    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
  })

  it('7. CRITICAL — saveSDRInteraccion rechaza en auto-pausa → alertarFounder y processed igual se llaman, no throw', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-7', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 1,
    })
    vi.mocked(sdrAgent.detectarHandoffTrigger).mockReturnValue('human_request')
    vi.mocked(queries.saveSDRInteraccion).mockRejectedValueOnce(new Error('db down'))
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-7', 'trace-7', sender)

    expect(result).toBe(true)
    expect(founderAlerts.alertarFounder).toHaveBeenCalledWith('sdr_handoff_solicitado', expect.any(Object))
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-7', { status: 'processed' })
  })

  it('8. setHandoffEstado rechaza → handoff_pause_write_failed, rethrow, alertarFounder NO se llama', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-8', handoff_status: 'bot', handoff_last_pinged_at: null, turns_total: 1,
    })
    vi.mocked(sdrAgent.detectarHandoffTrigger).mockReturnValue('human_request')
    vi.mocked(queries.setHandoffEstado).mockRejectedValueOnce(new Error('write failed'))
    const sender = crearSenderMock()

    await expect(handleHandoffGate(msgTexto, 'msg-8', 'trace-8', sender)).rejects.toThrow('write failed')

    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'handoff_pause_write_failed', level: 'ERROR' }),
    )
  })

  it('9. getHandoffEstado rechaza → handoff_lookup_failed, rethrow', async () => {
    vi.mocked(queries.getHandoffEstado).mockRejectedValueOnce(new Error('read failed'))
    const sender = crearSenderMock()

    await expect(handleHandoffGate(msgTexto, 'msg-9', 'trace-9', sender)).rejects.toThrow('read failed')

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'handoff_lookup_failed', level: 'ERROR' }),
    )
  })

  it('10. ya pausado — saveSDRInteraccion rechaza → true, processed igual se intenta, no throw', async () => {
    vi.mocked(queries.getHandoffEstado).mockResolvedValue({
      id: 'uuid-10', handoff_status: 'human_paused', handoff_last_pinged_at: '2026-06-30T10:00:00Z', turns_total: 3,
    })
    vi.mocked(queries.saveSDRInteraccion).mockRejectedValueOnce(new Error('db down'))
    const sender = crearSenderMock()

    const result = await handleHandoffGate(msgTexto, 'msg-10', 'trace-10', sender)

    expect(result).toBe(true)
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-10', { status: 'processed' })
  })
})
