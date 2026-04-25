import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleSDRSession, handleFounderApproval, detectarObjecion, handleMeetingConfirmation, detectarConfirmacionReunion } from '../../src/agents/sdrAgent.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'
import { langfuse } from '../../src/integrations/langfuse.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getSDRProspecto: vi.fn(),
  createSDRProspecto: vi.fn(),
  updateSDRProspecto: vi.fn().mockResolvedValue(undefined),
  saveSDRInteraccion: vi.fn().mockResolvedValue(undefined),
  getSDRProspectosPendingApproval: vi.fn(),
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      event: vi.fn(),
      generation: vi.fn().mockReturnValue({ end: vi.fn() }),
    }),
  },
}))

import * as queries from '../../src/pipeline/supabaseQueries.js'

const mockMsg: NormalizedMessage = {
  wamid: 'wamid-001',
  from: '593987654321',
  timestamp: new Date(),
  tipo: 'texto',
  rawPayload: {},
  texto: 'Hola, tengo una finca de 50 hectáreas de cacao en Ecuador',
}

const mockSender = { enviarTexto: vi.fn().mockResolvedValue(undefined) }
const mockLLM = { atenderSDR: vi.fn() }

const prospectoBase = {
  id: 'prosp-uuid-1',
  phone: '593987654321',
  nombre: null,
  empresa: null,
  cargo: null,
  pais: null,
  segmento_icp: 'desconocido',
  narrativa_asignada: 'A',
  score_total: 0,
  score_eudr_urgency: 0,
  score_tamano_cartera: 0,
  score_calidad_dato: 0,
  score_champion: 7,
  score_timeline_decision: 0,
  score_presupuesto: 5,
  preguntas_realizadas: [],
  fincas_en_cartera: null,
  cultivo_principal: null,
  eudr_urgency_nivel: 'desconocida',
  sistema_actual: null,
  objeciones_manejadas: [],
  punto_de_dolor_principal: null,
  status: 'new',
  turns_total: 0,
  deal_brief: null,
  founder_notified_at: null,
}

const respuestaDiscovery = {
  respuesta: '¿Cuántas hectáreas tiene tu finca?',
  preguntas_respondidas: [],
  score_delta: { eudr_urgency: 0, tamano_cartera: 0, calidad_dato: 0, champion: 0, timeline_decision: 0, presupuesto: 0 },
  action: 'continue_discovery' as const,
  objection_type: null,
  requires_founder_approval: false,
  deal_brief: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['FOUNDER_PHONE']
  delete process.env['DEMO_BOOKING_URL']
})

describe('detectarObjecion', () => {
  it('detecta objeción de presupuesto', () => {
    expect(detectarObjecion('no tengo presupuesto para eso')).toBe('sin_presupuesto')
  })

  it('detecta objeción de tiempo', () => {
    expect(detectarObjecion('estoy muy ocupado ahora')).toBe('sin_tiempo')
  })

  it('detecta sistema existente', () => {
    expect(detectarObjecion('ya tengo un sistema para eso')).toBe('tiene_sistema')
  })

  it('retorna null si no hay objeción', () => {
    expect(detectarObjecion('tengo 50 hectáreas de cacao')).toBeNull()
  })

  it('detecta sin_interes', () => {
    expect(detectarObjecion('no estoy interesado en esto')).toBe('sin_interes')
  })

  it('detecta posponer_decision', () => {
    expect(detectarObjecion('necesito pensar un poco más')).toBe('posponer_decision')
  })

  it('detecta desconoce_eudr', () => {
    expect(detectarObjecion('no conozco el EUDR, qué es eso')).toBe('desconoce_eudr')
  })

  it('detecta no_exporta', () => {
    expect(detectarObjecion('nosotros no exportamos nada')).toBe('no_exporta')
  })

  it('detecta operacion_pequena', () => {
    expect(detectarObjecion('solo son pocas hectáreas las que tengo')).toBe('operacion_pequena')
  })

  it('detecta prefiere_whatsapp_normal', () => {
    expect(detectarObjecion('prefiero WhatsApp normal, no quiero otra cosa')).toBe('prefiere_whatsapp_normal')
  })

  it('detecta desconfianza', () => {
    expect(detectarObjecion('soy desconfiado de estas apps')).toBe('desconfianza')
  })
})

describe('handleSDRSession', () => {
  describe('prospecto nuevo', () => {
    it('crea prospecto con narrativa aleatoria A o B y envía respuesta', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(null)
      vi.mocked(queries.createSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(queries.createSDRProspecto).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '593987654321',
          narrativa_asignada: expect.stringMatching(/^[AB]$/),
        }),
        undefined,
      )
      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', respuestaDiscovery.respuesta)
    })

    it('guarda interaccion inbound con score_before=0', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(null)
      vi.mocked(queries.createSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '593987654321',
          tipo: 'inbound',
          score_before: 0,
          action_taken: 'continue_discovery',
        }),
        undefined,
      )
    })
  })

  describe('prospecto existente', () => {
    it('no crea prospecto nuevo si ya existe', async () => {
      const prospectoExistente = { ...prospectoBase, status: 'en_discovery', turns_total: 2, score_total: 15, score_eudr_urgency: 15 }
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoExistente)
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(queries.createSDRProspecto).not.toHaveBeenCalled()
    })

    it('pasa preguntas ya respondidas al LLM', async () => {
      const preguntaRespondida = {
        question_id: 'Q-EX-01',
        question_text: '¿Cuántas hectáreas?',
        answer_text: '50 ha',
        dimension: 'tamano_cartera',
        score_delta: 20,
        evidence_quote: 'tengo 50 hectáreas',
        turn: 1,
        answered_at: '2026-04-23T10:00:00Z',
      }
      const prospectoConPreguntas = { ...prospectoBase, status: 'en_discovery', preguntas_realizadas: [preguntaRespondida] }
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoConPreguntas)
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      const entradaLLM = mockLLM.atenderSDR.mock.calls[0][0]
      expect(entradaLLM.preguntas_realizadas).toHaveLength(1)
      expect(entradaLLM.preguntas_realizadas[0].question_id).toBe('Q-EX-01')
    })

    it('no duplica preguntas ya respondidas al agregar nuevas', async () => {
      const preguntaExistente = { question_id: 'Q-EX-01', question_text: '', answer_text: '50 ha', dimension: 'tamano_cartera', score_delta: 20, evidence_quote: null, turn: 1, answered_at: null }
      const prospectoConPreguntas = { ...prospectoBase, status: 'en_discovery', preguntas_realizadas: [preguntaExistente] }
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoConPreguntas)
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        preguntas_respondidas: [
          { question_id: 'Q-EX-01', dimension: 'tamano_cartera', answer_text: 'repetida', score_delta: 0, evidence_quote: null },
          { question_id: 'Q-EX-02', dimension: 'calidad_dato', answer_text: 'cuaderno', score_delta: 18, evidence_quote: 'uso cuaderno' },
        ],
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      const preguntas = updateCall['preguntas_realizadas'] as unknown[]
      expect(preguntas).toHaveLength(2)
    })
  })

  describe('scores', () => {
    it('actualiza scores cuando el delta es positivo', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        score_delta: { eudr_urgency: 15, tamano_cartera: 20, calidad_dato: 0, champion: 0, timeline_decision: 0, presupuesto: 0 },
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
        prospectoBase.id,
        expect.objectContaining({
          score_eudr_urgency: 15,
          score_tamano_cartera: 20,
        }),
        undefined,
      )
    })

    it('score no decrementa si delta es negativo', async () => {
      const prospectoConScore = { ...prospectoBase, score_eudr_urgency: 15, score_champion: 10 }
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoConScore)
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        score_delta: { eudr_urgency: -5, tamano_cartera: 0, calidad_dato: 0, champion: -3, timeline_decision: 0, presupuesto: 0 },
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      expect(updateCall['score_eudr_urgency']).toBe(15)
      expect(updateCall['score_champion']).toBe(10)
    })

    it('score no supera el máximo de la dimensión', async () => {
      const prospectoConScore = { ...prospectoBase, score_eudr_urgency: 20 }
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoConScore)
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        score_delta: { eudr_urgency: 10, tamano_cartera: 0, calidad_dato: 0, champion: 0, timeline_decision: 0, presupuesto: 0 },
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      expect(updateCall['score_eudr_urgency']).toBe(25)
    })
  })

  describe('objección detectada', () => {
    it('pasa objection_type al LLM cuando detecta objeción', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      const msgConObjecion = { ...mockMsg, texto: 'No tenemos presupuesto para eso ahora' }
      await handleSDRSession(msgConObjecion, 'msg-1', 'trace-1', mockSender, mockLLM)

      const entradaLLM = mockLLM.atenderSDR.mock.calls[0][0]
      expect(entradaLLM.objection_detected).toBe('sin_presupuesto')
    })

    it('agrega la objeción a objeciones_manejadas', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue({ ...respuestaDiscovery, action: 'handle_objection' as const })

      const msgConObjecion = { ...mockMsg, texto: 'No tenemos presupuesto para eso ahora' }
      await handleSDRSession(msgConObjecion, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      expect(updateCall['objeciones_manejadas']).toContain('sin_presupuesto')
    })

    it('no duplica objeciones ya manejadas', async () => {
      const prospectoConObjecion = { ...prospectoBase, objeciones_manejadas: ['sin_presupuesto'] }
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoConObjecion)
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      const msgConObjecion = { ...mockMsg, texto: 'Sigo sin presupuesto para eso' }
      await handleSDRSession(msgConObjecion, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      const objeciones = updateCall['objeciones_manejadas'] as string[]
      expect(objeciones.filter(o => o === 'sin_presupuesto')).toHaveLength(1)
    })
  })

  describe('action=propose_pilot', () => {
    it('envía demo invitation al prospecto y notifica al founder informativo', async () => {
      process.env['FOUNDER_PHONE'] = '593000000001'
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, status: 'en_discovery', score_total: 50 })
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        respuesta: 'Te propongo un piloto de Wasagro para tu finca.',
        action: 'propose_pilot' as const,
        requires_founder_approval: true,
        deal_brief: { empresa: 'Finca Morales', qualification_score: 72 },
        score_delta: { eudr_urgency: 15, tamano_cartera: 0, calidad_dato: 0, champion: 0, timeline_decision: 0, presupuesto: 0 },
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      // Prospect receives the demo message + booking follow-up (2 calls)
      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', 'Te propongo un piloto de Wasagro para tu finca.')
      // Founder receives informational notification (no SÍ/NO gate)
      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593000000001', expect.stringContaining('Demo agendado automáticamente'))
      expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
        prospectoBase.id,
        expect.objectContaining({ status: 'piloto_propuesto' }),
        undefined,
      )
    })

    it('guarda draft_message en deal_brief', async () => {
      process.env['FOUNDER_PHONE'] = '593000000001'
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, status: 'en_discovery' })
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        respuesta: 'Draft: te propongo arrancar con un piloto esta semana.',
        action: 'propose_pilot' as const,
        requires_founder_approval: true,
        deal_brief: { empresa: 'Test Co' },
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      const dealBrief = updateCall['deal_brief'] as Record<string, unknown>
      expect(dealBrief['draft_message']).toBe('Draft: te propongo arrancar con un piloto esta semana.')
    })

    it('no envía al founder si FOUNDER_PHONE no está configurado', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        action: 'propose_pilot' as const,
        requires_founder_approval: true,
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      // Prospect receives 2 messages (demo + follow-up), founder receives nothing
      expect(mockSender.enviarTexto).toHaveBeenCalledTimes(2)
      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.any(String))
    })
  })

  describe('action=graceful_exit', () => {
    it('marca status como unqualified', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, status: 'en_discovery' })
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        action: 'graceful_exit' as const,
        respuesta: 'Gracias por tu tiempo. Si en algún momento cambias de opinión, aquí estamos. ✅',
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
        prospectoBase.id,
        expect.objectContaining({ status: 'unqualified' }),
        undefined,
      )
    })

    it('envía mensaje de cierre al prospecto', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        action: 'graceful_exit' as const,
        respuesta: 'Gracias por tu tiempo. ✅',
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', 'Gracias por tu tiempo. ✅')
    })
  })

  describe('prospecto en estado qualified (registro legacy)', () => {
    it('continúa la conversación normalmente con el LLM', async () => {
      // With Option A there is no qualified holding state — prospect goes directly
      // to piloto_propuesto. A qualified record in DB is treated as en_discovery.
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({
        ...prospectoBase,
        status: 'qualified',
        founder_notified_at: '2026-04-23T10:00:00Z',
      })
      mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(mockLLM.atenderSDR).toHaveBeenCalled()
    })
  })

  describe('límite de turnos (Regla 2)', () => {
    it('fuerza graceful_exit en turno 10 si LLM retorna continue_discovery', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({
        ...prospectoBase,
        status: 'en_discovery',
        turns_total: 9,
      })
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        action: 'continue_discovery' as const,
        respuesta: 'Siguiendo la conversación...',
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
        prospectoBase.id,
        expect.objectContaining({ status: 'unqualified' }),
        undefined,
      )
    })

    it('permite continue_discovery en turno 9', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({
        ...prospectoBase,
        status: 'en_discovery',
        turns_total: 8,
      })
      mockLLM.atenderSDR.mockResolvedValue({
        ...respuestaDiscovery,
        action: 'continue_discovery' as const,
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
      expect(updateCall['status']).toBe('en_discovery')
    })
  })
})

describe('handleFounderApproval', () => {
  const prospectoCalificado = {
    ...prospectoBase,
    status: 'qualified',
    founder_notified_at: '2026-04-23T10:00:00Z',
    deal_brief: { draft_message: 'Te proponemos un piloto de Wasagro esta semana. ✅' },
  }

  const msgFounder: NormalizedMessage = {
    wamid: 'wamid-founder-001',
    from: '593000000001',
    timestamp: new Date(),
    tipo: 'texto',
    rawPayload: {},
    texto: 'sí',
  }

  it('retorna false si no hay prospectos pendientes', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([])

    const result = await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

    expect(result).toBe(false)
    expect(mockSender.enviarTexto).not.toHaveBeenCalled()
  })

  it('founder SÍ → envía draft al prospecto, status=piloto_propuesto', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith(
      prospectoCalificado.phone,
      'Te proponemos un piloto de Wasagro esta semana. ✅',
    )
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoCalificado.id,
      expect.objectContaining({ status: 'piloto_propuesto' }),
      undefined,
    )
  })

  it('founder NO → status=descartado, sin mensaje al prospecto', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    const msgNo = { ...msgFounder, texto: 'no' }
    const result = await handleFounderApproval(msgNo, 'msg-1', 'trace-1', mockSender)

    expect(result).toBe(true)
    const envioAlProspecto = mockSender.enviarTexto.mock.calls.find(
      ([to]) => to === prospectoCalificado.phone,
    )
    expect(envioAlProspecto).toBeUndefined()
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoCalificado.id,
      expect.objectContaining({ status: 'descartado' }),
      undefined,
    )
  })

  it('founder override text → envía ese texto al prospecto, status=piloto_propuesto', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    const msgOverride = { ...msgFounder, texto: 'Hola, esta semana te hacemos el piloto en tu finca directamente.' }
    await handleFounderApproval(msgOverride, 'msg-1', 'trace-1', mockSender)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith(
      prospectoCalificado.phone,
      'Hola, esta semana te hacemos el piloto en tu finca directamente.',
    )
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoCalificado.id,
      expect.objectContaining({ status: 'piloto_propuesto' }),
      undefined,
    )
  })

  it('founder SÍ → retorna true y confirma al founder', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    const result = await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

    expect(result).toBe(true)
    expect(mockSender.enviarTexto).toHaveBeenCalledWith(
      msgFounder.from,
      expect.stringContaining('✅'),
    )
  })

  it('guarda interaccion tipo draft_approval', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'draft_approval',
        action_taken: 'send_approved_draft',
      }),
      undefined,
    )
  })

  it('guarda interaccion tipo founder_override para texto custom', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    const msgOverride = { ...msgFounder, texto: 'Mi texto personalizado para el prospecto.' }
    await handleFounderApproval(msgOverride, 'msg-1', 'trace-1', mockSender)

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'founder_override',
        action_taken: 'founder_override',
      }),
      undefined,
    )
  })

  describe('DEMO_BOOKING_URL (REQ-hand-006)', () => {
    it('envía URL de booking al prospecto cuando DEMO_BOOKING_URL está configurado', async () => {
      process.env['DEMO_BOOKING_URL'] = 'https://calendly.com/wasagro/demo'
      vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

      await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

      const mensajesAlProspecto = mockSender.enviarTexto.mock.calls.filter(
        ([to]: [string]) => to === prospectoCalificado.phone,
      )
      const tieneURL = mensajesAlProspecto.some(([, msg]: [string, string]) => msg.includes('https://calendly.com/wasagro/demo'))
      expect(tieneURL).toBe(true)
    })

    it('envía mensaje de disponibilidad cuando DEMO_BOOKING_URL no está configurado', async () => {
      vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

      await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

      const mensajesAlProspecto = mockSender.enviarTexto.mock.calls.filter(
        ([to]: [string]) => to === prospectoCalificado.phone,
      )
      const tieneDisponibilidad = mensajesAlProspecto.some(([, msg]: [string, string]) => msg.includes('20 minutos'))
      expect(tieneDisponibilidad).toBe(true)
    })
  })

  it('founder SÍ → emite sdr_pilot_proposed (REQ-narr-005)', async () => {
    vi.mocked(queries.getSDRProspectosPendingApproval).mockResolvedValue([prospectoCalificado])

    await handleFounderApproval(msgFounder, 'msg-1', 'trace-1', mockSender)

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sdr_pilot_proposed' }),
    )
  })
})

// ─── Phase 2: Score evidence validation (REQ-qual-009) ─────────────────────────

describe('score evidence validation (REQ-qual-009)', () => {
  it('no llama saveSDRInteraccion cuando preguntas_respondidas tiene delta sin evidence_quote', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      preguntas_respondidas: [
        { question_id: 'Q-01', dimension: 'tamano_cartera', answer_text: '50 fincas', score_delta: 20, evidence_quote: null },
      ],
      score_delta: { ...respuestaDiscovery.score_delta, tamano_cartera: 20 },
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(queries.saveSDRInteraccion).not.toHaveBeenCalled()
  })

  it('loga evento sdr_evidence_validation_error cuando falta evidence_quote', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      preguntas_respondidas: [
        { question_id: 'Q-01', dimension: 'tamano_cartera', answer_text: '50 fincas', score_delta: 20, evidence_quote: null },
      ],
      score_delta: { ...respuestaDiscovery.score_delta, tamano_cartera: 20 },
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(expect.objectContaining({ name: 'sdr_evidence_validation_error' }))
  })

  it('llama saveSDRInteraccion cuando evidence_quote está presente para delta no-cero', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      preguntas_respondidas: [
        { question_id: 'Q-01', dimension: 'tamano_cartera', answer_text: '50 fincas', score_delta: 20, evidence_quote: 'manejamos 50 fincas' },
      ],
      score_delta: { ...respuestaDiscovery.score_delta, tamano_cartera: 20 },
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(queries.saveSDRInteraccion).toHaveBeenCalled()
  })
})

// ─── Phase 3: Handoff trigger detection (REQ-hand-001) ─────────────────────────

describe('handoff trigger (REQ-hand-001)', () => {
  it('mensaje con "quiero hablar con alguien" fuerza propose_pilot sin importar el score', async () => {
    process.env['FOUNDER_PHONE'] = '593000000001'
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, score_total: 20 })
    mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

    const msgHandoff = { ...mockMsg, texto: 'quiero hablar con alguien del equipo' }
    await handleSDRSession(msgHandoff, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({ status: 'piloto_propuesto' }),
      undefined,
    )
  })

  it('pregunta de precio en turno > 3 activa handoff', async () => {
    process.env['FOUNDER_PHONE'] = '593000000001'
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, turns_total: 3 })
    mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

    const msgPrecio = { ...mockMsg, texto: '¿cuánto cuesta para mis fincas?' }
    await handleSDRSession(msgPrecio, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({ status: 'piloto_propuesto' }),
      undefined,
    )
  })

  it('pregunta de precio en turno ≤ 3 NO activa handoff', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, turns_total: 2 })
    mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

    const msgPrecio = { ...mockMsg, texto: '¿cuánto cuesta?' }
    await handleSDRSession(msgPrecio, 'msg-1', 'trace-1', mockSender, mockLLM)

    const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
    expect(updateCall['status']).not.toBe('qualified')
  })
})

// ─── Phase 4: Founder notification format (REQ-hand-003) ───────────────────────

describe('founder notification format (REQ-hand-003)', () => {
  it('incluye todos los campos del deal brief en el formato especificado', async () => {
    process.env['FOUNDER_PHONE'] = '593000000001'
    const prospectoConDatos = {
      ...prospectoBase,
      status: 'en_discovery',
      nombre: 'María García',
      empresa: 'Exportadora ABC',
      segmento_icp: 'exportadora',
      narrativa_asignada: 'B',
      score_total: 72,
      score_presupuesto: 5,
      fincas_en_cartera: 38,
      eudr_urgency_nivel: 'alta',
      sistema_actual: 'Excel',
      objeciones_manejadas: ['sin_presupuesto'],
      punto_de_dolor_principal: 'trazabilidad EUDR',
    }
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoConDatos)
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      respuesta: 'Te propongo un piloto de 4 semanas con 3 fincas. ¿Podemos agendar 20 minutos?',
      action: 'propose_pilot' as const,
      requires_founder_approval: true,
      deal_brief: {
        nombre_contacto: 'María García',
        empresa: 'Exportadora ABC',
        cargo: 'Gerente de Exportaciones',
        segmento_icp: 'exportadora',
        narrativa_asignada: 'B',
        qualification_score: 72,
        scores_por_dimension: { eudr_urgency: 25, tamano_cartera: 15, calidad_dato: 12, champion: 7, timeline_decision: 8, presupuesto: 5 },
        fincas_en_cartera: 38,
        cultivo_principal: 'cacao',
        pais: 'Ecuador',
        eudr_urgency_nivel: 'alta',
        sistema_actual: 'Excel',
        objeciones_manejadas: ['sin_presupuesto'],
        punto_de_dolor_principal: 'trazabilidad EUDR',
        compromiso_logrado: 'piloto',
        fecha_propuesta_reunion: null,
        conversacion_resumen: 'Exportadora con 38 fincas, urgencia EUDR alta',
        turns_total: 5,
        questions_asked: 4,
        handoff_trigger: 'score_threshold',
      },
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    const founderMsg = mockSender.enviarTexto.mock.calls.find(
      ([to]: [string]) => to === '593000000001',
    )?.[1] as string

    expect(founderMsg).toContain('⚡ LEAD CALIFICADO')
    expect(founderMsg).toContain('72/100')
    expect(founderMsg).toContain('exportadora')
    expect(founderMsg).toContain('María García')
    expect(founderMsg).toContain('Exportadora ABC')
    expect(founderMsg).toContain('MENSAJE ENVIADO AL PROSPECTO')
    expect(founderMsg).toContain('Demo agendado automáticamente')
    expect(founderMsg).not.toContain('Responde *SÍ*')
    expect(founderMsg).not.toContain('Responde *NO*')
  })
})

// ─── Phase 5: Segment detection (REQ-disc-003) ─────────────────────────────────

describe('segmento_icp mid-conversation update (REQ-disc-003)', () => {
  it('actualiza segmento_icp cuando el LLM lo incluye en la respuesta', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      segmento_icp: 'exportadora',
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({ segmento_icp: 'exportadora' }),
      undefined,
    )
  })

  it('no incluye segmento_icp en update si el LLM no lo retorna', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoBase)
    mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    const updateCall = vi.mocked(queries.updateSDRProspecto).mock.calls[0][1]
    expect(Object.keys(updateCall)).not.toContain('segmento_icp')
  })
})

// ─── Phase 6: LangFuse A/B events (REQ-narr-005) ───────────────────────────────

describe('LangFuse A/B narrative events (REQ-narr-005)', () => {
  it('emite sdr_session_started en prospecto nuevo con narrativa y segmento', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(null)
    vi.mocked(queries.createSDRProspecto).mockResolvedValue({
      ...prospectoBase,
      narrativa_asignada: 'A',
      segmento_icp: 'exportadora',
    })
    mockLLM.atenderSDR.mockResolvedValue(respuestaDiscovery)

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sdr_session_started',
      input: expect.objectContaining({ narrativa: 'A' }),
    }))
  })

  it('emite sdr_qualified cuando action === propose_pilot', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({
      ...prospectoBase,
      turns_total: 4,
      score_total: 50,
      status: 'en_discovery',
    })
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      action: 'propose_pilot' as const,
      requires_founder_approval: true,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sdr_qualified',
      input: expect.objectContaining({ turns_to_qualify: 5 }),
    }))
  })

  it('emite sdr_unqualified cuando action === graceful_exit', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({
      ...prospectoBase,
      status: 'en_discovery',
      score_total: 20,
    })
    mockLLM.atenderSDR.mockResolvedValue({
      ...respuestaDiscovery,
      action: 'graceful_exit' as const,
    })

    await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sdr_unqualified',
    }))
  })
})

// ─── Meeting confirmation (REQ-hand-006) ────────────────────────────────────

describe('detectarConfirmacionReunion', () => {
  it('retorna true cuando ya agendó', () => {
    expect(detectarConfirmacionReunion('ya agendé la reunión')).toBe(true)
  })

  it('retorna true con día + hora', () => {
    expect(detectarConfirmacionReunion('el martes a las 3 me viene perfecto')).toBe(true)
  })

  it('retorna true con confirmación explícita', () => {
    expect(detectarConfirmacionReunion('confirmó la reunión para el miércoles')).toBe(true)
  })

  it('retorna true con mañana + hora', () => {
    expect(detectarConfirmacionReunion('mañana a las 10 puedo')).toBe(true)
  })

  it('retorna true con fecha numérica', () => {
    expect(detectarConfirmacionReunion('el 15 de mayo a las 9 quedo')).toBe(true)
  })

  it('retorna false para texto sin confirmación', () => {
    expect(detectarConfirmacionReunion('tengo una finca en Ecuador')).toBe(false)
  })

  it('retorna false para "sí" genérico sin hora', () => {
    expect(detectarConfirmacionReunion('sí, me parece bien')).toBe(false)
  })
})

describe('handleMeetingConfirmation', () => {
  const prospectoEnPiloto = {
    ...prospectoBase,
    status: 'piloto_propuesto',
    turns_total: 6,
  }

  const msgProspecto: NormalizedMessage = {
    ...mockMsg,
    texto: 'hola, ¿cómo van con la propuesta?',
  }

  it('retorna false si el prospecto no existe', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(null)

    const result = await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(result).toBe(false)
    expect(mockSender.enviarTexto).not.toHaveBeenCalled()
  })

  it('retorna false si el status no es piloto_propuesto', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ ...prospectoBase, status: 'en_discovery' })

    const result = await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(result).toBe(false)
    expect(mockSender.enviarTexto).not.toHaveBeenCalled()
  })

  it('retorna true para prospecto en piloto_propuesto aunque no confirme reunión', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)

    const result = await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(result).toBe(true)
  })

  it('sin confirmación → envía booking URL cuando DEMO_BOOKING_URL está configurado', async () => {
    process.env['DEMO_BOOKING_URL'] = 'https://calendly.com/wasagro/demo'
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)

    await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith(
      prospectoBase.phone,
      expect.stringContaining('https://calendly.com/wasagro/demo'),
    )
  })

  it('sin confirmación, sin DEMO_BOOKING_URL → envía pregunta de horario', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)

    await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(mockSender.enviarTexto).toHaveBeenCalledWith(
      prospectoBase.phone,
      expect.stringContaining('20 minutos'),
    )
  })

  it('prospecto confirma reunión → status reunion_agendada + reunion_agendada_at', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)
    const msgConfirma = { ...mockMsg, texto: 'el jueves a las 10 me viene perfecto' }

    await handleMeetingConfirmation(msgConfirma, 'msg-1', 'trace-1', mockSender)

    expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
      prospectoBase.id,
      expect.objectContaining({
        status: 'reunion_agendada',
        reunion_agendada_at: expect.any(String),
      }),
      undefined,
    )
  })

  it('prospecto confirma → emite sdr_meeting_scheduled (REQ-narr-005)', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)
    const msgConfirma = { ...mockMsg, texto: 'ya agendé para el viernes a las 3' }

    await handleMeetingConfirmation(msgConfirma, 'msg-1', 'trace-1', mockSender)

    const traceInstance = vi.mocked(langfuse.trace).mock.results[0]?.value
    expect(traceInstance.event).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sdr_meeting_scheduled' }),
    )
  })

  it('sin confirmación → no actualiza status', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)

    await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(queries.updateSDRProspecto).not.toHaveBeenCalled()
  })

  it('guarda interaccion con tipo meeting_confirmation', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)

    await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'meeting_confirmation' }),
      undefined,
    )
  })

  it('confirmación → action_taken=meeting_confirmed', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)
    const msgConfirma = { ...mockMsg, texto: 'el lunes a las 9 puedo' }

    await handleMeetingConfirmation(msgConfirma, 'msg-1', 'trace-1', mockSender)

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(
      expect.objectContaining({ action_taken: 'meeting_confirmed' }),
      undefined,
    )
  })

  it('sin confirmación → action_taken=meeting_pending', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoEnPiloto)

    await handleMeetingConfirmation(msgProspecto, 'msg-1', 'trace-1', mockSender)

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(
      expect.objectContaining({ action_taken: 'meeting_pending' }),
      undefined,
    )
  })
})
