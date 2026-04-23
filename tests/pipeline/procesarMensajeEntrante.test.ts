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

import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as sttService from '../../src/pipeline/sttService.js'
import * as gcal from '../../src/integrations/gcal.js'

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

  describe('número no registrado → flujo prospecto', () => {
    it('SC1: número desconocido llama a atenderProspecto y guarda historial', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(null)

      await procesarMensajeEntrante({ ...msgTexto, texto: 'Hola' }, 'trace-sc1')

      expect(llm.atenderProspecto).toHaveBeenCalledOnce()
      expect(llm.extraerEvento).not.toHaveBeenCalled()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', prospectoResponseMock.mensaje_para_usuario)
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({
        contexto_parcial: expect.objectContaining({ historial: expect.any(Array) }),
      }))
    })

    it('SC2: prospecto con horario + GCal disponible → propone slot y espera confirmación', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(null)
      vi.mocked(gcal.gcalConfigurado).mockReturnValue(true)
      vi.mocked(gcal.verificarDisponibilidad).mockResolvedValue('available')
      vi.mocked(llm.atenderProspecto).mockResolvedValue({
        ...prospectoResponseMock,
        enviar_link_demo: true,
        datos_extraidos: { ...prospectoResponseMock.datos_extraidos, nombre: 'Pedro', horario_preferido: '2026-04-30T14:00:00.000Z' },
        mensaje_para_usuario: 'Perfecto Pedro, te envío el link.',
      })

      await procesarMensajeEntrante({ ...msgTexto, texto: 'Me interesa, ¿puedes el 30 a las 2pm?' }, 'trace-sc2')

      expect(gcal.verificarDisponibilidad).toHaveBeenCalledOnce()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({
        status: 'pending_confirmation',
        contexto_parcial: expect.objectContaining({ horario_propuesto: '2026-04-30T14:00:00.000Z' }),
      }))
      expect(sender.enviarTexto).toHaveBeenCalledWith(
        '593987654321',
        expect.stringContaining('Confirmamos'),
      )
    })

    it('SC3: pending_confirmation "sí" + Meet creado → envía Meet link y completa sesión', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(null)
      vi.mocked(gcal.crearReunionConMeet).mockResolvedValue({ meetLink: 'https://meet.google.com/abc-def-ghi', eventId: 'evt-gcal-1' })
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        tipo_sesion: 'reporte',
        contexto_parcial: { horario_propuesto: '2026-04-30T14:00:00.000Z', nombre_contacto: 'Pedro' },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'sí' }, 'trace-sc3')

      expect(gcal.crearReunionConMeet).toHaveBeenCalledOnce()
      expect(queries.updateSession).toHaveBeenCalledWith('ses-1', expect.objectContaining({ status: 'completed' }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('meet.google.com'))
    })

    it('SC4: pending_confirmation "sí" + Meet falla → cae a Calendly', async () => {
      vi.stubEnv('DEMO_BOOKING_URL', 'https://calendly.com/test/30min')
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(null)
      vi.mocked(gcal.crearReunionConMeet).mockResolvedValue(null)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue(sessionActiva({
        status: 'pending_confirmation',
        tipo_sesion: 'reporte',
        contexto_parcial: { horario_propuesto: '2026-04-30T14:00:00.000Z', nombre_contacto: 'Pedro' },
      }))

      await procesarMensajeEntrante({ ...msgTexto, texto: 'sí' }, 'trace-sc4')

      expect(gcal.crearReunionConMeet).toHaveBeenCalledOnce()
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('calendly.com'))
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
})
