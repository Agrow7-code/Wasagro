import { z } from 'zod'

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const PuntoMuestreoSigatokaSchema = z.object({
  punto: z.string(),

  // Each "P" row records 3 plants. The three "H" columns map to one plant each.
  // Cell values like "2(3)" carry two distinct numbers:
  //   principal (2) = Sigatoka stage   → planta{N}_estadio
  //   parenthesis (3) = piscas/lesions → planta{N}_piscas
  // Never collapse them into a single field.
  planta1_estadio: z.number().nullable(),
  planta1_piscas:  z.number().nullable(),
  planta2_estadio: z.number().nullable(),
  planta2_piscas:  z.number().nullable(),
  planta3_estadio: z.number().nullable(),
  planta3_piscas:  z.number().nullable(),

  hVle: z.number().nullable(),
  hVlq: z.number().nullable(),
  func: z.number().nullable(),

  // PR / T / EF marks live in the N/V column. Keep them raw — the calc layer
  // ignores marcaEspecial and only consumes nuevaOVieja when it's 0|1.
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

export const ResumenSigatokaSchema = z.object({
  A: z.number(),
  B: z.number(),
  C: z.number(),
  D: z.number(),
  E: z.number(),
  F: z.number(),
  G: z.number(),

  H_formulario: z.number().nullable(),
  I_formulario: z.number().nullable(),
  J_formulario: z.number().nullable(),
  K_formulario: z.number().nullable(),
  L_formulario: z.number().nullable(),
  M_formulario: z.number().nullable(),

  // Recomputed by Wasagro to surface supervisor arithmetic errors.
  // H=(C/A)·100 | I=(D/A)·100 | J=(E/A)·100 | K=B/A | L=F/A | M=G/A
  H_calculado: z.number(),
  I_calculado: z.number(),
  J_calculado: z.number(),
  K_calculado: z.number(),
  L_calculado: z.number(),
  M_calculado: z.number(),
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

  zona:        z.string(),
  codigoFinca: z.string(),
  nombreFinca: z.string(),
  semana:      z.number().int().min(1).max(52),
  periodo:     z.number().int(),
  fecha:       z.string(),
  supervisor:  z.string().nullable(),

  puntosMuestreo: z.array(PuntoMuestreoSigatokaSchema),
  plantas:        z.array(PlantaNumeradaSchema),
  resumen:        ResumenSigatokaSchema,
  plantas11sem:   z.array(Planta11SemanaSchema),
  plagasFoliares: PlagasFoliaresSchema,
})

export type SigatokaMuestreo       = z.infer<typeof SigatokaMuestreoSchema>
export type PuntoMuestreoSigatoka  = z.infer<typeof PuntoMuestreoSigatokaSchema>
export type PlantaNumerada         = z.infer<typeof PlantaNumeradaSchema>
export type ResumenSigatoka        = z.infer<typeof ResumenSigatokaSchema>
export type Planta11Semana         = z.infer<typeof Planta11SemanaSchema>
export type PlagaFoliar            = z.infer<typeof PlagaFoliarSchema>
export type PlagasFoliares         = z.infer<typeof PlagasFoliaresSchema>
