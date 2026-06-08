import { SigatokaMuestreoSchema } from '../../types/dominio/SigatokaMuestreo.js'
import type { SigatokaMuestreo, ResumenSigatoka } from '../../types/dominio/SigatokaMuestreo.js'
import { PromptManager } from '../promptManager.js'

// ─── Fórmulas y validación cruzada ────────────────────────────────────────────

export type ResumenSigatokaSinCalculo = Omit<
  ResumenSigatoka,
  'H_calculado' | 'I_calculado' | 'J_calculado' | 'K_calculado' | 'L_calculado' | 'M_calculado'
>

const round1 = (n: number): number => parseFloat(n.toFixed(1))

export function calcularResumen(raw: ResumenSigatokaSinCalculo): ResumenSigatoka {
  const { A, B, C, D, E, F, G } = raw
  if (!A || A === 0) throw new Error('A (plantas muestreadas) no puede ser 0')

  return {
    ...raw,
    H_calculado: round1((C / A) * 100),
    I_calculado: round1((D / A) * 100),
    J_calculado: round1((E / A) * 100),
    K_calculado: round1(B / A),
    L_calculado: round1(F / A),
    M_calculado: round1(G / A),
  }
}

export function detectarCamposDudosos(resumen: ResumenSigatoka): string[] {
  const dudosos: string[] = []
  const checks = [
    { campo: 'H', calc: resumen.H_calculado, form: resumen.H_formulario },
    { campo: 'I', calc: resumen.I_calculado, form: resumen.I_formulario },
    { campo: 'J', calc: resumen.J_calculado, form: resumen.J_formulario },
    { campo: 'K', calc: resumen.K_calculado, form: resumen.K_formulario },
    { campo: 'L', calc: resumen.L_calculado, form: resumen.L_formulario },
    { campo: 'M', calc: resumen.M_calculado, form: resumen.M_formulario },
  ]
  for (const { campo, calc, form } of checks) {
    if (form !== null && form !== undefined && Math.abs(calc - form) > 0.5) {
      dudosos.push(`resumen.${campo} (calculado: ${calc}, formulario: ${form})`)
    }
  }
  return dudosos
}

// ─── Sub-clasificador: ¿es un formulario de Sigatoka? ────────────────────────
// detectarFormularioSigatoka corre sobre el texto que ya extrajo el OCR genérico
// (sp-03d). NO hace llamada LLM — solo cuenta marcadores. El extractor real
// extractSigatokaMuestreo (más abajo) SÍ hace llamada Vision con sp-03e — pero
// ese es otro contrato, no este sub-clasificador.

const MARCADORES_SIGATOKA = ['SIGATOKA', 'H+VLE', 'EF PAS', 'EF ACT', 'FUNC', 'EE2', 'EE3', 'CERAMIDA', 'SIBINE']

export function detectarFormularioSigatoka(textoExtraido: string): boolean {
  if (!textoExtraido) return false
  const upper = textoExtraido.toUpperCase()
  const matches = MARCADORES_SIGATOKA.filter(m => upper.includes(m)).length
  return matches >= 3
}

// ─── Extracción Vision ────────────────────────────────────────────────────────
// El cliente Vision se inyecta. Cuando se haga el wiring (paso siguiente):
//   - Opción A: añadir extraerMuestreoSigatoka() a IWasagroLLM
//   - Opción B: pasar un adapter que llame _llm.#adapter.generarTexto con responseFormat:'json_object'

export interface SigatokaVisionParams {
  prompt:      string
  imageBase64: string
  mimeType:    string
  traceId:     string
}

export type SigatokaVisionFn = (params: SigatokaVisionParams) => Promise<string>

export async function extractSigatokaMuestreo(
  imageBase64: string,
  mimeType: string,
  vision: SigatokaVisionFn,
  traceId: string,
): Promise<{ data: SigatokaMuestreo; camposAclarar: string[] }> {
  const prompt = await PromptManager.getPrompt('sp-03e-muestreo-sigatoka.md', 'prompts/sp-03e-muestreo-sigatoka.md', traceId)

  const rawResponse = await vision({ prompt, imageBase64, mimeType, traceId })

  let parsed: any
  try {
    parsed = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse
  } catch {
    throw new Error('sp-03e devolvió JSON inválido')
  }

  parsed.resumen = calcularResumen(parsed.resumen)

  const camposDudosos = [
    ...(parsed.camposDudosos ?? []),
    ...detectarCamposDudosos(parsed.resumen),
  ]

  const data = SigatokaMuestreoSchema.parse({
    ...parsed,
    requiereValidacion: camposDudosos.length > 0 || (parsed.confidenceScore ?? 0) < 0.75,
    camposDudosos,
  })

  return { data, camposAclarar: camposDudosos.slice(0, 2) }
}

// ─── Descripción para RAG / embeddings ───────────────────────────────────────
// Este texto va a eventos_campo.descripcion_raw — debe ser legible y contener
// los números clave para que el retriever lo encuentre en queries futuras.

export function buildDescripcionRaw(data: SigatokaMuestreo): string {
  const r = data.resumen
  const parts = [
    `Muestreo de Sigatoka semana ${data.semana} finca ${data.nombreFinca}.`,
    `Plantas muestreadas: ${r.A}.`,
    `Promedio hoja más vieja libre de estría (K): ${r.K_calculado}.`,
    `Promedio hojas funcionales (M): ${r.M_calculado}.`,
    `% plantas EE2 avanzado (I): ${r.I_calculado}%.`,
    `% plantas EE3-6 (J): ${r.J_calculado}%.`,
    `Ceramida: huevos ${data.plagasFoliares.ceramida.h ?? '-'}, pupas ${data.plagasFoliares.ceramida.p ?? '-'}, muertos ${data.plagasFoliares.ceramida.m ?? '-'}.`,
    `Sibine: huevos ${data.plagasFoliares.sibine.h ?? '-'}, pupas ${data.plagasFoliares.sibine.p ?? '-'}, muertos ${data.plagasFoliares.sibine.m ?? '-'}.`,
  ]
  if (data.camposDudosos.length > 0) {
    parts.push(`Campos con discrepancia: ${data.camposDudosos.join(', ')}.`)
  }
  return parts.join(' ')
}

// ─── Resumen para WhatsApp ───────────────────────────────────────────────────

export function buildWhatsappSummary(data: SigatokaMuestreo, camposAclarar: string[]): string {
  const r = data.resumen
  const alertas: string[] = []

  if (r.J_calculado > 10) alertas.push(`⚠️ ${r.J_calculado}% plantas con EE3-6 — revisar programa de fumigación`)
  if (r.I_calculado > 5)  alertas.push(`⚠️ ${r.I_calculado}% plantas con EE2 avanzado (estadios 4+)`)
  if (r.M_calculado < 9)  alertas.push(`⚠️ Promedio hojas funcionales bajo (${r.M_calculado}) — evaluar nutrición`)

  let msg =
`✅ *Muestreo Sigatoka semana ${data.semana} — ${data.nombreFinca}* registrado

📊 *Resumen:*
• Plantas muestreadas: ${r.A}
• Prom. hoja libre de estría: ${r.K_calculado}
• Prom. hojas funcionales: ${r.M_calculado}
• % EE2 avanzado: ${r.I_calculado}%
• % EE3-6: ${r.J_calculado}%

🐛 *Plagas foliares:*
• Ceramida — H:${data.plagasFoliares.ceramida.h ?? '-'} P:${data.plagasFoliares.ceramida.p ?? '-'} M:${data.plagasFoliares.ceramida.m ?? '-'}
• Sibine — H:${data.plagasFoliares.sibine.h ?? '-'} P:${data.plagasFoliares.sibine.p ?? '-'} M:${data.plagasFoliares.sibine.m ?? '-'}`

  if (alertas.length > 0) {
    msg += '\n\n' + alertas.join('\n')
  }

  if (camposAclarar.length > 0) {
    msg += `\n\n❓ Encontré ${camposAclarar.length} valor${camposAclarar.length > 1 ? 'es' : ''} con discrepancia — te escribo en un momento.`
  }

  return msg
}
