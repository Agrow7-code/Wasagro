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
  source_context: z.string().optional(),
  // founder-crm PR5: true when this event is an Evolution `fromMe` echo (the
  // founder's own linked device, or our own send). `from` still carries the
  // RECIPIENT (key.remoteJid), never the founder's own number. Messages with
  // esFromMe=true must NEVER reach the normal inbound pipeline
  // (procesarMensajeEntrante/handleEvento) — see src/webhook/router.ts.
  esFromMe: z.boolean().optional(),
})

export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>
