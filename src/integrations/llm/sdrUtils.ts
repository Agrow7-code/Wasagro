import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LLMError } from './LLMError.js'
import type { EntradaSDR } from '../../types/dominio/SDRTypes.js'

export function cargarSDRPrompt(nombre: string): string {
  try {
    return readFileSync(join(process.cwd(), 'sdr', 'prompts', nombre), 'utf-8')
  } catch (err) {
    throw new LLMError('PARSE_ERROR', `SDR prompt requerido no encontrado: sdr/prompts/${nombre}`, err)
  }
}

export function buildSDRContexto(entrada: EntradaSDR): string {
  const p = entrada.prospecto
  const lines = [
    '## Contexto del prospecto',
    `- Nombre: ${p.nombre ?? 'desconocido'}`,
    `- Empresa: ${p.empresa ?? 'no especificada'}`,
    `- Segmento ICP: ${entrada.segmento_icp}`,
    `- Narrativa: ${entrada.narrativa}`,
    `- Turno: ${entrada.turno}`,
    `- Score actual: ${entrada.score_actual}/100`,
    `- Scores: eudr_urgency=${p.scores_por_dimension.eudr_urgency}/25, tamano_cartera=${p.scores_por_dimension.tamano_cartera}/20, calidad_dato=${p.scores_por_dimension.calidad_dato}/20, champion=${p.scores_por_dimension.champion}/15, timeline_decision=${p.scores_por_dimension.timeline_decision}/10, presupuesto=${p.scores_por_dimension.presupuesto}/10`,
  ]
  if (p.preguntas_realizadas.length > 0) {
    lines.push(`- Preguntas ya respondidas (NO repetir): ${p.preguntas_realizadas.map(q => q.question_id).join(', ')}`)
  }
  if (p.objeciones_manejadas.length > 0) {
    lines.push(`- Objeciones ya manejadas: ${p.objeciones_manejadas.join(', ')}`)
  }
  if (p.punto_de_dolor_principal) {
    lines.push(`- Pain principal identificado: ${p.punto_de_dolor_principal}`)
  }
  if (entrada.objection_detected) {
    lines.push(`- OBJECIÓN DETECTADA en este mensaje: ${entrada.objection_detected}`)
  }
  return lines.join('\n')
}
