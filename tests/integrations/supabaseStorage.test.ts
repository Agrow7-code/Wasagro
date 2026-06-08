import { describe, it, expect, vi } from 'vitest'

// supabaseStorage importa ./supabase.js, que tira al cargar si no hay env.
// Lo mockeamos: subirImagenEvento recibe el cliente por parámetro, así que el
// export real nunca se toca en estos tests.
vi.mock('../../src/integrations/supabase.js', () => ({ supabase: {} }))

import {
  buildImagenPath,
  subirImagenEvento,
} from '../../src/integrations/supabaseStorage.js'

describe('buildImagenPath', () => {
  it('scoped por finca con extensión derivada del mime', () => {
    expect(buildImagenPath('F001', 'image/jpeg', 'abc')).toBe('F001/abc.jpg')
  })

  it('mime desconocido → extensión .bin', () => {
    expect(buildImagenPath('F001', 'application/zip', 'x')).toBe('F001/x.bin')
  })

  it('sanea caracteres no seguros del finca_id', () => {
    expect(buildImagenPath('F0/01', 'image/png', 'x')).toBe('F0_01/x.png')
  })

  it('usa sin-finca cuando el finca_id viene vacío', () => {
    expect(buildImagenPath('', 'image/png', 'x')).toBe('sin-finca/x.png')
  })
})

describe('subirImagenEvento', () => {
  const fakeClient = (uploadResult: unknown) =>
    ({ storage: { from: () => ({ upload: vi.fn().mockResolvedValue(uploadResult) }) } }) as any

  it('devuelve la ruta del objeto cuando el upload es exitoso', async () => {
    const path = await subirImagenEvento('aGVsbG8=', 'image/jpeg', 'F001', fakeClient({ error: null }))
    expect(path).toMatch(/^F001\/.+\.jpg$/)
  })

  it('devuelve null cuando Storage responde error (no lanza)', async () => {
    const path = await subirImagenEvento('aGVsbG8=', 'image/jpeg', 'F001', fakeClient({ error: { message: 'boom' } }))
    expect(path).toBeNull()
  })

  it('devuelve null cuando el upload tira excepción (no propaga)', async () => {
    const client = { storage: { from: () => ({ upload: vi.fn().mockRejectedValue(new Error('net')) }) } } as any
    const path = await subirImagenEvento('aGVsbG8=', 'image/jpeg', 'F001', client)
    expect(path).toBeNull()
  })
})
