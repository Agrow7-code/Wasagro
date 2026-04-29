import { z } from 'zod'

export const RegistroOCRSchema = z.object({
  fila: z.number().int().min(1),
  lote_raw: z.string().nullable(),
  lote_id: z.string().nullable(),
  actividad: z.string().nullable(),
  producto: z.string().nullable(),
  cantidad: z.union([z.number(), z.string().transform(v => {
    const n = Number(v)
    return isNaN(n) ? null : n
  })]).nullable(),
  unidad: z.string().nullable(),
  trabajadores: z.union([z.number(), z.string().transform(v => {
    const n = Number(v)
    return isNaN(n) ? null : n
  })]).nullable(),
  monto: z.union([z.number(), z.string().transform(v => {
    const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
    return isNaN(n) ? null : n
  })]).nullable(),
  fecha_raw: z.string().nullable(),
  notas: z.string().nullable(),
  ilegible: z.boolean().default(false),
})

export type RegistroOCR = z.infer<typeof RegistroOCRSchema>

export const ResultadoOCRSchema = z.object({
  tipo_documento: z.enum(['planilla_aplicacion', 'registro_cosecha', 'registro_gastos', 'cuaderno_campo', 'otro']),
  fecha_documento: z.string().nullable(),
  registros: z.array(RegistroOCRSchema),
  texto_completo_visible: z.string().min(0),
  confianza_lectura: z.number().min(0).max(1),
  advertencia: z.string().nullable(),
})

export type ResultadoOCR = z.infer<typeof ResultadoOCRSchema>

export const TipoDocumentoOCRSchema = z.enum([
  'planilla_aplicacion',
  'registro_cosecha',
  'registro_gastos',
  'cuaderno_campo',
  'otro',
])

export type TipoDocumentoOCR = z.infer<typeof TipoDocumentoOCRSchema>
