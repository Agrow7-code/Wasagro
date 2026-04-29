import { z } from 'zod'

export const NormalizedMessageSchema = z.object({
  wamid: z.string(),
  from: z.string().regex(/^\d+$/, 'from debe ser E.164 — solo dígitos, sin @dominio'),
  timestamp: z.date(),
  tipo: z.enum(['texto', 'audio', 'imagen', 'ubicacion', 'documento', 'otro']),
  rawPayload: z.unknown().refine((v) => v !== undefined, 'rawPayload es requerido'),
  texto: z.string().optional(),
  audioUrl: z.string().url().optional(),
  mediaId: z.string().optional(),
  imagenUrl: z.string().url().optional(),
  latitud: z.number().optional(),
  longitud: z.number().optional(),
  documentoUrl: z.string().url().optional(),
  documentoNombre: z.string().optional(),
  documentoMimetype: z.string().optional(),
  mediaBase64: z.string().optional(),
  mediaMimetype: z.string().optional(),
})

export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>
