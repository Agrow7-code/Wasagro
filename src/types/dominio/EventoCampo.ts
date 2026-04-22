import { z } from 'zod'

export const EventoCampoExtraidoSchema = z.object({
  tipo_evento: z.enum(['labor', 'insumo', 'plaga', 'clima', 'cosecha', 'gasto', 'observacion']),
  lote_id: z.string().nullable(),
  fecha_evento: z.string().nullable(),
  confidence_score: z.number().min(0).max(1),
  campos_extraidos: z.record(z.unknown()),
  confidence_por_campo: z.record(z.number()),
  campos_faltantes: z.array(z.string()),
  requiere_clarificacion: z.boolean(),
  pregunta_sugerida: z.string().nullable(),
})

export type EventoCampoExtraido = z.infer<typeof EventoCampoExtraidoSchema>

export const EntradaEventoSchema = z.object({
  transcripcion: z.string(),
  finca_id: z.string(),
  usuario_id: z.string(),
  finca_nombre: z.string().optional(),
  cultivo_principal: z.string().optional(),
  pais: z.string().optional(),
  lista_lotes: z.string().optional(),
})

export type EntradaEvento = z.infer<typeof EntradaEventoSchema>
