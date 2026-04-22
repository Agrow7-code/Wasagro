import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

import {
  getMensajeByWamid,
  registrarMensaje,
  actualizarMensaje,
  getUserByPhone,
  getLotesByFinca,
  getOrCreateSession,
  saveEvento,
} from '../../src/pipeline/supabaseQueries.js'

function crearThenable(result: unknown) {
  const obj: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  }
  obj['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return obj
}

function crearSupabaseMock() {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  }
  return { from: vi.fn().mockReturnValue(chainMethods), _chain: chainMethods }
}

describe('supabaseQueries', () => {
  describe('getMensajeByWamid', () => {
    it('retorna null si no existe el wamid', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })

      const result = await getMensajeByWamid('wamid.XYZ', mock as any)
      expect(result).toBeNull()
    })

    it('retorna el mensaje si existe', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: { id: 'uuid-1', wa_message_id: 'wamid.XYZ', status: 'processed' }, error: null })

      const result = await getMensajeByWamid('wamid.XYZ', mock as any)
      expect(result?.id).toBe('uuid-1')
    })

    it('lanza error si Supabase devuelve error', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: new Error('DB error') })

      await expect(getMensajeByWamid('wamid.XYZ', mock as any)).rejects.toThrow('DB error')
    })
  })

  describe('getUserByPhone', () => {
    it('retorna usuario cuando existe', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({
        data: { id: 'usr-1', phone: '593987654321', onboarding_completo: true, finca_id: 'F001' },
        error: null,
      })

      const result = await getUserByPhone('593987654321', mock as any)
      expect(result?.id).toBe('usr-1')
      expect(result?.finca_id).toBe('F001')
    })
  })

  describe('getLotesByFinca', () => {
    it('retorna lista de lotes', async () => {
      const lotes = [{ lote_id: 'F001-L01', finca_id: 'F001', nombre_coloquial: 'El de arriba', hectareas: 2.5 }]
      const thenable = crearThenable({ data: lotes, error: null })
      const mockFinal = { from: vi.fn().mockReturnValue(thenable) }

      const result = await getLotesByFinca('F001', mockFinal as any)
      expect(result).toHaveLength(1)
      expect(result[0]?.lote_id).toBe('F001-L01')
    })
  })

  describe('saveEvento', () => {
    it('retorna el UUID del evento creado', async () => {
      const mock = crearSupabaseMock()
      mock._chain.single.mockResolvedValue({ data: { id: 'evt-uuid-1' }, error: null })

      const id = await saveEvento({
        finca_id: 'F001',
        tipo_evento: 'insumo',
        status: 'complete',
        datos_evento: { producto: 'mancozeb' },
        descripcion_raw: 'Apliqué mancozeb',
        confidence_score: 0.9,
      }, mock as any)

      expect(id).toBe('evt-uuid-1')
    })
  })

  describe('registrarMensaje', () => {
    it('retorna el UUID del mensaje creado', async () => {
      const mock = crearSupabaseMock()
      mock._chain.single.mockResolvedValue({ data: { id: 'msg-uuid-1' }, error: null })

      const id = await registrarMensaje({
        wa_message_id: 'wamid.ABC',
        phone: '593987654321',
        tipo_mensaje: 'text',
        contenido_raw: 'hola',
      }, mock as any)

      expect(id).toBe('msg-uuid-1')
    })
  })

  describe('getOrCreateSession', () => {
    it('retorna sesión activa existente si la hay', async () => {
      const existingSession = { session_id: 'ses-1', phone: '593987654321', tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {}, status: 'active', finca_id: null, paso_onboarding: null }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: existingSession, error: null })

      const result = await getOrCreateSession('593987654321', 'reporte', mock as any)
      expect(result.session_id).toBe('ses-1')
    })

    it('crea nueva sesión si no hay activa', async () => {
      const newSession = { session_id: 'ses-2', phone: '593987654321', tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {}, status: 'active', finca_id: null, paso_onboarding: null }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })
      mock._chain.single.mockResolvedValue({ data: newSession, error: null })

      const result = await getOrCreateSession('593987654321', 'reporte', mock as any)
      expect(result.session_id).toBe('ses-2')
    })
  })

  describe('actualizarMensaje', () => {
    it('llama update sin error', async () => {
      const thenable = crearThenable({ error: null })
      const mockFinal = { from: vi.fn().mockReturnValue(thenable) }

      await expect(actualizarMensaje('msg-1', { status: 'processed' }, mockFinal as any)).resolves.toBeUndefined()
    })
  })
})
