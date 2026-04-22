import { describe, expect, it, vi, beforeEach } from 'vitest'
import { procesarMensajeEntrante, inicializarPipeline } from '../../src/pipeline/procesarMensajeEntrante.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

// Mock heavy deps before import resolves
vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getMensajeByWamid: vi.fn(),
  registrarMensaje: vi.fn().mockResolvedValue('msg-uuid'),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
  getUserByPhone: vi.fn(),
  getFincaById: vi.fn().mockResolvedValue({ finca_id: 'F001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' }),
  getLotesByFinca: vi.fn().mockResolvedValue([{ lote_id: 'F001-L01', nombre_coloquial: 'El de arriba', hectareas: 2 }]),
  getOrCreateSession: vi.fn().mockResolvedValue({ session_id: 'ses-1', clarification_count: 0, contexto_parcial: {}, status: 'active' }),
  updateSession: vi.fn().mockResolvedValue(undefined),
  saveEvento: vi.fn().mockResolvedValue('evt-uuid'),
}))

vi.mock('../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn().mockResolvedValue('Apliqué mancozeb'),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn() }) },
}))

import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as sttService from '../../src/pipeline/sttService.js'

const usuarioActivo = { id: 'usr-1', phone: '593987654321', nombre: 'Carlos', rol: 'agricultor', finca_id: 'F001', onboarding_completo: true, consentimiento_datos: true }

const extractedEventoMock = {
  tipo_evento: 'insumo' as const,
  lote_id: 'F001-L01',
  fecha_evento: null,
  confidence_score: 0.90,
  campos_extraidos: { producto: 'mancozeb', dosis_cantidad: 2 },
  confidence_por_campo: {},
  campos_faltantes: [],
  requiere_clarificacion: false,
  pregunta_sugerida: null,
}

function crearSenderMock() {
  return { enviarTexto: vi.fn().mockResolvedValue(undefined) }
}

function crearLlmMock(extraido = extractedEventoMock) {
  return {
    extraerEvento: vi.fn().mockResolvedValue(extraido),
    onboardar: vi.fn().mockResolvedValue({ mensaje: 'Bienvenido', onboarding_completo: false, siguiente_pregunta: null }),
    corregirTranscripcion: vi.fn(),
    analizarImagen: vi.fn(),
    resumirSemana: vi.fn(),
  }
}

const msgTexto: NormalizedMessage = { wamid: 'wamid.001', from: '593987654321', timestamp: new Date(), tipo: 'texto', texto: 'Apliqué mancozeb en lote 3', rawPayload: {} }
const msgAudio: NormalizedMessage = { wamid: 'wamid.002', from: '593987654321', timestamp: new Date(), tipo: 'audio', audioUrl: 'http://audio.example.com/clip.ogg', rawPayload: {} }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queries.getMensajeByWamid).mockResolvedValue(null)
  vi.mocked(queries.registrarMensaje).mockResolvedValue('msg-uuid')
  vi.mocked(queries.actualizarMensaje).mockResolvedValue(undefined)
  vi.mocked(queries.saveEvento).mockResolvedValue('evt-uuid')
  vi.mocked(queries.updateSession).mockResolvedValue(undefined)
  vi.mocked(queries.getFincaById).mockResolvedValue({ finca_id: 'F001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' })
  vi.mocked(queries.getLotesByFinca).mockResolvedValue([{ lote_id: 'F001-L01', finca_id: 'F001', nombre_coloquial: 'El de arriba', hectareas: 2 }])
  vi.mocked(queries.getOrCreateSession).mockResolvedValue({ session_id: 'ses-1', clarification_count: 0, contexto_parcial: {}, status: 'active', phone: '593987654321', finca_id: null, tipo_sesion: 'reporte', paso_onboarding: null })
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

  describe('usuario no registrado', () => {
    it('envía mensaje de no-registro y sale', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(null)

      await procesarMensajeEntrante(msgTexto, 'trace-2')

      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('no estás registrado'))
      expect(llm.extraerEvento).not.toHaveBeenCalled()
    })
  })

  describe('procesamiento de evento (texto)', () => {
    it('extrae evento y lo guarda en Supabase', async () => {
      const sender = crearSenderMock()
      const llm = crearLlmMock()
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)

      await procesarMensajeEntrante(msgTexto, 'trace-3')

      expect(llm.extraerEvento).toHaveBeenCalledOnce()
      expect(queries.saveEvento).toHaveBeenCalledWith(expect.objectContaining({
        finca_id: 'F001',
        tipo_evento: 'insumo',
        descripcion_raw: 'Apliqué mancozeb en lote 3',
      }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('insumo'))
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

    it('guarda como nota_libre cuando requiere_clarificacion y count >= 2 (Regla 2)', async () => {
      const sender = crearSenderMock()
      const extracted = { ...extractedEventoMock, requiere_clarificacion: true, pregunta_sugerida: '¿Cuántas bombadas?' }
      const llm = crearLlmMock(extracted)
      inicializarPipeline(sender, llm)
      vi.mocked(queries.getUserByPhone).mockResolvedValue(usuarioActivo)
      vi.mocked(queries.getOrCreateSession).mockResolvedValue({ session_id: 'ses-1', clarification_count: 2, contexto_parcial: {}, status: 'active', phone: '593987654321', finca_id: null, tipo_sesion: 'reporte', paso_onboarding: null })

      await procesarMensajeEntrante(msgTexto, 'trace-5')

      expect(queries.saveEvento).toHaveBeenCalledWith(expect.objectContaining({ tipo_evento: 'nota_libre' }))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('revisará'))
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

  describe('pipeline no inicializado', () => {
    it('lanza error si se llama sin inicializar', async () => {
      // @ts-expect-error - forzar estado no inicializado para test
      inicializarPipeline(null, null)

      await expect(procesarMensajeEntrante(msgTexto, 'trace-err')).rejects.toThrow('Pipeline no inicializado')
    })
  })
})
