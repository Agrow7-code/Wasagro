import { SigatokaMuestreoSchema } from '../../types/dominio/SigatokaMuestreo.js'
import type {
  SigatokaMuestreo,
  ResumenColumna,
  PuntoMuestreoSigatoka,
  CeldaMuestra,
  AclaracionCelda,
  FilaSemana,
  TotalesSemana,
  VerificacionTabla,
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

// Columnas de la tabla de semanas que participan en el seguimiento de ilegibles.
const CELDAS_SEMANA = ['ht', 'hVle', 'q5menos', 'q5mas', 'lc'] as const

// Cuenta SOLO celdas con estado 'ilegible' (no 'vacia') y las ubica para poder
// formular la pregunta. Cubre puntos de muestra + filas de 11 y 00 semanas.
// Las filas semana usan identificador "11sem-{fila}" / "00sem-{fila}" (índice+1
// si fila es null) para el round-trip de aclaración.
// Es la señal que habilita el follow-up "preguntar al tomador" (umbral ≤5, P2).
export function contarCeldasIlegibles(
  puntos:   PuntoMuestreoSigatoka[],
  filas11:  FilaSemana[] = [],
  filas00:  FilaSemana[] = [],
): ConteoIlegibles {
  const ubicaciones: ConteoIlegibles['ubicaciones'] = []

  for (const p of puntos) {
    for (const campo of CELDAS_MUESTRA) {
      if ((p as unknown as Record<string, CeldaMuestra>)[campo]?.estado === 'ilegible') {
        ubicaciones.push({ punto: p.punto, sector: p.sector, campo })
      }
    }
  }

  const escanearFilas = (filas: FilaSemana[], prefijo: '11sem' | '00sem') => {
    filas.forEach((f, idx) => {
      const etiqueta = `${prefijo}-${f.fila ?? idx + 1}`
      for (const campo of CELDAS_SEMANA) {
        const celda = (f as unknown as Record<string, CeldaMuestra>)[campo]
        if (celda?.estado === 'ilegible') {
          ubicaciones.push({ punto: etiqueta, sector: f.sector, campo })
        }
      }
    })
  }
  escanearFilas(filas11, '11sem')
  escanearFilas(filas00, '00sem')

  const total = ubicaciones.length
  const ruta: ConteoIlegibles['ruta'] = total === 0 ? 'completo' : total <= 5 ? 'preguntar' : 'manual'
  return { total, ubicaciones, ruta }
}

// Etiqueta legible de cada celda de muestra para el mensaje al tomador.
// Cubre tanto las celdas de puntos como las columnas de filas semana.
const LABEL_CELDA: Record<string, string> = {
  planta1_estadio: 'planta 1 estadio', planta1_piscas: 'planta 1 piscas',
  planta2_estadio: 'planta 2 estadio', planta2_piscas: 'planta 2 piscas',
  planta3_estadio: 'planta 3 estadio', planta3_piscas: 'planta 3 piscas',
  hVle: 'H+VLE', hVlq: 'H+VLQ', func: 'func',
  // Columnas de tablas semana
  ht: 'H.T', q5menos: 'Q<5%', q5mas: 'Q>5%', lc: 'LC',
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
// ya leída ni inventa: ignora valor null). Cubre puntos, filas 11sem y filas 00sem.
// Identificadores: "P3" → punto, "11sem-14" → fila de 11 semanas, "00sem-3" → 00 sem.
// Recalcula requiereValidacion: true si persisten ilegibles, discrepancias o baja confianza.
export function aplicarAclaraciones(sigatoka: SigatokaMuestreo, respuestas: AclaracionCelda[]): SigatokaMuestreo {
  const puntos: PuntoMuestreoSigatoka[] = sigatoka.puntosMuestreo.map(p => ({ ...p }))
  const filas11: FilaSemana[] = (sigatoka.plantas11sem ?? []).map(f => ({ ...f }))
  const filas00: FilaSemana[] = (sigatoka.plantas00sem ?? []).map(f => ({ ...f }))

  const resolverEnFilas = (filas: FilaSemana[], punto: string, prefijo: '11sem' | '00sem', campo: string, valor: number) => {
    // Extraer el número de fila del identificador "11sem-14" → 14
    const m = punto.match(new RegExp(`^${prefijo}-(\\d+)$`))
    if (!m) return
    const numFila = parseInt(m[1]!, 10)
    // Buscar la fila por fila o por posición (idx+1 si fila es null)
    const fila = filas.find((f, idx) => (f.fila ?? idx + 1) === numFila)
    if (!fila) return
    const celdaActual = (fila as unknown as Record<string, CeldaMuestra>)[campo]
    if (celdaActual?.estado !== 'ilegible') return
    ;(fila as unknown as Record<string, CeldaMuestra>)[campo] = { valor, estado: 'leida' }
  }

  for (const r of respuestas) {
    if (r.valor == null || !Number.isFinite(r.valor)) continue
    if (!(r.campo in LABEL_CELDA)) continue

    if (r.punto.startsWith('11sem-')) {
      resolverEnFilas(filas11, r.punto, '11sem', r.campo, r.valor)
    } else if (r.punto.startsWith('00sem-')) {
      resolverEnFilas(filas00, r.punto, '00sem', r.campo, r.valor)
    } else {
      const p = puntos.find(pt => pt.punto === r.punto)
      if (!p) continue
      const celdaActual = (p as unknown as Record<string, CeldaMuestra>)[r.campo]
      if (celdaActual?.estado !== 'ilegible') continue
      ;(p as unknown as Record<string, CeldaMuestra>)[r.campo] = { valor: r.valor, estado: 'leida' }
    }
  }

  const restantes = contarCeldasIlegibles(puntos, filas11, filas00).total

  // Una celda corregida cambia la suma de su columna: el checksum persistido se
  // recalcula para que un muestreo ya corregido no quede marcado "no cuadra".
  const ver11 = sigatoka.totales11sem ? verificarChecksumTabla(filas11, sigatoka.totales11sem) : sigatoka.verificacion11sem ?? null
  const ver00 = sigatoka.totales00sem ? verificarChecksumTabla(filas00, sigatoka.totales00sem) : sigatoka.verificacion00sem ?? null

  const checksumFalla = (ver11 != null && ver11.cuadraTodo === false) || (ver00 != null && ver00.cuadraTodo === false)

  // Reconstruir camposDudosos eliminando las entradas de checksum stale y
  // regenerando solo las que siguen fallando según la verificación recalculada.
  // Las entradas que NO son de checksum (ej. "bloque DATOS incompleto", discrepancias
  // de fórmulas) se conservan intactas — no dependen de las celdas corregidas.
  const noChecksum = sigatoka.camposDudosos.filter(d => !d.startsWith('checksum '))
  const checksumActualizados: string[] = []
  if (ver11?.cuadraTodo === false) {
    for (const col of ver11.columnas.filter(c => c.cuadra === false)) {
      checksumActualizados.push(`checksum 11 semanas: ${col.columna}`)
    }
  }
  if (ver00?.cuadraTodo === false) {
    for (const col of ver00.columnas.filter(c => c.cuadra === false)) {
      checksumActualizados.push(`checksum 00 semanas: ${col.columna}`)
    }
  }
  const camposDudososActualizados = [...noChecksum, ...checksumActualizados]

  return {
    ...sigatoka,
    puntosMuestreo: puntos,
    plantas11sem: filas11,
    plantas00sem: filas00,
    verificacion11sem: ver11,
    verificacion00sem: ver00,
    camposDudosos: camposDudososActualizados,
    requiereValidacion: camposDudososActualizados.length > 0 || sigatoka.confidenceScore < 0.75 || restantes > 0 || checksumFalla,
  }
}

// Corrección explícita del asesor desde la UI (P7). A diferencia de aplicarAclaraciones,
// PUEDE pisar celdas ya leídas — es una acción humana deliberada, no una inferencia.
// Recalcula verificacion* y requiereValidacion igual que aplicarAclaraciones.
// El capturador de feedback (guardarCorreccionesSigatoka) debe llamarse desde el router
// ANTES de invocar esta función para no perder los valores previos.
export interface CorreccionCelda {
  punto: string
  campo: string
  valor: number | null
}

export interface ResultadoCorrecciones {
  sigatoka: SigatokaMuestreo
  /** Claves "punto.campo" de las correcciones que se aplicaron con éxito. */
  aplicadas: string[]
  /** Claves "punto.campo" de las correcciones que se ignoraron (punto/fila inexistente,
   *  campo desconocido, valor null/no-finito, o celda no encontrada). */
  ignoradas: string[]
}

export function aplicarCorrecciones(sigatoka: SigatokaMuestreo, correcciones: CorreccionCelda[]): ResultadoCorrecciones {
  const puntos: PuntoMuestreoSigatoka[] = sigatoka.puntosMuestreo.map(p => ({ ...p }))
  const filas11: FilaSemana[] = (sigatoka.plantas11sem ?? []).map(f => ({ ...f }))
  const filas00: FilaSemana[] = (sigatoka.plantas00sem ?? []).map(f => ({ ...f }))

  const aplicadas: string[] = []
  const ignoradas: string[] = []

  const pisarEnFilas = (filas: FilaSemana[], punto: string, prefijo: '11sem' | '00sem', campo: string, valor: number): boolean => {
    const m = punto.match(new RegExp(`^${prefijo}-(\\d+)$`))
    if (!m) return false
    const numFila = parseInt(m[1]!, 10)
    const fila = filas.find((f, idx) => (f.fila ?? idx + 1) === numFila)
    if (!fila) return false
    if (!(campo in LABEL_CELDA)) return false
    ;(fila as unknown as Record<string, CeldaMuestra>)[campo] = { valor, estado: 'leida' }
    return true
  }

  for (const c of correcciones) {
    const key = `${c.punto}.${c.campo}`
    if (c.valor == null || !Number.isFinite(c.valor)) { ignoradas.push(key); continue }
    if (!(c.campo in LABEL_CELDA)) { ignoradas.push(key); continue }

    if (c.punto.startsWith('11sem-')) {
      const ok = pisarEnFilas(filas11, c.punto, '11sem', c.campo, c.valor)
      if (ok) aplicadas.push(key); else ignoradas.push(key)
    } else if (c.punto.startsWith('00sem-')) {
      const ok = pisarEnFilas(filas00, c.punto, '00sem', c.campo, c.valor)
      if (ok) aplicadas.push(key); else ignoradas.push(key)
    } else {
      const p = puntos.find(pt => pt.punto === c.punto)
      if (!p) { ignoradas.push(key); continue }
      ;(p as unknown as Record<string, CeldaMuestra>)[c.campo] = { valor: c.valor, estado: 'leida' }
      aplicadas.push(key)
    }
  }

  const restantes = contarCeldasIlegibles(puntos, filas11, filas00).total

  const ver11 = sigatoka.totales11sem ? verificarChecksumTabla(filas11, sigatoka.totales11sem) : sigatoka.verificacion11sem ?? null
  const ver00 = sigatoka.totales00sem ? verificarChecksumTabla(filas00, sigatoka.totales00sem) : sigatoka.verificacion00sem ?? null

  const checksumFalla = (ver11 != null && ver11.cuadraTodo === false) || (ver00 != null && ver00.cuadraTodo === false)

  // Reconstruir camposDudosos eliminando las entradas de checksum stale y
  // regenerando solo las que siguen fallando según la verificación recalculada.
  // Las entradas que NO son de checksum se conservan intactas.
  const noChecksum = sigatoka.camposDudosos.filter(d => !d.startsWith('checksum '))
  const checksumActualizados: string[] = []
  if (ver11?.cuadraTodo === false) {
    for (const col of ver11.columnas.filter(c => c.cuadra === false)) {
      checksumActualizados.push(`checksum 11 semanas: ${col.columna}`)
    }
  }
  if (ver00?.cuadraTodo === false) {
    for (const col of ver00.columnas.filter(c => c.cuadra === false)) {
      checksumActualizados.push(`checksum 00 semanas: ${col.columna}`)
    }
  }
  const camposDudososActualizados = [...noChecksum, ...checksumActualizados]

  const sigatokaActualizado: SigatokaMuestreo = {
    ...sigatoka,
    puntosMuestreo: puntos,
    plantas11sem: filas11,
    plantas00sem: filas00,
    verificacion11sem: ver11,
    verificacion00sem: ver00,
    camposDudosos: camposDudososActualizados,
    requiereValidacion: camposDudososActualizados.length > 0 || sigatoka.confidenceScore < 0.75 || restantes > 0 || checksumFalla,
  }

  return { sigatoka: sigatokaActualizado, aplicadas, ignoradas }
}

// ─── Fórmulas y validación cruzada (por columna) ──────────────────────────────

export type ResumenColumnaSinCalculo = Omit<
  ResumenColumna,
  'H_calculado' | 'I_calculado' | 'J_calculado' | 'K_calculado' | 'L_calculado' | 'M_calculado'
>

const round1 = (n: number): number => parseFloat(n.toFixed(1))

// % de plantas en una categoría sobre el total muestreado (A). El conteo de la
// categoría (C/D/E) NUNCA puede exceder A → si num > den es imposible (dígito mal
// leído, ej. D=2916 con A=24) → null. No fabricamos un % imposible/válido-pero-falso
// que llegue al cliente (P1). El recálculo lo detecta y el evento va a requires_review.
const pct = (num: number | null, den: number | null): number | null =>
  num != null && den != null && den > 0 && num <= den ? round1((num / den) * 100) : null
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

// Cuenta porcentajes (H/I/J) NO verificables: calc=null porque el conteo era imposible
// (num>den, pct lo anuló) o faltaba. Un null NO es "sin error" — es "no se pudo verificar".
// Penalizarlo evita que una lectura basura (conteos imposibles → todo null → 0
// discrepancias detectadas) gane sobre una verificable con una discrepancia real.
const pctNoVerificables = (cols: ResumenColumna[]): number =>
  cols.reduce((n, c) =>
    n + (c.H_calculado == null ? 1 : 0) + (c.I_calculado == null ? 1 : 0) + (c.J_calculado == null ? 1 : 0), 0)

// Elige la mejor lectura del bloque DATOS entre la foto completa (a) y un recorte
// ampliado (b). Score = discrepancias (calc≠formulario) + porcentajes no verificables;
// MENOR gana. Una lectura con decimales/conteos correctos es consistente Y verificable.
// Empate o lectura sin 3 columnas → conserva la primera (full-frame, el baseline). Pura.
export function elegirMejorDatos(a: ResumenColumna[], b: ResumenColumna[]): ResumenColumna[] {
  if (b.length !== 3) return a
  if (a.length !== 3) return b
  const score = (cols: ResumenColumna[]): number => detectarCamposDudosos(cols).length + pctNoVerificables(cols)
  return score(b) < score(a) ? b : a
}

// ─── Incertidumbre por DESACUERDO entre dos lecturas (calibración real) ───────
// Gemini no se auto-califica (infla su confianza: marca todo 'leida'). Derivamos
// la incertidumbre del DESACUERDO entre dos lecturas independientes de la MISMA
// tabla: donde COINCIDEN conservamos el valor; donde DIFIEREN marcamos `ilegible`
// (incierta) → sale ámbar en la UI y el validador sabe exactamente qué mirar. Una
// fila presente en una sola lectura → existencia dudosa → ilegible. Pura.
const CAMPOS_SEMANA_REC = ['ht', 'hVle', 'q5menos', 'q5mas', 'lc'] as const

function valorCeldaSemana(fila: FilaSemana, campo: string): number | null {
  const c = (fila as unknown as Record<string, unknown>)[campo]
  if (c !== null && typeof c === 'object' && 'valor' in (c as object)) return (c as CeldaMuestra).valor ?? null
  return typeof c === 'number' ? c : null
}

export function reconciliarPorDesacuerdo(filasA: FilaSemana[], filasB: FilaSemana[]): { filas: FilaSemana[]; marcadas: number } {
  const n = Math.max(filasA.length, filasB.length)
  let marcadas = 0
  const filas: FilaSemana[] = []
  for (let i = 0; i < n; i++) {
    const a = filasA[i]
    const b = filasB[i]
    const base = a ?? b
    const fila: Record<string, unknown> = { fila: base?.fila ?? null, sector: base?.sector ?? null, lote_id: base?.lote_id ?? null }
    for (const campo of CAMPOS_SEMANA_REC) {
      if (a && b) {
        const va = valorCeldaSemana(a, campo)
        const vb = valorCeldaSemana(b, campo)
        if (va === vb) {
          fila[campo] = { valor: va, estado: va == null ? 'vacia' : 'leida' }
        } else {
          fila[campo] = { valor: null, estado: 'ilegible' }
          marcadas++
        }
      } else {
        fila[campo] = { valor: null, estado: 'ilegible' }
        marcadas++
      }
    }
    filas.push(fila as unknown as FilaSemana)
  }
  return { filas, marcadas }
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

// Igual que mapearSectoresALotes pero para FilaSemana (filas de tablas 11/00 sem).
export function mapearSectoresALotesFilas(
  filas: FilaSemana[],
  lotes: LoteRef[],
): FilaSemana[] {
  const indice = new Map(lotes.map(l => [normalizar(l.nombre), l.lote_id]))
  return filas.map(f => {
    if (!f.sector) return f
    return { ...f, lote_id: indice.get(normalizar(f.sector)) ?? null }
  })
}

// ─── Normalización de fila semana (para uso externo / presave) ────────────────
// Eleva un objeto crudo con columnas numéricas planas a FilaSemana con CeldaMuestra.
// Útil cuando se recibe un array de la pasada e2a/e2b sin aplicar el preprocess Zod.

const aNum2 = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    if (t === '' || t === '-') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function normalizarFilaSemana(raw: Record<string, unknown>): FilaSemana {
  const elevaCelda = (v: unknown): CeldaMuestra => {
    if (v === null || v === undefined) return { valor: null, estado: 'vacia' }
    if (typeof v === 'object' && 'estado' in (v as object)) {
      const obj = v as { valor?: unknown; estado?: unknown }
      const valor = aNum2(obj.valor)
      if (valor !== null) return { valor, estado: 'leida' }
      return { valor: null, estado: obj.estado === 'ilegible' ? 'ilegible' : 'vacia' }
    }
    const n = aNum2(v)
    return n !== null ? { valor: n, estado: 'leida' } : { valor: null, estado: 'vacia' }
  }
  return {
    fila:    typeof raw['fila'] !== 'undefined' ? (aNum2(raw['fila']) ?? null) : null,
    sector:  typeof raw['sector'] === 'string' ? raw['sector'] : null,
    lote_id: typeof raw['lote_id'] === 'string' ? raw['lote_id'] : null,
    ht:      elevaCelda(raw['ht']),
    hVle:    elevaCelda(raw['hVle']),
    q5menos: elevaCelda(raw['q5menos']),
    q5mas:   elevaCelda(raw['q5mas']),
    lc:      elevaCelda(raw['lc']),
  }
}

// ─── Checksum de tabla (T= vs suma de filas) ───────────────────────────────────
// Verifica si las sumas de las filas de una tabla cuadran con los totales T=
// que el supervisor calculó a mano en la ficha. Tolerancia ±1 (redondeo).
// Resultado determinista, null-safe. Nunca lanza.
export function verificarChecksumTabla(
  filas: FilaSemana[],
  totales: TotalesSemana,
): VerificacionTabla {
  type ColKey = 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc'
  const columnas: ColKey[] = ['ht', 'hVle', 'q5menos', 'q5mas', 'lc']

  const resultado = columnas.map(col => {
    let suma = 0
    for (const f of filas) {
      const celda = (f as unknown as Record<string, CeldaMuestra>)[col]
      const v = celda?.valor
      if (typeof v === 'number' && Number.isFinite(v)) suma += v
    }
    const totalFicha = totales[col]
    const cuadra = totalFicha !== null && totalFicha !== undefined
      ? Math.abs(suma - totalFicha) <= 1
      : null
    return { columna: col, sumaFilas: suma, totalFicha: totalFicha ?? null, cuadra }
  })

  // cuadraTodo: true si todas las col con total cuadran; false si alguna no cuadra;
  // null si ninguna tiene total legible (no se pudo verificar nada).
  const conTotal = resultado.filter(c => c.cuadra !== null)
  const cuadraTodo = conTotal.length === 0
    ? null
    : conTotal.every(c => c.cuadra === true)

  return { columnas: resultado, cuadraTodo }
}

// ─── Helpers de cobertura y selección de tabla ───────────────────────────────

// Cuenta filas con al menos un valor numérico leído. Mide cobertura real
// para desempatar entre dos lecturas con el mismo score de checksum.
export function filasConDato(fs: FilaSemana[]): number {
  return fs.filter(f =>
    (['ht', 'hVle', 'q5menos', 'q5mas', 'lc'] as const).some(k => (f as unknown as Record<string, CeldaMuestra>)[k]?.valor != null)
  ).length
}

// Tipo interno para representar un resultado de pasada de tabla de semanas.
export interface ResultadoTabla {
  filas: FilaSemana[]
  totales: TotalesSemana | null
  promedios: TotalesSemana | null
}

// Elige la mejor de dos lecturas (crop vs full-frame, o retry vs original).
// Reglas en orden de prioridad:
//   1. Uno es null/sin filas → el otro gana.
//   2. Preferir cuadraTodo===true (checksum perfecto).
//   3. Desempate: más columnas con cuadra===true.
//   4. Desempate final: más filas con dato.
// Determinista. Nunca lanza.
export function elegirMejorTabla(
  a: ResultadoTabla | null,
  b: ResultadoTabla | null,
  totalesRef: TotalesSemana | null,
): ResultadoTabla | null {
  if (!a || a.filas.length === 0) return b ?? null
  if (!b || b.filas.length === 0) return a

  const totRef = totalesRef ?? a.totales ?? b.totales
  const verA = totRef ? verificarChecksumTabla(a.filas, totRef) : null
  const verB = totRef ? verificarChecksumTabla(b.filas, totRef) : null

  // Criterio 2: cuadraTodo
  const cuadraA = verA?.cuadraTodo === true
  const cuadraB = verB?.cuadraTodo === true
  if (cuadraA && !cuadraB) return a
  if (cuadraB && !cuadraA) return b

  // Criterio 3: columnas que cuadran
  const colsA = verA ? verA.columnas.filter(c => c.cuadra === true).length : 0
  const colsB = verB ? verB.columnas.filter(c => c.cuadra === true).length : 0
  if (colsA !== colsB) return colsA > colsB ? a : b

  // Criterio 4: filas con dato
  return filasConDato(a.filas) >= filasConDato(b.filas) ? a : b
}

// ─── Reconciliación cross-field (corrector-oráculo, Etapa A) ──────────────────
// En la ficha LOGBAN, ciertas columnas son casi idénticas por fila. Validado: H.T
// (ht) ≈ Q>5% (q5mas) — sus totales T= coinciden. Cuando el modelo lee una distinta
// de la otra en una fila, una está mal; el total T= dice cuál confiar.
// SOLO relaciones VERIFICADAS — una relación falsa corregiría mal (P1). Y SIEMPRE
// con doble compuerta: adoptar la corrección únicamente si hace cuadrar el total.
const CORRELACIONES_SEMANA: ReadonlyArray<readonly [keyof Pick<FilaSemana, 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc'>, keyof Pick<FilaSemana, 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc'>]> = [
  ['ht', 'q5mas'],
]

const valorCelda = (f: FilaSemana, k: string): number | null =>
  (f as unknown as Record<string, CeldaMuestra>)[k]?.valor ?? null

const cuadraColumna = (filas: FilaSemana[], totales: TotalesSemana, col: string): boolean | null =>
  verificarChecksumTabla(filas, totales).columnas.find(c => c.columna === col)?.cuadra ?? null

const sumaColumnaExacta = (filas: FilaSemana[], col: string): number =>
  filas.reduce((s, f) => s + (valorCelda(f, col) ?? 0), 0)

// Devuelve filas reconciliadas + las celdas corregidas ("ht[3]"). Solo aplica una
// corrección cuando hace que esa columna cuadre EXACTO con su T= (doble compuerta).
export function reconciliarCrossField(
  filas: FilaSemana[],
  totales: TotalesSemana | null,
): { filas: FilaSemana[]; corregidas: string[] } {
  if (!totales) return { filas, corregidas: [] }
  let out = filas.map(f => ({ ...f }))
  const corregidas: string[] = []

  for (const [a, b] of CORRELACIONES_SEMANA) {
    // Probar en ambas direcciones: la columna que no cuadra toma la otra donde difieren.
    for (const [target, source] of [[a, b], [b, a]] as const) {
      if (totales[target] == null) continue
      if (cuadraColumna(out, totales, target) !== false) continue // ya cuadra o sin total

      const cand = out.map(f => {
        const tv = valorCelda(f, target), sv = valorCelda(f, source)
        return tv != null && sv != null && tv !== sv
          ? { ...f, [target]: { valor: sv, estado: 'leida' as const, origen: 'cross_field' as const } }
          : f
      })
      // Doble compuerta ESTRICTA: adoptar SOLO si la suma da EXACTO el T= (no ±1).
      // Con la tolerancia ±1, si el correlato también tiene un error de 1, la copia
      // podría "cuadrar" falso y meter un valor incorrecto (P1). Exigir exacto cierra
      // ese hueco: solo adoptamos cuando la corrección reconstruye el total al dígito.
      const tTotal = totales[target]
      if (tTotal != null && sumaColumnaExacta(cand, target) === tTotal) {
        cand.forEach((f, i) => {
          if (valorCelda(f, target) !== valorCelda(out[i]!, target)) corregidas.push(`${target}[${i}]`)
        })
        out = cand
      }
    }
  }
  return { filas: out, corregidas }
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
  const sanPlaga = (p: any) => ({ h: num(p?.h), p: num(p?.p), m: num(p?.m), g: num(p?.g) ?? null })

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
    // FilaSemanaSchema tiene preprocess que eleva números planos → backward compat OK
    plantas11sem: arr(j.plantas11sem),
    plantas00sem: arr(j.plantas00sem),
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

// ─── Umbrales de severidad (alertas + estado general) ────────────────────────
// Estos 4 valores deciden qué se le ALERTA al cliente y el estado general del
// muestreo. Son criterio AGRONÓMICO, no técnico: el valor correcto lo fija el
// agrónomo de la exportadora. Hasta esa confirmación operan con estos defaults.
// Per-finca: pasar `umbrales` a buildWhatsappSummary cuando exista ese dato (D18,
// umbrales por finca) — cada exportadora puede tener su propio criterio.
export interface UmbralesSeveridad {
  ee3a6Severo: number          // J: % plantas EE3-6 (severo) → CRÍTICO + revisar fumigación
  ee2Avanzado: number          // I: % plantas EE2 avanzado (4+) → CRÍTICO
  ee2Leve: number              // H: % plantas EE2 (1-3) → ATENCIÓN (PLACEHOLDER)
  hojasFuncionalesMin: number  // M: mínimo de hojas funcionales → ATENCIÓN si por debajo
}

export const UMBRALES_SEVERIDAD_DEFAULT: UmbralesSeveridad = {
  ee3a6Severo: 10,
  ee2Avanzado: 5,
  // SILENCED BY DEFAULT (101 > the max possible H of 100, so it never fires): ee2Leve
  // was a placeholder (30) with no agronomic backing. Shipping it would alert paying
  // clients on an unvalidated signal (P7, D29). It stays off until a finca/org configures
  // a real value via the umbrales_alerta table (D34).
  ee2Leve: 101,
  hojasFuncionalesMin: 9,
}

// Retrocompat: el umbral suelto que antes era una constante. Apunta al default.
export const UMBRAL_EE2_LEVE = UMBRALES_SEVERIDAD_DEFAULT.ee2Leve

// Etiqueta humana de cada columna de tabla semana para el veredicto de checksum.
const LABEL_COLUMNA_SEMANA: Record<string, string> = {
  ht:      'H.T',
  hVle:    'H+VLE',
  q5menos: 'Q<5%',
  q5mas:   'Q>5%',
  lc:      'LC',
}

export function buildWhatsappSummary(
  data: SigatokaMuestreo,
  umbrales: UmbralesSeveridad = UMBRALES_SEVERIDAD_DEFAULT,
): string {
  const cols = data.resumenColumnas
  // #6 — Severidad provisional: el bloque DATOS (columnas H/I/J/K/M) es la fuente
  // de los números de severidad. Si alguna de esas columnas no cuadra (calculado ≠
  // formulario), la severidad mostrada es incierta y NO debe leerse como alarma
  // confirmada — se marca provisional para evitar una falsa alarma al cliente (P1).
  const datosDudosos = detectarCamposDudosos(cols)
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

  const porPlanta = (sel: (c: ResumenColumna) => number | null): string =>
    cols.length ? cols.map(c => { const v = sel(c); return v == null ? '-' : `${v}%` }).join(' / ') : '-'

  const alertas: string[] = []
  if (peorJ != null && peorJ > umbrales.ee3a6Severo) alertas.push(`⚠️ ${peorJ}% plantas con EE3-6 (severo) — revisar programa de fumigación`)
  if (peorI != null && peorI > umbrales.ee2Avanzado) alertas.push(`⚠️ ${peorI}% plantas con EE2 avanzado (4+)`)
  if (peorH != null && peorH > umbrales.ee2Leve) alertas.push(`⚠️ ${peorH}% plantas con EE2 (1-3) — infección temprana extendida`)
  if (peorM != null && peorM < umbrales.hojasFuncionalesMin)  alertas.push(`⚠️ Promedio hojas funcionales bajo (${peorM}) — evaluar nutrición`)

  // Estado general de un vistazo (para decidir rápido). Usa los mismos umbrales.
  // Guard (Tarea 2): con < 3 columnas no se puede afirmar "BAJO CONTROL" — la
  // pasada e1 solo leyó parte del bloque DATOS. Se bloquea ese estado.
  const estadoCalculado =
    (peorJ != null && peorJ > umbrales.ee3a6Severo) || (peorI != null && peorI > umbrales.ee2Avanzado)
      ? '⚠️ *CRÍTICO*'
      : (peorH != null && peorH > umbrales.ee2Leve) || (peorM != null && peorM < umbrales.hojasFuncionalesMin)
        ? '⚠️ *ATENCIÓN*'
        : '✅ *BAJO CONTROL*'
  const estado = cols.length < 3 && estadoCalculado === '✅ *BAJO CONTROL*'
    ? '⚠️ *LECTURA INCOMPLETA — revisar*'
    : estadoCalculado

  // Cabecera: identidad de la ficha (lo que esté disponible).
  const meta = [
    `Semana ${data.semana ?? '-'}`,
    data.periodo != null ? `Período ${data.periodo}` : null,
    data.fecha ?? null,
  ].filter(Boolean).join(' · ')
  const supLine = [data.supervisor ? `👤 ${data.supervisor}` : null, data.zona ? `📍 ${data.zona}` : null].filter(Boolean).join(' · ')

  const pl = data.plagasFoliares
  // Incluye G (adultos) cuando tiene valor — se omite si null para no mostrar ruido.
  const plagaLine = (n: string, p: { h: number | null; p: number | null; m: number | null; g?: number | null }) => {
    const base = `• ${n} — huevos:${p.h ?? '-'} pupas:${p.p ?? '-'} muertos:${p.m ?? '-'}`
    return p.g != null ? `${base} g:${p.g}` : base
  }

  // ─── Seguimiento reestructurado (Tarea 1) ────────────────────────────────────
  // Cada tabla tiene su propio sub-bloque: título + veredicto inline + promedios
  // indentados. Erradicadas/EF van en línea separada como "Finca:".
  const seguimientoLineas: string[] = []

  // Plantas EVALUADAS = filas con algún dato, no el largo del array: la tabla tiene
  // renglones numerados que pueden quedar en blanco; contarlos infla el número que
  // ve el tomador (ej. "24 plantas" cuando se evaluaron 19).
  const n11sem = filasConDato(data.plantas11sem ?? [])
  const n00sem = filasConDato(data.plantas00sem ?? [])

  const promediosSemana = (pr: typeof data.promedios11sem): string | null => {
    if (!pr) return null
    return [
      pr.ht   != null ? `H.T ${pr.ht}`   : null,
      pr.hVle != null ? `H+VLE ${pr.hVle}` : null,
      pr.lc   != null ? `LC ${pr.lc}`     : null,
    ].filter(Boolean).join(' · ') || null
  }

  const veredictoInline = (ver: typeof data.verificacion11sem): string => {
    if (ver == null) return ''
    if (ver.cuadraTodo === true)  return ' ✅'
    if (ver.cuadraTodo === false) return ' ⚠️'
    return ''
  }

  if (n11sem > 0) {
    const vi = veredictoInline(data.verificacion11sem)
    seguimientoLineas.push(`*11 semanas* — ${n11sem} plantas${vi}`)
    const pr = promediosSemana(data.promedios11sem)
    if (pr) seguimientoLineas.push(`  ${pr}`)
  }
  if (n00sem > 0) {
    const vi = veredictoInline(data.verificacion00sem)
    seguimientoLineas.push(`*00 semanas* — ${n00sem} plantas${vi}`)
    const pr = promediosSemana(data.promedios00sem)
    if (pr) seguimientoLineas.push(`  ${pr}`)
  }

  const fincaItems = [
    data.erradicadasBsv != null ? `Erradicadas BSV ${data.erradicadasBsv}` : null,
    data.pEfFinca       != null ? `Índice EF ${data.pEfFinca}`             : null,
  ].filter(Boolean)
  if (fincaItems.length > 0) seguimientoLineas.push(`*Finca:* ${fincaItems.join(' · ')}`)

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

  // #6 — caveat justo bajo la severidad cuando el bloque DATOS no cuadra.
  if (datosDudosos.length > 0) msg += `\n⚠️ Severidad provisional — en revisión`

  if (seguimientoLineas.length > 0) msg += `\n\n🌱 *Seguimiento*\n${seguimientoLineas.join('\n')}`

  // Plagas foliares: solo si hay algún valor real (no mostrar 0/null — esa zona
  // de la ficha aún se lee mal y unos ceros falsos confunden al cliente).
  const algunaPlaga = [pl.ceramida, pl.sibine].some(p => [p.h, p.p, p.m, p.g].some(v => v != null && v !== 0))
  if (algunaPlaga) {
    msg += `\n\n🐛 *Plagas foliares*\n${plagaLine('Ceramida', pl.ceramida)}\n${plagaLine('Sibine', pl.sibine)}`
  }

  // ─── Veredicto de checksum (Tarea 1 — reemplaza el bloque anterior) ──────────
  // Una línea de detalle POR TABLA que falla, con nombre legible, etiqueta humana
  // de columna (LABEL_COLUMNA_SEMANA) y los números accionables (sumaFilas/totalFicha).
  // Si TODAS las tablas verificadas cuadran → una sola línea ✅ global.
  type VerEntry = { nombre: string; ver: VerificacionTabla }
  const verificationes: VerEntry[] = []
  if (data.verificacion11sem != null) verificationes.push({ nombre: '11 semanas', ver: data.verificacion11sem })
  if (data.verificacion00sem != null) verificationes.push({ nombre: '00 semanas', ver: data.verificacion00sem })

  if (verificationes.length > 0) {
    const fallidas = verificationes.filter(x => x.ver.cuadraTodo === false)
    if (fallidas.length === 0) {
      // Todas las tablas verificadas cuadran
      msg += '\n\n✅ Cuadra con los totales de la ficha'
    } else {
      const lineas = fallidas.flatMap(({ nombre, ver }) => {
        const colsNoOK = ver.columnas.filter(c => c.cuadra === false)
        return colsNoOK.map(c => {
          const etiqueta = LABEL_COLUMNA_SEMANA[c.columna] ?? c.columna
          return `⚠️ ${nombre}: ${etiqueta} no cuadra (suma ${c.sumaFilas} · ficha ${c.totalFicha})`
        })
      })
      msg += '\n\n' + lineas.join('\n')
    }
  }

  if (alertas.length > 0) msg += '\n\n' + alertas.join('\n')
  if (data.camposDudosos.length > 0) {
    // Honesto: una discrepancia es entre el recálculo (fuente confiable, desde
    // los conteos crudos) y el total escrito a mano. No le preguntamos al tomador
    // por esto ni prometemos un follow-up que no existe — lo deriva el asesor.
    // #3 — el conteo sale de la lista COMPLETA (data.camposDudosos), no de un slice
    // capado a 2: antes el disclaimer decía "2 valores" aunque hubiera 12 (undercount).
    const n = data.camposDudosos.length
    const plural = n > 1
    msg += `\n\n⚠️ ${n} valor${plural ? 'es' : ''} no ${plural ? 'cuadran' : 'cuadra'} con las cuentas — usé el recálculo y tu asesor lo revisa.`
  }
  return msg
}
