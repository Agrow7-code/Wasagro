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

export interface ContextoOnboardingAgricultor {
  historial: Array<{ rol: 'usuario' | 'agente'; contenido: string }>
  paso_actual: number
  datos_recolectados: Record<string, unknown>
  fincas_disponibles: string
}

const DatosExtraidosOnboardingSchema = z.object({
  nombre: z.string().nullable().optional(),
  rol: z.string().nullable().optional(),
  consentimiento: z.boolean().nullable().optional(),
  finca_nombre: z.string().nullable().optional(),
  finca_ubicacion_texto: z.string().nullable().optional(),
  finca_lat: z.number().nullable().optional(),
  finca_lng: z.number().nullable().optional(),
  cultivo_principal: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  lotes: z.array(z.object({
    nombre_coloquial: z.string(),
    hectareas: z.number().nullable(),
  })).optional(),
  finca_id: z.string().nullable().optional(),
}).optional()

export const RespuestaOnboardingSchema = z.object({
  paso_completado: z.number().int(),
  siguiente_paso: z.number().int(),
  datos_extraidos: DatosExtraidosOnboardingSchema,
  status_usuario: z.enum(['pendiente_aprobacion', 'activo', 'rechazado']).optional(),
  notificar_jefe: z.boolean().optional(),
  mensaje_para_usuario: z.string(),
  onboarding_completo: z.boolean(),
})

export type RespuestaOnboarding = z.infer<typeof RespuestaOnboardingSchema>
export type DatosExtraidosOnboarding = z.infer<typeof DatosExtraidosOnboardingSchema>
