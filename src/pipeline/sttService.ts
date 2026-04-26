import OpenAI from 'openai'
import { openai as defaultOpenai, STT_MODEL } from '../integrations/openai.js'
import { langfuse } from '../integrations/langfuse.js'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

export async function transcribirAudio(
  audioUrl: string,
  traceId: string,
  deps: { fetchClient?: typeof fetch; openaiClient?: OpenAI } = {},
): Promise<string> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch
  
  // Decidir qué cliente usar
  let openaiClient = deps.openaiClient
  let model = STT_MODEL

  if (!openaiClient) {
    const nvidiaKey = process.env['NVIDIA_STT_KEY']
    if (nvidiaKey) {
      openaiClient = new OpenAI({ apiKey: nvidiaKey, baseURL: NVIDIA_BASE_URL })
      // Si usamos NVIDIA, el modelo por defecto suele ser parakeet-ctc-1.1b-asr
      // pero permitimos configurarlo vía env
      model = process.env['NVIDIA_STT_MODEL'] ?? 'nvidia/parakeet-ctc-1.1b-asl'
    } else {
      openaiClient = defaultOpenai as OpenAI
    }
  }

  if (!openaiClient) throw new Error('STT_NO_DISPONIBLE')

  const trace = langfuse.trace({ id: traceId })
  const generation = trace.generation({
    name: 'transcribir_audio',
    model: model,
    input: { audio_url: audioUrl },
  })

  const inicio = Date.now()
  try {
    const audioRes = await fetchClient(audioUrl)
    if (!audioRes.ok) {
      throw new Error(`[sttService] No se pudo descargar audio (HTTP ${audioRes.status}): ${audioUrl}`)
    }

    const buffer = await audioRes.arrayBuffer()
    // NVIDIA y OpenAI esperan un archivo real o un objeto compatible
    const file = new File([new Uint8Array(buffer)], 'audio.ogg', { type: 'audio/ogg; codecs=opus' })

    const transcription = await openaiClient.audio.transcriptions.create({
      model: model,
      file: file as unknown as File,
      language: 'es',
    })

    generation.end({ output: transcription.text, metadata: { latencia_ms: Date.now() - inicio } })
    return transcription.text
  } catch (err) {
    generation.end({ output: String(err), level: 'ERROR' })
    throw err
  }
}
