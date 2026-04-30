import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleSDRSession, handleFounderApproval, handleMeetingConfirmation, detectarObjecion, detectarConfirmacionReunion } from '../../src/agents/sdrAgent.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'
import type { ExtraccionSDR } from '../../types/dominio/SDRTypes.js'

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      event: vi.fn(),
      generation: vi.fn().mockReturnValue({ end: vi.fn() }),
    }),
  },
}))

export const mockResendSend = vi.fn()
vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: mockResendSend }
    }))
  }
})

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getSDRProspecto: vi.fn(),
  createSDRProspecto: vi.fn(),
  updateSDRProspecto: vi.fn(),
  saveSDRInteraccion: vi.fn(),
  actualizarMensaje: vi.fn(),
  getSDRProspectosPendingApproval: vi.fn(),
}))

const mockMsg: NormalizedMessage = {
  wamid: 'wamid-001',
  from: '593987654321',
  timestamp: new Date('2026-04-30T10:00:00Z'),
  tipo: 'texto',
  texto: 'Hola, me interesa saber más sobre wasagro',
}

const mockSender = {
  enviarTexto: vi.fn().mockResolvedValue(undefined),
  enviarImagen: vi.fn(),
  enviarAudio: vi.fn(),
  enviarDocumento: vi.fn(),
  enviarVideo: vi.fn(),
  enviarContacto: vi.fn(),
  enviarUbicacion: vi.fn(),
  marcarLeido: vi.fn(),
}

const mockLLM = {
  extraerDatosSDR: vi.fn(),
  redactarMensajeSDR: vi.fn().mockResolvedValue('Mensaje redactado por el LLM'),
} as any

const prospectoBase = {
  id: 'prospecto-123',
  phone: '593987654321',
  nombre: null,
  empresa: null,
  cargo: null,
  pais: null,
  segmento_icp: 'desconocido',
  narrativa_asignada: 'A',
  fincas_en_cartera: null,
  cultivo_principal: null,
  sistema_actual: null,
  status: 'new',
  turns_total: 0,
  objeciones_manejadas: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['FOUNDER_EMAIL']
  delete process.env['DEMO_BOOKING_URL']
})

describe('handleSDRSession (Extracción Determinista)', () => {
  it('crea un prospecto nuevo y hace la primera pregunta harcodeada', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(null)
    vi.mocked(queries.createSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.extraerDatosSDR.mockResolvedValue({
      fincas_en_cartera: null,
      cultivo_principal: null,
      pais: null,
      sistema_actual: null,
      es_spam: false,
      pregunta_precio: false,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(queries.createSDRProspecto).toHaveBeenCalled()
    expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('Mensaje redactado por el LLM'))
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({ status: 'en_discovery', turns_total: 1 }),
      undefined
    )
  })

  it('detecta spam y rechaza con graceful_exit', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.extraerDatosSDR.mockResolvedValue({
      fincas_en_cartera: null, cultivo_principal: null, pais: null, sistema_actual: null,
      es_spam: true, pregunta_precio: false,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('equivocado de número'))
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({ status: 'unqualified' }),
      undefined
    )
  })

  it('agrupa datos conocidos y hace la siguiente pregunta si faltan datos', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({
      ...prospectoBase,
      fincas_en_cartera: 20, // Ya sabe esto
    })
    mockLLM.extraerDatosSDR.mockResolvedValue({
      fincas_en_cartera: 20,
      cultivo_principal: null,
      pais: null,
      sistema_actual: null,
      es_spam: false,
      pregunta_precio: false,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('Mensaje redactado por el LLM'))
  })

  it('agrupa 3 datos y cierra inmediatamente con propose_pilot', async () => {
    process.env['FOUNDER_EMAIL'] = 'founder@test.com'
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({
      ...prospectoBase,
      fincas_en_cartera: 20,
      cultivo_principal: 'banano',
      // Faltaría país y sistema
    })
    
    // El mensaje actual le da el país
    mockLLM.extraerDatosSDR.mockResolvedValue({
      fincas_en_cartera: null, // no extraído en este msg
      cultivo_principal: null,
      pais: 'Ecuador',
      sistema_actual: null,
      es_spam: false,
      pregunta_precio: false,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    // Se unifican: fincas(bd), cultivo(bd), pais(llm) = 3 datos -> CIERRE
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({ 
        status: 'piloto_propuesto',
        pais: 'Ecuador'
      }),
      undefined
    )
    
    expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('Mensaje redactado por el LLM'))
    expect(mockResendSend).toHaveBeenCalled()
  })

  it('maneja peticiones de precio explícitamente', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, segmento_icp: 'exportadora' })
    mockLLM.extraerDatosSDR.mockResolvedValue({
      fincas_en_cartera: null, cultivo_principal: null, pais: null, sistema_actual: null,
      es_spam: false, pregunta_precio: true,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('planes personalizados'))
  })
})

describe('handleFounderApproval', () => {
  it('retorna false si no hay prospectos pendientes', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([])
    const result = await handleFounderApproval(mockMsg, 'msg-1', 'trace-1', mockSender)
    expect(result).toBe(false)
  })
})

describe('handleMeetingConfirmation', () => {
  it('retorna true cuando detecta agendamiento', () => {
    expect(detectarConfirmacionReunion('ya agendé para el lunes')).toBe(true)
  })
})
