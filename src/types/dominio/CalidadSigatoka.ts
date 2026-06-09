import { z } from 'zod'

// Secciones estructurales de una ficha de muestreo de Sigatoka. Se usan para
// detectar CORTADA (falta una región grande) vs BORROSA (está pero ilegible).
export const SeccionSigatokaSchema = z.enum([
  'titulo',          // encabezado "MUESTREO DE SIGATOKA" / "LOGBAN"
  'matriz_puntos',   // la matriz P1..P19 — el núcleo del dato
  'ef_pas_act',      // bloque EF PASADA / EF ACTUAL por planta
  'plagas_foliares', // CERAMIDA / SIBINE
  'bloque_formulas', // A..M
])
export type SeccionSigatoka = z.infer<typeof SeccionSigatokaSchema>

export const CalidadSigatokaSchema = z.object({
  secciones_visibles:  z.array(SeccionSigatokaSchema),
  secciones_faltantes: z.array(SeccionSigatokaSchema),
  // Legibilidad FUNCIONAL de la matriz: ¿se pueden leer los números?
  //   legible  = se leen sin problema
  //   parcial  = algunos cuestan pero la mayoría se lee  → PASA (la red de
  //              abajo, el conteo de dudosos, decide)
  //   ilegible = no se puede leer la matriz en absoluto    → rechazo
  legibilidad_matriz: z.enum(['legible', 'parcial', 'ilegible']),
  motivo:    z.string().nullable(),   // ej. "esquina inferior cortada", "reflejo sobre la matriz"
  confianza: z.number().min(0).max(1),
})
export type CalidadSigatoka = z.infer<typeof CalidadSigatokaSchema>

// Sección imprescindible para el chequeo de CORTADA. La matriz ES el dato: si
// falta, hay que re-capturar. El resto (título, EF, plagas, fórmulas), si se
// cortó, se detecta aguas abajo como celdas de muestra faltantes — no bloquea.
const SECCIONES_OBLIGATORIAS: ReadonlyArray<SeccionSigatoka> = ['matriz_puntos']

// Solo rechazamos cuando el gate está razonablemente seguro. Bajo este umbral,
// ante la duda, PASA — minimizar falsos positivos (rechazar una foto buena es
// el peor error de UX en campo).
export const UMBRAL_RECHAZO_DEFAULT = 0.5

export interface VeredictoCalidad {
  aceptable: boolean
  problema:  'cortada' | 'borrosa' | null
  mensaje:   string | null   // copy WhatsApp (tuteo Ec/Gt, ⚠️) cuando se rechaza
}

const MSG_CORTADA =
  'No entró toda la planilla en la foto ⚠️ Vuelve a tomarla de modo que se vea la tabla completa, derecha y sin cortes.'
const MSG_BORROSA =
  'La foto salió borrosa y no puedo leer bien los números ⚠️ Tómala de nuevo con buena luz, sin reflejo y bien enfocada.'

/**
 * Veredicto determinista sobre la calidad de la foto. Regla CONSERVADORA:
 * rechaza SOLO ante una señal negativa clara y con confianza suficiente.
 * Todo lo demás (incluido 'parcial') pasa a extracción.
 */
export function evaluarCalidadSigatoka(
  c: CalidadSigatoka,
  umbralRechazo: number = UMBRAL_RECHAZO_DEFAULT,
): VeredictoCalidad {
  const seguro = c.confianza >= umbralRechazo

  const faltaObligatoria = SECCIONES_OBLIGATORIAS.some(s => c.secciones_faltantes.includes(s))
  if (seguro && faltaObligatoria) {
    return { aceptable: false, problema: 'cortada', mensaje: MSG_CORTADA }
  }

  if (seguro && c.legibilidad_matriz === 'ilegible') {
    return { aceptable: false, problema: 'borrosa', mensaje: MSG_BORROSA }
  }

  return { aceptable: true, problema: null, mensaje: null }
}

// Cap de re-captura (P2): cuántas veces pedimos otra foto antes de procesar
// igual. 2 = consistente con "máximo 2 preguntas de clarificación".
export const MAX_RECAPTURA_SIGATOKA = 2

// Decide qué hacer con una foto que NO pasó el gate, según cuántas re-capturas ya
// pedimos. 'pedir' = solicitar otra foto; 'procesar' = no insistir más (P2 — no
// torturar) y mandar a extracción igual (el extractor marca lo ilegible →
// requires_review para el asesor; la imagen ya está persistida).
export function decidirRecaptura(
  aceptable: boolean,
  intentosPrevios: number,
  max: number = MAX_RECAPTURA_SIGATOKA,
): 'pedir' | 'procesar' {
  if (aceptable) return 'procesar'
  return intentosPrevios < max ? 'pedir' : 'procesar'
}

// Fallback usado cuando el pase de calidad mismo falla (LLM error, JSON inválido):
// nunca bloquear por una falla del gate — dejar pasar a extracción.
export const CALIDAD_FALLBACK_PASA: CalidadSigatoka = {
  secciones_visibles:  [],
  secciones_faltantes: [],
  legibilidad_matriz:  'legible',
  motivo:              null,
  confianza:           0,
}
