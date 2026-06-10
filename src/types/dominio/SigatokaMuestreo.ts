import { z } from 'zod'

// ─── Coerción numérica tolerante ──────────────────────────────────────────────
// Los modelos de visión devuelven números como string ("6.6"), con coma decimal,
// o vacíos. Convertimos a number; lo no-numérico → null. Nunca rompe el parse:
// el dato se rescata en vez de tirar la ficha entera (P1).
const aNumero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    if (t === '' || t === '-') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}
const numNullable = () => z.preprocess(aNumero, z.number().nullable())

// ─── Estado por celda (I5) ────────────────────────────────────────────────────
// Cada celda de MUESTRA lleva valor + estado de lectura. Distinguir 'vacia'
// (punto no muestreado, null legítimo) de 'ilegible' (hay algo escrito que el
// modelo no pudo leer) es lo que habilita el "preguntar al tomador" sin molestar
// por celdas en blanco a propósito (P2). 'leida' ⟺ valor presente.
export const EstadoCeldaSchema = z.enum(['leida', 'vacia', 'ilegible'])
export type EstadoCelda = z.infer<typeof EstadoCeldaSchema>

export const CeldaMuestraSchema = z.object({
  valor:  numNullable(),
  estado: EstadoCeldaSchema,
})
export type CeldaMuestra = z.infer<typeof CeldaMuestraSchema>

// Respuesta del tomador a una celda ilegible (follow-up "preguntar al tomador").
// `valor` null = no la respondió / no se pudo interpretar → la celda sigue ilegible.
export const AclaracionCeldaSchema = z.object({
  punto: z.string(),
  campo: z.string(),
  valor: z.number().nullable(),
})
export type AclaracionCelda = z.infer<typeof AclaracionCeldaSchema>

export const AclaracionSigatokaSchema = z.object({
  aclaraciones: z.array(AclaracionCeldaSchema),
})
export type AclaracionSigatoka = z.infer<typeof AclaracionSigatokaSchema>

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const PuntoMuestreoSigatokaSchema = z.object({
  punto: z.string(),

  // Sector del bloque al que pertenece el punto. En la ficha aparece como un
  // rótulo manuscrito entre las filas P (ej. "Corrijal", "arrastradero"). El
  // EventHandler lo resuelve contra los lotes registrados de la finca → lote_id.
  sector:  z.string().nullable(),
  lote_id: z.string().nullable(),

  // Cada fila "P" registra 3 plantas. Las tres columnas "H" mapean a una planta
  // c/u. Valores como "2(3)" llevan dos números distintos:
  //   principal (2) = estadio de Sigatoka → planta{N}_estadio
  //   paréntesis (3) = piscas/lesiones    → planta{N}_piscas
  // Cada una es una CeldaMuestra ({ valor, estado }) — ver I5 arriba.
  planta1_estadio: CeldaMuestraSchema,
  planta1_piscas:  CeldaMuestraSchema,
  planta2_estadio: CeldaMuestraSchema,
  planta2_piscas:  CeldaMuestraSchema,
  planta3_estadio: CeldaMuestraSchema,
  planta3_piscas:  CeldaMuestraSchema,

  hVle: CeldaMuestraSchema,
  hVlq: CeldaMuestraSchema,
  func: CeldaMuestraSchema,

  marcaEspecial: z.string().nullable(),
})

export const PlantaNumeradaSchema = z.object({
  numero:        z.preprocess(v => aNumero(v) ?? 0, z.number()),
  nuevaOVieja:   z.preprocess(aNumero, z.union([z.literal(0), z.literal(1)]).nullable()),
  efPasada:      numNullable(),
  efActual:      numNullable(),
  referencia:    numNullable(),
  marcaEspecial: z.string().nullable(),
})

// El bloque DATOS de la ficha repite A..M para CADA una de las 3 plantas (las
// tres columnas "H"). C/D/E/H/I/J difieren por columna (distribución de estadios
// por posición de planta); A/B/F/G/K/L/M suelen repetirse. Modelamos una columna
// completa por planta para no perder el peor caso (ej. una columna con J=95%).
// Todo nullable: una celda ilegible nunca debe tumbar la extracción (P1).
export const ResumenColumnaSchema = z.object({
  A: numNullable(),
  B: numNullable(),
  C: numNullable(),
  D: numNullable(),
  E: numNullable(),
  F: numNullable(),
  G: numNullable(),

  H_formulario: numNullable(),
  I_formulario: numNullable(),
  J_formulario: numNullable(),
  K_formulario: numNullable(),
  L_formulario: numNullable(),
  M_formulario: numNullable(),

  // Recalculado por Wasagro: H=(C/A)·100 | I=(D/A)·100 | J=(E/A)·100
  //                          K=B/A | L=F/A | M=G/A
  // null cuando faltan los insumos (no se divide por un desconocido).
  H_calculado: z.number().nullable(),
  I_calculado: z.number().nullable(),
  J_calculado: z.number().nullable(),
  K_calculado: z.number().nullable(),
  L_calculado: z.number().nullable(),
  M_calculado: z.number().nullable(),
})

// ─── FilaSemanaSchema — tabla PLANTAS DE 11/00 SEMANAS ────────────────────────
// Reemplaza el uso de Planta11SemanaSchema (números planos) para filas:
// cada columna de la fila es un CeldaMuestra ({ valor, estado }) para
// habilitar el follow-up "preguntar al tomador" sobre celdas ilegibles.
//
// Backward compat: el preprocess eleva la forma vieja (número plano o null)
// a CeldaMuestra. Objetos {valor,estado} pasan intactos. Filas sin los campos
// fila/sector/lote_id (persistidas antes de esta migración) → null en esos campos.

const elevaCelda = (v: unknown): unknown => {
  if (v === null || v === undefined) return { valor: null, estado: 'vacia' }
  if (typeof v === 'object' && 'estado' in (v as object)) return v
  const n = aNumero(v)
  return n !== null ? { valor: n, estado: 'leida' } : { valor: null, estado: 'vacia' }
}

export const FilaSemanaSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return raw
    const r = raw as Record<string, unknown>
    return {
      fila:    r['fila']    !== undefined ? (aNumero(r['fila']) ?? null) : null,
      sector:  r['sector']  !== undefined ? (typeof r['sector'] === 'string' ? r['sector'] : null) : null,
      lote_id: r['lote_id'] !== undefined ? (typeof r['lote_id'] === 'string' ? r['lote_id'] : null) : null,
      ht:      elevaCelda(r['ht']),
      hVle:    elevaCelda(r['hVle']),
      q5menos: elevaCelda(r['q5menos']),
      q5mas:   elevaCelda(r['q5mas']),
      lc:      elevaCelda(r['lc']),
    }
  },
  z.object({
    fila:    z.number().int().positive().nullable(),
    sector:  z.string().nullable(),
    lote_id: z.string().nullable(),
    ht:      CeldaMuestraSchema,
    hVle:    CeldaMuestraSchema,
    q5menos: CeldaMuestraSchema,
    q5mas:   CeldaMuestraSchema,
    lc:      CeldaMuestraSchema,
  }),
)
export type FilaSemana = z.infer<typeof FilaSemanaSchema>

// Totales de pie de tabla (fila T=) y promedios (fila Pr=). Capturados por
// las pasadas e2a/e2b como campos separados, NUNCA como filas de planta (P1).
export const TotalesSemanaSchema = z.object({
  ht:      numNullable(),
  hVle:    numNullable(),
  q5menos: numNullable(),
  q5mas:   numNullable(),
  lc:      numNullable(),
})
export type TotalesSemana = z.infer<typeof TotalesSemanaSchema>

// Resultado de verificar si las sumas de filas cuadran con el total T= de la ficha.
// Lo calcula Wasagro (no el LLM). Persiste en datos_evento.sigatoka.
// null = sin totales legibles (no se pudo verificar).
export const ColumnaChecksumSchema = z.object({
  columna:    z.string(),
  sumaFilas:  z.number(),
  totalFicha: z.number().nullable(),
  cuadra:     z.boolean().nullable(), // null = totalFicha es null
})

export const VerificacionTablaSchema = z.object({
  columnas:   z.array(ColumnaChecksumSchema),
  cuadraTodo: z.boolean().nullable(), // true si todas las col con total cuadran
})
export type VerificacionTabla = z.infer<typeof VerificacionTablaSchema>

// Planta11SemanaSchema se mantiene como alias backward-compat. El tipo real
// de plantas11sem/plantas00sem es ahora FilaSemana.
export const Planta11SemanaSchema = FilaSemanaSchema

export const PlagaFoliarSchema = z.object({
  h: numNullable(),
  p: numNullable(),
  m: numNullable(),
  // Columna G (adultos) de ceramida/sibine — presente en la ficha LOGBAN SGI F09R902
  // pero previamente no capturada. Default null para backward compat con datos
  // persistidos antes de esta migración (campo ausente → null, no undefined).
  g: numNullable().default(null),
})

export const PlagasFoliaresSchema = z.object({
  ceramida: PlagaFoliarSchema,
  sibine:   PlagaFoliarSchema,
})

// ─── Top-level schema ─────────────────────────────────────────────────────────

export const SigatokaMuestreoSchema = z.object({
  confidenceScore:    z.preprocess(v => aNumero(v) ?? 0, z.number().min(0).max(1)),
  requiereValidacion: z.boolean(),
  camposDudosos:      z.array(z.string()),

  // Identidad nullable: recuperable del contexto de la finca / fecha del mensaje;
  // un header ilegible no debe bloquear la captura de la matriz.
  zona:        z.string().nullable(),
  codigoFinca: z.string().nullable(),
  nombreFinca: z.string().nullable(),
  semana:      z.preprocess(aNumero, z.number().int().min(1).max(53).nullable()),
  periodo:     z.preprocess(aNumero, z.number().int().nullable()),
  fecha:       z.string().nullable(),
  supervisor:  z.string().nullable(),

  puntosMuestreo:  z.array(PuntoMuestreoSigatokaSchema),
  plantas:         z.array(PlantaNumeradaSchema),
  resumenColumnas: z.array(ResumenColumnaSchema),

  // Tablas de semanas — ya NO optional (default []).
  // FilaSemanaSchema tiene backward compat con la forma plana anterior.
  plantas11sem: z.array(FilaSemanaSchema),
  plantas00sem: z.array(FilaSemanaSchema).default([]),

  // Totales y promedios de pie de tabla, capturados por pasadas e2a/e2b.
  totales11sem:   TotalesSemanaSchema.nullable().optional(),
  promedios11sem: TotalesSemanaSchema.nullable().optional(),
  totales00sem:   TotalesSemanaSchema.nullable().optional(),
  promedios00sem: TotalesSemanaSchema.nullable().optional(),

  // Resultado de verificación de checksum — calculado por Wasagro, no el LLM.
  // null = sin totales legibles / omitido = no se ejecutó aún.
  verificacion11sem: VerificacionTablaSchema.nullable().optional(),
  verificacion00sem: VerificacionTablaSchema.nullable().optional(),

  plagasFoliares:  PlagasFoliaresSchema,

  // Diferidos (I9/I10/I11): se capturan si el modelo los ve, pero sin lógica por
  // ahora. Opcionales para no perder la foto ni cargar el extractor.
  pEfFinca:       numNullable().optional(),
  pEfFincaT:      numNullable().optional(), // T= de P-EF-FINCA
  pEfFincaFrec:   numNullable().optional(), // Frec (días) de P-EF-FINCA
  erradicadasBsv: numNullable().optional(),
})

export type SigatokaMuestreo       = z.infer<typeof SigatokaMuestreoSchema>
export type PuntoMuestreoSigatoka  = z.infer<typeof PuntoMuestreoSigatokaSchema>
export type PlantaNumerada         = z.infer<typeof PlantaNumeradaSchema>
export type ResumenColumna         = z.infer<typeof ResumenColumnaSchema>
export type PlagaFoliar            = z.infer<typeof PlagaFoliarSchema>
export type PlagasFoliares         = z.infer<typeof PlagasFoliaresSchema>
