import OpenAI from 'openai'

export interface IEmbeddingService {
  generarEmbedding(text: string): Promise<number[]>
}

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const NVIDIA_EMBED_MODEL = 'baai/bge-m3'
const OLLAMA_EMBED_MODEL = 'mxbai-embed-large'
export const EMBEDDING_DIMENSIONS = 1024

// Works with OpenAI, NVIDIA NIM, or any OpenAI-compatible embedding endpoint
export class OpenAICompatibleEmbeddingService implements IEmbeddingService {
  constructor(
    private readonly client: Pick<OpenAI, 'embeddings'>,
    private readonly model: string,
    private readonly dimensions: number = EMBEDDING_DIMENSIONS,
  ) {}

  async generarEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    })

    const embedding = response.data[0]?.embedding
    if (!embedding) throw new Error('[EmbeddingService] La API no devolvió un embedding')

    return embedding
  }
}

// Ollama uses a different endpoint format from OpenAI
export class OllamaEmbeddingService implements IEmbeddingService {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetchClient: typeof fetch = globalThis.fetch,
  ) {}

  async generarEmbedding(text: string): Promise<number[]> {
    const res = await this.fetchClient(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    })

    if (!res.ok) throw new Error(`[OllamaEmbedding] HTTP ${res.status}`)

    const data = await res.json() as { embedding?: number[] }
    if (!data.embedding) throw new Error('[OllamaEmbedding] Respuesta sin campo embedding')

    return data.embedding
  }
}

// Keep for backward compatibility in tests
export const OpenAIEmbeddingService = OpenAICompatibleEmbeddingService

export function crearEmbeddingService(): IEmbeddingService | null {
  // NVIDIA NIM (cloud — misma key que deepseek/glm/minimax)
  const nvidiaKey = process.env['NVIDIA_API_KEY'] ?? process.env['NVIDIA_QWEN_KEY']
  if (nvidiaKey) {
    const client = new OpenAI({ apiKey: nvidiaKey, baseURL: NVIDIA_BASE_URL })
    return new OpenAICompatibleEmbeddingService(client, NVIDIA_EMBED_MODEL, EMBEDDING_DIMENSIONS)
  }

  // OpenAI (si está disponible)
  const openaiKey = process.env['OPENAI_API_KEY']
  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey })
    return new OpenAICompatibleEmbeddingService(client, 'text-embedding-3-small', EMBEDDING_DIMENSIONS)
  }

  // Ollama (dev local)
  if (process.env['WASAGRO_LLM'] === 'ollama') {
    const baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
    return new OllamaEmbeddingService(baseUrl, OLLAMA_EMBED_MODEL)
  }

  return null
}
