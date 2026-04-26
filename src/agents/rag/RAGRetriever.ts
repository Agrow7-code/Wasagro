import type { SupabaseClient } from '@supabase/supabase-js'
import type { IEmbeddingService } from '../../integrations/llm/EmbeddingService.js'

interface EventoSimilar {
  id: string
  tipo_evento: string
  descripcion_raw: string
  fecha_evento: string
  similitud: number
}

interface RecuperarContextoOptions {
  k?: number
  threshold?: number
}

export class RAGRetriever {
  constructor(
    private readonly embeddingService: IEmbeddingService,
    private readonly db: Pick<SupabaseClient, 'rpc'>,
  ) {}

  async recuperarContexto(
    finca_id: string,
    transcripcion: string,
    options: RecuperarContextoOptions = {},
  ): Promise<string> {
    const { k = 5, threshold = 0.75 } = options

    try {
      const embedding = await this.embeddingService.generarEmbedding(transcripcion)

      const { data, error } = await this.db.rpc('buscar_eventos_similares', {
        p_finca_id: finca_id,
        p_embedding: `[${embedding.join(',')}]`,
        p_limit: k,
        p_threshold: threshold,
      })

      if (error || !data || (data as EventoSimilar[]).length === 0) return ''

      return this.#formatear(data as EventoSimilar[])
    } catch (err) {
      console.error('[RAGRetriever] Error recuperando contexto:', err)
      return ''
    }
  }

  #formatear(eventos: EventoSimilar[]): string {
    const lineas = eventos.map(
      (e) => `- [${e.fecha_evento}] ${e.tipo_evento}: "${e.descripcion_raw}"`,
    )
    return `Eventos similares registrados en esta finca:\n${lineas.join('\n')}`
  }
}
