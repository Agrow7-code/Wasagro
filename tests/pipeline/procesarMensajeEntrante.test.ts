import { describe, expect, it, vi, beforeEach } from 'vitest'
import { procesarMensajeEntrante, inicializarPipeline } from '../../src/pipeline/procesarMensajeEntrante.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'
import type { EventoCampoExtraido } from '../../src/types/dominio/EventoCampo.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getMensajeByWamid: vi.fn(),
  registrarMensaje: vi.fn().mockResolvedValue('msg-uuid'),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  getUserByPhone: vi.fn(),
  getFincaById: vi.fn().mockResolvedValue({ finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' }),
  getLotesByFinca: vi.fn().mockResolvedValue([{ lote_id: 'F001-L01', finca_id: 'F001', nombre_coloquial: 'El de arriba', hectareas: 2 }]),
  getOrCreateSession: vi.fn().mockResolvedValue({ session_id: 'ses-1', phone: '593987654321', finca_id: null, tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {}, status: 'active', paso_onboarding: null }),
  updateSession: vi.fn().mockResolvedValue(undefined),
  saveEvento: vi.fn().mockResolvedValue('evt-uuid'),
  saveProspecto: vi.fn().mockResolvedValue('pros-uuid'),
  getFincasDisponibles: vi.fn().mockResolvedValue([{ finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' }]),
  updateUsuario: vi.fn().mockResolvedValue(undefined),
  saveUserConsent: vi.fn().mockResolvedValue(undefined),
  getNextFincaId: vi.fn().mockResolvedValue('F002'),
  createFinca: vi.fn().mockResolvedValue(undefined),
  createLote: vi.fn().mockResolvedValue(undefined),
  getJefeByFinca: vi.fn().mockResolvedValue(null),
  getPendingAgricultoresByFinca: vi.fn().mockResolvedValue([]),
  approveAgricultor: vi.fn().mockResolvedValue(undefined),
  updateFincaCoordenadas: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn().mockResolvedValue('Apliqué mancozeb'),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn(), generation: vi.fn().mockReturnValue({ end: vi.fn() }) }) },
}))

vi.mock('../../src/integrations/gcal.js', () => ({
  gcalConfigurado: vi.fn().mockReturnValue(false),
  verificarDisponibilidad: vi.fn().mockResolvedValue('unknown'),
  crearReunionConMeet: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/integrations/calendar.js', () => ({
  checkCalendarAvailability: vi.fn().mockResolvedValue('unknown'),
  buildCalendlyUrl: vi.fn().mockImplementation((base: string) => base),
}))

vi.mock('../../src/agents/sdrAgent.js', () => ({
  handleSDRSession: vi.fn().mockResolvedValue(undefined),
  handleFounderApproval: vi.fn().mockResolvedValue(false),
  handleMeetingConfirmation: vi.fn().mockResolvedValue(false),
}))

import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as sttService from '../../src/pipeline/sttService.js'
import * as gcal from '../../src/integrations/gcal.js'
import * as sdrAgent from '../../src/agents/sdrAgent.js'
import { langfuse } from '../../src/integrations/langfuse.js'

const usuarioActivo = {
  id: 'usr-1', phone: '593987654321', nombre: 'Carlos', rol: 'agricultor',
  finca_id: 'F001', org_id: 'ORG001', onboarding_completo: true,
  consentimiento_datos: true, status: 'activo', email: null,
}

const usuarioJefe = {
  id: 'usr-jefe', phone: '593999000001', nombre: 'Don Marco', rol: 'propietario',
  finca_id: 'F001', org_id: 'ORG001', onboarding_completo: true,
  consentimiento_datos: true, status: 'activo', email: null,
}

const usuarioPendienteOnboarding = {
  id: 'usr-new', phone: '593987654321', nombre: null, rol: 'agricultor',
  finca_id: null, org_id: 'ORG001', onboarding_completo: false,
  consentimiento_datos: false, status: 'activo', email: null,
}

const usuarioAdminOnboarding = {
  id: 'usr-admin', phone: '593999111222', nombre: null, rol: 'propietario',
  finca_id: null, org_id: 'ORG001', onboarding_completo: false,
  consentimiento_datos: false, status: 'activo', email: null,
}

const extractedEventoMock: EventoCampoExtraido = {
  tipo_evento: 'insumo',
  lote_id: 'F001-L01',
  lote_detectado_raw: null,
  fecha_evento: null,
  confidence_score: 0.90,
  requiere_validacion: false,
  alerta_urgente: false,
  campos_extraidos: { producto: 'mancozeb', dosis_cantidad: 2 },
  confidence_por_campo: {},
  campos_faltantes: [],
  requiere_clarificacion: false,
  pregunta_sugerida: null,
}

const prospectoResponseMock = {
  paso_completado: 1,
  siguiente_paso: 2,
  tipo_contacto: 'sin_clasificar' as const,
  datos_extraidos: { nombre: null, finca_nombre: null, cultivo_principal: null, pais: null, tamanio_aproximado: null, interes_demo: false, horario_preferido: null },
  enviar_link_demo: false,
  guardar_en_prospectos: false,
  mensaje_para_usuario: 'Hola, soy Wasagro. ¿Cuál es tu nombre?',
}

const onboardingAdminResponseMock = {
  paso_completado: 1, siguiente_paso: 2,
  datos_extraidos: { nombre: null, rol: null, consentimiento: null, finca_nombre: null, finca_ubicacion_texto: null, finca_lat: null, finca_lng: null, cultivo_principal: null, pais: null, lotes: [] },
  mensaje_para_usuario: '¿Con quién hablo?',
  onboarding_completo: false,
}

const onboardingAgricultorResponseMock = {
  paso_completado: 1, siguiente_paso: 2,
  datos_extraidos: { nombre: null, rol: null, consentimiento: null, finca_id: null },
  status_usuario: undefined,
  notificar_jefe: false,
  mensaje_para_usuario: '¡Hola! ¿Cómo te llamas?',
  onboarding_completo: false,
}

function crearSenderMock() {
  return { enviarTexto: vi.fn().mockResolvedValue(undefined) }
}

function crearLlmMock(extraido: EventoCampoExtraido = extractedEventoMock) {
  return {
    extraerEvento: vi.fn().mockResolvedValue(extraido),
    atenderProspecto: vi.fn().mockResolvedValue(prospectoResponseMock),
    onboardarAdmin: vi.fn().mockResolvedValue(onboardingAdminResponseMock),
    onboardarAgricultor: vi.fn().mockResolvedValue(onboardingAgricultorResponseMock),
    corregirTranscripcion: vi.fn(),
    analizarImagen: vi.fn(),
    resumirSemana: vi.fn(),
    atenderSDR: vi.fn(),
  }
}

const msgTexto: NormalizedMessage = { wamid: 'wamid.001', from: '593987654321', timestamp: new Date(), tipo: 'texto', texto: 'Apliqué mancozeb en lote 3', rawPayload: {} }
const msgAudio: NormalizedMessage = { wamid: 'wamid.002', from: '593987654321', timestamp: new Date(), tipo: 'audio', audioUrl: 'http://audio.example.com/clip.ogg', rawPayload: {} }

function sessionActiva(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'ses-1', phone: '593987654321', finca_id: null,
    tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {},
    status: 'active', paso_onboarding: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queries.getMensajeByWamid).mockResolvedValue(null)
  vi.mocked(queries.registrarMensaje).mockResolvedValue('msg-uuid')
  vi.mocked(queries.actualizarMensaje).mockResolvedValue(undefined)
  vi.mocked(queries.saveEvento).mockResolvedValue('evt-uuid')
  vi.mocked(queries.updateSession).mockResolvedValue(undefined)
  vi.mocked(queries.getFincaById).mockResolvedValue({ finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' })
  vi.mocked(queries.getLotesByFinca).mockResolvedValue([{ lote_id: 'F001-L01', finca_id: 'F001', nombre_coloquial: 'El de arriba', hectareas: 2 }])
  vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva())
  vi.mocked(gcal.gcalConfigurado).mockReturnValue(false)
})

describe('procesarMensajeEntrante', () => {
  describe('idempotencia', () => {
    it('retorna sin procesar si el wamid ya existe', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getMensajeByWamid).mockResolvedValue({ id: 'existing', wa_message_id: 'wamid.001', status: 'processed' })

      await procesarMensajeEntrante(msgTexto, 'trace-1')

      expect(queries.registrarMensaje).not.toHaveBeenCalled()
      expect(sender.enviarTexto).not.toHaveBeenCalled()
    })
  })

  describe('procesamiento de evento (texto)', () => {
    it('extrae evento y envía resumen para confirmar', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)

      await procesarMensajeEntrante(msgTexto, 'trace-3')

      expect(llm.extraerEvento).toHaveBeenCalledOnce()
      expect(queries.saveEvento).not.toHaveBeenCalled()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'pending_confirmation' }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('mancozeb'))
    })

    it('guarda evento cuando usuario confirma en pending_confirmation', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: { ...extractedEventoMock, requiere_clarificacion: false } as unknown as Record<string, unknown>,
          transcripcion_original: 'Apliqué mancozeb en lote 3',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'sí' }, 'trace-confirm')

      expect(queries.saveEvento).toHaveBeenCalledWith(expect.objectContaining({
        finca_id: 'F001',
        tipo_evento: 'insumo',
        descripcion_raw: 'Apliqué mancozeb en lote 3',
      }))
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'completed' }))
    })

    it('guarda como nota_libre cuando confirma evento con requiere_clarificacion (Regla 2)', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: { ...extractedEventoMock, requiere_clarificacion: true } as unknown as Record<string, unknown>,
          transcripcion_original: 'Algo pasó',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'sí' }, 'trace-nota')

      expect(queries.saveEvento).toHaveBeenCalledWith(expect.objectContaining({ tipo_evento: 'nota_libre', status: 'requires_review' }))
    })

    it('envía pregunta de clarificación cuando requiere_clarificacion y count < 2', async () => {
      const sender = crearSenderMock()
      const extracted = { ...extractedEventoMock, requiere_clarificacion: true, pregunta_sugerida: '¿Cuántas bombadas?' }
      const llm = crearLlmMock(extracted)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)

      await procesarMensajeEntrante(msgTexto, 'trace-4')

      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', '¿Cuántas bombadas?')
      expect(queries.saveEvento).not.toHaveBeenCalled()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ clarification_count: 1 }))
    })
  })

  describe('procesamiento de audio', () => {
    it('transcribe el audio antes de extraer el evento', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)

      await procesarMensajeEntrante(msgAudio, 'trace-6')

      expect(sttService.transcribirAudio).toHaveBeenCalledWith('http://audio.example.com/clip.ogg', 'trace-6')
      expect(llm.extraerEvento).toHaveBeenCalledWith(expect.objectContaining({ transcripcion: 'Apliqué mancozeb' }), 'trace-6')
    })
  })

  describe('onboarding admin', () => {
    it('guarda consentimiento P6 cuando admin acepta por primera vez', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioAdminOnboarding)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({ tipo_sesion: 'onboarding' }))
      vi.mocked(llm.onboardarAdmin).mockResolvedValue({
        ...onboardingAdminResponseMock,
        datos_extraidos: { ...onboardingAdminResponseMock.datos_extraidos, consentimiento: true },
      })

      await procesarMensajeEntrante({ ...msgTexto, from: '593999111222', texto: 'Sí acepto' }, 'trace-cons-admin')

      expect(queries.saveUserConsent).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'usr-admin', tipo: 'datos', aceptado: true,
        texto_mostrado: expect.stringContaining('reportes de tu finca'),
      }))
      expect(queries.updateUsuario).toHaveBeenCalledWith('usr-admin', expect.objectContaining({ consentimiento_datos: true }))
    })

    it('crea finca y lotes cuando onboarding admin completa con datos', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioAdminOnboarding)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({ tipo_sesion: 'onboarding' }))
      vi.mocked(llm.onboardarAdmin).mockResolvedValue({
        paso_completado: 6, siguiente_paso: 6,
        datos_extraidos: {
          nombre: 'Marco', rol: 'propietario', consentimiento: true,
          finca_nombre: 'Finca El Cacao', finca_ubicacion_texto: 'Esmeraldas',
          finca_lat: null, finca_lng: null, cultivo_principal: 'cacao', pais: 'EC',
          lotes: [{ nombre_coloquial: 'El de arriba', hectareas: 3 }, { nombre_coloquial: 'El de abajo', hectareas: 2 }],
        },
        mensaje_para_usuario: '¡Listo Marco! ✅',
        onboarding_completo: true,
      })

      await procesarMensajeEntrante({ ...msgTexto, from: '593999111222', texto: 'Sí está bien' }, 'trace-admin-finca')

      expect(queries.getNextFincaId).toHaveBeenCalledOnce()
      expect(queries.createFinca).toHaveBeenCalledWith(expect.objectContaining({ finca_id: 'F002', org_id: 'ORG001', nombre: 'Finca El Cacao' }))
      expect(queries.createLote).toHaveBeenCalledTimes(2)
      expect(queries.updateUsuario).toHaveBeenCalledWith('usr-admin', expect.objectContaining({ finca_id: 'F002', onboarding_completo: true }))
    })
  })

  describe('onboarding agricultor', () => {
    it('guarda consentimiento P6 cuando agricultor acepta por primera vez', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioPendienteOnboarding)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({ tipo_sesion: 'onboarding' }))
      vi.mocked(llm.onboardarAgricultor).mockResolvedValue({
        ...onboardingAgricultorResponseMock,
        datos_extraidos: { ...onboardingAgricultorResponseMock.datos_extraidos, consentimiento: true },
      })

      await procesarMensajeEntrante(msgTexto, 'trace-cons-agr')

      expect(queries.saveUserConsent).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'usr-new', tipo: 'datos', aceptado: true,
        texto_mostrado: expect.stringContaining('reportes de campo'),
      }))
    })

    it('notifica al jefe cuando agricultor queda pendiente de aprobación', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioPendienteOnboarding)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({ tipo_sesion: 'onboarding' }))
      vi.mocked(queries.getJefeByFinca).mockResolvedValue({ id: 'usr-jefe', phone: '593999000001', nombre: 'Don Marco', rol: 'propietario' })
      vi.mocked(llm.onboardarAgricultor).mockResolvedValue({
        ...onboardingAgricultorResponseMock,
        datos_extraidos: { nombre: 'Juan', rol: 'agricultor', consentimiento: true, finca_id: 'F001' },
        status_usuario: 'pendiente_aprobacion',
        notificar_jefe: true,
      })

      await procesarMensajeEntrante(msgTexto, 'trace-pend-agr')

      expect(queries.updateUsuario).toHaveBeenCalledWith('usr-new', expect.objectContaining({ status: 'pendiente_aprobacion' }))
      expect(queries.updateUsuario).toHaveBeenCalledWith('usr-new', expect.objectContaining({ finca_id: 'F001' }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593999000001', expect.stringContaining('Juan'))
    })
  })

  describe('comando de aprobación (jefe)', () => {
    it('aprueba agricultor pendiente y notifica a ambas partes', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioJefe)
      vi.mocked(queries.getPendingAgricultoresByFinca).mockResolvedValue([
        { id: 'usr-pend', phone: '593987000099', nombre: 'Juan', rol: 'agricultor', finca_id: 'F001', org_id: 'ORG001', onboarding_completo: false, consentimiento_datos: true, status: 'pendiente_aprobacion', email: null },
      ])

      await procesarMensajeEntrante({ ...msgTexto, from: '593999000001', texto: 'aprobar Juan' }, 'trace-aprobar')

      expect(queries.getPendingAgricultoresByFinca).toHaveBeenCalledWith('F001')
      expect(queries.approveAgricultor).toHaveBeenCalledWith('usr-pend')
      expect(sender.enviarTexto).toHaveBeenCalledWith('593999000001', expect.stringContaining('Juan'))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987000099', expect.stringContaining('activaron'))
    })

    it('responde "no encontré" si no hay pendientes con ese nombre', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioJefe)
      vi.mocked(queries.getPendingAgricultoresByFinca).mockResolvedValue([])

      await procesarMensajeEntrante({ ...msgTexto, from: '593999000001', texto: 'aprobar Pedro' }, 'trace-no-pend')

      expect(queries.approveAgricultor).not.toHaveBeenCalled()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593999000001', expect.stringContaining('No encontré'))
    })
  })

  describe('pipeline no inicializado', () => {
    it('lanza error si se llama sin inicializar', async () => {
      // @ts-expect-error - forzar estado no inicializado para test
      inicializarPipeline(null, null)

      await expect(procesarMensajeEntrante(msgTexto, 'trace-err')).rejects.toThrow('Pipeline no inicializado')
    })
  })

  describe('SDR routing', () => {
    beforeEach(() => {
      delete process.env['FOUNDER_PHONE']
      vi.mocked(sdrAgent.handleSDRSession).mockResolvedValue(undefined)
      vi.mocked(sdrAgent.handleFounderApproval).mockResolvedValue(false)
    })

    it('número desconocido → handleSDRSession llamado', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(null)

      await procesarMensajeEntrante(msgTexto, 'trace-sdr-1')

      expect(sdrAgent.handleSDRSession).toHaveBeenCalledWith(
        msgTexto,
        'msg-uuid',
        'trace-sdr-1',
        sender,
        llm,
      )
    })

    it('número del founder con aprobación pendiente → handleFounderApproval llamado', async () => {
      process.env['FOUNDER_PHONE'] = '593000000001'
      vi.mocked(sdrAgent.handleFounderApproval).mockResolvedValue(true)
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)

      const msgFounder: NormalizedMessage = { wamid: 'wamid.founder', from: '593000000001', timestamp: new Date(), tipo: 'texto', texto: 'sí', rawPayload: {} }
      await procesarMensajeEntrante(msgFounder, 'trace-founder-1')

      expect(sdrAgent.handleFounderApproval).toHaveBeenCalledWith(
        msgFounder,
        'msg-uuid',
        'trace-founder-1',
        sender,
      )
      expect(queries.getUserByPhone).not.toHaveBeenCalled()
    })

    it('número del founder sin aprobación pendiente → cae al flujo normal', async () => {
      process.env['FOUNDER_PHONE'] = '593000000001'
      vi.mocked(sdrAgent.handleFounderApproval).mockResolvedValue(false)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva())
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)

      const msgFounder: NormalizedMessage = { wamid: 'wamid.founder2', from: '593000000001', timestamp: new Date(), tipo: 'texto', texto: 'Hola', rawPayload: {} }
      await procesarMensajeEntrante(msgFounder, 'trace-founder-2')

      expect(queries.getUserByPhone).toHaveBeenCalledWith('593000000001')
    })
  })

  // ─── Tipo imagen ────────────────────────────────────────────────────────────

  describe('procesamiento de imagen', () => {
    it('tipo imagen → guarda observacion con status requires_review, NO llama extraerEvento', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)

      const msgImagen: NormalizedMessage = { wamid: 'wamid.img', from: '593987654321', timestamp: new Date(), tipo: 'imagen', imagenUrl: 'http://img.example.com/foto.jpg', rawPayload: {} }
      await procesarMensajeEntrante(msgImagen, 'trace-img')

      expect(llm.extraerEvento).not.toHaveBeenCalled()
      expect(queries.saveEvento).toHaveBeenCalledWith(expect.objectContaining({
        tipo_evento: 'observacion',
        status: 'requires_review',
        finca_id: 'F001',
      }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('imagen'))
    })

    it('tipo imagen → actualizarMensaje con evento_id del saveEvento', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.saveEvento).mockResolvedValue('evt-img-001')

      const msgImagen: NormalizedMessage = { wamid: 'wamid.img2', from: '593987654321', timestamp: new Date(), tipo: 'imagen', rawPayload: {} }
      await procesarMensajeEntrante(msgImagen, 'trace-img2')

      expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-uuid', expect.objectContaining({ evento_id: 'evt-img-001' }))
    })
  })

  // ─── Tipo ubicacion ─────────────────────────────────────────────────────────

  describe('procesamiento de ubicación', () => {
    it('tipo ubicacion con finca_id → pide confirmación (P7), NO llama updateFincaCoordenadas todavía', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)

      const msgUbicacion: NormalizedMessage = { wamid: 'wamid.ub', from: '593987654321', timestamp: new Date(), tipo: 'ubicacion', latitud: -0.1234, longitud: -78.5678, rawPayload: {} }
      await procesarMensajeEntrante(msgUbicacion, 'trace-ub')

      expect(queries.updateFincaCoordenadas).not.toHaveBeenCalled()
      expect(queries.updateSession).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        status: 'pending_location_confirm',
        contexto_parcial: { lat: -0.1234, lng: -78.5678 },
      }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('Confirmas'))
      expect(llm.extraerEvento).not.toHaveBeenCalled()
    })

    it('pending_location_confirm + sí → guarda coordenadas', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue({
        session_id: 'ses-loc',
        status: 'pending_location_confirm',
        clarification_count: 0,
        contexto_parcial: { lat: -0.1234, lng: -78.5678 },
      } as any)

      const msgSi: NormalizedMessage = { wamid: 'wamid.si', from: '593987654321', timestamp: new Date(), tipo: 'texto', texto: 'sí', rawPayload: {} }
      await procesarMensajeEntrante(msgSi, 'trace-ub-si')

      expect(queries.updateFincaCoordenadas).toHaveBeenCalledWith('F001', -0.1234, -78.5678)
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('ubicación'))
    })

    it('pending_location_confirm + no → cancela sin guardar', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue({
        session_id: 'ses-loc2',
        status: 'pending_location_confirm',
        clarification_count: 0,
        contexto_parcial: { lat: -0.1234, lng: -78.5678 },
      } as any)

      const msgNo: NormalizedMessage = { wamid: 'wamid.no', from: '593987654321', timestamp: new Date(), tipo: 'texto', texto: 'no', rawPayload: {} }
      await procesarMensajeEntrante(msgNo, 'trace-ub-no')

      expect(queries.updateFincaCoordenadas).not.toHaveBeenCalled()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('no guardé'))
    })

    it('tipo ubicacion sin finca_id → responde error, no llama updateFincaCoordenadas', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue({ ...usuarioActivo, finca_id: null })

      const msgUbicacion: NormalizedMessage = { wamid: 'wamid.ub2', from: '593987654321', timestamp: new Date(), tipo: 'ubicacion', latitud: -0.1, longitud: -78.5, rawPayload: {} }
      await procesarMensajeEntrante(msgUbicacion, 'trace-ub2')

      expect(queries.updateFincaCoordenadas).not.toHaveBeenCalled()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('finca'))
    })
  })

  // ─── STT errors ─────────────────────────────────────────────────────────────

  describe('errores de STT', () => {
    it('STT_NO_DISPONIBLE → envía aviso de texto requerido, no llama extraerEvento', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(sttService.transcribirAudio).mockRejectedValue(Object.assign(new Error('STT_NO_DISPONIBLE'), {}))

      await procesarMensajeEntrante(msgAudio, 'trace-stt-nd')

      expect(llm.extraerEvento).not.toHaveBeenCalled()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('texto'))
      expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-uuid', expect.objectContaining({ status: 'processed' }))
    })

    it('STT error genérico → se propaga al catch global y envía mensaje de error', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(sttService.transcribirAudio).mockRejectedValue(new Error('Whisper API timeout'))

      await procesarMensajeEntrante(msgAudio, 'trace-stt-err')

      expect(llm.extraerEvento).not.toHaveBeenCalled()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('problema'))
      expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-uuid', expect.objectContaining({ status: 'error' }))
    })
  })

  // ─── alerta_urgente ─────────────────────────────────────────────────────────

  describe('alerta_urgente (P4 — todo error se loggea)', () => {
    it('alerta_urgente=true al confirmar → emite evento "alerta_plaga_urgente" en LangFuse', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: { ...extractedEventoMock, alerta_urgente: true, requiere_clarificacion: false } as unknown as Record<string, unknown>,
          transcripcion_original: 'Monilia severa en todo el lote',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'sí' }, 'trace-alerta')

      const traceReturnValue = vi.mocked(langfuse.trace).mock.results.find(r => r.value)?.value
      expect(traceReturnValue?.event).toHaveBeenCalledWith(expect.objectContaining({ name: 'alerta_plaga_urgente' }))
    })

    it('alerta_urgente=false → NO emite "alerta_plaga_urgente"', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: { ...extractedEventoMock, alerta_urgente: false, requiere_clarificacion: false } as unknown as Record<string, unknown>,
          transcripcion_original: 'Apliqué mancozeb',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'sí' }, 'trace-no-alerta')

      const allEventCalls = vi.mocked(langfuse.trace).mock.results
        .flatMap(r => r.value?.event?.mock?.calls ?? [])
        .map((c: unknown[]) => (c[0] as { name?: string })?.name)
      expect(allEventCalls).not.toContain('alerta_plaga_urgente')
    })
  })

  // ─── Consentimiento ya guardado (P6) ────────────────────────────────────────

  describe('consentimiento — guardar exactamente una vez (P6)', () => {
    it('admin: consent_saved=true en session → saveUserConsent NO se vuelve a llamar', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioAdminOnboarding)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        tipo_sesion: 'onboarding',
        contexto_parcial: { consent_saved: true },
      }))
      vi.mocked(llm.onboardarAdmin).mockResolvedValue({
        ...onboardingAdminResponseMock,
        datos_extraidos: { ...onboardingAdminResponseMock.datos_extraidos, consentimiento: true },
      })

      await procesarMensajeEntrante({ ...msgTexto, from: '593999111222', texto: 'Sí acepto' }, 'trace-consent-dup')

      expect(queries.saveUserConsent).not.toHaveBeenCalled()
    })

    it('agricultor: consent_saved=true en session → saveUserConsent NO se vuelve a llamar', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioPendienteOnboarding)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        tipo_sesion: 'onboarding',
        contexto_parcial: { consent_saved: true },
      }))
      vi.mocked(llm.onboardarAgricultor).mockResolvedValue({
        ...onboardingAgricultorResponseMock,
        datos_extraidos: { ...onboardingAgricultorResponseMock.datos_extraidos, consentimiento: true },
      })

      await procesarMensajeEntrante(msgTexto, 'trace-consent-dup-agr')

      expect(queries.saveUserConsent).not.toHaveBeenCalled()
    })
  })

  // ─── Flujo de corrección (pending_confirmation) ──────────────────────────────

  describe('flujo de corrección en pending_confirmation', () => {
    it('corrección válida → re-extrae y muestra nuevo resumen para confirmar', async () => {
      const sender = crearSenderMock()
      const extractedCorreccion = { ...extractedEventoMock, campos_extraidos: { producto: 'fungicida', dosis_cantidad: 3 } }
      const llm = crearLlmMock(extractedCorreccion)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: extractedEventoMock as unknown as Record<string, unknown>,
          transcripcion_original: 'Apliqué mancozeb',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'No, fue fungicida' }, 'trace-corr-1')

      expect(llm.extraerEvento).toHaveBeenCalledOnce()
      expect(queries.saveEvento).not.toHaveBeenCalled()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'pending_confirmation' }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('fungicida'))
    })

    it('corrección resulta en sin_evento → reset limpio de session', async () => {
      const sender = crearSenderMock()
      const extracted = { ...extractedEventoMock, tipo_evento: 'sin_evento' as const }
      const llm = crearLlmMock(extracted)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: extractedEventoMock as unknown as Record<string, unknown>,
          transcripcion_original: 'Apliqué algo',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'No, olvídalo' }, 'trace-corr-noevent')

      expect(queries.saveEvento).not.toHaveBeenCalled()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({
        status: 'active',
        clarification_count: 0,
        contexto_parcial: {},
      }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('registrar'))
    })

    it('corrección con lote inválido → pide corrección de lote (status: active)', async () => {
      const sender = crearSenderMock()
      const extracted = { ...extractedEventoMock, lote_id: null, lote_detectado_raw: 'lote inexistente' }
      const llm = crearLlmMock(extracted)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: extractedEventoMock as unknown as Record<string, unknown>,
          transcripcion_original: 'Apliqué mancozeb',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'fue en lote inexistente' }, 'trace-corr-lote')

      expect(queries.saveEvento).not.toHaveBeenCalled()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'active' }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('no está registrado'))
    })

    it('corrección de tipo (gasto vs infraestructura) → transcripción merged con corrección PRIMERO', async () => {
      const sender = crearSenderMock()
      const extractedGasto = { ...extractedEventoMock, tipo_evento: 'gasto' as const, campos_extraidos: { monto: 200, descripcion: 'motor' } }
      const llm = crearLlmMock(extractedGasto)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        contexto_parcial: {
          extracted_data: { ...extractedEventoMock, tipo_evento: 'infraestructura' } as unknown as Record<string, unknown>,
          transcripcion_original: 'hoy gasté 200 en una compra de un motor. Va a reemplazar uno dañado',
        },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'No, compré el motor, es un gasto' }, 'trace-corr-gasto')

      const llamada = vi.mocked(llm.extraerEvento).mock.calls[0]![0]
      expect(llamada.transcripcion).toMatch(/^Corrección del agricultor:/)
      expect(llamada.transcripcion).toContain('No, compré el motor, es un gasto')
      expect(llamada.transcripcion).toContain('Contexto previo')
      expect(queries.saveEvento).not.toHaveBeenCalled()
    })
  })

  // ─── clarification_count >= 2 ────────────────────────────────────────────────

  describe('límite de clarificaciones (Regla 2 — máx 2 preguntas)', () => {
    it('requiere_clarificacion=true con count=2 → pasa directo a pending_confirmation sin preguntar', async () => {
      const sender = crearSenderMock()
      const extracted = { ...extractedEventoMock, requiere_clarificacion: true, pregunta_sugerida: '¿Cuántas bombadas?' }
      const llm = crearLlmMock(extracted)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        clarification_count: 2,
        contexto_parcial: { original_transcripcion: 'Apliqué algo en el lote' },
      }))

      await procesarMensajeEntrante(msgTexto, 'trace-max-clarit')

      // No debe pedir más clarificaciones — debe ir a pending_confirmation
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('Esto es lo que entendí'))
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'pending_confirmation' }))
    })

    it('lote inválido con count=2 → pasa a pending_confirmation (no más preguntas de lote)', async () => {
      const sender = crearSenderMock()
      const extracted = { ...extractedEventoMock, lote_id: null, lote_detectado_raw: 'lote fantasma' }
      const llm = crearLlmMock(extracted)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        clarification_count: 2,
        contexto_parcial: { original_transcripcion: 'Apliqué algo' },
      }))

      await procesarMensajeEntrante(msgTexto, 'trace-max-lote')

      // Con count>=2 no pregunta lote — va a pending_confirmation
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'pending_confirmation' }))
    })
  })
})
