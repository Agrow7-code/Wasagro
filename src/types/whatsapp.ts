import { z } from 'zod'

export const WhatsAppMessageSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      value: z.object({
        messaging_product: z.literal('whatsapp'),
        metadata: z.object({
          display_phone_number: z.string(),
          phone_number_id: z.string(),
        }),
        contacts: z.array(z.object({
          profile: z.object({ name: z.string() }),
          wa_id: z.string(),
        })).optional(),
        messages: z.array(z.object({
          from: z.string(),
          id: z.string(),
          timestamp: z.string(),
          type: z.enum(['text', 'audio', 'image', 'document']),
          text: z.object({ body: z.string() }).optional(),
          audio: z.object({ id: z.string(), mime_type: z.string() }).optional(),
          image: z.object({ id: z.string(), mime_type: z.string(), caption: z.string().optional() }).optional(),
          referral: z.object({
            source_url: z.string().optional(),
            source_type: z.string().optional(),
            source_id: z.string().optional(),
            headline: z.string().optional(),
            body: z.string().optional(),
          }).optional(),
        })).optional(),
      }),
      field: z.string(),
    })),
  })),
})

export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>
