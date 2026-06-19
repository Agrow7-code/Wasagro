// Eval harness de extracción Sigatoka (CR5 / D32). Consume las correcciones
// humanas (extraído-vs-corregido) y reporta DÓNDE falla la extracción y cuántos
// errores fueron "confiados" (el modelo leyó un valor y estaba MAL, sin avisar)
// vs "ilegibles completados" (el modelo avisó honestamente que no podía leer).
// Los errores confiados son los peligrosos: se cuelan porque nada los marca.
// Núcleo PURO → testeable sin DB; la query vive en supabaseQueries.

export type Seccion = 'matriz' | 'sem11' | 'sem00' | 'otro'

// Subset estructural de una fila de `sigatoka_correcciones` que el análisis necesita.
export interface CorreccionEval {
  punto: string
  campo: string
  estado_extraido: string | null
  valor_extraido: number | null
  valor_corregido: number | null
}

export interface ConteoSeccion { errores: number; confiados: number }

export interface ReporteEval {
  total: number                 // celdas tocadas por el humano
  errores: number               // el valor cambió (extraído ≠ corregido)
  erroresConfiados: number      // estado_extraido='leida' Y cambió → modelo confiado pero MAL
  ilegiblesCompletados: number  // estado_extraido='ilegible' → el modelo avisó
  porSeccion: Record<Seccion, ConteoSeccion>
}

// La sección sale del prefijo del `punto`: "11sem-14" / "00sem-3" / "P1".."P19".
export function seccionDeCorreccion(punto: string): Seccion {
  if (punto.startsWith('11sem-')) return 'sem11'
  if (punto.startsWith('00sem-')) return 'sem00'
  if (/^P\d/.test(punto)) return 'matriz'
  return 'otro'
}

const esError = (c: CorreccionEval): boolean => c.valor_extraido !== c.valor_corregido

export function analizarCorrecciones(correcciones: CorreccionEval[]): ReporteEval {
  const seccionVacia = (): ConteoSeccion => ({ errores: 0, confiados: 0 })
  const porSeccion: Record<Seccion, ConteoSeccion> = {
    matriz: seccionVacia(), sem11: seccionVacia(), sem00: seccionVacia(), otro: seccionVacia(),
  }

  let errores = 0
  let erroresConfiados = 0
  let ilegiblesCompletados = 0

  for (const c of correcciones) {
    if (!esError(c)) continue
    errores++
    const confiado = c.estado_extraido === 'leida'
    const ilegible = c.estado_extraido === 'ilegible'
    if (confiado) erroresConfiados++
    if (ilegible) ilegiblesCompletados++

    const sec = porSeccion[seccionDeCorreccion(c.punto)]
    sec.errores++
    if (confiado) sec.confiados++
  }

  return { total: correcciones.length, errores, erroresConfiados, ilegiblesCompletados, porSeccion }
}

// ─── Comparación de dos extracciones (loop de re-extracción) ──────────────────
// Re-corremos la extracción sobre la imagen guardada y comparamos contra el
// ground-truth (el muestreo ya corregido por el humano). Mide celdas mal Y filas
// faltantes/de más por sección — las faltantes son el bug de filas omitidas.

const CAMPOS_MATRIZ = [
  'planta1_estadio', 'planta1_piscas', 'planta2_estadio', 'planta2_piscas',
  'planta3_estadio', 'planta3_piscas', 'hVle', 'hVlq', 'func',
] as const
const CAMPOS_SEMANA = ['ht', 'hVle', 'q5menos', 'q5mas', 'lc'] as const

// Lee el valor numérico de una celda tolerando { valor, estado } o número plano.
function valorDe(row: Record<string, unknown>, campo: string): number | null {
  const c = row[campo]
  if (c !== null && typeof c === 'object' && 'valor' in (c as object)) {
    const v = (c as { valor: number | null }).valor
    return v ?? null
  }
  return typeof c === 'number' ? c : null
}

// Estado de lectura de la celda. Forma vieja (número plano) ⟹ 'leida'.
function estadoDe(row: Record<string, unknown>, campo: string): string | null {
  const c = row[campo]
  if (c !== null && typeof c === 'object' && 'estado' in (c as object)) {
    return (c as { estado: string }).estado
  }
  return typeof c === 'number' ? 'leida' : null
}

export interface ConteoComp {
  celdasMal: number
  silenciosas: number   // mismatch donde el modelo leyó 'leida' pero mal — lo peligroso (calibración debe bajarlo)
  marcadas: number      // mismatch donde el modelo marcó 'ilegible' — flag honesto (mejor que silencioso)
  filasFaltantes: number
  filasDeMas: number
  celdasComparadas: number
}
export interface ReporteComparacion {
  porSeccion: { matriz: ConteoComp; sem11: ConteoComp; sem00: ConteoComp }
  totalCeldasMal: number
  totalSilenciosas: number
  totalFilasFaltantes: number
}

export interface MuestreoComparable {
  puntosMuestreo?: Array<Record<string, unknown>>
  plantas11sem?: Array<Record<string, unknown>>
  plantas00sem?: Array<Record<string, unknown>>
}

function compararFilas(
  nuevo: Array<Record<string, unknown>>,
  verdad: Array<Record<string, unknown>>,
  campos: readonly string[],
  claveDe: (row: Record<string, unknown>, idx: number) => string,
): ConteoComp {
  const c: ConteoComp = { celdasMal: 0, silenciosas: 0, marcadas: 0, filasFaltantes: 0, filasDeMas: 0, celdasComparadas: 0 }
  const mapNuevo = new Map(nuevo.map((r, i) => [claveDe(r, i), r]))
  const clavesVerdad = new Set<string>()

  verdad.forEach((v, i) => {
    const k = claveDe(v, i)
    clavesVerdad.add(k)
    const n = mapNuevo.get(k)
    if (!n) { c.filasFaltantes++; return } // el ground-truth la tiene, la re-extracción NO
    for (const campo of campos) {
      c.celdasComparadas++
      if (valorDe(n, campo) !== valorDe(v, campo)) {
        c.celdasMal++
        // ¿el modelo lo marcó honestamente (ilegible) o lo reportó confiado (leida)?
        if (estadoDe(n, campo) === 'ilegible') c.marcadas++
        else c.silenciosas++
      }
    }
  })
  nuevo.forEach((r, i) => { if (!clavesVerdad.has(claveDe(r, i))) c.filasDeMas++ })
  return c
}

// Distribución de estados de lectura en UNA extracción (sin ground-truth).
// Métrica directa de calibración: cuántas celdas el modelo marca 'ilegible' vs
// 'leida'. La calibración del 00sem debe SUBIR `ilegible` (admite la duda) en vez
// de adivinar. Robusto a desalineación de filas (no compara contra otra cosa).
export interface DistSeccion { leida: number; ilegible: number; vacia: number }

function distribucionFilas(filas: Array<Record<string, unknown>>, campos: readonly string[]): DistSeccion {
  const d: DistSeccion = { leida: 0, ilegible: 0, vacia: 0 }
  for (const f of filas) {
    for (const campo of campos) {
      const e = estadoDe(f, campo)
      if (e === 'leida') d.leida++
      else if (e === 'ilegible') d.ilegible++
      else if (e === 'vacia') d.vacia++
    }
  }
  return d
}

export function distribucionEstados(m: MuestreoComparable): { matriz: DistSeccion; sem11: DistSeccion; sem00: DistSeccion } {
  return {
    matriz: distribucionFilas(m.puntosMuestreo ?? [], CAMPOS_MATRIZ),
    sem11: distribucionFilas(m.plantas11sem ?? [], CAMPOS_SEMANA),
    sem00: distribucionFilas(m.plantas00sem ?? [], CAMPOS_SEMANA),
  }
}

export function compararMuestreos(nuevo: MuestreoComparable, verdad: MuestreoComparable): ReporteComparacion {
  const porPunto = (r: Record<string, unknown>, i: number) => String(r['punto'] ?? `i${i}`)
  const porFila = (r: Record<string, unknown>, i: number) => (r['fila'] != null ? `f${r['fila']}` : `i${i}`)

  const porSeccion = {
    matriz: compararFilas(nuevo.puntosMuestreo ?? [], verdad.puntosMuestreo ?? [], CAMPOS_MATRIZ, porPunto),
    sem11: compararFilas(nuevo.plantas11sem ?? [], verdad.plantas11sem ?? [], CAMPOS_SEMANA, porFila),
    sem00: compararFilas(nuevo.plantas00sem ?? [], verdad.plantas00sem ?? [], CAMPOS_SEMANA, porFila),
  }
  const totalCeldasMal = porSeccion.matriz.celdasMal + porSeccion.sem11.celdasMal + porSeccion.sem00.celdasMal
  const totalSilenciosas = porSeccion.matriz.silenciosas + porSeccion.sem11.silenciosas + porSeccion.sem00.silenciosas
  const totalFilasFaltantes = porSeccion.matriz.filasFaltantes + porSeccion.sem11.filasFaltantes + porSeccion.sem00.filasFaltantes
  return { porSeccion, totalCeldasMal, totalSilenciosas, totalFilasFaltantes }
}
