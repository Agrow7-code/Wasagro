import { SigatokaMuestreoSchema } from '../../types/dominio/SigatokaMuestreo.js'
import type {
  SigatokaMuestreo,
  ResumenColumna,
  PuntoMuestreoSigatoka,
} from '../../types/dominio/SigatokaMuestreo.js'
import { PromptManager } from '../promptManager.js'

// ─── Fórmulas y validación cruzada (por columna) ──────────────────────────────

export type ResumenColumnaSinCalculo = Omit<
  ResumenColumna,
  'H_calculado' | 'I_calculado' | 'J_calculado' | 'K_calculado' | 'L_calculado' | 'M_calculado'
>

const round1 = (n: number): number => parseFloat(n.toFixed(1))

const pct = (num: number | null, den: number | null): number | null =>
  num != null && den != null && den !== 0 ? round1((num / den) * 100) : null
const ratio = (num: number | null, den: number | null): number | null =>
  num != null && den != null && den !== 0 ? round1(num / den) : null

// Recalcula una columna de DATOS. Null-safe: si falta A o el numerador, el
// resultado es null en vez de tirar excepción (P1 — no inventar, no crashear).
export function calcularColumna(raw: ResumenColumnaSinCalculo): ResumenColumna {
  const { A, B, C, D, E, F, G } = raw
  return {
    ...raw,
    H_calculado: pct(C, A),
    I_calculado: pct(D, A),
    J_calculado: pct(E, A),
    K_calculado: ratio(B, A),
    L_calculado: ratio(F, A),
    M_calculado: ratio(G, A),
  }
}

export function detectarCamposDudososColumna(col: ResumenColumna, idx: number): string[] {
  const dudosos: string[] = []
  const checks: Array<[string, number | null, number | null]> = [
    ['H', col.H_calculado, col.H_formulario],
    ['I', col.I_calculado, col.I_formulario],
    ['J', col.J_calculado, col.J_formulario],
    ['K', col.K_calculado, col.K_formulario],
    ['L', col.L_calculado, col.L_formulario],
    ['M', col.M_calculado, col.M_formulario],
  ]
  for (const [campo, calc, form] of checks) {
    if (form != null && calc != null && Math.abs(calc - form) > 0.5) {
      dudosos.push(`resumen[col${idx + 1}].${campo} (calculado: ${calc}, formulario: ${form})`)
    }
  }
  return dudosos
}

export function detectarCamposDudosos(columnas: ResumenColumna[]): string[] {
  return columnas.flatMap((col, idx) => detectarCamposDudososColumna(col, idx))
}

// ─── Atribución de puntos a lotes ─────────────────────────────────────────────
// Cada bloque de puntos lleva un rótulo de sector (ej. "Corrijal"). Si coincide
// con un lote registrado de la finca, atribuimos esos puntos a ese lote_id. Si
// no coincide, lote_id queda null y el sector crudo se preserva para revisión.

export interface LoteRef { lote_id: string; nombre: string }

const normalizar = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '')

export function mapearSectoresALotes(
  puntos: PuntoMuestreoSigatoka[],
  lotes: LoteRef[],
): PuntoMuestreoSigatoka[] {
  const indice = new Map(lotes.map(l => [normalizar(l.nombre), l.lote_id]))
  return puntos.map(p => {
    if (!p.sector) return p
    return { ...p, lote_id: indice.get(normalizar(p.sector)) ?? null }
  })
}

// ─── Sub-clasificador: ¿es un formulario de Sigatoka? ────────────────────────

const MARCADORES_SIGATOKA = ['SIGATOKA', 'H+VLE', 'EF PAS', 'EF ACT', 'FUNC', 'EE2', 'EE3', 'CERAMIDA', 'SIBINE']

export function detectarFormularioSigatoka(textoExtraido: string): boolean {
  if (!textoExtraido) return false
  const upper = textoExtraido.toUpperCase()
  const matches = MARCADORES_SIGATOKA.filter(m => upper.includes(m)).length
  return matches >= 3
}

// ─── Extracción Vision (helper standalone, sin retry) ─────────────────────────

export interface SigatokaVisionParams {
  prompt:      string
  imageBase64: string
  mimeType:    string
  traceId:     string
}
export type SigatokaVisionFn = (params: SigatokaVisionParams) => Promise<string>

function postProcesar(parsed: any): { data: SigatokaMuestreo; camposAclarar: string[] } {
  const columnas: ResumenColumna[] = (parsed.resumenColumnas ?? []).map(calcularColumna)
  const camposDudosos = [
    ...(parsed.camposDudosos ?? []),
    ...detectarCamposDudosos(columnas),
  ]
  const data = SigatokaMuestreoSchema.parse({
    ...parsed,
    resumenColumnas: columnas,
    requiereValidacion: camposDudosos.length > 0 || (parsed.confidenceScore ?? 0) < 0.75,
    camposDudosos,
  })
  return { data, camposAclarar: camposDudosos.slice(0, 2) }
}

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
  return postProcesar(parsed)
}

// ─── Fallback determinista (nunca lanza) ──────────────────────────────────────
// Cuando la extracción agota reintentos, rescatamos lo que se pueda de la última
// respuesta y guardamos como requires_review en vez de tirar excepción (P1/P4).

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function sanPunto(p: any): PuntoMuestreoSigatoka {
  return {
    punto: str(p?.punto) ?? '?',
    sector: str(p?.sector),
    lote_id: str(p?.lote_id),
    planta1_estadio: num(p?.planta1_estadio), planta1_piscas: num(p?.planta1_piscas),
    planta2_estadio: num(p?.planta2_estadio), planta2_piscas: num(p?.planta2_piscas),
    planta3_estadio: num(p?.planta3_estadio), planta3_piscas: num(p?.planta3_piscas),
    hVle: num(p?.hVle), hVlq: num(p?.hVlq), func: num(p?.func),
    marcaEspecial: str(p?.marcaEspecial),
  }
}

function sanColumna(c: any): ResumenColumna {
  return calcularColumna({
    A: num(c?.A), B: num(c?.B), C: num(c?.C), D: num(c?.D), E: num(c?.E), F: num(c?.F), G: num(c?.G),
    H_formulario: num(c?.H_formulario), I_formulario: num(c?.I_formulario), J_formulario: num(c?.J_formulario),
    K_formulario: num(c?.K_formulario), L_formulario: num(c?.L_formulario), M_formulario: num(c?.M_formulario),
  })
}

export function construirFallbackSigatoka(rawJson: any, zodErrors: string | null): SigatokaMuestreo {
  const j = rawJson ?? {}
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
  const sanPlaga = (p: any) => ({ h: num(p?.h), p: num(p?.p), m: num(p?.m) })

  return SigatokaMuestreoSchema.parse({
    confidenceScore: 0,
    requiereValidacion: true,
    camposDudosos: [zodErrors ? `extracción incompleta: ${zodErrors}` : 'extracción incompleta'],
    zona: str(j.zona), codigoFinca: str(j.codigoFinca), nombreFinca: str(j.nombreFinca),
    semana: typeof j.semana === 'number' && j.semana >= 1 && j.semana <= 53 ? j.semana : null,
    periodo: num(j.periodo), fecha: str(j.fecha), supervisor: str(j.supervisor),
    puntosMuestreo: arr(j.puntosMuestreo).map(sanPunto),
    plantas: arr(j.plantas).map((p: any) => ({
      numero: num(p?.numero) ?? 0,
      nuevaOVieja: p?.nuevaOVieja === 0 || p?.nuevaOVieja === 1 ? p.nuevaOVieja : null,
      efPasada: num(p?.efPasada), efActual: num(p?.efActual), referencia: num(p?.referencia),
      marcaEspecial: str(p?.marcaEspecial),
    })),
    resumenColumnas: arr(j.resumenColumnas).map(sanColumna),
    plantas11sem: arr(j.plantas11sem).map((p: any) => ({
      ht: num(p?.ht), hVle: num(p?.hVle), q5menos: num(p?.q5menos), q5mas: num(p?.q5mas), lc: num(p?.lc),
    })),
    plagasFoliares: {
      ceramida: sanPlaga(j?.plagasFoliares?.ceramida),
      sibine: sanPlaga(j?.plagasFoliares?.sibine),
    },
  })
}

// ─── Helpers de agregación entre columnas ─────────────────────────────────────

const maximo = (vals: Array<number | null>): number | null => {
  const nums = vals.filter((v): v is number => v != null)
  return nums.length ? Math.max(...nums) : null
}
const minimo = (vals: Array<number | null>): number | null => {
  const nums = vals.filter((v): v is number => v != null)
  return nums.length ? Math.min(...nums) : null
}

// ─── Descripción para RAG / embeddings ───────────────────────────────────────

export function buildDescripcionRaw(data: SigatokaMuestreo): string {
  const cols = data.resumenColumnas
  const A = cols[0]?.A ?? null
  const peorI = maximo(cols.map(c => c.I_calculado))
  const peorJ = maximo(cols.map(c => c.J_calculado))
  const peorM = minimo(cols.map(c => c.M_calculado))
  const K = cols[0]?.K_calculado ?? null
  const f = (v: number | null) => (v == null ? '-' : String(v))

  const parts = [
    `Muestreo de Sigatoka semana ${data.semana ?? '-'} finca ${data.nombreFinca ?? '-'}.`,
    `Plantas muestreadas: ${f(A)}.`,
    `Promedio hoja más vieja libre de estría (K): ${f(K)}.`,
    `Peor % plantas EE2 avanzado (I): ${f(peorI)}%.`,
    `Peor % plantas EE3-6 (J): ${f(peorJ)}%.`,
    `Mínimo promedio hojas funcionales (M): ${f(peorM)}.`,
    `Ceramida: huevos ${data.plagasFoliares.ceramida.h ?? '-'}, pupas ${data.plagasFoliares.ceramida.p ?? '-'}, muertos ${data.plagasFoliares.ceramida.m ?? '-'}.`,
    `Sibine: huevos ${data.plagasFoliares.sibine.h ?? '-'}, pupas ${data.plagasFoliares.sibine.p ?? '-'}, muertos ${data.plagasFoliares.sibine.m ?? '-'}.`,
  ]
  if (data.camposDudosos.length > 0) {
    parts.push(`Campos con discrepancia: ${data.camposDudosos.join(', ')}.`)
  }
  return parts.join(' ')
}

// ─── Resumen para WhatsApp ───────────────────────────────────────────────────
// Alertas si CUALQUIER columna (planta) supera el umbral — no perder el peor caso.

export function buildWhatsappSummary(data: SigatokaMuestreo, camposAclarar: string[]): string {
  const cols = data.resumenColumnas
  const A = cols[0]?.A ?? null
  const K = cols[0]?.K_calculado ?? null
  const peorI = maximo(cols.map(c => c.I_calculado))
  const peorJ = maximo(cols.map(c => c.J_calculado))
  const peorM = minimo(cols.map(c => c.M_calculado))
  const f = (v: number | null) => (v == null ? '-' : String(v))

  const alertas: string[] = []
  if (peorJ != null && peorJ > 10) alertas.push(`⚠️ ${peorJ}% plantas con EE3-6 — revisar programa de fumigación`)
  if (peorI != null && peorI > 5)  alertas.push(`⚠️ ${peorI}% plantas con EE2 avanzado (estadios 4+)`)
  if (peorM != null && peorM < 9)  alertas.push(`⚠️ Promedio hojas funcionales bajo (${peorM}) — evaluar nutrición`)

  let msg =
`✅ *Muestreo Sigatoka semana ${data.semana ?? '-'} — ${data.nombreFinca ?? 'finca'}* registrado

📊 *Resumen:*
• Plantas muestreadas: ${f(A)}
• Prom. hoja libre de estría: ${f(K)}
• Mín. hojas funcionales: ${f(peorM)}
• Peor % EE2 avanzado: ${f(peorI)}%
• Peor % EE3-6: ${f(peorJ)}%

🐛 *Plagas foliares:*
• Ceramida — H:${data.plagasFoliares.ceramida.h ?? '-'} P:${data.plagasFoliares.ceramida.p ?? '-'} M:${data.plagasFoliares.ceramida.m ?? '-'}
• Sibine — H:${data.plagasFoliares.sibine.h ?? '-'} P:${data.plagasFoliares.sibine.p ?? '-'} M:${data.plagasFoliares.sibine.m ?? '-'}`

  if (alertas.length > 0) msg += '\n\n' + alertas.join('\n')
  if (camposAclarar.length > 0) {
    // Honesto: una discrepancia es entre el recálculo (fuente confiable, desde
    // los conteos crudos) y el total escrito a mano. No le preguntamos al tomador
    // por esto ni prometemos un follow-up que no existe — lo deriva el asesor.
    const n = camposAclarar.length
    const plural = n > 1
    msg += `\n\n⚠️ ${n} valor${plural ? 'es' : ''} no ${plural ? 'cuadran' : 'cuadra'} con las cuentas — usé el recálculo y tu asesor lo revisa.`
  }
  return msg
}
