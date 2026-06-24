import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Module mocks (must be declared before imports) ────────────────────────────

vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

vi.mock('../../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      event: vi.fn(),
      generation: vi.fn().mockReturnValue({ end: vi.fn() }),
    }),
  },
}))

// We test the side-effects that handleOnboardingAdmin triggers after
// finca creation: startTrial, seedMetricasPlantilla, seedFincaConfig.
// Those functions live in supabaseQueries — mock the whole module.
vi.mock('../../../src/pipeline/supabaseQueries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/pipeline/supabaseQueries.js')>()
  return {
    ...actual,
    getUserByPhone: vi.fn(),
    getOrCreateSession: vi.fn(),
    updateSession: vi.fn().mockResolvedValue(undefined),
    saveUserConsent: vi.fn().mockResolvedValue(undefined),
    updateUsuario: vi.fn().mockResolvedValue(undefined),
    getNextFincaId: vi.fn().mockResolvedValue('F002'),
    createFinca: vi.fn().mockResolvedValue(undefined),
    createLote: vi.fn().mockResolvedValue(undefined),
    actualizarMensaje: vi.fn().mockResolvedValue(undefined),
    updateFincaCoordenadas: vi.fn().mockResolvedValue(undefined),
    getFincasDisponibles: vi.fn().mockResolvedValue([]),
    getJefeByFinca: vi.fn().mockResolvedValue(null),
    // The three functions under test for T-14/T-15
    startTrial: vi.fn().mockResolvedValue(undefined),
    seedMetricasPlantilla: vi.fn().mockResolvedValue(undefined),
    seedFincaConfig: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('../../../src/pipeline/procesarMensajeEntrante.js', () => ({
  _sender: { enviarTexto: vi.fn().mockResolvedValue(undefined) },
  _llm: {
    onboardarAdmin: vi.fn(),
    onboardarAgricultor: vi.fn(),
  },
  _intentDetector: vi.fn(),
  _ragRetriever: null,
  _embeddingService: null,
  ROLES_ADMIN: ['admin_org', 'propietario'],
}))

vi.mock('../../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../../src/integrations/whatsapp/EvolutionMediaClient.js', () => ({
  downloadEvolutionMedia: vi.fn().mockResolvedValue({ base64: '', mimeType: 'audio/ogg' }),
}))

vi.mock('../../../src/agents/onboarding/context.js', () => ({
  reduceOnboardingContext: vi.fn().mockImplementation((ctx: Record<string, unknown>, updates: Record<string, unknown>) => ({ ...ctx, ...updates })),
  mapDatosToExtraction: vi.fn().mockReturnValue({}),
}))

vi.mock('../../../src/agents/onboarding/contextStore.js', () => ({
  hydrateOnboardingContext: vi.fn().mockReturnValue({ pasoSiguiente: 0, onboardingCompleto: false, consentimiento: false }),
  toContextoConversacion: vi.fn().mockReturnValue({}),
  toContextoAgricultor: vi.fn().mockReturnValue({}),
  serializeContextForSession: vi.fn().mockReturnValue({}),
  loadCachedOnboardingContext: vi.fn().mockResolvedValue(null),
  cacheOnboardingContext: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../src/integrations/timedFetch.js', () => ({
  timedFetch: vi.fn().mockReturnValue(() => Promise.resolve({ json: () => Promise.resolve([]) })),
}))

// Mock founderAlerts so we can assert it is called without real WhatsApp sends
vi.mock('../../../src/integrations/whatsapp/founderAlerts.js', () => ({
  alertarFounder: vi.fn().mockResolvedValue({ sent: true }),
  construirMensajeFounder: vi.fn().mockReturnValue('test message'),
}))

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { handleOnboardingAdmin } from '../../../src/pipeline/handlers/OnboardingHandler.js'
import * as supabaseQueriesMod from '../../../src/pipeline/supabaseQueries.js'
import * as procesarMensajeMod from '../../../src/pipeline/procesarMensajeEntrante.js'
import * as founderAlertsMod from '../../../src/integrations/whatsapp/founderAlerts.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tipo: 'texto' as const,
    texto: 'mi finca se llama La Esperanza, cultivo banano, en Ecuador',
    from: '593987310830',
    wamid: 'wamid.test.01',
    rawPayload: {},
    ...overrides,
  }
}

function makeUsuario(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'usr-1',
    phone: '593987310830',
    nombre: 'Test Admin',
    rol: 'admin_org',
    org_id: 'ORG001',
    finca_id: null,
    email: null,
    onboarding_completo: false,
    consentimiento_datos: false,
    status: 'activo',
    ...overrides,
  }
}

function makeSession() {
  return {
    session_id: 'ses-1',
    phone: '593987310830',
    finca_id: null,
    tipo_sesion: 'onboarding' as const,
    clarification_count: 0,
    paso_onboarding: 0,
    contexto_parcial: {},
    status: 'active',
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OnboardingHandler — trial start and farm seed wiring (T-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls startTrial after onboarding completes (trial_inicio set when NULL)', async () => {
    const sq = supabaseQueriesMod as Record<string, ReturnType<typeof vi.fn>>
    sq['getUserByPhone'].mockResolvedValue(makeUsuario())
    sq['getOrCreateSession'].mockResolvedValue(makeSession())

    const llm = (procesarMensajeMod as Record<string, unknown>)['_llm'] as Record<string, ReturnType<typeof vi.fn>>
    llm['onboardarAdmin'].mockResolvedValue({
      onboarding_completo: true,
      paso_completado: 1,
      siguiente_paso: 2,
      mensaje_para_usuario: 'Listo, tu finca fue creada.',
      datos_extraidos: {
        finca_nombre: 'La Esperanza',
        cultivo_principal: 'banano',
        pais: 'EC',
        lotes: [],
      },
    })

    await handleOnboardingAdmin(makeMsg() as any, makeUsuario() as any, 'msg-1', 'trace-1')

    expect(sq['startTrial']).toHaveBeenCalledWith('ORG001')
  })

  it('calls seedMetricasPlantilla with the finca cultivo_principal after onboarding completes', async () => {
    const sq = supabaseQueriesMod as Record<string, ReturnType<typeof vi.fn>>
    sq['getUserByPhone'].mockResolvedValue(makeUsuario())
    sq['getOrCreateSession'].mockResolvedValue(makeSession())

    const llm = (procesarMensajeMod as Record<string, unknown>)['_llm'] as Record<string, ReturnType<typeof vi.fn>>
    llm['onboardarAdmin'].mockResolvedValue({
      onboarding_completo: true,
      paso_completado: 1,
      siguiente_paso: 2,
      mensaje_para_usuario: 'Listo.',
      datos_extraidos: {
        finca_nombre: 'La Esperanza',
        cultivo_principal: 'banano',
        pais: 'EC',
        lotes: [],
      },
    })

    await handleOnboardingAdmin(makeMsg() as any, makeUsuario() as any, 'msg-1', 'trace-1')

    expect(sq['seedMetricasPlantilla']).toHaveBeenCalledWith(
      'ORG001',
      expect.stringContaining('F'), // fincaId
      'banano',
    )
  })

  it('calls seedFincaConfig with the finca cultivo_principal after onboarding completes', async () => {
    const sq = supabaseQueriesMod as Record<string, ReturnType<typeof vi.fn>>
    sq['getUserByPhone'].mockResolvedValue(makeUsuario())
    sq['getOrCreateSession'].mockResolvedValue(makeSession())

    const llm = (procesarMensajeMod as Record<string, unknown>)['_llm'] as Record<string, ReturnType<typeof vi.fn>>
    llm['onboardarAdmin'].mockResolvedValue({
      onboarding_completo: true,
      paso_completado: 1,
      siguiente_paso: 2,
      mensaje_para_usuario: 'Listo.',
      datos_extraidos: {
        finca_nombre: 'La Esperanza',
        cultivo_principal: 'banano',
        pais: 'EC',
        lotes: [],
      },
    })

    await handleOnboardingAdmin(makeMsg() as any, makeUsuario() as any, 'msg-1', 'trace-1')

    expect(sq['seedFincaConfig']).toHaveBeenCalledWith(
      expect.stringContaining('F'), // fincaId
      'banano',
    )
  })

  it('does NOT call startTrial when onboarding is NOT complete yet', async () => {
    const sq = supabaseQueriesMod as Record<string, ReturnType<typeof vi.fn>>
    sq['getUserByPhone'].mockResolvedValue(makeUsuario())
    sq['getOrCreateSession'].mockResolvedValue(makeSession())

    const llm = (procesarMensajeMod as Record<string, unknown>)['_llm'] as Record<string, ReturnType<typeof vi.fn>>
    llm['onboardarAdmin'].mockResolvedValue({
      onboarding_completo: false,
      paso_completado: 1,
      siguiente_paso: 2,
      mensaje_para_usuario: '¿Cuál es el nombre de tu finca?',
      datos_extraidos: {},
    })

    await handleOnboardingAdmin(makeMsg() as any, makeUsuario() as any, 'msg-1', 'trace-1')

    expect(sq['startTrial']).not.toHaveBeenCalled()
    expect(sq['seedMetricasPlantilla']).not.toHaveBeenCalled()
    expect(sq['seedFincaConfig']).not.toHaveBeenCalled()
  })

  it('seed failure does not break onboarding (best-effort, P4)', async () => {
    const sq = supabaseQueriesMod as Record<string, ReturnType<typeof vi.fn>>
    sq['getUserByPhone'].mockResolvedValue(makeUsuario())
    sq['getOrCreateSession'].mockResolvedValue(makeSession())
    sq['seedMetricasPlantilla'].mockRejectedValue(new Error('DB seed error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const llm = (procesarMensajeMod as Record<string, unknown>)['_llm'] as Record<string, ReturnType<typeof vi.fn>>
    llm['onboardarAdmin'].mockResolvedValue({
      onboarding_completo: true,
      paso_completado: 1,
      siguiente_paso: 2,
      mensaje_para_usuario: 'Listo.',
      datos_extraidos: {
        finca_nombre: 'La Esperanza',
        cultivo_principal: 'banano',
        pais: 'EC',
        lotes: [],
      },
    })

    // Should NOT throw even though seed fails
    await expect(
      handleOnboardingAdmin(makeMsg() as any, makeUsuario() as any, 'msg-1', 'trace-1')
    ).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })

  it('fires alertarFounder when startTrial rejects AND onboarding still completes (Fix 3)', async () => {
    // CRITICAL: startTrial failure must not silently leave trial_inicio=NULL with
    // no signal. The founder must be alerted (P7) so they can fix it manually.
    const sq = supabaseQueriesMod as Record<string, ReturnType<typeof vi.fn>>
    sq['getUserByPhone'].mockResolvedValue(makeUsuario())
    sq['getOrCreateSession'].mockResolvedValue(makeSession())
    sq['startTrial'].mockRejectedValue(new Error('DB trial error'))

    const llm = (procesarMensajeMod as Record<string, unknown>)['_llm'] as Record<string, ReturnType<typeof vi.fn>>
    llm['onboardarAdmin'].mockResolvedValue({
      onboarding_completo: true,
      paso_completado: 1,
      siguiente_paso: 2,
      mensaje_para_usuario: 'Listo.',
      datos_extraidos: {
        finca_nombre: 'La Esperanza',
        cultivo_principal: 'banano',
        pais: 'EC',
        lotes: [],
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // onboarding must still complete without throwing (P4)
    await expect(
      handleOnboardingAdmin(makeMsg() as any, makeUsuario() as any, 'msg-1', 'trace-1')
    ).resolves.toBeUndefined()

    // alertarFounder must have been called with the critical alert reason
    const alertFn = vi.mocked(founderAlertsMod.alertarFounder)
    expect(alertFn).toHaveBeenCalledWith(
      'onboarding_requiere_revision',
      expect.objectContaining({ detalle: expect.stringContaining('ORG001') }),
      expect.anything(),
    )

    consoleSpy.mockRestore()
  })
})
