import type { ConvContext } from '../../context.js'

// Política CLAUDE.md §Identidad: "Si llega un cliente de otro país u otro
// cultivo, se trabaja con él. Nunca rechazar a un cliente por geografía o
// cultivo."
//
// Antes (rechazo amable con waitlist): "te anotamos para más adelante" — eso
// era rechazo de facto. El prospecto nunca volvía y perdíamos la chance de
// entender un cultivo que podríamos sumar.
//
// Ahora: invitación a coordinar. Reconocemos el cultivo, somos honestos sobre
// el foco actual (MVP cacao/banano/café), y pedimos 20 minutos para entender
// cómo Wasagro le serviría a ese cultivo en particular. El calendar link se
// manda como mensaje aparte vía composeCalendarLink (mismo patrón que el
// cierre del flow principal).
//
// P1 "el agente nunca inventa datos": no prometemos features ni timelines.
// La copy dice "queremos entender bien cómo podríamos servirte" — exploración
// genuina, no compromiso comercial.

export function outOfScopeCultivo({ ctx }: { ctx: ConvContext }): string {
  const cultivo = ctx.cultivo ?? 'tu cultivo'
  const cultivoLabel = cultivo === 'otro' ? 'tu cultivo' : cultivo
  return `¡Gracias por contarme sobre tu operación de ${cultivoLabel}! Hoy Wasagro está optimizado para cacao, banano y café, pero ${cultivoLabel} es un cultivo que queremos sumar y nos encantaría entender bien cómo podríamos servirte. ¿Coordinamos 20 minutos para verlo juntos?`
}
