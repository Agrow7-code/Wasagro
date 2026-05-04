import { z } from 'zod'
import type { ForecastSemanal } from '../../integrations/weather/OpenMeteoClient.js'

export const ResumenSemanalSchema = z.object({
  semana:            z.string(),
  finca_id:          z.string(),
  total_eventos:     z.number().int(),
  eventos_por_tipo:  z.record(z.string(), z.number()).optional(),
  alertas: z.array(z.object({
    tipo:        z.string(),
    descripcion: z.string(),
    severidad:   z.enum(['baja', 'media', 'alta']),
  })),
  resumen_narrativo:  z.string(),
  requiere_atencion:  z.boolean(),
  es_solo_informativo: z.literal(true),
})

export type ResumenSemanal = z.infer<typeof ResumenSemanalSchema>

export interface EventoResumenRow {
  tipo_evento:     string
  fecha_evento:    string | null
  lote_id:         string | null
  datos_evento:    Record<string, unknown>
  descripcion_raw: string
  confidence_score: number
  status:          string
}

export interface EntradaResumenSemanal {
  finca_id:          string
  finca_nombre:      string
  cultivo_principal: string
  pais?:             string
  fecha_inicio:      string
  fecha_fin:         string
  eventos:           EventoResumenRow[]
  forecast?:         ForecastSemanal | null
}
