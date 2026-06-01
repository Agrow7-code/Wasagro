import type { ConvContext } from '../../context.js'

// The close — offered after the FSM transitions to 'closing'. Asks two
// low-commitment options: a 10-min demo OR a brochure for the prospect's
// segmento. The brochure path is the safer escape hatch — if the prospect
// declines the demo they still receive nurture material.
//
// IMPORTANT: never promises "casos de éxito" (Wasagro does not have any) and
// never apologizes for prior questions (the LLM-generated version of this
// message kept inventing "Disculpa la pregunta anterior..." which surprised
// real clients). This template is the structural cure for both regressions.

export function closeOffer({ ctx }: { ctx: ConvContext }): string {
  const seg = ctx.segmento !== 'desconocido' ? ctx.segmento : 'tu segmento'
  return `¿Te parece si agendamos 10 minutitos para mostrarte cómo se ve, o preferís que te mande el brochure con la info para ${seg}? 📅`
}
