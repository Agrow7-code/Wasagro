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
