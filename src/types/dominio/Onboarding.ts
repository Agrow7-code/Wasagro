import { z } from 'zod'

export const ContextoConversacionSchema = z.object({
  historial: z.array(z.object({
    rol: z.enum(['usuario', 'agente']),
    contenido: z.string(),
  })),
  preguntas_realizadas: z.number().int().min(0),
  datos_recolectados: z.record(z.string(), z.unknown()),
})

export type ContextoConversacion = z.infer<typeof ContextoConversacionSchema>

export const RespuestaOnboardingSchema = z.object({
  mensaje: z.string(),
  onboarding_completo: z.boolean(),
  datos_finca: z.object({
    nombre: z.string().nullable(),
    cultivo: z.enum(['cacao', 'banano', 'otro']).nullable(),
    pais: z.enum(['Ecuador', 'Guatemala', 'otro']).nullable(),
    hectareas: z.number().nullable(),
  }).optional(),
  siguiente_pregunta: z.string().nullable(),
})

export type RespuestaOnboarding = z.infer<typeof RespuestaOnboardingSchema>
