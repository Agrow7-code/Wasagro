import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      generation: vi.fn().mockReturnValue({ end: vi.fn() }),
      event: vi.fn(),
    }),
  },
}))

vi.mock('../../src/integrations/ssrfProtection.js', () => ({
  validateUrlAgainstSSRF: vi.fn().mockResolvedValue(undefined),
}))

const transcribeFileMock = vi.fn()

vi.mock('@deepgram/sdk', () => ({
  DeepgramClient: vi.fn().mockImplementation(() => ({
    listen: { v1: { media: { transcribeFile: transcribeFileMock } } },
  })),
}))

import { transcribirAudio } from '../../src/pipeline/sttService.js'

const DEEPGRAM_OK = {
  results: { channels: [{ alternatives: [{ transcript: 'Apliqué mancozeb en lote 3' }] }] },
}

function crearFetchMock(audioBuffer: ArrayBuffer) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => audioBuffer,
  })
}

beforeEach(() => {
  process.env['DEEPGRAM_API_KEY'] = 'test-deepgram-key'
  transcribeFileMock.mockReset()
})

describe('transcribirAudio', () => {
  it('descarga el audio y llama a Deepgram con el modelo correcto', async () => {
    const buffer = new ArrayBuffer(8)
    const fetchMock = crearFetchMock(buffer)
    transcribeFileMock.mockResolvedValue(DEEPGRAM_OK)

    const result = await transcribirAudio('http://audio.example.com/clip.ogg', 'trace-stt', {
      fetchClient: fetchMock as any,
    })

    expect(fetchMock).toHaveBeenCalledWith('http://audio.example.com/clip.ogg', { redirect: 'error' })
    expect(transcribeFileMock).toHaveBeenCalledOnce()
    expect(transcribeFileMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ model: 'nova-2-general', language: 'multi', smart_format: true }),
    )
    expect(result).toBe('Apliqué mancozeb en lote 3')
  })

  it('lanza error si la descarga del audio falla', async () => {
    const fetchFail = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(
      transcribirAudio('http://audio.example.com/missing.ogg', 'trace-stt', {
        fetchClient: fetchFail as any,
      })
    ).rejects.toThrow('HTTP 404')
  })

  it('propaga errores de la API de Deepgram', async () => {
    const buffer = new ArrayBuffer(8)
    const fetchMock = crearFetchMock(buffer)
    transcribeFileMock.mockRejectedValue(new Error('quota exceeded'))

    await expect(
      transcribirAudio('http://audio.example.com/clip.ogg', 'trace-stt', {
        fetchClient: fetchMock as any,
      })
    ).rejects.toThrow('quota exceeded')
  })

  it('lanza si DEEPGRAM_API_KEY no está configurada', async () => {
    delete process.env['DEEPGRAM_API_KEY']
    await expect(
      transcribirAudio(Buffer.from([1, 2, 3]), 'trace-stt'),
    ).rejects.toThrow('DEEPGRAM_API_KEY')
  })
})
