import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

vi.mock('../../src/integrations/supabase.js', () => ({ supabase: {} }))

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getOrCreateSession: vi.fn().mockResolvedValue({ session_id: 'ses-1', phone: '593987000111', finca_id: null, tipo_sesion: 'onboarding', clarification_count: 0, contexto_parcial: {}, status: 'active', paso_onboarding: null }),
  updateSession: vi.fn().mockResolvedValue(undefined),
  updateUsuario: vi.fn().mockResolvedValue(undefined),
  saveUserConsent: vi.fn().mockResolvedValue(undefined),
  setOnboardingEstado: vi.fn().mockResolvedValue({ transitioned: true }),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  getNextFincaId: vi.fn().mockResolvedValue('F002'),
  createFinca: vi.fn().mockResolvedValue(undefined),
  createLote: vi.fn().mockResolvedValue(undefined),
  getFincasDisponibles: vi.fn().mockResolvedValue([]),
  getJefeByFinca: vi.fn().mockResolvedValue(null),
  updateFincaCoordenadas: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/integrations/whatsapp/founderAlerts.js', () => ({
  alertarFounder: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn() }) },
}))

vi.mock('../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn(),
}))

vi.mock('../../src/integrations/whatsapp/EvolutionMediaClient.js', () => ({
  downloadEvolutionMedia: vi.fn(),
}))

vi.mock('../../src/agents/onboarding/contextStore.js', () => ({
  loadCachedOnboardingContext: vi.fn().mockResolvedValue(null),
  hydrateOnboardingContext: vi.fn().mockReturnValue({
    userId: 'usr-1', phone: '593987000111', tipoFlujo: 'admin',
    nombre: null, rol: null, consentimiento: false, fincaNombre: null,
    fincaUbicacionTexto: null, fincaId: null, cultivoPrincipal: null, pais: null,
    lotes: [], historial: [], pasoCompletado: 0, pasoSiguiente: 1,
    clarificationTurnsUsed: 0, onboardingCompleto: false,
  }),
  toContextoConversacion: vi.fn().mockReturnValue({}),
  toContextoAgricultor: vi.fn().mockReturnValue({}),
  serializeContextForSession: vi.fn().mockReturnValue({}),
  cacheOnboardingContext: vi.fn().mockResolvedValue(undefined),
}))

import { handleOnboardingAdmin } from '../../src/pipeline/handlers/OnboardingHandler.js'
import { inicializarPipeline } from '../../src/pipeline/procesarMensajeEntrante.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as founderAlerts from '../../src/integrations/whatsapp/founderAlerts.js'
import * as stt from '../../src/pipeline/sttService.js'

const usuarioAdmin = {
  id: 'usr-1', phone: '593987000111', nombre: 'Don Pepe', rol: 'propietario',
  finca_id: null, org_id: 'ORG001', email: null, onboarding_completo: false,
  consentimiento_datos: false, status: 'activo', onboarding_estado: 'en_progreso',
} as any

function crearSender() { return { enviarTexto: vi.fn().mockResolvedValue(undefined), enviarTemplate: vi.fn() } }
function crearLlm(resultado: any) {
  return { onboardarAdmin: vi.fn().mockResolvedValue(resultado), onboardarAgricultor: vi.fn() } as any
}

const respBase = {
  paso_completado: 1, siguiente_paso: 2,
  datos_extraidos: { nombre: 'Don Pepe', consentimiento: true },
  mensaje_para_usuario: 'Listo ✅', onboarding_completo: false,
}

beforeEach(() => vi.clearAllMocks())

describe('OnboardingHandler recovery (PR-B)', () => {
  it('STT degradado (#7): audio ilegible → pide escribir, NO llama al LLM', async () => {
    const sender = crearSender()
    const llm = crearLlm(respBase)
    inicializarPipeline(sender as any, llm)
    vi.mocked(stt.transcribirAudio).mockRejectedValue(new Error('stt fail'))

    const msg: NormalizedMessage = { wamid: 'w1', from: '593987000111', timestamp: new Date(), tipo: 'audio', audioUrl: 'http://a/x.ogg', rawPayload: {} }
    await handleOnboardingAdmin(msg, usuarioAdmin, 'msg-1', 'trace-1')

    expect(llm.onboardarAdmin).not.toHaveBeenCalled()
    expect(sender.enviarTexto).toHaveBeenCalledWith('593987000111', expect.stringMatching(/no te entend.* audio/i))
  })

  it('rechazo de consentimiento (#3): → estado terminal + alerta founder + cierre', async () => {
    const sender = crearSender()
    const llm = crearLlm({ ...respBase, datos_extraidos: { consentimiento: false }, mensaje_para_usuario: 'ok' })
    inicializarPipeline(sender as any, llm)

    const msg: NormalizedMessage = { wamid: 'w2', from: '593987000111', timestamp: new Date(), tipo: 'texto', texto: 'no', rawPayload: {} }
    await handleOnboardingAdmin(msg, usuarioAdmin, 'msg-2', 'trace-2')

    expect(queries.setOnboardingEstado).toHaveBeenCalledWith('usr-1', 'rechazo_consentimiento')
    expect(founderAlerts.alertarFounder).toHaveBeenCalledWith('consentimiento_rechazado', expect.objectContaining({ phone: '593987000111' }))
    expect(sender.enviarTexto).toHaveBeenCalledWith('593987000111', expect.stringMatching(/cambias de idea/i))
  })

  it('stuck por techo de pasos (#1): → requiere_revision + alerta founder + holding', async () => {
    const sender = crearSender()
    // LLM no completa y empuja el paso al techo
    const llm = crearLlm({ ...respBase, siguiente_paso: 10, datos_extraidos: { nombre: 'Don Pepe' }, onboarding_completo: false })
    inicializarPipeline(sender as any, llm)

    const msg: NormalizedMessage = { wamid: 'w3', from: '593987000111', timestamp: new Date(), tipo: 'texto', texto: 'no sé', rawPayload: {} }
    await handleOnboardingAdmin(msg, usuarioAdmin, 'msg-3', 'trace-3')

    expect(queries.setOnboardingEstado).toHaveBeenCalledWith('usr-1', 'requiere_revision', { pasoTrabado: 10 })
    expect(founderAlerts.alertarFounder).toHaveBeenCalledWith('onboarding_requiere_revision', expect.objectContaining({ phone: '593987000111' }))
    expect(sender.enviarTexto).toHaveBeenCalledWith('593987000111', expect.stringMatching(/revisar|en breve/i))
  })

  it('camino normal: no dispara estados terminales', async () => {
    const sender = crearSender()
    const llm = crearLlm(respBase)
    inicializarPipeline(sender as any, llm)

    const msg: NormalizedMessage = { wamid: 'w4', from: '593987000111', timestamp: new Date(), tipo: 'texto', texto: 'Don Pepe', rawPayload: {} }
    await handleOnboardingAdmin(msg, usuarioAdmin, 'msg-4', 'trace-4')

    expect(queries.setOnboardingEstado).toHaveBeenCalledWith('usr-1', 'en_progreso')
    expect(founderAlerts.alertarFounder).not.toHaveBeenCalled()
    expect(sender.enviarTexto).toHaveBeenCalledWith('593987000111', 'Listo ✅')
  })
})
