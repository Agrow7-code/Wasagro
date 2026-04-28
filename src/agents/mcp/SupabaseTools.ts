import { supabase } from '../../integrations/supabase.js'
import type { ToolDef } from '../../integrations/llm/ILLMAdapter.js'

export interface SupabaseMCPTool extends ToolDef {
  execute: (args: Record<string, any>) => Promise<any>
}

export const SupabaseTools: SupabaseMCPTool[] = [
  {
    name: 'obtener_lotes_finca',
    description: 'Busca la lista de lotes registrados en la finca del agricultor. Úsalo cuando el agricultor mencione un lote y necesites validar si existe o conocer su nombre exacto.',
    parameters: {
      type: 'object',
      properties: {
        finca_id: { type: 'string', description: 'El ID de la finca del usuario.' }
      },
      required: ['finca_id']
    },
    execute: async (args) => {
      const { finca_id } = args
      if (!finca_id) throw new Error('finca_id es requerido')
      
      const { data, error } = await supabase
        .from('lotes')
        .select('id, nombre_coloquial, hectareas')
        .eq('finca_id', finca_id)
        .eq('activo', true)
        
      if (error) throw new Error(`Error Supabase: ${error.message}`)
      return data && data.length > 0 ? data : 'No hay lotes registrados en esta finca.'
    }
  },
  {
    name: 'consultar_inventario_insumos',
    description: 'Consulta el stock actual de insumos (agroquímicos, fertilizantes) en la bodega de la finca. Úsalo para saber si un producto aplicado realmente estaba en stock o para extraer su nombre exacto.',
    parameters: {
      type: 'object',
      properties: {
        finca_id: { type: 'string', description: 'El ID de la finca.' },
        busqueda: { type: 'string', description: 'Opcional. Término de búsqueda (ej. nombre del producto).' }
      },
      required: ['finca_id']
    },
    execute: async (args) => {
      const { finca_id, busqueda } = args
      if (!finca_id) throw new Error('finca_id es requerido')

      let query = supabase
        .from('inventario_insumos')
        .select('producto, cantidad, unidad_medida, categoria')
        .eq('finca_id', finca_id)
        .gt('cantidad', 0)

      if (busqueda) {
        query = query.ilike('producto', `%${busqueda}%`)
      }

      const { data, error } = await query.limit(10)
      if (error) throw new Error(`Error Supabase: ${error.message}`)
      return data && data.length > 0 ? data : `No hay stock disponible${busqueda ? ` para '${busqueda}'` : ''}.`
    }
  }
]
