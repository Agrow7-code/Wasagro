import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleSDRSession, handleFounderApproval, detectarObjecion } from '../../src/agents/sdrAgent.js'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

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
    it('notifica al founder y envía holding message al prospecto', async () => {
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

      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593000000001', expect.stringContaining('SÍ'))
      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.stringContaining('propuesta'))
      expect(queries.updateSDRProspecto).toHaveBeenCalledWith(
        prospectoBase.id,
        expect.objectContaining({ status: 'qualified' }),
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

      expect(mockSender.enviarTexto).toHaveBeenCalledTimes(1)
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

  describe('prospecto en espera de aprobación del founder', () => {
    it('envía holding message sin llamar al LLM', async () => {
      vi.mocked(queries.getSDRProspecto).mockResolvedValue({
        ...prospectoBase,
        status: 'qualified',
        founder_notified_at: '2026-04-23T10:00:00Z',
      })

      await handleSDRSession(mockMsg, 'msg-1', 'trace-1', mockSender, mockLLM)

      expect(mockLLM.atenderSDR).not.toHaveBeenCalled()
      expect(mockSender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.any(String))
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
})
