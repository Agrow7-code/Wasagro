import type { ConvContext } from '../../context.js'

// TODO [H1-expansion] resuelto: cuando el prospecto declara un cultivo fuera
// del MVP (cacao/banano/cafe/pina), responder honestamente — la regla P1
// "El agente nunca inventa datos" implica también "el agente no promete
// cobertura que no tiene". El waitlist se construye exportando los eventos
// sdr_out_of_scope_cultivo de LangFuse (cada uno trae phone + cultivo).
//
// Política comercial del CLAUDE.md §Identidad: "Si llega un cliente de otro
// país u otro cultivo, se trabaja con él. Nunca rechazar a un cliente por
// geografía o cultivo." Por eso el copy no cierra la puerta — ofrece quedarse
// en contacto.

export function outOfScopeCultivo({ ctx }: { ctx: ConvContext }): string {
  const cultivo = ctx.cultivo ?? 'tu cultivo'
  const cultivoLabel = cultivo === 'otro' ? 'ese cultivo' : cultivo
  return `Gracias por contarme. Hoy Wasagro está optimizado para cacao, banano y café — tu operación de ${cultivoLabel} la podemos sumar más adelante. Te anoto y te aviso apenas tengamos el flujo listo. ¿Te parece bien?`
}
