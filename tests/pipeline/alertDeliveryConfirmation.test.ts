/**
 * PR#3b — Tests for delivery wiring at the EventHandler confirmation point.
 *
 * Verifies:
 *   1. entregarAlertaPlaga is called (async) after saveEvento when ALERT_DELIVERY_ENABLED=true
 *   2. eventId from saveEvento is passed for real idempotency (markAlertaEntregada keyed by evento_id)
 *   3. M12 is_first_alert determined from decision_alerta.ask_count at confirmation time
 *   4. DM reply before session-open race: corrupted-ctx guard covers the narrow window
 *   5. Gate off: entregarAlertaPlaga is NOT called when ALERT_DELIVERY_ENABLED is unset/false
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

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
  getFincaById: vi.fn().mockResolvedValue({
    finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Uno',
    pais: 'EC', cultivo_principal: 'cacao',
  }),
  getLotesByFinca: vi.fn().mockResolvedValue([]),
  getOrCreateSession: vi.fn(),
  updateSession: vi.fn().mockResolvedValue(undefined),
  saveEvento: vi.fn().mockResolvedValue('evt-pr3b'),
  actualizarEventoDatos: vi.fn().mockResolvedValue(undefined),
  updateFincaCoordenadas: vi.fn().mockResolvedValue(undefined),
  guardarLoteIntenciones: vi.fn().mockResolvedValue(undefined),
  guardarCorreccionesSigatoka: vi.fn().mockResolvedValue(undefined),
  guardarEmbeddingEnEvento: vi.fn().mockResolvedValue(undefined),
  getUmbralesAlerta: vi.fn().mockResolvedValue([]),
  upsertUmbralAlerta: vi.fn().mockResolvedValue(undefined),
  upsertDecisionAlerta: vi.fn().mockResolvedValue(undefined),
  getDecisionAlerta: vi.fn().mockResolvedValue(null),
  haEntregadoAlertaAntes: vi.fn().mockResolvedValue(false), // false → no prior history → is_first_alert=true
  getDecisionMakersByOrg: vi.fn().mockResolvedValue([]),
  getAdminsByFinca: vi.fn().mockResolvedValue([]),
  markAlertaEntregada: vi.fn().mockResolvedValue(true), // fresh delivery by default
  getPendingAgricultoresByFinca: vi.fn().mockResolvedValue([]),
  approveAgricultor: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn().mockResolvedValue(''),
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

// alertaEntrega — we spy on this to observe calls without actually sending WA messages.
// Tests that verify delivery behavior use the real entregarAlertaPlaga (already tested in
// alertaEntrega.test.ts). These tests verify the WIRING between EventHandler and delivery.
vi.mock('../../src/pipeline/alertaEntrega.js', () => ({
  entregarAlertaPlaga: vi.fn().mockResolvedValue({ alert_sent: true, finca_id: 'F001', pest_type: 'moniliasis', reason: 'threshold_crossed' }),
}))

// ─── Imports ────────────────────────────────────────────────────────────────

import { procesarMensajeEntrante, inicializarPipeline } from '../../src/pipeline/procesarMensajeEntrante.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as alertaEntregaModule from '../../src/pipeline/alertaEntrega.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const agricultor = {
  id: 'u-agric',
  phone: '593999000111',
  nombre: 'Jorge',
  rol: 'agricultor',
  org_id: 'ORG001',
  finca_id: 'F001',
  email: null,
  onboarding_completo: true,
  consentimiento_datos: true,
  status: 'active',
}

/** NormalizedMessage that represents a simple text confirm "sí" */
function msgSi(from = '593999000111'): NormalizedMessage {
  return {
    wamid: `wamid.${Date.now()}`,
    from,
    timestamp: new Date(),
    tipo: 'texto',
    texto: 'sí',
    rawPayload: {},
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

/** A pending_confirmation session with a pest event in extracted_data */
function sessionPendingConfirmation(alerta_urgente: boolean, plagatipo = 'moniliasis') {
  return {
    session_id: 'ses-pr3b-1',
    phone: '593999000111',
    finca_id: 'F001',
    tipo_sesion: 'reporte',
    clarification_count: 0,
    status: 'pending_confirmation' as const,
    paso_onboarding: null,
    contexto_parcial: {
      transcripcion_original: 'Hay moniliasis en el lote',
      extracted_data: [
        {
          tipo_evento: 'reporte_plaga',
          confidence_score: 0.9,
          requiere_clarificacion: false,
          requiere_validacion: false,
          alerta_urgente,
          lote_id: null,
          lote_detectado_raw: null,
          campos_extraidos: { plaga_tipo: plagatipo, incidencia: 25 },
          confidence_por_campo: {},
          campos_faltantes: [],
          fecha_evento: null,
        },
      ],
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PR#3b — delivery wiring at confirmation point', () => {
  let sender: ReturnType<typeof makeSender>
  let llm: ReturnType<typeof makeLlm>
  const originalAlertEnabled = process.env['ALERT_DELIVERY_ENABLED']

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.getMensajeByWamid).mockResolvedValue(null)
    vi.mocked(queries.registrarMensaje).mockResolvedValue('msg-uuid')
    vi.mocked(queries.actualizarMensaje).mockResolvedValue(undefined)
    vi.mocked(queries.updateSession).mockResolvedValue(undefined)
    vi.mocked(queries.saveEvento).mockResolvedValue('evt-pr3b')
    vi.mocked(queries.getUserByPhone).mockResolvedValue(agricultor)
    vi.mocked(queries.getDecisionAlerta).mockResolvedValue(null)
    vi.mocked(queries.haEntregadoAlertaAntes).mockResolvedValue(false) // false → no history → is_first_alert=true
    vi.mocked(queries.markAlertaEntregada).mockResolvedValue(true)
    vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mockResolvedValue({
      alert_sent: true, finca_id: 'F001', pest_type: 'moniliasis', reason: 'threshold_crossed',
    })

    sender = makeSender()
    llm = makeLlm()
    inicializarPipeline(sender, llm)
  })

  afterEach(() => {
    // Restore ALERT_DELIVERY_ENABLED after each test
    if (originalAlertEnabled === undefined) {
      delete process.env['ALERT_DELIVERY_ENABLED']
    } else {
      process.env['ALERT_DELIVERY_ENABLED'] = originalAlertEnabled
    }
  })

  it('gate OFF (ALERT_DELIVERY_ENABLED unset): entregarAlertaPlaga NOT called even with alerta_urgente=true', async () => {
    delete process.env['ALERT_DELIVERY_ENABLED']
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))

    await procesarMensajeEntrante(msgSi(), 'trace-gate-off')

    // Even though alerta_urgente=true, delivery is gated off → no call
    expect(alertaEntregaModule.entregarAlertaPlaga).not.toHaveBeenCalled()
    // saveEvento is still called — event is persisted
    expect(queries.saveEvento).toHaveBeenCalled()
  })

  it('gate ON + alerta_urgente=false: entregarAlertaPlaga NOT called (only pest events trigger delivery)', async () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(false))

    await procesarMensajeEntrante(msgSi(), 'trace-no-alerta')
    // Wait one tick for async fire-and-forget
    await new Promise(r => setTimeout(r, 0))

    expect(alertaEntregaModule.entregarAlertaPlaga).not.toHaveBeenCalled()
  })

  it('gate ON + alerta_urgente=true + eventoId returned: entregarAlertaPlaga called with eventId', async () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))
    vi.mocked(queries.saveEvento).mockResolvedValue('evt-pr3b-real')

    await procesarMensajeEntrante(msgSi(), 'trace-delivery-fires')
    // Wait for async fire-and-forget to run
    await new Promise(r => setTimeout(r, 10))

    expect(alertaEntregaModule.entregarAlertaPlaga).toHaveBeenCalled()
    const [, deps] = vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mock.calls[0]!
    // Real eventId from saveEvento must be passed for idempotency
    expect(deps.eventId).toBe('evt-pr3b-real')
    // markAlertaEntregada function must be passed
    expect(typeof deps.markAlertaEntregada).toBe('function')
  })

  it('gate ON + alerta_urgente=true: saveEvento called BEFORE entregarAlertaPlaga (P7)', async () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))

    const callOrder: string[] = []
    vi.mocked(queries.saveEvento).mockImplementation(async () => {
      callOrder.push('saveEvento')
      return 'evt-order-test'
    })
    vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mockImplementation(async () => {
      callOrder.push('entregarAlertaPlaga')
      return { alert_sent: true, finca_id: 'F001', pest_type: 'moniliasis', reason: 'threshold_crossed' as const }
    })

    await procesarMensajeEntrante(msgSi(), 'trace-p7-order')
    await new Promise(r => setTimeout(r, 10))

    // saveEvento must come before entregarAlertaPlaga (event persisted before alert)
    const saveIdx = callOrder.indexOf('saveEvento')
    const deliverIdx = callOrder.indexOf('entregarAlertaPlaga')
    expect(saveIdx).toBeGreaterThanOrEqual(0)
    expect(deliverIdx).toBeGreaterThan(saveIdx)
  })

  it('M12 is_first_alert=true when haEntregadoAlertaAntes returns false (no prior history)', async () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))
    // No prior delivered alert for this finca+pest → is first alert
    vi.mocked(queries.haEntregadoAlertaAntes).mockResolvedValue(false)

    await procesarMensajeEntrante(msgSi(), 'trace-m12-first')
    await new Promise(r => setTimeout(r, 10))

    expect(alertaEntregaModule.entregarAlertaPlaga).toHaveBeenCalled()
    const [ctx] = vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mock.calls[0]!
    // No prior history → is_first_alert must be true
    expect(ctx.is_first_alert).toBe(true)
  })

  it('M12 is_first_alert=false when haEntregadoAlertaAntes returns true (prior alerts exist)', async () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))
    // Prior delivered alerts exist for this finca+pest
    vi.mocked(queries.haEntregadoAlertaAntes).mockResolvedValue(true)

    await procesarMensajeEntrante(msgSi(), 'trace-m12-repeat')
    await new Promise(r => setTimeout(r, 10))

    expect(alertaEntregaModule.entregarAlertaPlaga).toHaveBeenCalled()
    const [ctx] = vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mock.calls[0]!
    // Prior history → not first alert
    expect(ctx.is_first_alert).toBe(false)
  })

  it('M12 web-configured pest (no decision_alerta row) → is_first_alert correctly first-then-not', async () => {
    // This is the critical regression case: web-configured pests never have a decision_alerta row.
    // The old ask_count=null approach always resolved to is_first_alert=true (every delivery
    // looked like the first). haEntregadoAlertaAntes uses delivered history instead.
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))

    // First delivery: no prior history → is first alert
    vi.mocked(queries.haEntregadoAlertaAntes).mockResolvedValue(false)
    await procesarMensajeEntrante(msgSi(), 'trace-m12-web-first')
    await new Promise(r => setTimeout(r, 10))

    const firstCalls = vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mock.calls
    expect(firstCalls.length).toBeGreaterThanOrEqual(1)
    const [firstCtx] = firstCalls[0]!
    expect(firstCtx.is_first_alert).toBe(true)

    // Reset for second delivery
    vi.clearAllMocks()
    vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionPendingConfirmation(true))
    vi.mocked(queries.saveEvento).mockResolvedValue('evt-web-second')
    vi.mocked(queries.markAlertaEntregada).mockResolvedValue(true)
    vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mockResolvedValue({
      alert_sent: true, finca_id: 'F001', pest_type: 'moniliasis', reason: 'threshold_crossed',
    })

    // Second delivery: prior history exists → NOT first alert
    vi.mocked(queries.haEntregadoAlertaAntes).mockResolvedValue(true)
    await procesarMensajeEntrante(msgSi(), 'trace-m12-web-second')
    await new Promise(r => setTimeout(r, 10))

    const secondCalls = vi.mocked(alertaEntregaModule.entregarAlertaPlaga).mock.calls
    expect(secondCalls.length).toBeGreaterThanOrEqual(1)
    const [secondCtx] = secondCalls[0]!
    expect(secondCtx.is_first_alert).toBe(false)
  })
})

// ─── DM reply before session-open race (fix #2 from PR#3a) ─────────────────
// When outreachDecisionMakers sends a DM but fails to persist the session (network glitch),
// the DM's next reply arrives with status='active' (or no session). The corrupted-ctx guard
// in handleAlertConfigSession catches the missing pest_type/finca_id/org_id and resets
// gracefully instead of crashing.

describe('PR#3b — DM reply before session-open race: corrupted-ctx guard', () => {
  let sender: ReturnType<typeof makeSender>
  let llm: ReturnType<typeof makeLlm>

  const decisionMaker = {
    id: 'dm-race',
    phone: '593999111888',
    nombre: 'Ana',
    rol: 'admin_org',
    org_id: 'ORG001',
    finca_id: null,
    email: null,
    onboarding_completo: true,
    consentimiento_datos: true,
    status: 'active',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.getMensajeByWamid).mockResolvedValue(null)
    vi.mocked(queries.registrarMensaje).mockResolvedValue('msg-uuid')
    vi.mocked(queries.actualizarMensaje).mockResolvedValue(undefined)
    vi.mocked(queries.updateSession).mockResolvedValue(undefined)
    vi.mocked(queries.getUserByPhone).mockResolvedValue(decisionMaker)

    sender = makeSender()
    llm = makeLlm()
    inicializarPipeline(sender, llm)
  })

  it('corrupted pending_alert_config (missing pest_type): session resets gracefully, DM gets prompt', async () => {
    // The session was opened but contexto_parcial is empty/corrupted
    // (send succeeded but updateSession failed — fix #2 race)
    vi.mocked(queries.getOrCreateSession).mockResolvedValue({
      session_id: 'ses-race-1',
      phone: '593999111888',
      finca_id: null,
      tipo_sesion: 'reporte',
      clarification_count: 0,
      status: 'pending_alert_config' as const,
      paso_onboarding: null,
      contexto_parcial: {
        // Corrupted: missing pest_type, finca_id, org_id — session was never properly opened
      },
    })

    const msg: NormalizedMessage = {
      wamid: 'wamid.race1',
      from: '593999111888',
      timestamp: new Date(),
      tipo: 'texto',
      texto: '15', // DM tries to reply to the config question
      rawPayload: {},
    }

    // Must not throw — the corrupted-ctx guard handles this gracefully
    await expect(procesarMensajeEntrante(msg, 'trace-race')).resolves.not.toThrow()

    // Session must be reset (status=active, ctx cleared)
    expect(queries.updateSession).toHaveBeenCalledWith(
      'ses-race-1',
      expect.objectContaining({ status: 'active', contexto_parcial: {} }),
    )

    // DM receives a recovery prompt (not silence)
    expect(sender.enviarTexto).toHaveBeenCalledWith('593999111888', expect.any(String))
  })

  it('pending_alert_config with valid ctx: does not crash — normal reducer flow runs instead of guard', async () => {
    // Valid ctx — the corrupted-ctx guard should NOT intercept this.
    // The reducer will handle the reply (ask_next / persist / etc.) normally.
    vi.mocked(queries.getOrCreateSession).mockResolvedValue({
      session_id: 'ses-race-2',
      phone: '593999111888',
      finca_id: null,
      tipo_sesion: 'reporte',
      clarification_count: 0,
      status: 'pending_alert_config' as const,
      paso_onboarding: null,
      contexto_parcial: {
        pest_type: 'moniliasis',
        finca_id: 'F001',
        org_id: 'ORG001',
        pending_campos: ['pct_afectado'],
        collected: {},
        current_campo: 'pct_afectado',
        turn: 0,
      },
    })

    const msg: NormalizedMessage = {
      wamid: 'wamid.race2',
      from: '593999111888',
      timestamp: new Date(),
      tipo: 'texto',
      texto: '20',
      rawPayload: {},
    }

    // Must not throw — the reducer handles the reply; the guard never fires for valid ctx
    await expect(procesarMensajeEntrante(msg, 'trace-valid-ctx')).resolves.not.toThrow()

    // DM receives some response (the reducer sent a prompt or confirmation)
    expect(sender.enviarTexto).toHaveBeenCalled()
  })
})
