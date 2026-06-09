import { z } from 'zod'

// ─── Estado por celda (I5) ────────────────────────────────────────────────────
// Cada celda de MUESTRA lleva valor + estado de lectura. Distinguir 'vacia'
// (punto no muestreado, null legítimo) de 'ilegible' (hay algo escrito que el
// modelo no pudo leer) es lo que habilita el "preguntar al tomador" sin molestar
// por celdas en blanco a propósito (P2). 'leida' ⟺ valor presente.
export const EstadoCeldaSchema = z.enum(['leida', 'vacia', 'ilegible'])
export type EstadoCelda = z.infer<typeof EstadoCeldaSchema>

export const CeldaMuestraSchema = z.object({
  valor:  z.number().nullable(),
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
  numero:        z.number(),
  nuevaOVieja:   z.union([z.literal(0), z.literal(1)]).nullable(),
  efPasada:      z.number().nullable(),
  efActual:      z.number().nullable(),
  referencia:    z.number().nullable(),
  marcaEspecial: z.string().nullable(),
})

// El bloque DATOS de la ficha repite A..M para CADA una de las 3 plantas (las
// tres columnas "H"). C/D/E/H/I/J difieren por columna (distribución de estadios
// por posición de planta); A/B/F/G/K/L/M suelen repetirse. Modelamos una columna
// completa por planta para no perder el peor caso (ej. una columna con J=95%).
// Todo nullable: una celda ilegible nunca debe tumbar la extracción (P1).
export const ResumenColumnaSchema = z.object({
  A: z.number().nullable(),
  B: z.number().nullable(),
  C: z.number().nullable(),
  D: z.number().nullable(),
  E: z.number().nullable(),
  F: z.number().nullable(),
  G: z.number().nullable(),

  H_formulario: z.number().nullable(),
  I_formulario: z.number().nullable(),
  J_formulario: z.number().nullable(),
  K_formulario: z.number().nullable(),
  L_formulario: z.number().nullable(),
  M_formulario: z.number().nullable(),

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

export const Planta11SemanaSchema = z.object({
  ht:      z.number().nullable(),
  hVle:    z.number().nullable(),
  q5menos: z.number().nullable(),
  q5mas:   z.number().nullable(),
  lc:      z.number().nullable(),
})

export const PlagaFoliarSchema = z.object({
  h: z.number().nullable(),
  p: z.number().nullable(),
  m: z.number().nullable(),
})

export const PlagasFoliaresSchema = z.object({
  ceramida: PlagaFoliarSchema,
  sibine:   PlagaFoliarSchema,
})

// ─── Top-level schema ─────────────────────────────────────────────────────────

export const SigatokaMuestreoSchema = z.object({
  confidenceScore:    z.number().min(0).max(1),
  requiereValidacion: z.boolean(),
  camposDudosos:      z.array(z.string()),

  // Identidad nullable: recuperable del contexto de la finca / fecha del mensaje;
  // un header ilegible no debe bloquear la captura de la matriz.
  zona:        z.string().nullable(),
  codigoFinca: z.string().nullable(),
  nombreFinca: z.string().nullable(),
  semana:      z.number().int().min(1).max(53).nullable(),
  periodo:     z.number().int().nullable(),
  fecha:       z.string().nullable(),
  supervisor:  z.string().nullable(),

  puntosMuestreo:  z.array(PuntoMuestreoSigatokaSchema),
  plantas:         z.array(PlantaNumeradaSchema),
  resumenColumnas: z.array(ResumenColumnaSchema),
  plantas11sem:    z.array(Planta11SemanaSchema),
  plagasFoliares:  PlagasFoliaresSchema,

  // Diferidos (I9/I10/I11): se capturan si el modelo los ve, pero sin lógica por
  // ahora. Opcionales para no perder la foto ni cargar el extractor.
  plantas00sem:   z.array(Planta11SemanaSchema).optional(),
  pEfFinca:       z.number().nullable().optional(),
  erradicadasBsv: z.number().nullable().optional(),
})

export type SigatokaMuestreo       = z.infer<typeof SigatokaMuestreoSchema>
export type PuntoMuestreoSigatoka  = z.infer<typeof PuntoMuestreoSigatokaSchema>
export type PlantaNumerada         = z.infer<typeof PlantaNumeradaSchema>
export type ResumenColumna         = z.infer<typeof ResumenColumnaSchema>
export type Planta11Semana         = z.infer<typeof Planta11SemanaSchema>
export type PlagaFoliar            = z.infer<typeof PlagaFoliarSchema>
export type PlagasFoliares         = z.infer<typeof PlagasFoliaresSchema>
