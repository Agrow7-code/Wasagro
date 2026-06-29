/**
 * T3.5 / T3.6 — Proactive outreach orchestration tests.
 * T3.10 / T3.11 — Opt-out keyword handler tests.
 * T3.12 / T3.13 — Session collision deferral tests.
 *
 * Design: §4.1 (trigger points), §4.2 (decision-state gating), §4.3 (session shape),
 *         §4.5 (opt-out keyword), §5 (decision-maker resolution).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      event: vi.fn(),
      generation: vi.fn().mockReturnValue({ end: vi.fn() }),
    }),
  },
}))

// We need to intercept Supabase client directly for session collision check
vi.mock('../../src/integrations/supabase.js', () => {
  const mockFrom = vi.fn().mockReturnThis()
  const mockSelect = vi.fn().mockReturnThis()
  const mockEq = vi.fn().mockReturnThis()
  const mockNeq = vi.fn().mockReturnThis()
  const mockGt = vi.fn().mockReturnThis()
  const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

  const mockChain = {
    select: mockSelect,
    eq: mockEq,
    neq: mockNeq,
    gt: mockGt,
    maybeSingle: mockMaybeSingle,
  }
  mockFrom.mockReturnValue(mockChain)
  mockSelect.mockReturnValue(mockChain)
  mockEq.mockReturnValue(mockChain)
  mockNeq.mockReturnValue(mockChain)
  mockGt.mockReturnValue(mockChain)

  return {
    supabase: {
      from: mockFrom,
      _mockMaybeSingle: mockMaybeSingle,
    },
  }
})

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getDecisionAlerta: vi.fn().mockResolvedValue(null),
  upsertDecisionAlerta: vi.fn().mockResolvedValue(undefined),
  getDecisionMakersByOrg: vi.fn(),
  getOrCreateSession: vi.fn().mockResolvedValue({ session_id: 'ses-dm-1', phone: '593999000000', status: 'active', contexto_parcial: {}, clarification_count: 0 }),
  updateSession: vi.fn().mockResolvedValue(undefined),
  upsertUmbralAlerta: vi.fn().mockResolvedValue(undefined),
  // Additional mocks needed for procesarMensajeEntrante flow
  getMensajeByWamid: vi.fn().mockResolvedValue(null),
  registrarMensaje: vi.fn().mockResolvedValue('msg-uuid'),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  getUserByPhone: vi.fn(),
  getFincaById: vi.fn().mockResolvedValue({ finca_id: 'F001', org_id: 'ORG001', nombre: 'F', pais: 'EC', cultivo_principal: 'banano' }),
  getLotesByFinca: vi.fn().mockResolvedValue([]),
  saveEvento: vi.fn().mockResolvedValue('evt-uuid'),
  actualizarEventoDatos: vi.fn().mockResolvedValue(undefined),
  getPendingAgricultoresByFinca: vi.fn().mockResolvedValue([]),
  approveAgricultor: vi.fn().mockResolvedValue(undefined),
  updateFincaCoordenadas: vi.fn().mockResolvedValue(undefined),
  guardarLoteIntenciones: vi.fn().mockResolvedValue(undefined),
  guardarCorreccionesSigatoka: vi.fn().mockResolvedValue(undefined),
  guardarEmbeddingEnEvento: vi.fn().mockResolvedValue(undefined),
  getUmbralesAlerta: vi.fn().mockResolvedValue([]),
  markAlertaEntregada: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn().mockResolvedValue('15'),
}))

vi.mock('../../src/pipeline/handlers/SigatokaHandler.js', () => ({
  detectarFormularioSigatoka: vi.fn().mockReturnValue(false),
  buildDescripcionRaw: vi.fn().mockReturnValue('desc'),
  buildWhatsappSummary: vi.fn().mockReturnValue('summary'),
  mapearSectoresALotes: vi.fn().mockReturnValue([]),
  mapearSectoresALotesFilas: vi.fn().mockReturnValue([]),
  contarCeldasIlegibles: vi.fn().mockReturnValue({ ruta: 'revisar', total: 0, ubicaciones: [] }),
  buildPreguntaAclaracion: vi.fn().mockReturnValue('?'),
  aplicarAclaraciones: vi.fn(),
  parseFincaUmbrales: vi.fn().mockReturnValue(null),
  UMBRALES_SEVERIDAD_DEFAULT: { ee3a6Severo: 10, ee2Avanzado: 5, ee2Leve: Infinity, hojasFuncionalesMin: 9 },
}))

vi.mock('../../src/integrations/supabaseStorage.js', () => ({
  subirImagenEvento: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/integrations/whatsapp/EvolutionMediaClient.js', () => ({
  downloadEvolutionMedia: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/workers/pgBoss.js', () => ({
  getBoss: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) }),
}))

vi.mock('../../src/pipeline/procesarExcel.js', () => ({
  handleDocumento: vi.fn().mockResolvedValue({ tipo: 'otro' }),
  procesarFilasExcelConfirmadas: vi.fn().mockResolvedValue({ insertados: 0, errores: 0 }),
}))

vi.mock('../../src/auth/planGuard.js', () => ({
  planGuardWhatsApp: vi.fn().mockResolvedValue({ allowed: true, state: { plan: 'trial' } }),
}))

vi.mock('../../src/agents/sdrAgent.js', () => ({
  handleSDRSession: vi.fn().mockResolvedValue(undefined),
  handleFounderApproval: vi.fn().mockResolvedValue(false),
  handleMeetingConfirmation: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../src/agents/sdr/contextStore.js', () => ({
  loadSessionState: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/agents/sdr/onboardingGuard.js', () => ({
  shouldSuppressOnboardingForActiveSDR: vi.fn().mockReturnValue(false),
}))

vi.mock('../../src/integrations/whatsapp/CostTrackedSender.js', () => ({
  recordInboundWaCost: vi.fn(),
}))

vi.mock('../../src/pipeline/handlers/BillingIntentHandler.js', () => ({
  handleBillingIntent: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../src/pipeline/derivadorInfraestructura.js', () => ({
  enriquecerDatosEventoInfraestructura: vi.fn().mockImplementation((d: unknown) => d),
}))

vi.mock('../../src/pipeline/feedbackBuilder.js', () => ({
  buildFeedbackRecibo: vi.fn().mockReturnValue('ok'),
}))

vi.mock('../../src/pipeline/handlers/OnboardingHandler.js', () => ({
  handleOnboardingAdmin: vi.fn().mockResolvedValue(undefined),
  handleOnboardingAgricultor: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/types/dominio/CalidadSigatoka.js', () => ({
  evaluarCalidadSigatoka: vi.fn().mockReturnValue({ pasa: true, razon: null }),
  decidirRecaptura: vi.fn().mockReturnValue({ ruta: 'procesar' }),
}))

// ─── Imports ─────────────────────────────────────────────────────────────────

import { outreachDecisionMakers, _resetOutreachDedupForTest } from '../../src/pipeline/handlers/EventHandler.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as supabaseModule from '../../src/integrations/supabase.js'

const dmA = { id: 'dm-1', phone: '593999000001', nombre: 'Ana', rol: 'admin_org' }
const dmB = { id: 'dm-2', phone: '593999000002', nombre: 'Bob', rol: 'director' }

function makeSender(sendFn?: Mock) {
  return {
    enviarTexto: sendFn ?? vi.fn().mockResolvedValue(undefined),
    enviarTemplate: vi.fn().mockResolvedValue(undefined),
  }
}

// ─── T3.5 / T3.6 — Proactive outreach ────────────────────────────────────────

describe('T3.5/T3.6 — outreachDecisionMakers', () => {
  let sender: ReturnType<typeof makeSender>

  beforeEach(async () => {
    vi.clearAllMocks()
    _resetOutreachDedupForTest()
    sender = makeSender()

    // Wire sender into EventHandler module
    const { inicializarPipeline } = await import('../../src/pipeline/procesarMensajeEntrante.js')
    inicializarPipeline(sender, {} as any)

    // Default: no existing session for DM phones
    const { supabase } = supabaseModule as any
    supabase._mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    vi.mocked(queries.getOrCreateSession).mockResolvedValue({
      session_id: 'ses-dm-1', phone: '593999000001', status: 'active',
      contexto_parcial: {}, clarification_count: 0,
    } as any)
    vi.mocked(queries.updateSession).mockResolvedValue(undefined)
    vi.mocked(queries.upsertDecisionAlerta).mockResolvedValue(undefined)
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue(null)
  })

  it('when shouldOutreach=ask and DMs exist: sends config prompt + opens pending_alert_config session', async () => {
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(true)
    // Evolution send called once (one DM)
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999000001', expect.any(String))
    // Session opened as pending_alert_config
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-dm-1',
      expect.objectContaining({
        status: 'pending_alert_config',
        contexto_parcial: expect.objectContaining({
          pest_type: 'sigatoka_negra',
          finca_id: 'F001',
          org_id: 'ORG001',
          current_campo: expect.any(String),
        }),
      }),
    )
    // decision_alerta upserted to 'asked'
    expect(queries.upsertDecisionAlerta).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'asked', org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra' }),
    )
  })

  it('when decision_alerta.status=decided: silent, no Evolution send', async () => {
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue({
      id: 'da-1', org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra',
      status: 'decided', ask_count: 1, asked_at: new Date().toISOString(),
    })
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(queries.updateSession).not.toHaveBeenCalled()
  })

  it('when decision_alerta.status=opted_out: silent forever', async () => {
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue({
      id: 'da-2', org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra',
      status: 'opted_out', ask_count: 2, asked_at: null,
    })
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('when decision_alerta.status=asked within cooldown: silent (no re-nag)', async () => {
    const recentDate = new Date()
    recentDate.setDate(recentDate.getDate() - 2)  // 2 days ago, within 7d cooldown
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue({
      id: 'da-3', org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra',
      status: 'asked', ask_count: 1, asked_at: recentDate.toISOString(),
    })
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('when ask_count >= maxAsks (3): escalates (no DM send)', async () => {
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue({
      id: 'da-4', org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra',
      status: 'asked', ask_count: 3, asked_at: '2026-01-01T00:00:00Z',
    })
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    // Escalate → no DM send, no session
    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(queries.updateSession).not.toHaveBeenCalled()
  })

  it('when zero decision-makers found: no outreach', async () => {
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([])

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('multiple DMs: sends to those without blocking session, skips those with open session (T3.12)', async () => {
    // Use dmA (first) = free, dmB (second) = busy with open session
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA, dmB])

    // dmA: free (first call returns null)
    // dmB: busy (second call returns open session)
    const { supabase } = supabaseModule as any
    let sessionCheckCount = 0
    supabase._mockMaybeSingle.mockImplementation(() => {
      sessionCheckCount++
      if (sessionCheckCount === 1) {
        return Promise.resolve({ data: null, error: null })  // dmA: free
      }
      return Promise.resolve({ data: { session_id: 'ses-busy', status: 'pending_sigatoka_aclaracion' }, error: null })  // dmB: busy
    })

    // Return a session for dmA
    vi.mocked(queries.getOrCreateSession).mockResolvedValue({
      session_id: 'ses-dm-a', phone: dmA.phone, status: 'active',
      contexto_parcial: {}, clarification_count: 0,
    } as any)

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(true)
    // Only dmA (index 0, free) got a message; dmB (index 1, busy) was deferred
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
    // The first DM in the array (dmA) should have received the message
    const calls = vi.mocked(sender.enviarTexto).mock.calls
    expect(calls[0]?.[0]).toBe(dmA.phone)
  })
})

// ─── T3.10 / T3.11 — Opt-out keyword handler ─────────────────────────────────
// Tests for the "desactivar/activar alertas {pest}" keyword detection in handleEvento.
// Fires for decision-makers (admin_org/director), regardless of session state.

describe('T3.10/T3.11 — alert opt-out/opt-in keyword handler', () => {
  // Test via procesarMensajeEntrante → handleEvento → handleAlertOptOutKeyword
  let sender: ReturnType<typeof makeSender>
  const decisionMakerUser = {
    id: 'dm-1', phone: '593999000001', nombre: 'María', rol: 'admin_org',
    org_id: 'ORG001', finca_id: null, email: null,
    onboarding_completo: true, consentimiento_datos: true, status: 'activo',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    _resetOutreachDedupForTest()
    sender = makeSender()
    const { inicializarPipeline } = await import('../../src/pipeline/procesarMensajeEntrante.js')
    inicializarPipeline(sender, {} as any)
  })

  it('desactivar alertas sigatoka: upserts all sigatoka campos with enabled=false', async () => {
    const { procesarMensajeEntrante } = await import('../../src/pipeline/procesarMensajeEntrante.js')
    const { getUserByPhone, getMensajeByWamid, registrarMensaje, actualizarMensaje } = await import('../../src/pipeline/supabaseQueries.js')

    vi.mocked(getMensajeByWamid).mockResolvedValue(null)
    vi.mocked(registrarMensaje).mockResolvedValue('msg-uuid')
    vi.mocked(actualizarMensaje).mockResolvedValue(undefined)
    vi.mocked(getUserByPhone).mockResolvedValue(decisionMakerUser)

    const msg = {
      wamid: 'opt-out-1', from: '593999000001', timestamp: new Date(),
      tipo: 'texto' as const, texto: 'desactivar alertas sigatoka negra', rawPayload: {},
    }

    await procesarMensajeEntrante(msg, 'trace-opt-out-kw')

    expect(queries.upsertUmbralAlerta).toHaveBeenCalled()
    // All sigatoka_negra campos should be upserted with enabled=false
    const calls = vi.mocked(queries.upsertUmbralAlerta).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const [args] of calls) {
      expect(args.enabled).toBe(false)
      expect(args.pest_type).toBe('sigatoka_negra')
    }
    // Confirmation sent
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999000001', expect.stringMatching(/desactivadas/i))
  })

  it('activar alertas sigatoka: upserts all sigatoka campos with enabled=true', async () => {
    const { procesarMensajeEntrante } = await import('../../src/pipeline/procesarMensajeEntrante.js')
    const { getUserByPhone, getMensajeByWamid, registrarMensaje, actualizarMensaje } = await import('../../src/pipeline/supabaseQueries.js')

    vi.mocked(getMensajeByWamid).mockResolvedValue(null)
    vi.mocked(registrarMensaje).mockResolvedValue('msg-uuid')
    vi.mocked(actualizarMensaje).mockResolvedValue(undefined)
    vi.mocked(getUserByPhone).mockResolvedValue(decisionMakerUser)

    const msg = {
      wamid: 'opt-in-1', from: '593999000001', timestamp: new Date(),
      tipo: 'texto' as const, texto: 'activar alertas de sigatoka negra', rawPayload: {},
    }

    await procesarMensajeEntrante(msg, 'trace-opt-in-kw')

    const calls = vi.mocked(queries.upsertUmbralAlerta).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const [args] of calls) {
      expect(args.enabled).toBe(true)
    }
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999000001', expect.stringMatching(/activadas/i))
  })

  it('keyword from non-decision-maker (agricultor): not handled by opt-out detector', async () => {
    const { procesarMensajeEntrante } = await import('../../src/pipeline/procesarMensajeEntrante.js')
    const { getUserByPhone, getMensajeByWamid, registrarMensaje, getOrCreateSession, updateSession } = await import('../../src/pipeline/supabaseQueries.js')

    vi.mocked(getMensajeByWamid).mockResolvedValue(null)
    vi.mocked(registrarMensaje).mockResolvedValue('msg-uuid')
    vi.mocked(getUserByPhone).mockResolvedValue({
      ...decisionMakerUser, rol: 'agricultor',
    })
    vi.mocked(getOrCreateSession).mockResolvedValue({
      session_id: 'ses-agri', phone: '593999000001', finca_id: null,
      tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {},
      status: 'active', paso_onboarding: null,
    } as any)
    vi.mocked(updateSession).mockResolvedValue(undefined)

    const msg = {
      wamid: 'non-dm-kw', from: '593999000001', timestamp: new Date(),
      tipo: 'texto' as const, texto: 'desactivar alertas sigatoka', rawPayload: {},
    }

    await procesarMensajeEntrante(msg, 'trace-non-dm')

    // upsertUmbralAlerta should NOT be called for non-decision-makers
    expect(queries.upsertUmbralAlerta).not.toHaveBeenCalled()
  })
})

// ─── T3.12 / T3.13 — Session collision deferral ──────────────────────────────

describe('T3.12/T3.13 — session collision deferral in outreachDecisionMakers', () => {
  let sender: ReturnType<typeof makeSender>

  beforeEach(async () => {
    vi.clearAllMocks()
    _resetOutreachDedupForTest()
    sender = makeSender()
    const { inicializarPipeline } = await import('../../src/pipeline/procesarMensajeEntrante.js')
    inicializarPipeline(sender, {} as any)
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue(null)
  })

  it('DM in pending_sigatoka_aclaracion: deferred (no send, no session, decision_alerta stays not_asked)', async () => {
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const { supabase } = supabaseModule as any
    supabase._mockMaybeSingle.mockResolvedValue({
      data: { session_id: 'ses-siga', status: 'pending_sigatoka_aclaracion' },
      error: null,
    })

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
    expect(queries.updateSession).not.toHaveBeenCalled()
    // decision_alerta should NOT be upserted (no one was actually asked)
    expect(queries.upsertDecisionAlerta).not.toHaveBeenCalled()
  })

  it('DM with any other active session: also deferred', async () => {
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    const { supabase } = supabaseModule as any
    supabase._mockMaybeSingle.mockResolvedValue({
      data: { session_id: 'ses-other', status: 'pending_confirmation' },
      error: null,
    })

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(false)
    expect(sender.enviarTexto).not.toHaveBeenCalled()
  })

  it('DM with completed/expired session: NOT blocked (completed is not deferred)', async () => {
    vi.mocked(queries.getDecisionMakersByOrg).mockResolvedValue([dmA])

    // Completed sessions are excluded by the query (neq completed, neq expired)
    // So this returns null (no open session found)
    const { supabase } = supabaseModule as any
    supabase._mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    vi.mocked(queries.getOrCreateSession).mockResolvedValue({
      session_id: 'ses-dm-a', phone: dmA.phone, status: 'active',
      contexto_parcial: {}, clarification_count: 0,
    } as any)

    const sent = await outreachDecisionMakers('ORG001', 'F001', 'sigatoka_negra', new Date())

    expect(sent).toBe(true)
    expect(sender.enviarTexto).toHaveBeenCalledWith(dmA.phone, expect.any(String))
  })
})
