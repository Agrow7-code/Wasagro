import { z } from 'zod'

const CampoConConfianza = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ valor: schema.nullable(), confidence_score: z.number().min(0).max(1) })

export const EventoCampoExtraidoSchema = z.object({
  tipo_evento: CampoConConfianza(z.string()),
  lote_id: CampoConConfianza(z.string()),
  fecha: CampoConConfianza(z.string()),
  producto: CampoConConfianza(z.string()),
  dosis: CampoConConfianza(z.number()),
  unidad_dosis: CampoConConfianza(z.string()),
  area_hectareas: CampoConConfianza(z.number()),
  observaciones: CampoConConfianza(z.string()),
  requiere_validacion: z.boolean(),
})

export type EventoCampoExtraido = z.infer<typeof EventoCampoExtraidoSchema>

export const EntradaEventoSchema = z.object({
  transcripcion: z.string(),
  finca_id: z.string(),
  usuario_id: z.string(),
})

export type EntradaEvento = z.infer<typeof EntradaEventoSchema>
