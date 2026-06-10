import { SigatokaMuestreoSchema } from '../../types/dominio/SigatokaMuestreo.js'
import type {
  SigatokaMuestreo,
  ResumenColumna,
  PuntoMuestreoSigatoka,
  CeldaMuestra,
  AclaracionCelda,
} from '../../types/dominio/SigatokaMuestreo.js'
import { PromptManager } from '../promptManager.js'

// ─── Estado por celda (I5) ────────────────────────────────────────────────────
// Las 9 celdas de MUESTRA de cada punto. Excluye contexto (punto/sector) y la
// marca especial — solo lo que se cuenta para "preguntar al tomador".
export const CELDAS_MUESTRA = [
  'planta1_estadio', 'planta1_piscas',
  'planta2_estadio', 'planta2_piscas',
  'planta3_estadio', 'planta3_piscas',
  'hVle', 'hVlq', 'func',
] as const

// Normaliza una celda cruda del modelo a { valor, estado }. Determinista, nunca
// lanza. Reglas (en orden): un valor numérico SIEMPRE es 'leida' (un número
// presente no puede ser ilegible); sin valor, respetamos 'ilegible' SOLO si el
// modelo lo declaró; cualquier otra cosa cae a 'vacia' (conservador — no
// inventamos "ilegible" sobre celdas en blanco, eso torturaría al usuario, P2).
// Coerción tolerante a string ("2", "6,6") — los modelos de visión a veces los
// devuelven como texto. No-numérico → null.
const aNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    if (t === '' || t === '-') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function normalizarCelda(raw: unknown): CeldaMuestra {
  if (raw && typeof raw === 'object') {
    const valor = aNum((raw as { valor?: unknown }).valor)
    if (valor !== null) return { valor, estado: 'leida' }
    const estado = (raw as { estado?: unknown }).estado
    return { valor: null, estado: estado === 'ilegible' ? 'ilegible' : 'vacia' }
  }
  const valor = aNum(raw)
  return valor !== null ? { valor, estado: 'leida' } : { valor: null, estado: 'vacia' }
}

// Envuelve las 9 celdas de un punto crudo a CeldaMuestra; deja el resto intacto.
// Corre PRE-parse (como calcularColumna), sobre JSON no confiable del LLM.
export function normalizarPunto(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p }
  for (const campo of CELDAS_MUESTRA) out[campo] = normalizarCelda(p?.[campo])
  return out
}

export interface ConteoIlegibles {
  total: number
  ubicaciones: Array<{ punto: string; sector: string | null; campo: string }>
  // 0 → completo (no preguntar) · 1-5 → preguntar al tomador · >5 → corrección manual
  ruta: 'completo' | 'preguntar' | 'manual'
}

// Cuenta SOLO celdas con estado 'ilegible' (no 'vacia') y las ubica para poder
// formular la pregunta. Es la señal que habilita el follow-up "preguntar al
// tomador" del diseño D29 (umbral ≤5 por P2).
export function contarCeldasIlegibles(puntos: PuntoMuestreoSigatoka[]): ConteoIlegibles {
  const ubicaciones: ConteoIlegibles['ubicaciones'] = []
  for (const p of puntos) {
    for (const campo of CELDAS_MUESTRA) {
      if ((p as unknown as Record<string, CeldaMuestra>)[campo]?.estado === 'ilegible') {
        ubicaciones.push({ punto: p.punto, sector: p.sector, campo })
      }
    }
  }
  const total = ubicaciones.length
  const ruta: ConteoIlegibles['ruta'] = total === 0 ? 'completo' : total <= 5 ? 'preguntar' : 'manual'
  return { total, ubicaciones, ruta }
}

// Etiqueta legible de cada celda de muestra para el mensaje al tomador.
const LABEL_CELDA: Record<string, string> = {
  planta1_estadio: 'planta 1 estadio', planta1_piscas: 'planta 1 piscas',
  planta2_estadio: 'planta 2 estadio', planta2_piscas: 'planta 2 piscas',
  planta3_estadio: 'planta 3 estadio', planta3_piscas: 'planta 3 piscas',
  hVle: 'H+VLE', hVlq: 'H+VLQ', func: 'func',
}

// Pregunta al tomador por las celdas ilegibles (ruta 'preguntar', ≤5 por P2).
// Tuteo Ec/Gt, conciso, solo ⚠️. Pide los valores con un ejemplo de formato.
export function buildPreguntaAclaracion(ubicaciones: ConteoIlegibles['ubicaciones']): string {
  const lista = ubicaciones.map(u => `${u.punto} ${LABEL_CELDA[u.campo] ?? u.campo}`).join(', ')
  const n = ubicaciones.length
  const ej = ubicaciones[0]
  return `⚠️ En tu ficha no pude leer ${n} valor${n > 1 ? 'es' : ''}: ${lista}. ¿Me los pasás? Ej: "${ej?.punto ?? 'P1'} 4"`
}

// Aplica las respuestas del tomador a las celdas ILEGIBLES (nunca pisa una celda
// ya leída ni inventa: ignora valor null). Recalcula requiereValidacion: queda
// true si persisten ilegibles, discrepancias previas o confianza baja.
export function aplicarAclaraciones(sigatoka: SigatokaMuestreo, respuestas: AclaracionCelda[]): SigatokaMuestreo {
  const puntos: PuntoMuestreoSigatoka[] = sigatoka.puntosMuestreo.map(p => ({ ...p }))
  for (const r of respuestas) {
    if (r.valor == null || !Number.isFinite(r.valor)) continue
    if (!(r.campo in LABEL_CELDA)) continue
    const p = puntos.find(pt => pt.punto === r.punto)
    if (!p) continue
    const celdaActual = (p as unknown as Record<string, CeldaMuestra>)[r.campo]
    if (celdaActual?.estado !== 'ilegible') continue // solo resolvemos ilegibles
    ;(p as unknown as Record<string, CeldaMuestra>)[r.campo] = { valor: r.valor, estado: 'leida' }
  }
  const restantes = contarCeldasIlegibles(puntos).total
  return {
    ...sigatoka,
    puntosMuestreo: puntos,
    requiereValidacion: sigatoka.camposDudosos.length > 0 || sigatoka.confidenceScore < 0.75 || restantes > 0,
  }
}

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
  const puntos = (parsed.puntosMuestreo ?? []).map(normalizarPunto)
  const camposDudosos = [
    ...(parsed.camposDudosos ?? []),
    ...detectarCamposDudosos(columnas),
  ]
  const data = SigatokaMuestreoSchema.parse({
    ...parsed,
    puntosMuestreo: puntos,
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
    planta1_estadio: normalizarCelda(p?.planta1_estadio), planta1_piscas: normalizarCelda(p?.planta1_piscas),
    planta2_estadio: normalizarCelda(p?.planta2_estadio), planta2_piscas: normalizarCelda(p?.planta2_piscas),
    planta3_estadio: normalizarCelda(p?.planta3_estadio), planta3_piscas: normalizarCelda(p?.planta3_piscas),
    hVle: normalizarCelda(p?.hVle), hVlq: normalizarCelda(p?.hVlq), func: normalizarCelda(p?.func),
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

  const peorH = maximo(cols.map(c => c.H_calculado))
  const parts = [
    `Muestreo de Sigatoka semana ${data.semana ?? '-'} finca ${data.nombreFinca ?? '-'}.`,
    `Plantas muestreadas: ${f(A)}.`,
    `Promedio hoja más vieja libre de estría (K): ${f(K)}.`,
    `Peor % plantas EE2 leve 1-3 (H): ${f(peorH)}%.`,
    `Peor % plantas EE2 avanzado 4+ (I): ${f(peorI)}%.`,
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

// Umbral de % EE2 leve (1-3) que dispara alerta de infección temprana extendida.
// PLACEHOLDER — confirmar con criterio agronómico de la exportadora.
export const UMBRAL_EE2_LEVE = 30

export function buildWhatsappSummary(data: SigatokaMuestreo, camposAclarar: string[]): string {
  const cols = data.resumenColumnas
  const A = cols[0]?.A ?? null
  const K = cols[0]?.K_calculado ?? null
  const peorH = maximo(cols.map(c => c.H_calculado))
  const peorI = maximo(cols.map(c => c.I_calculado))
  const peorJ = maximo(cols.map(c => c.J_calculado))
  const peorM = minimo(cols.map(c => c.M_calculado))
  const f = (v: number | null) => (v == null ? '-' : String(v))
  // EE2 (1-3) por las 3 columnas (plantas H1/H2/H3) — NO colapsar al "peor":
  // es la categoría que más varía entre plantas y la que el resumen escondía.
  const ee2LevePorPlanta = cols.length
    ? cols.map(c => (c.H_calculado == null ? '-' : `${c.H_calculado}%`)).join(' / ')
    : '-'
  const n11sem = data.plantas11sem.length

  const porPlanta = (sel: (c: ResumenColumna) => number | null): string =>
    cols.length ? cols.map(c => { const v = sel(c); return v == null ? '-' : `${v}%` }).join(' / ') : '-'

  const alertas: string[] = []
  if (peorJ != null && peorJ > 10) alertas.push(`⚠️ ${peorJ}% plantas con EE3-6 (severo) — revisar programa de fumigación`)
  if (peorI != null && peorI > 5)  alertas.push(`⚠️ ${peorI}% plantas con EE2 avanzado (4+)`)
  if (peorH != null && peorH > UMBRAL_EE2_LEVE) alertas.push(`⚠️ ${peorH}% plantas con EE2 (1-3) — infección temprana extendida`)
  if (peorM != null && peorM < 9)  alertas.push(`⚠️ Promedio hojas funcionales bajo (${peorM}) — evaluar nutrición`)

  // Estado general de un vistazo (para decidir rápido). Usa los mismos umbrales.
  const estado =
    (peorJ != null && peorJ > 10) || (peorI != null && peorI > 5)
      ? '⚠️ *CRÍTICO*'
      : (peorH != null && peorH > UMBRAL_EE2_LEVE) || (peorM != null && peorM < 9)
        ? '⚠️ *ATENCIÓN*'
        : '✅ *BAJO CONTROL*'

  // Cabecera: identidad de la ficha (lo que esté disponible).
  const meta = [
    `Semana ${data.semana ?? '-'}`,
    data.periodo != null ? `Período ${data.periodo}` : null,
    data.fecha ?? null,
  ].filter(Boolean).join(' · ')
  const supLine = [data.supervisor ? `👤 ${data.supervisor}` : null, data.zona ? `📍 ${data.zona}` : null].filter(Boolean).join(' · ')

  const pl = data.plagasFoliares
  const plagaLine = (n: string, p: { h: number | null; p: number | null; m: number | null }) =>
    `• ${n} — huevos:${p.h ?? '-'} pupas:${p.p ?? '-'} muertos:${p.m ?? '-'}`

  // Seguimiento: SOLO el conteo de 11-sem (confiable). Erradicadas BSV e índice
  // EF se extraen de la esquina inferior-derecha (densa, multi-columna sin
  // encabezados claros) donde el modelo toma celdas equivocadas → NO se muestran
  // hasta que sp-03e3 lea esa zona con confianza. Mejor omitir que mostrar mal.
  const seguimiento: string[] = []
  if (n11sem > 0) seguimiento.push(`• Plantas 11 sem evaluadas: ${n11sem}`)

  let msg =
`✅ *Muestreo Sigatoka — ${data.nombreFinca ?? 'finca'}*
📅 ${meta}${supLine ? `\n${supLine}` : ''}

🧭 Estado general: ${estado}

📊 *Severidad* (por planta H1/H2/H3 — ${f(A)} plantas)
• EE2 leve (1-3): ${ee2LevePorPlanta}
• EE2 avanzado (4+): ${porPlanta(c => c.I_calculado)}
• EE3-6 (severo): ${porPlanta(c => c.J_calculado)}
• Hoja libre de estría (prom): ${f(K)}
• Hojas funcionales (mín): ${f(peorM)}`

  if (seguimiento.length > 0) msg += `\n\n🌱 *Seguimiento*\n${seguimiento.join('\n')}`

  // Plagas foliares: solo si hay algún valor real (no mostrar 0/null — esa zona
  // de la ficha aún se lee mal y unos ceros falsos confunden al cliente).
  const algunaPlaga = [pl.ceramida, pl.sibine].some(p => [p.h, p.p, p.m].some(v => v != null && v !== 0))
  if (algunaPlaga) {
    msg += `\n\n🐛 *Plagas foliares*\n${plagaLine('Ceramida', pl.ceramida)}\n${plagaLine('Sibine', pl.sibine)}`
  }

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
