import { describe, expect, it, vi } from 'vitest'
import {
  OpenAICompatibleEmbeddingService,
  OllamaEmbeddingService,
  EMBEDDING_DIMENSIONS,
} from '../../../src/integrations/llm/EmbeddingService.js'

const FAKE_EMBEDDING = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS)

function mockOpenAIClient(embedding = FAKE_EMBEDDING) {
  return {
    embeddings: {
      create: vi.fn().mockResolvedValue({ data: [{ embedding }] }),
    },
  }
}

describe('OpenAICompatibleEmbeddingService', () => {
  it('genera un embedding con las dimensiones configuradas', async () => {
    const client = mockOpenAIClient()
    const svc = new OpenAICompatibleEmbeddingService(client as never, 'baai/bge-m3', EMBEDDING_DIMENSIONS)

    const result = await svc.generarEmbedding('Apliqué Roundup en el lote 3')

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(client.embeddings.create).toHaveBeenCalledWith({
      model: 'baai/bge-m3',
      input: 'Apliqué Roundup en el lote 3',
      dimensions: EMBEDDING_DIMENSIONS,
    })
  })

  it('lanza error si el cliente devuelve lista vacía', async () => {
    const client = { embeddings: { create: vi.fn().mockResolvedValue({ data: [] }) } }
    const svc = new OpenAICompatibleEmbeddingService(client as never, 'baai/bge-m3')

    await expect(svc.generarEmbedding('texto')).rejects.toThrow()
  })

  it('propaga el error si el cliente falla', async () => {
    const client = {
      embeddings: { create: vi.fn().mockRejectedValue(new Error('rate limit')) },
    }
    const svc = new OpenAICompatibleEmbeddingService(client as never, 'baai/bge-m3')

    await expect(svc.generarEmbedding('texto')).rejects.toThrow('rate limit')
  })
})

describe('OllamaEmbeddingService', () => {
  it('llama al endpoint de Ollama y devuelve el embedding', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ embedding: FAKE_EMBEDDING }),
    })
    const svc = new OllamaEmbeddingService('http://localhost:11434', 'mxbai-embed-large', mockFetch as never)

    const result = await svc.generarEmbedding('Cosechamos 30 quintales')

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/embeddings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ model: 'mxbai-embed-large', prompt: 'Cosechamos 30 quintales' }),
    }))
  })

  it('lanza error si Ollama responde con error HTTP', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const svc = new OllamaEmbeddingService('http://localhost:11434', 'mxbai-embed-large', mockFetch as never)

    await expect(svc.generarEmbedding('texto')).rejects.toThrow('HTTP 500')
  })

  it('lanza error si Ollama no devuelve campo embedding', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    })
    const svc = new OllamaEmbeddingService('http://localhost:11434', 'mxbai-embed-large', mockFetch as never)

    await expect(svc.generarEmbedding('texto')).rejects.toThrow('embedding')
  })
})
