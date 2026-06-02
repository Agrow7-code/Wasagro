import type { ConvContext } from '../../context.js'

// The close — offered after the FSM transitions to 'closing'. Asks two
// low-commitment options: a 30-min demo OR a brochure for the prospect's
// segmento. The brochure path is the safer escape hatch — if the prospect
// declines the demo they still receive nurture material.
//
// FIX-5: duracion real de la demo es 30 minutos, no 10. La copy historica
// vendia "10 minutitos" pero las reuniones reales eran de media hora —
// generaba sorpresa al prospecto al recibir la invitacion del calendario.
//
// IMPORTANT: never promises "casos de éxito" (Wasagro does not have any) and
// never apologizes for prior questions (the LLM-generated version of this
// message kept inventing "Disculpa la pregunta anterior..." which surprised
// real clients). This template is the structural cure for both regressions.

export function closeOffer({ ctx }: { ctx: ConvContext }): string {
  const seg = ctx.segmento !== 'desconocido' ? ctx.segmento : 'tu segmento'
  return `¿Te parece si agendamos 30 minutos para mostrarte cómo se ve, o preferís que te mande el brochure con la info para ${seg}? 📅`
}
