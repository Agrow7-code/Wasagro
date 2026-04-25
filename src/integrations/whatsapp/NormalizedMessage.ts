import { z } from 'zod'

export const NormalizedMessageSchema = z.object({
  wamid: z.string(),
  from: z.string().regex(/^\d+$/, 'from debe ser E.164 — solo dígitos, sin @dominio'),
  timestamp: z.date(),
  tipo: z.enum(['texto', 'audio', 'imagen', 'ubicacion', 'otro']),
  rawPayload: z.unknown().refine((v) => v !== undefined, 'rawPayload es requerido'),
  texto: z.string().optional(),
  audioUrl: z.string().url().optional(),
  mediaId: z.string().optional(),
  imagenUrl: z.string().url().optional(),
  latitud: z.number().optional(),
  longitud: z.number().optional(),
})

export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>
