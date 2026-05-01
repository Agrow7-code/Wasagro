import { DeepgramClient } from '@deepgram/sdk'
import { langfuse } from '../integrations/langfuse.js'

export async function transcribirAudio(
  audioUrl: string,
  traceId: string,
  deps: { fetchClient?: typeof fetch } = {},
): Promise<string> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch
  
  const deepgramKey = process.env['DEEPGRAM_API_KEY']
  if (!deepgramKey) throw new Error('DEEPGRAM_API_KEY no configurada en el servidor')

  // Deepgram SDK v5: Constructor espera un objeto con apiKey
  const deepgram = new DeepgramClient({ apiKey: deepgramKey })

  const trace = langfuse.trace({ id: traceId })
  const generation = trace.generation({
    name: 'transcribir_audio',
    model: 'nova-2-general', 
    input: { audio_url: audioUrl },
  })

  const inicio = Date.now()
  try {
    const audioRes = await fetchClient(audioUrl)
    if (!audioRes.ok) {
      throw new Error(`[sttService] No se pudo descargar audio (HTTP ${audioRes.status}): ${audioUrl}`)
    }

    const buffer = await audioRes.arrayBuffer()

    // Usar SDK v5 API: client.listen.v1.media.transcribeFile
    // Documentación Multilingual: https://developers.deepgram.com/docs/multilingual-code-switching
    const result = await deepgram.listen.v1.media.transcribeFile(
      Buffer.from(buffer),
      {
        model: 'nova-2-general',
        language: 'multi', // Habilita la detección multi-idioma
        smart_format: true,
      }
    )

    // En v5, result es directamente la respuesta (ListenV1Response | ListenV1AcceptedResponse)
    const transcription = (result as any)?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''

    generation.end({ output: transcription, metadata: { latencia_ms: Date.now() - inicio, deepgram_result: result } })
    return transcription
  } catch (err) {
    generation.end({ output: String(err), level: 'ERROR' })
    throw err
  }
}
