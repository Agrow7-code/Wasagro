import type { EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'

// ── Filtro de confianza (P1: "el agente nunca inventa datos") ────────────────
// La regla "campo de baja confianza → null" vivía SOLO en los prompts (rúbrica
// de confidence_score). Esto la convierte en una garantía determinista de código:
// después de la validación Zod y ANTES de persistir/usar el evento, todo campo
// cuya confianza por-campo esté por debajo del umbral se anula (se marca como
// faltante y se fuerza revisión humana). Un valor que el modelo "adivinó" con
// baja confianza es justamente lo que P1 prohíbe persistir.
//
// Diseño: función PURA (no muta la entrada, no hace I/O), determinista y testeable.
// El llamante decide qué observabilidad emitir (LangFuse) con `camposAnulados`.

export interface FiltroConfianzaOpciones {
  // Por debajo de esto, un campo individual se considera "adivinado" → null.
  // Default 0.3, alineado con la rúbrica de los prompts ("< 0.29 → devolvé null").
  umbralCampoNull: number
  // Por debajo de esto, el evento completo se marca para revisión humana
  // (NUNCA se descarta: escalamos, no borramos). Default 0.5 ("< 0.49 → dudoso").
  umbralEventoRevision: number
}

export const DEFAULT_FILTRO_CONFIANZA: FiltroConfianzaOpciones = {
  umbralCampoNull: Number(process.env['CONFIDENCE_FIELD_NULL_THRESHOLD'] ?? 0.3),
  umbralEventoRevision: Number(process.env['CONFIDENCE_EVENT_REVIEW_THRESHOLD'] ?? 0.5),
}

export interface ResultadoFiltroConfianza {
  evento: EventoCampoExtraido
  // Nombres de los campos que se anularon por baja confianza (para trazas/UX).
  camposAnulados: string[]
}

/**
 * Anula los campos extraídos cuya confianza por-campo esté por debajo del umbral.
 * - Solo actúa cuando hay una confianza numérica explícita y baja. Un campo sin
 *   entrada en `confidence_por_campo` NO se anula (no destruimos dato por ausencia
 *   de metadato), pero el evento igual se marca para revisión si su score global
 *   es bajo.
 * - Los campos anulados se agregan a `campos_faltantes` y fuerzan
 *   `requiere_validacion = true` (P7: aprobación humana antes de actuar).
 * - No descarta el evento ni cambia su `tipo_evento`.
 */
export function aplicarFiltroConfianza(
  evento: EventoCampoExtraido,
  opciones: FiltroConfianzaOpciones = DEFAULT_FILTRO_CONFIANZA,
): ResultadoFiltroConfianza {
  const { umbralCampoNull, umbralEventoRevision } = opciones

  const camposExtraidos: Record<string, unknown> = { ...evento.campos_extraidos }
  const confianzaPorCampo = evento.confidence_por_campo ?? {}
  const camposAnulados: string[] = []

  for (const [campo, valor] of Object.entries(camposExtraidos)) {
    // Ya nulo: nada que anular.
    if (valor === null || valor === undefined) continue
    const conf = confianzaPorCampo[campo]
    if (typeof conf === 'number' && conf < umbralCampoNull) {
      camposExtraidos[campo] = null
      camposAnulados.push(campo)
    }
  }

  // campos_faltantes con los anulados, sin duplicar.
  const camposFaltantes = Array.from(new Set([...(evento.campos_faltantes ?? []), ...camposAnulados]))

  const requiereValidacion =
    evento.requiere_validacion ||
    camposAnulados.length > 0 ||
    evento.confidence_score < umbralEventoRevision

  const eventoFiltrado: EventoCampoExtraido = {
    ...evento,
    campos_extraidos: camposExtraidos,
    campos_faltantes: camposFaltantes,
    requiere_validacion: requiereValidacion,
  }

  return { evento: eventoFiltrado, camposAnulados }
}
