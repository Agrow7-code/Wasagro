import { z } from 'zod'

export const DiagnosticoV2VKSchema = z.object({
  diagnostico_final: z.string(),
  tipo_evento_sugerido: z.enum(['plaga', 'cosecha', 'observacion', 'infraestructura', 'calidad', 'sin_evento']),
  severidad: z.enum(['leve', 'moderada', 'severa', 'critica']).nullable().optional(),
  requiere_accion_inmediata: z.boolean(),
  recomendacion_tecnica: z.string().nullable(),
  confianza: z.number().min(0).max(1),
})

export type DiagnosticoV2VK = z.infer<typeof DiagnosticoV2VKSchema>
