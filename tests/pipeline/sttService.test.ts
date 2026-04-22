import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({
      startGeneration: vi.fn().mockReturnValue({ end: vi.fn() }),
      event: vi.fn(),
    }),
  },
}))

vi.mock('../../src/integrations/openai.js', () => ({
  openai: {},
  STT_MODEL: 'gpt-4o-mini-transcribe',
  LLM_MODEL: 'gpt-4o-mini',
}))

import { transcribirAudio } from '../../src/pipeline/sttService.js'

function crearFetchMock(audioBuffer: ArrayBuffer) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => audioBuffer,
  })
}

function crearOpenaiMock(text: string) {
  return {
    audio: {
      transcriptions: {
        create: vi.fn().mockResolvedValue({ text }),
      },
    },
  }
}

describe('transcribirAudio', () => {
  it('descarga el audio y llama a OpenAI con el modelo correcto', async () => {
    const buffer = new ArrayBuffer(8)
    const fetchMock = crearFetchMock(buffer)
    const openaiMock = crearOpenaiMock('Apliqué mancozeb en lote 3')

    const result = await transcribirAudio('http://audio.example.com/clip.ogg', 'trace-stt', {
      fetchClient: fetchMock as any,
      openaiClient: openaiMock as any,
    })

    expect(fetchMock).toHaveBeenCalledWith('http://audio.example.com/clip.ogg')
    expect(openaiMock.audio.transcriptions.create).toHaveBeenCalledOnce()
    expect(result).toBe('Apliqué mancozeb en lote 3')
  })

  it('lanza error si la descarga del audio falla', async () => {
    const fetchFail = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const openaiMock = crearOpenaiMock('')

    await expect(
      transcribirAudio('http://audio.example.com/missing.ogg', 'trace-stt', {
        fetchClient: fetchFail as any,
        openaiClient: openaiMock as any,
      })
    ).rejects.toThrow('HTTP 404')
  })

  it('propaga errores de la API de OpenAI', async () => {
    const buffer = new ArrayBuffer(8)
    const fetchMock = crearFetchMock(buffer)
    const openaiError = {
      audio: {
        transcriptions: {
          create: vi.fn().mockRejectedValue(new Error('quota exceeded')),
        },
      },
    }

    await expect(
      transcribirAudio('http://audio.example.com/clip.ogg', 'trace-stt', {
        fetchClient: fetchMock as any,
        openaiClient: openaiError as any,
      })
    ).rejects.toThrow('quota exceeded')
  })
})
