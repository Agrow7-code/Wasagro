import { z } from 'zod'

export const ScoreDeltaSchema = z.object({
  eudr_urgency: z.number().default(0),
  tamano_cartera: z.number().default(0),
  calidad_dato: z.number().default(0),
  champion: z.number().default(0),
  timeline_decision: z.number().default(0),
  presupuesto: z.number().default(0),
})

export type ScoreDelta = z.infer<typeof ScoreDeltaSchema>

export const PreguntaRespondidaSchema = z.object({
  question_id: z.string(),
  dimension: z.string(),
  answer_text: z.string(),
  score_delta: z.number(),
  evidence_quote: z.string().nullable(),
})

export type PreguntaRespondida = z.infer<typeof PreguntaRespondidaSchema>

export const ExtraccionSDRSchema = z.object({
  fincas_en_cartera: z.number().nullable(),
  cultivo_principal: z.string().nullable(),
  pais: z.string().nullable(),
  sistema_actual: z.string().nullable(),
  es_spam: z.boolean().default(false),
  pregunta_precio: z.boolean().default(false),
})

export type ExtraccionSDR = z.infer<typeof ExtraccionSDRSchema>

export interface PreguntaRealizada {
  question_id: string
  question_text: string
  answer_text: string | null
  dimension: string
  score_delta: number
  evidence_quote: string | null
  turn: number
  answered_at: string | null
}

export interface ScoreDimensions {
  eudr_urgency: number
  tamano_cartera: number
  calidad_dato: number
  champion: number
  timeline_decision: number
  presupuesto: number
}

export interface DealBrief {
  nombre_contacto: string | null
  empresa: string | null
  cargo: string | null
  segmento_icp: string
  narrativa_asignada: 'A' | 'B'
  qualification_score: number
  scores_por_dimension: ScoreDimensions
  fincas_en_cartera: number | null
  cultivo_principal: string | null
  pais: string | null
  eudr_urgency_nivel: string
  sistema_actual: string | null
  objeciones_manejadas: string[]
  punto_de_dolor_principal: string | null
  compromiso_logrado: 'reunion' | 'piloto' | 'ninguno'
  fecha_propuesta_reunion: string | null
  conversacion_resumen: string
  turns_total: number
  questions_asked: number
  handoff_trigger: 'score_threshold' | 'human_request' | 'price_readiness'
  source_context?: string | null
}

export type SDRNode = 'triage' | 'discovery' | 'pitch' | 'close' | 'global_fallback'

export interface SDRProspectoRow {
  id: string
  phone: string
  sdr_node: SDRNode
  nombre: string | null
  empresa: string | null
  cargo: string | null
  pais: string | null
  segmento_icp: 'exportadora' | 'ong' | 'gerente_finca' | 'otro' | 'desconocido'
  narrativa_asignada: 'A' | 'B'
  score_total: number
  score_eudr_urgency: number
  score_tamano_cartera: number
  score_calidad_dato: number
  score_champion: number
  score_timeline_decision: number
  score_presupuesto: number
  preguntas_realizadas: PreguntaRealizada[]
  fincas_en_cartera: number | null
  cultivo_principal: string | null
  eudr_urgency_nivel: 'alta' | 'media' | 'baja' | 'ninguna' | 'desconocida'
  sistema_actual: string | null
  objeciones_manejadas: string[]
  punto_de_dolor_principal: string | null
  status: 'new' | 'en_discovery' | 'qualified' | 'unqualified' | 'piloto_propuesto' | 'reunion_agendada' | 'dormant' | 'descartado'
  turns_total: number
  deal_brief: DealBrief | null
  founder_notified_at: string | null
  reunion_agendada_at: string | null
  source_context: string | null
}

export interface SDRProspectoInsert {
  phone: string
  narrativa_asignada: 'A' | 'B'
  nombre?: string | null
  empresa?: string | null
  segmento_icp?: string
  source_context?: string | null
}

export interface SDRProspectoContext {
  nombre: string | null
  empresa: string | null
  segmento_icp: string
  narrativa: 'A' | 'B'
  score_total: number
  scores_por_dimension: ScoreDimensions
  preguntas_realizadas: PreguntaRealizada[]
  objeciones_manejadas: string[]
  punto_de_dolor_principal: string | null
  source_context?: string | null
}

export interface EntradaSDR {
  mensaje: string
  prospecto: SDRProspectoContext
  narrativa: 'A' | 'B'
  preguntas_realizadas: PreguntaRealizada[]
  score_actual: number
  turno: number
  objection_detected: string | null
  segmento_icp: string
}

export interface SDRInteraccionInsert {
  prospecto_id: string
  phone: string
  turno: number
  tipo: 'inbound' | 'outbound' | 'draft_approval' | 'founder_override' | 'meeting_confirmation'
  contenido: string
  score_before?: number
  score_after?: number
  score_delta?: Partial<ScoreDelta>
  objection_detected?: string | null
  action_taken?: string
  narrativa?: 'A' | 'B'
  segmento_icp?: string
  langfuse_trace_id?: string
  session_id?: string
}
