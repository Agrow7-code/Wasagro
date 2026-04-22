import OpenAI from 'openai'
import { openai as defaultOpenai, STT_MODEL } from '../integrations/openai.js'
import { langfuse } from '../integrations/langfuse.js'

export async function transcribirAudio(
  audioUrl: string,
  traceId: string,
  deps: { fetchClient?: typeof fetch; openaiClient?: OpenAI } = {},
): Promise<string> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch
  const openaiClient = deps.openaiClient ?? defaultOpenai

  const trace = langfuse.trace({ id: traceId })
  const generation = trace.startGeneration({
    name: 'transcribir_audio',
    model: STT_MODEL,
    input: { audio_url: audioUrl },
  })

  const inicio = Date.now()
  try {
    const audioRes = await fetchClient(audioUrl)
    if (!audioRes.ok) {
      throw new Error(`[sttService] No se pudo descargar audio (HTTP ${audioRes.status}): ${audioUrl}`)
    }

    const buffer = await audioRes.arrayBuffer()
    const file = new File([buffer], 'audio.ogg', { type: 'audio/ogg; codecs=opus' })

    const transcription = await openaiClient.audio.transcriptions.create({
      model: STT_MODEL,
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
