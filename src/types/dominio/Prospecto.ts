import { z } from 'zod'

export const RespuestaProspectoSchema = z.object({
  paso_completado: z.number(),
  siguiente_paso: z.number(),
  tipo_contacto: z.enum(['trabajador', 'decision_maker', 'otro', 'sin_clasificar']),
  datos_extraidos: z.object({
    nombre: z.string().nullable(),
    finca_nombre: z.string().nullable(),
    cultivo_principal: z.string().nullable(),
    pais: z.string().nullable(),
    tamanio_aproximado: z.string().nullable(),
    interes_demo: z.boolean(),
    horario_preferido: z.string().nullable().optional(),
  }),
  enviar_link_demo: z.boolean().optional().default(false),
  guardar_en_prospectos: z.boolean(),
  mensaje_para_usuario: z.string(),
})

export interface ContextoProspecto {
  historial: Array<{ rol: 'usuario' | 'agente'; contenido: string }>
  paso_actual: number
  datos_recopilados: Record<string, unknown>
}

export type RespuestaProspecto = z.infer<typeof RespuestaProspectoSchema>
