import { z } from 'zod'

export const EventoCampoExtraidoSchema = z.object({
  tipo_evento: z.enum(['labor', 'insumo', 'plaga', 'clima', 'cosecha', 'gasto', 'calidad', 'venta', 'inventario', 'infraestructura', 'observacion', 'nota_libre', 'sin_evento']),
  lote_id: z.string().nullable(),
  lote_detectado_raw: z.string().nullable().default(null),
  fecha_evento: z.string().nullable(),
  confidence_score: z.number().min(0).max(1),
  requiere_validacion: z.boolean().default(false),
  alerta_urgente: z.boolean().default(false),
  campos_extraidos: z.record(z.unknown()),
  confidence_por_campo: z.record(z.number()),
  campos_faltantes: z.array(z.string()),
  requiere_clarificacion: z.boolean(),
  pregunta_sugerida: z.string().nullable().optional(),
})

export type EventoCampoExtraido = z.infer<typeof EventoCampoExtraidoSchema>

export const ExtraccionMultiEventoSchema = z.object({
  eventos: z.array(EventoCampoExtraidoSchema),
  pregunta_sugerida: z.string().nullable().optional(),
})

export type ExtraccionMultiEvento = z.infer<typeof ExtraccionMultiEventoSchema>

const TipoEventoForzadoEnum = z.enum([
  'labor', 'insumo', 'plaga', 'clima', 'cosecha', 'gasto',
  'calidad', 'venta', 'inventario', 'infraestructura', 'observacion', 'nota_libre',
])

export const EntradaEventoSchema = z.object({
  transcripcion: z.string(),
  finca_id: z.string(),
  usuario_id: z.string(),
  nombre_usuario: z.string().optional(),
  finca_nombre: z.string().optional(),
  cultivo_principal: z.string().optional(),
  pais: z.string().optional(),
  lista_lotes: z.string().optional(),
  tipo_forzado: TipoEventoForzadoEnum.optional(),
  tipos_forzados: z.array(TipoEventoForzadoEnum).optional(), // Añadido para forzar múltiples tipos
  contexto_rag: z.string().optional(),
  estado_parcial: z.array(EventoCampoExtraidoSchema).optional(), // Workspace JSON con los eventos en borrador
})

export type EntradaEvento = z.infer<typeof EntradaEventoSchema>

export function sinEvento(mensaje: string): ExtraccionMultiEvento {
  return {
    eventos: [{
      tipo_evento: 'sin_evento',
      lote_id: null,
      lote_detectado_raw: null,
      fecha_evento: null,
      confidence_score: 1.0,
      requiere_validacion: false,
      alerta_urgente: false,
      campos_extraidos: {},
      confidence_por_campo: {},
      campos_faltantes: [],
      requiere_clarificacion: false,
    }],
    pregunta_sugerida: mensaje,
  }
}

