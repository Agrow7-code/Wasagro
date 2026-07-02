import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  actualizarMensaje: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/integrations/supabaseStorage.js', () => ({
  subirMediaSDR: vi.fn(),
}))

vi.mock('../../src/integrations/whatsapp/EvolutionMediaClient.js', () => ({
  downloadEvolutionMedia: vi.fn(),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn() }) },
}))

import { ingerirMediaSDR } from '../../src/pipeline/handlers/SDRMediaIngest.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'
import * as storage from '../../src/integrations/supabaseStorage.js'
import * as mediaClient from '../../src/integrations/whatsapp/EvolutionMediaClient.js'

const baseMsg: NormalizedMessage = {
  wamid: 'wamid.sdr.001', from: '593987654321', timestamp: new Date(),
  tipo: 'imagen', rawPayload: { data: { key: {}, message: {} } },
}

describe('ingerirMediaSDR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['EVOLUTION_API_URL'] = 'https://evo.example'
    process.env['EVOLUTION_API_KEY'] = 'key'
    process.env['EVOLUTION_INSTANCE'] = 'wasagro-prod'
  })

  it('tipo texto → no-op, no descarga ni sube nada', async () => {
    const msg: NormalizedMessage = { ...baseMsg, tipo: 'texto', texto: 'hola' }

    await ingerirMediaSDR(msg, 'msg-1', 'trace-1')

    expect(mediaClient.downloadEvolutionMedia).not.toHaveBeenCalled()
    expect(storage.subirMediaSDR).not.toHaveBeenCalled()
    expect(queries.actualizarMensaje).not.toHaveBeenCalled()
  })

  it('imagen: descarga + sube + guarda media_path en éxito', async () => {
    vi.mocked(mediaClient.downloadEvolutionMedia).mockResolvedValue({ base64: 'aGVsbG8=', mimeType: 'image/jpeg' })
    vi.mocked(storage.subirMediaSDR).mockResolvedValue('sdr/593987654321/uuid.jpg')

    await ingerirMediaSDR(baseMsg, 'msg-2', 'trace-2')

    expect(mediaClient.downloadEvolutionMedia).toHaveBeenCalledWith(baseMsg.rawPayload, 'https://evo.example', 'key', 'wasagro-prod')
    expect(storage.subirMediaSDR).toHaveBeenCalledWith('aGVsbG8=', 'image/jpeg', '593987654321')
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-2', { media_path: 'sdr/593987654321/uuid.jpg' })
  })

  it('audio: usa msg.mediaBase64 cuando ya viene resuelto (no llama a downloadEvolutionMedia)', async () => {
    const msg: NormalizedMessage = { ...baseMsg, tipo: 'audio', mediaBase64: 'YXVkaW8=', mediaMimetype: 'audio/ogg' }
    vi.mocked(storage.subirMediaSDR).mockResolvedValue('sdr/593987654321/uuid.ogg')

    await ingerirMediaSDR(msg, 'msg-3', 'trace-3')

    expect(mediaClient.downloadEvolutionMedia).not.toHaveBeenCalled()
    expect(storage.subirMediaSDR).toHaveBeenCalledWith('YXVkaW8=', 'audio/ogg', '593987654321')
    expect(queries.actualizarMensaje).toHaveBeenCalledWith('msg-3', { media_path: 'sdr/593987654321/uuid.ogg' })
  })

  it('descarga falla → se traga el error, NO lanza, NO actualiza media_path', async () => {
    vi.mocked(mediaClient.downloadEvolutionMedia).mockRejectedValue(new Error('Evolution timeout'))

    await expect(ingerirMediaSDR(baseMsg, 'msg-4', 'trace-4')).resolves.toBeUndefined()

    expect(storage.subirMediaSDR).not.toHaveBeenCalled()
    expect(queries.actualizarMensaje).not.toHaveBeenCalled()
  })

  it('upload devuelve null → no actualiza media_path, no lanza', async () => {
    vi.mocked(mediaClient.downloadEvolutionMedia).mockResolvedValue({ base64: 'aGVsbG8=', mimeType: 'image/jpeg' })
    vi.mocked(storage.subirMediaSDR).mockResolvedValue(null)

    await expect(ingerirMediaSDR(baseMsg, 'msg-5', 'trace-5')).resolves.toBeUndefined()

    expect(queries.actualizarMensaje).not.toHaveBeenCalled()
  })

  it('actualizarMensaje falla → se traga el error, no lanza', async () => {
    vi.mocked(mediaClient.downloadEvolutionMedia).mockResolvedValue({ base64: 'aGVsbG8=', mimeType: 'image/jpeg' })
    vi.mocked(storage.subirMediaSDR).mockResolvedValue('sdr/593987654321/uuid.jpg')
    vi.mocked(queries.actualizarMensaje).mockRejectedValue(new Error('db down'))

    await expect(ingerirMediaSDR(baseMsg, 'msg-6', 'trace-6')).resolves.toBeUndefined()
  })

  it('faltan credenciales Evolution → no descarga, no lanza', async () => {
    delete process.env['EVOLUTION_API_URL']

    await ingerirMediaSDR(baseMsg, 'msg-7', 'trace-7')

    expect(mediaClient.downloadEvolutionMedia).not.toHaveBeenCalled()
    expect(storage.subirMediaSDR).not.toHaveBeenCalled()
  })
})
