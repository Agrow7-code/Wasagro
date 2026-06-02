import type { ConvContext } from '../../context.js'

// FIX-3 — Audio inbound on SDR context.
//
// STT (Deepgram, D4) belongs to the field agent. In SDR, an inbound audio
// is a high-interest signal: the prospect is showing they grasp the use
// case ("look, this is how I'd record events"). Two-line response:
//   1. Acknowledge the audio explicitly — never silent-drop or apologize.
//   2. Advance: either close (if we already have enough info to pitch) or
//      ask the next discovery question we'd ask anyway.
//
// Never says "tuve un problemita" — that copy lives in handleSDRSession's
// catch and historically fired on audio because the classifier choked on
// the placeholder text. This template is the structural cure.

export function audioAck({ ctx }: { ctx: ConvContext }): string {
  const ack = 'Vi que mandaste un audio — en Wasagro exactamente así es como tus trabajadores registran las labores en el campo.'

  // Enough info to pitch the close. Bridge to the regular close offer:
  // brochure or 30-min demo, segment-aware.
  if (ctx.datosConocidos >= 3) {
    const seg = ctx.segmento !== 'desconocido' ? ctx.segmento : 'tu operación'
    return `${ack} ¿Te parece si agendamos 30 minutos para mostrarte cómo lo procesa el sistema, o preferís que te mande el brochure con la info para ${seg}? 📅`
  }

  // Still discovering — keep the funnel moving. Use the same discovery gate
  // the router uses in directiva-building so the audio doesn't break the
  // information-collection invariants.
  if (ctx.fincasEstimadas == null) {
    return `${ack} Antes de mostrarte cómo lo procesa, contame: ¿cuántas hectáreas o fincas manejás?`
  }
  if (ctx.cultivo == null) {
    return `${ack} ¿Qué cultivo principal manejan en tus fincas?`
  }
  if (ctx.pais == null) {
    return `${ack} ¿En qué país está ubicada la finca?`
  }
  if (ctx.sistemaActual == null) {
    return `${ack} ¿Cómo registran hoy las labores — en papel, Excel, o con otra app?`
  }

  // Defensive fallback. datosConocidos should cover this branch already, but
  // if a missed field slips through we still offer a meaningful close.
  return `${ack} ¿Querés ver cómo se ve en una demo de 30 minutos, o preferís el brochure para revisarlo a tu ritmo?`
}
