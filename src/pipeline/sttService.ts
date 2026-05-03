import { DeepgramClient, type ListenV1Response, type ListenV1AcceptedResponse } from '@deepgram/sdk'
import { langfuse } from '../integrations/langfuse.js'

export async function transcribirAudio(
  audioInput: string | Buffer,
  traceId: string,
  deps: { fetchClient?: typeof fetch } = {},
): Promise<string> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch

  const deepgramKey = process.env['DEEPGRAM_API_KEY']
  if (!deepgramKey) throw new Error('DEEPGRAM_API_KEY no configurada en el servidor')

  const deepgram = new DeepgramClient({ apiKey: deepgramKey })

  const trace = langfuse.trace({ id: traceId })
  const generation = trace.generation({
    name: 'transcribir_audio',
    model: 'nova-2-general',
    input: { audio_ref: typeof audioInput === 'string' ? audioInput : '[buffer]' },
  })

  const inicio = Date.now()
  try {
    let buffer: Buffer

    if (typeof audioInput === 'string') {
      const audioRes = await fetchClient(audioInput)
      if (!audioRes.ok) {
        throw new Error(`[sttService] No se pudo descargar audio (HTTP ${audioRes.status}): ${audioInput}`)
      }
      buffer = Buffer.from(await audioRes.arrayBuffer())
    } else {
      buffer = audioInput
    }

    // SDK v5: HttpResponsePromise<T> extends Promise<T> — await devuelve T directamente (ListenV1Response | ListenV1AcceptedResponse)
    const response: ListenV1Response | ListenV1AcceptedResponse = await deepgram.listen.v1.media.transcribeFile(buffer, {
      model: 'nova-2-general',
      language: 'multi',
      smart_format: true,
    })

    const transcription = 'results' in response
      ? response.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
      : ''

    generation.end({ output: transcription, metadata: { latencia_ms: Date.now() - inicio } })
    return transcription
  } catch (err) {
    generation.end({ output: String(err), level: 'ERROR' })
    throw err
  }
}
