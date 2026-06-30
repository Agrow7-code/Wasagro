/**
 * T3.8 / T3.9 — Tests for the pending_alert_config session handler.
 * Design: §4.4 — multi-turn WhatsApp config flow wired into EventHandler.
 *
 * Tests cover:
 *   - numeric reply → ask_next: updates session ctx, sends next campo prompt
 *   - persist action → upsertUmbralAlerta called for each campo, upsertDecisionAlerta('decided'), session closed
 *   - abort action → session closed silently, decision_alerta NOT updated
 *   - opted_out action → upsertUmbralAlerta(enabled=false), upsertDecisionAlerta('opted_out'), confirmation sent
 *   - clarify action → re-prompt sent, session ctx updated (turn incremented)
 *   - corrupted ctx (missing required fields) → session reset, prompt to restart
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ─── Mocks (must be declared before imports) ─────────────────────────────────

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      event: vi.fn(),
      generation: vi.fn().mockReturnValue({ end: vi.fn() }),
    }),
  },
}))

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getMensajeByWamid: vi.fn().mockResolvedValue(null),
  registrarMensaje: vi.fn().mockResolvedValue('msg-uuid'),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  getUserByPhone: vi.fn(),
  getFincaById: vi.fn().mockResolvedValue({ finca_id: 'F001', org_id: 'ORG001', nome: 'Finca Uno', pais: 'EC', cultivo_principal: 'banano' }),
  getLotesByFinca: vi.fn().mockResolvedValue([]),
  getOrCreateSession: vi.fn(),
  updateSession: vi.fn().mockResolvedValue(undefined),
  saveEvento: vi.fn().mockResolvedValue('evt-uuid'),
  actualizarEventoDatos: vi.fn().mockResolvedValue(undefined),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  getPendingAgricultoresByFinca: vi.fn().mockResolvedValue([]),
  approveAgricultor: vi.fn().mockResolvedValue(undefined),
  updateFincaCoordenadas: vi.fn().mockResolvedValue(undefined),
  guardarLoteIntenciones: vi.fn().mockResolvedValue(undefined),
  guardarCorreccionesSigatoka: vi.fn().mockResolvedValue(undefined),
  guardarEmbeddingEnEvento: vi.fn().mockResolvedValue(undefined),
  getUmbralesAlerta: vi.fn().mockResolvedValue([]),
  upsertUmbralAlerta: vi.fn().mockResolvedValue(undefined),
  upsertDecisionAlerta: vi.fn().mockResolvedValue(undefined),
  getDecisionAlerta: vi.fn().mockResolvedValue(null),
  getDecisionMakersByOrg: vi.fn().mockResolvedValue([]),
  markAlertaEntregada: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn().mockResolvedValue('15'),
}))

vi.mock('../../src/pipeline/handlers/SigatokaHandler.js', () => ({
  detectarFormularioSigatoka: vi.fn().mockReturnValue(false),
  buildDescripcionRaw: vi.fn().mockReturnValue('desc'),
  buildWhatsappSummary: vi.fn().mockReturnValue('sigatoka summary'),
  mapearSectoresALotes: vi.fn().mockReturnValue([]),
  mapearSectoresALotesFilas: vi.fn().mockReturnValue([]),
  contarCeldasIlegibles: vi.fn().mockReturnValue({ ruta: 'revisar', total: 0, ubicaciones: [] }),
  buildPreguntaAclaracion: vi.fn().mockReturnValue('¿Cuáles son los valores?'),
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
  buildFeedbackRecibo: vi.fn().mockReturnValue('feedbackMsg'),
}))

vi.mock('../../src/pipeline/handlers/OnboardingHandler.js', () => ({
  handleOnboardingAdmin: vi.fn().mockResolvedValue(undefined),
  handleOnboardingAgricultor: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/types/dominio/CalidadSigatoka.js', () => ({
  evaluarCalidadSigatoka: vi.fn().mockReturnValue({ pasa: true, razon: null }),
  decidirRecaptura: vi.fn().mockReturnValue({ ruta: 'procesar' }),
}))

// ─── Imports ────────────────────────────────────────────────────────────────

import { procesarMensajeEntrante, inicializarPipeline } from '../../src/pipeline/procesarMensajeEntrante.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import type { PendingAlertConfigCtx } from '../../src/pipeline/handlers/alertConfigReducer.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const decisionMaker = {
  id: 'dm-1',
  phone: '593999111000',
  nombre: 'María',
  rol: 'admin_org',
  org_id: 'ORG001',
  finca_id: null,
  email: null,
  onboarding_completo: true,
  consentimiento_datos: true,
  status: 'activo',
}

const msgTexto = (texto: string, from = '593999111000'): NormalizedMessage => ({
  wamid: `wamid.${Date.now()}`,
  from,
  timestamp: new Date(),
  tipo: 'texto',
  texto,
  rawPayload: {},
})

function makePendingCtx(overrides: Partial<PendingAlertConfigCtx> = {}): PendingAlertConfigCtx {
  return {
    pest_type: 'sigatoka_negra',
    finca_id: 'F001',
    org_id: 'ORG001',
    pending_campos: ['ee3a6Severo', 'ee2Avanzado'],
    collected: {},
    current_campo: 'ee3a6Severo',
    turn: 0,
    ...overrides,
  }
}

function makeSender() {
  return {
    enviarTexto: vi.fn().mockResolvedValue(undefined),
    enviarTemplate: vi.fn().mockResolvedValue(undefined),
  }
}

function makeLlm() {
  return {
    extraerEvento: vi.fn(),
    extraerEventos: vi.fn(),
    clasificarIntenciones: vi.fn(),
    onboardarAdmin: vi.fn(),
    onboardarAgricultor: vi.fn(),
    corregirTranscripcion: vi.fn(),
    analizarImagen: vi.fn(),
    resumirSemana: vi.fn(),
    atenderSDR: vi.fn(),
    interpretarAclaracionSigatoka: vi.fn(),
  }
}

function sessionPendingAlertConfig(ctx: PendingAlertConfigCtx, sessionId = 'ses-alert-1') {
  return {
    session_id: sessionId,
    phone: '593999111000',
    finca_id: 'F001',
    tipo_sesion: 'reporte',
    clarification_count: 0,
    contexto_parcial: ctx as unknown as Record<string, unknown>,
    status: 'pending_alert_config',
    paso_onboarding: null,
  }
}

// ─── T3.8/T3.9 — pending_alert_config session handler ────────────────────────

describe('T3.8/T3.9 — pending_alert_config session handler', () => {
  let sender: ReturnType<typeof makeSender>
  let llm: ReturnType<typeof makeLlm>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.getMensajeByWamid).mockResolvedValue(null)
    vi.mocked(queries.registrarMensaje).mockResolvedValue('msg-uuid')
    vi.mocked(queries.actualizarMensaje).mockResolvedValue(undefined)
    vi.mocked(queries.updateSession).mockResolvedValue(undefined)
    vi.mocked(queries.upsertUmbralAlerta).mockResolvedValue(undefined)
    vi.mocked(queries.upsertDecisionAlerta).mockResolvedValue(undefined)
    vi.mocked(queries.getUserByPhone).mockResolvedValue(decisionMaker)

    sender = makeSender()
    llm = makeLlm()
    inicializarPipeline(sender, llm)
  })

  it('numeric reply (ask_next): updates session ctx, sends next campo prompt', async () => {
    const ctx = makePendingCtx({
      pending_campos: ['ee3a6Severo', 'ee2Avanzado'],
      current_campo: 'ee3a6Severo',
    })
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingAlertConfig(ctx))

    await procesarMensajeEntrante(msgTexto('15'), 'trace-ask_next')

    // Session ctx should be updated with new collected value + next campo
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-alert-1',
      expect.objectContaining({
        contexto_parcial: expect.objectContaining({
          collected: expect.objectContaining({ ee3a6Severo: 15 }),
          current_campo: 'ee2Avanzado',
        }),
      }),
    )
    // No upsert yet — still collecting
    expect(queries.upsertUmbralAlerta).not.toHaveBeenCalled()
    // Next campo prompt sent
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999111000', expect.any(String))
  })

  it('numeric reply on last campo (persist): upsertUmbralAlerta + upsertDecisionAlerta(decided) + session closed', async () => {
    const ctx = makePendingCtx({
      pending_campos: ['hojasFuncionalesMin'],
      current_campo: 'hojasFuncionalesMin',
      collected: { ee3a6Severo: 15, ee2Avanzado: 8 },
      ask_count: 2,  // Fix #4: carry ask_count from outreach so it is preserved, not reset to 1
    })
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingAlertConfig(ctx))

    await procesarMensajeEntrante(msgTexto('7'), 'trace-persist')

    // upsertUmbralAlerta called for each collected campo (3 total)
    expect(queries.upsertUmbralAlerta).toHaveBeenCalledTimes(3)
    // All rows have enabled=true
    const calls = vi.mocked(queries.upsertUmbralAlerta).mock.calls
    for (const [args] of calls) {
      expect(args.enabled).toBe(true)
      expect(args.finca_id).toBe('F001')
      expect(args.org_id).toBe('ORG001')
    }
    // Fix #4: ask_count must be preserved from ctx (2), NOT reset to 1
    expect(queries.upsertDecisionAlerta).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'decided', finca_id: 'F001', org_id: 'ORG001', pest_type: 'sigatoka_negra', ask_count: 2 }),
    )
    // Session closed (active or completed)
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-alert-1',
      expect.objectContaining({ status: expect.stringMatching(/active|completed/) }),
    )
    // Confirmation sent
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999111000', expect.any(String))
  })

  it('abort action: session closed, decision_alerta NOT updated, DM notified (fix #9)', async () => {
    // turn=1 + non-numeric → abort
    const ctx = makePendingCtx({ turn: 1, pending_campos: ['ee3a6Severo'], current_campo: 'ee3a6Severo' })
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingAlertConfig(ctx))

    await procesarMensajeEntrante(msgTexto('no sé'), 'trace-abort')

    expect(queries.upsertUmbralAlerta).not.toHaveBeenCalled()
    expect(queries.upsertDecisionAlerta).not.toHaveBeenCalled()
    // Session closed/reset
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-alert-1',
      expect.objectContaining({ status: expect.stringMatching(/active|completed/) }),
    )
    // Fix #9: DM notified instead of going silent (P4/UX)
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999111000', expect.stringMatching(/probá de nuevo|intentá|configurar/i))
  })

  it('opted_out action: upsertUmbralAlerta(enabled=false) + upsertDecisionAlerta(opted_out) + confirmation', async () => {
    const ctx = makePendingCtx({ ask_count: 3 })  // Fix #4: carry ask_count
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingAlertConfig(ctx))

    await procesarMensajeEntrante(msgTexto('no quiero'), 'trace-opt-out')

    // All campos should be upserted with enabled=false
    expect(queries.upsertUmbralAlerta).toHaveBeenCalled()
    const calls = vi.mocked(queries.upsertUmbralAlerta).mock.calls
    for (const [args] of calls) {
      expect(args.enabled).toBe(false)
    }
    // Fix #4: ask_count must be preserved from ctx (3), NOT reset to 1
    expect(queries.upsertDecisionAlerta).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'opted_out', ask_count: 3 }),
    )
    // Confirmation sent
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999111000', expect.any(String))
  })

  it('clarify action: re-prompt sent, session turn incremented, no upsert', async () => {
    // turn=0 + non-numeric → clarify
    const ctx = makePendingCtx({ turn: 0 })
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingAlertConfig(ctx))

    await procesarMensajeEntrante(msgTexto('no sé'), 'trace-clarify')

    expect(queries.upsertUmbralAlerta).not.toHaveBeenCalled()
    expect(queries.upsertDecisionAlerta).not.toHaveBeenCalled()
    // Session updated with turn=1
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-alert-1',
      expect.objectContaining({
        contexto_parcial: expect.objectContaining({ turn: 1 }),
      }),
    )
    // Re-prompt sent
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999111000', expect.any(String))
  })

  it('corrupted ctx (missing pest_type/finca_id) → session reset and re-prompt', async () => {
    // Session with empty/missing required fields
    const badSession = {
      session_id: 'ses-corrupt',
      phone: '593999111000',
      finca_id: 'F001',
      tipo_sesion: 'reporte',
      clarification_count: 0,
      contexto_parcial: { pest_type: '', finca_id: '', org_id: '' } as unknown as Record<string, unknown>,
      status: 'pending_alert_config',
      paso_onboarding: null,
    }
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(badSession)

    await procesarMensajeEntrante(msgTexto('15'), 'trace-corrupt')

    expect(queries.upsertUmbralAlerta).not.toHaveBeenCalled()
    // Session reset
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-corrupt',
      expect.objectContaining({ status: expect.stringMatching(/active|completed/) }),
    )
  })
})
