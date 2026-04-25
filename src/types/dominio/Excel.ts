import { z } from 'zod'

export const ClasificacionExcelSchema = z.object({
  tipo_datos: z.enum(['insumo', 'labor', 'cosecha', 'plaga', 'clima', 'gasto', 'calidad', 'venta', 'inventario', 'mixto', 'desconocido']),
  filas_detectadas: z.number().int().min(0),
  columnas_detectadas: z.array(z.string()),
  cultivo_detectado: z.string().nullable(),
  confianza: z.number().min(0).max(1),
  mensaje_confirmacion: z.string(),
})

export type ClasificacionExcel = z.infer<typeof ClasificacionExcelSchema>

export interface FilaExcel {
  [columna: string]: string | number | null
}

export interface EntradaClasificacionExcel {
  nombre_archivo: string
  columnas: string[]
  muestra_filas: FilaExcel[]
  total_filas: number
  finca_nombre?: string
  cultivo_principal?: string
}
