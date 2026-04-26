import { describe, expect, it, vi } from 'vitest'
import { RAGRetriever } from '../../../src/agents/rag/RAGRetriever.js'
import type { IEmbeddingService } from '../../../src/integrations/llm/EmbeddingService.js'

const FAKE_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024)

function mockEmbeddingService(): IEmbeddingService {
  return { generarEmbedding: vi.fn().mockResolvedValue(FAKE_EMBEDDING) }
}

function mockSupabaseClient(rows: object[] = []) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  return { rpc }
}

const BASE_ROWS = [
  {
    id: 'ev-1',
    tipo_evento: 'insumo',
    descripcion_raw: 'Apliqué Roundup 2L en lote norte',
    fecha_evento: '2026-03-10',
    similitud: 0.92,
  },
  {
    id: 'ev-2',
    tipo_evento: 'labor',
    descripcion_raw: 'Chapiaron el lote 2 hoy',
    fecha_evento: '2026-03-08',
    similitud: 0.85,
  },
]

describe('RAGRetriever', () => {
  it('devuelve string vacío si no hay eventos similares', async () => {
    const retriever = new RAGRetriever(mockEmbeddingService(), mockSupabaseClient() as never)
    const ctx = await retriever.recuperarContexto('F001', 'Apliqué pesticida')

    expect(ctx).toBe('')
  })

  it('formatea los eventos recuperados en texto estructurado', async () => {
    const retriever = new RAGRetriever(
      mockEmbeddingService(),
      mockSupabaseClient(BASE_ROWS) as never,
    )
    const ctx = await retriever.recuperarContexto('F001', 'Apliqué algo en el lote norte')

    expect(ctx).toContain('Roundup')
    expect(ctx).toContain('insumo')
    expect(ctx).toContain('2026-03-10')
  })

  it('llama a buscar_eventos_similares con finca_id y embedding correctos', async () => {
    const embSvc = mockEmbeddingService()
    const db = mockSupabaseClient(BASE_ROWS)
    const retriever = new RAGRetriever(embSvc, db as never)

    await retriever.recuperarContexto('F001', 'texto de prueba', { k: 3 })

    expect(db.rpc).toHaveBeenCalledWith('buscar_eventos_similares', {
      p_finca_id: 'F001',
      p_embedding: `[${FAKE_EMBEDDING.join(',')}]`,
      p_limit: 3,
      p_threshold: expect.any(Number),
    })
  })

  it('devuelve string vacío si el embedding service falla', async () => {
    const embSvc: IEmbeddingService = {
      generarEmbedding: vi.fn().mockRejectedValue(new Error('timeout')),
    }
    const retriever = new RAGRetriever(embSvc, mockSupabaseClient(BASE_ROWS) as never)
    const ctx = await retriever.recuperarContexto('F001', 'texto')

    expect(ctx).toBe('')
  })

  it('devuelve string vacío si Supabase devuelve error', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }) }
    const retriever = new RAGRetriever(mockEmbeddingService(), db as never)
    const ctx = await retriever.recuperarContexto('F001', 'texto')

    expect(ctx).toBe('')
  })
})
