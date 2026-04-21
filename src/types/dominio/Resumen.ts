import { z } from 'zod'

export const ResumenSemanalSchema = z.object({
  semana: z.string(),
  finca_id: z.string(),
  total_eventos: z.number().int(),
  eventos_por_tipo: z.record(z.string(), z.number()),
  alertas: z.array(z.object({
    tipo: z.string(),
    descripcion: z.string(),
    severidad: z.enum(['baja', 'media', 'alta']),
  })),
  resumen_narrativo: z.string(),
  requiere_atencion: z.boolean(),
})

export type ResumenSemanal = z.infer<typeof ResumenSemanalSchema>
